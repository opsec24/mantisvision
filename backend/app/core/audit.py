"""Async audit-logging helpers."""

from __future__ import annotations

import uuid
from typing import Any, Optional

import structlog
from fastapi import BackgroundTasks, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory

logger = structlog.get_logger(__name__)


async def write_audit_log(
    user_id: uuid.UUID,
    user_email: str,
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> None:
    """Insert a row into the ``audit_logs`` table.

    Uses its own short-lived session so that the audit write succeeds even if
    the caller's transaction rolls back.
    """
    async with async_session_factory() as session:
        try:
            await session.execute(
                text(
                    """
                    INSERT INTO audit_logs
                        (id, user_id, user_email, action, resource_type,
                         resource_id, ip_address, user_agent, metadata)
                    VALUES
                        (:id, :user_id, :user_email, :action, :resource_type,
                         :resource_id, :ip_address, :user_agent, :metadata::jsonb)
                    """
                ),
                {
                    "id": uuid.uuid4(),
                    "user_id": user_id,
                    "user_email": user_email,
                    "action": action,
                    "resource_type": resource_type,
                    "resource_id": resource_id,
                    "ip_address": ip_address,
                    "user_agent": user_agent,
                    "metadata": _json_dumps(metadata),
                },
            )
            await session.commit()
        except Exception as exc:
            logger.error("audit_log_write_failed", error=str(exc))
            await session.rollback()


def _json_dumps(obj: Any) -> Optional[str]:
    """Safely serialise *obj* to a JSON string or return ``None``."""
    if obj is None:
        return None
    import json

    return json.dumps(obj, default=str)


def log_user_action(
    background_tasks: BackgroundTasks,
    request: Request,
    user_id: uuid.UUID,
    user_email: str,
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> None:
    """Extract IP / User-Agent from the request and schedule an audit write
    as a FastAPI background task so it doesn't block the response."""
    ip_address = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")

    background_tasks.add_task(
        write_audit_log,
        user_id=user_id,
        user_email=user_email,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        ip_address=ip_address,
        user_agent=user_agent,
        metadata=metadata,
    )
