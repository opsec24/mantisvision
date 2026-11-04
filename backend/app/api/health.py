"""Health-check API route."""

from __future__ import annotations

import structlog
from fastapi import APIRouter
from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine

logger = structlog.get_logger(__name__)
router = APIRouter(tags=["health"])


@router.get("/api/health")
async def health_check() -> dict:
    """Check connectivity to Postgres, Redis, and the Docker daemon.

    Returns a JSON object with the status of each dependency and an overall
    ``status`` field (``healthy`` or ``degraded``).
    """
    checks: dict[str, str] = {}

    # ── Postgres ──────────────────────────────────────────────────────
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception as exc:
        logger.warning("health_postgres_fail", error=str(exc))
        checks["postgres"] = f"error: {exc}"

    # ── Redis ─────────────────────────────────────────────────────────
    try:
        import redis.asyncio as aioredis

        r = aioredis.from_url(settings.REDIS_URL)
        pong = await r.ping()
        checks["redis"] = "ok" if pong else "no pong"
        await r.close()
    except Exception as exc:
        logger.warning("health_redis_fail", error=str(exc))
        checks["redis"] = f"error: {exc}"

    # ── Docker ────────────────────────────────────────────────────────
    try:
        import docker

        client = docker.from_env()
        client.ping()
        checks["docker"] = "ok"
        client.close()
    except Exception as exc:
        logger.warning("health_docker_fail", error=str(exc))
        checks["docker"] = f"error: {exc}"

    # ── Overall ───────────────────────────────────────────────────────
    all_ok = all(v == "ok" for v in checks.values())

    active_count = 0
    queued_count = 0
    db_status = "connected" if checks.get("postgres") == "ok" else "disconnected"
    redis_status = "connected" if checks.get("redis") == "ok" else "disconnected"
    docker_status = "connected" if checks.get("docker") == "ok" else "unavailable"

    if checks.get("postgres") == "ok":
        try:
            async with engine.begin() as conn:
                res_act = await conn.execute(text("SELECT COUNT(*) FROM scans WHERE status = 'running'"))
                active_count = res_act.scalar() or 0
                res_q = await conn.execute(text("SELECT COUNT(*) FROM scans WHERE status = 'queued'"))
                queued_count = res_q.scalar() or 0
        except Exception:
            pass

    return {
        "status": "healthy" if all_ok else "degraded",
        "database": db_status,
        "redis": redis_status,
        "docker": docker_status,
        "active_scans": active_count,
        "queued_scans": queued_count,
        "checks": checks,
    }
