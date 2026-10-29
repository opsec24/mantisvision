"""Paginated audit log API route."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

import structlog
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.core.database import get_db
from app.core.models import AuditLog, User

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/audit", tags=["audit"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class AuditLogResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_email: str
    action: str
    resource_type: str
    resource_id: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None
    created_at: datetime


class PaginatedAuditResponse(BaseModel):
    items: list[AuditLogResponse]
    total: int
    limit: int
    offset: int


# ── Routes ────────────────────────────────────────────────────────────────────


@router.get("", response_model=PaginatedAuditResponse)
async def list_audit_logs(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user_email: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    resource_type: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PaginatedAuditResponse:
    """Return paginated audit logs with optional filters."""
    base_query = select(AuditLog)
    count_query = select(func.count(AuditLog.id))

    # Apply filters
    if user_email:
        base_query = base_query.where(AuditLog.user_email == user_email)
        count_query = count_query.where(AuditLog.user_email == user_email)
    if action:
        base_query = base_query.where(AuditLog.action == action)
        count_query = count_query.where(AuditLog.action == action)
    if resource_type:
        base_query = base_query.where(AuditLog.resource_type == resource_type)
        count_query = count_query.where(AuditLog.resource_type == resource_type)
    if date_from:
        base_query = base_query.where(AuditLog.created_at >= date_from)
        count_query = count_query.where(AuditLog.created_at >= date_from)
    if date_to:
        base_query = base_query.where(AuditLog.created_at <= date_to)
        count_query = count_query.where(AuditLog.created_at <= date_to)

    # Total count
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Paginated results
    result = await db.execute(
        base_query.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
    )
    logs = result.scalars().all()

    return PaginatedAuditResponse(
        items=[_log_to_response(log) for log in logs],
        total=total,
        limit=limit,
        offset=offset,
    )


# ── Helpers ───────────────────────────────────────────────────────────────────


def _log_to_response(log: AuditLog) -> AuditLogResponse:
    return AuditLogResponse(
        id=log.id,
        user_id=log.user_id,
        user_email=log.user_email,
        action=log.action,
        resource_type=log.resource_type,
        resource_id=log.resource_id,
        ip_address=log.ip_address,
        user_agent=log.user_agent,
        metadata=log.metadata_,
        created_at=log.created_at,
    )
