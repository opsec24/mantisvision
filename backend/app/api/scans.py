"""Scan management API routes."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi import Request as FastAPIRequest
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.auth import get_current_user
from app.core.audit import log_user_action
from app.core.database import get_db
from app.core.models import Finding, Scan, User

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/scans", tags=["scans"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class ScanCreateRequest(BaseModel):
    source_type: str  # "git" or "local"
    source_target: str
    branch: Optional[str] = None
    git_token: Optional[str] = None
    phase_models: Optional[dict] = None
    budget_limit_usd: Optional[float] = None


class ScanResponse(BaseModel):
    id: uuid.UUID
    source_type: str
    source_target: str
    branch: Optional[str] = None
    status: str
    current_phase: Optional[str] = None
    phase_models: Optional[dict] = None
    budget_limit_usd: Optional[float] = None
    cost_spent_usd: float
    error_message: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    triggered_by: uuid.UUID


class FindingResponse(BaseModel):
    id: uuid.UUID
    scan_id: uuid.UUID
    title: str
    cwe: Optional[str] = None
    severity: str
    status: str
    file_path: Optional[str] = None
    line_number: Optional[int] = None
    description: Optional[str] = None
    poc_script: Optional[str] = None
    poc_output: Optional[str] = None
    patch_diff: Optional[str] = None
    created_at: datetime


class ScanDetailResponse(ScanResponse):
    findings: list[FindingResponse] = []


# ── Routes ────────────────────────────────────────────────────────────────────


@router.post("", response_model=ScanResponse, status_code=status.HTTP_201_CREATED)
async def create_scan(
    body: ScanCreateRequest,
    request: FastAPIRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScanResponse:
    """Create a new scan and enqueue it for asynchronous processing."""
    scan = Scan(
        source_type=body.source_type,
        source_target=body.source_target,
        branch=body.branch,
        git_token=body.git_token,
        triggered_by=current_user.id,
        status="queued",
        phase_models=body.phase_models,
        budget_limit_usd=body.budget_limit_usd,
    )
    db.add(scan)
    await db.flush()
    await db.refresh(scan)

    # Enqueue Celery task – import here to avoid circular imports at module
    # level when the worker isn't running.
    try:
        from app.pipeline.orchestrator import run_mantis_scan

        run_mantis_scan.delay(
            scan_id=str(scan.id),
            source_type=body.source_type,
            source_target=body.source_target,
            branch=body.branch,
            git_token=body.git_token,
        )
    except Exception as exc:
        logger.warning("celery_dispatch_failed", error=str(exc))

    # Audit log
    log_user_action(
        background_tasks=background_tasks,
        request=request,
        user_id=current_user.id,
        user_email=current_user.email,
        action="scan.created",
        resource_type="scan",
        resource_id=str(scan.id),
        metadata={"source_type": body.source_type, "source_target": body.source_target},
    )

    logger.info("scan_created", scan_id=str(scan.id), user=current_user.email)
    return _scan_to_response(scan)


@router.get("", response_model=list[ScanResponse])
async def list_scans(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ScanResponse]:
    """List all scans ordered by creation date (newest first)."""
    result = await db.execute(
        select(Scan).order_by(Scan.created_at.desc()).limit(limit).offset(offset)
    )
    scans = result.scalars().all()
    return [_scan_to_response(s) for s in scans]


@router.get("/{scan_id}", response_model=ScanDetailResponse)
async def get_scan(
    scan_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScanDetailResponse:
    """Get full scan details including findings."""
    result = await db.execute(
        select(Scan).options(selectinload(Scan.findings)).where(Scan.id == scan_id)
    )
    scan = result.scalar_one_or_none()
    if scan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")

    return ScanDetailResponse(
        **_scan_to_response(scan).model_dump(),
        findings=[_finding_to_response(f) for f in scan.findings],
    )


@router.post("/{scan_id}/cancel", response_model=ScanResponse)
async def cancel_scan(
    scan_id: uuid.UUID,
    request: FastAPIRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScanResponse:
    """Cancel a running or queued scan."""
    result = await db.execute(select(Scan).where(Scan.id == scan_id))
    scan = result.scalar_one_or_none()
    if scan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")

    if scan.status not in ("queued", "running"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot cancel scan in '{scan.status}' status",
        )

    await db.execute(
        update(Scan)
        .where(Scan.id == scan_id)
        .values(status="cancelled", completed_at=datetime.now(timezone.utc))
    )
    await db.flush()
    await db.refresh(scan)

    log_user_action(
        background_tasks=background_tasks,
        request=request,
        user_id=current_user.id,
        user_email=current_user.email,
        action="scan.cancelled",
        resource_type="scan",
        resource_id=str(scan_id),
    )

    logger.info("scan_cancelled", scan_id=str(scan_id), user=current_user.email)
    return _scan_to_response(scan)


@router.get("/{scan_id}/findings", response_model=list[FindingResponse])
async def list_findings(
    scan_id: uuid.UUID,
    severity: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[FindingResponse]:
    """List findings for a specific scan, optionally filtered by severity."""
    query = select(Finding).where(Finding.scan_id == scan_id)
    if severity:
        query = query.where(Finding.severity == severity)
    query = query.order_by(Finding.created_at.desc())

    result = await db.execute(query)
    findings = result.scalars().all()
    return [_finding_to_response(f) for f in findings]


@router.get("/{scan_id}/findings/{finding_id}", response_model=FindingResponse)
async def get_finding(
    scan_id: uuid.UUID,
    finding_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FindingResponse:
    """Get a single finding with PoC and patch details."""
    result = await db.execute(
        select(Finding).where(Finding.id == finding_id, Finding.scan_id == scan_id)
    )
    finding = result.scalar_one_or_none()
    if finding is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Finding not found")
    return _finding_to_response(finding)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _scan_to_response(scan: Scan) -> ScanResponse:
    return ScanResponse(
        id=scan.id,
        source_type=scan.source_type,
        source_target=scan.source_target,
        branch=scan.branch,
        status=scan.status,
        current_phase=scan.current_phase,
        phase_models=scan.phase_models,
        budget_limit_usd=scan.budget_limit_usd,
        cost_spent_usd=scan.cost_spent_usd,
        error_message=scan.error_message,
        created_at=scan.created_at,
        completed_at=scan.completed_at,
        triggered_by=scan.triggered_by,
    )


def _finding_to_response(finding: Finding) -> FindingResponse:
    return FindingResponse(
        id=finding.id,
        scan_id=finding.scan_id,
        title=finding.title,
        cwe=finding.cwe,
        severity=finding.severity,
        status=finding.status,
        file_path=finding.file_path,
        line_number=finding.line_number,
        description=finding.description,
        poc_script=finding.poc_script,
        poc_output=finding.poc_output,
        patch_diff=finding.patch_diff,
        created_at=finding.created_at,
    )
