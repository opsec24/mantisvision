"""Server-Sent Events (SSE) stream for real-time and historical scan progress."""

from __future__ import annotations

import asyncio
import json
import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.models import Scan, User

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/scans", tags=["stream"])


@router.get("/{scan_id}/stream")
async def stream_scan_progress(
    scan_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """SSE endpoint that streams historical and real-time scan progress."""
    result = await db.execute(select(Scan).where(Scan.id == scan_id))
    scan = result.scalar_one_or_none()
    if scan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")

    return StreamingResponse(
        _event_generator(str(scan_id), scan),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _event_generator(scan_id: str, scan: Scan):
    """Replay past scan events from Redis and stream new ones via Redis Pub/Sub."""
    import redis.asyncio as aioredis

    redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    history_key = f"scan:{scan_id}:history"
    channel_name = f"scan:{scan_id}:progress"
    pubsub = redis_client.pubsub()

    try:
        # 1. Replay historical logs from Redis list, or fallback to Postgres traces if Redis history is empty
        history = await redis_client.lrange(history_key, 0, -1)
        if history:
            for item in history:
                yield f"data: {item}\n\n"
        else:
            try:
                from app.core.database import async_session_factory
                from app.core.models import AgentInferenceTrace
                async with async_session_factory() as trace_db:
                    res = await trace_db.execute(
                        select(AgentInferenceTrace)
                        .where(AgentInferenceTrace.scan_id == uuid.UUID(scan_id))
                        .order_by(AgentInferenceTrace.step_number.asc())
                        .limit(300)
                    )
                    rows = res.scalars().all()
                    for r in rows:
                        msg = r.response_raw or (f"[{r.tool_name}]" if r.tool_name else f"Swarm step {r.step_number}")
                        payload = json.dumps({
                            "step": r.step_number,
                            "phase": r.phase,
                            "node": r.agent_name,
                            "timestamp": r.created_at.isoformat() if r.created_at else "",
                            "message": msg,
                            "decision_status": r.decision_status,
                        })
                        yield f"data: {payload}\n\n"
            except Exception as fb_err:
                logger.warning("sse_db_replay_failed", scan_id=scan_id, error=str(fb_err))

        # 2. If scan is already terminal and no history was stored yet (e.g. initial failure), yield terminal event
        if scan.status in ("completed", "failed", "cancelled", "budget_exceeded"):
            if not history:
                term_msg = scan.error_message or f"Scan {scan.status}"
                term_payload = json.dumps({
                    "scan_id": scan_id,
                    "phase": scan.current_phase or "done",
                    "status": scan.status,
                    "message": term_msg,
                    "cost": scan.cost_spent_usd,
                })
                yield f"data: {term_payload}\n\n"
            yield f"event: done\ndata: {json.dumps({'done': True, 'status': scan.status})}\n\n"
            return

        # 3. Otherwise subscribe to live channel for active updates
        await pubsub.subscribe(channel_name)
        logger.info("sse_subscribed", scan_id=scan_id, channel=channel_name)

        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message["type"] == "message":
                raw_data = message["data"]
                # Send standard data message for onmessage compatibility
                yield f"data: {raw_data}\n\n"

                # Check for terminal status
                try:
                    payload = json.loads(raw_data)
                    if payload.get("status") in (
                        "completed",
                        "failed",
                        "cancelled",
                        "budget_exceeded",
                    ):
                        break
                except (json.JSONDecodeError, KeyError):
                    pass
            else:
                yield ": heartbeat\n\n"

            await asyncio.sleep(0.1)

    except asyncio.CancelledError:
        logger.info("sse_client_disconnected", scan_id=scan_id)
    except Exception as exc:
        logger.error("sse_error", scan_id=scan_id, error=str(exc))
        yield f"data: {json.dumps({'status': 'failed', 'message': str(exc)})}\n\n"
    finally:
        try:
            await pubsub.unsubscribe(channel_name)
            await pubsub.close()
            await redis_client.close()
        except Exception:
            pass
