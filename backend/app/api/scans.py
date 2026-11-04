"""Scan management API routes."""

from __future__ import annotations

import io
import os
import shutil
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from fastapi import Request as FastAPIRequest
from pydantic import BaseModel
from sqlalchemy import delete, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.auth import get_current_user
from app.core.audit import log_user_action
from app.core.database import get_db
from app.core.models import AgentInferenceTrace, Finding, Scan, User

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/scans", tags=["scans"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class ScanCreateRequest(BaseModel):
    name: Optional[str] = None
    source_type: str  # "git" or "local"
    source_target: str
    branch: Optional[str] = None
    git_token: Optional[str] = None
    phase_models: Optional[dict] = None
    budget_limit_usd: Optional[float] = None
    fresh: Optional[bool] = False  # If True, purge historical knowledge base and start from clean slate


class ScanResponse(BaseModel):
    id: uuid.UUID
    name: Optional[str] = None
    source_type: str
    source_target: str
    branch: Optional[str] = None
    status: str
    current_phase: Optional[str] = None
    phase_models: Optional[dict] = None
    budget_limit_usd: Optional[float] = None
    cost_spent_usd: float
    findings_count: int = 0
    error_message: Optional[str] = None
    architecture_summary: Optional[str] = None
    threat_model: Optional[str] = None
    hunting_plan: Optional[str] = None
    review_packet: Optional[str] = None
    exploit_chains: Optional[Any] = None
    total_tokens: Optional[int] = 0
    prompt_tokens: Optional[int] = 0
    completion_tokens: Optional[int] = 0
    created_at: datetime
    completed_at: Optional[datetime] = None
    triggered_by: uuid.UUID


class BulkDeleteRequest(BaseModel):
    scan_ids: list[uuid.UUID]


class ScanSummaryMetric(BaseModel):
    id: uuid.UUID
    name: str
    source_type: str
    source_target: str
    branch: Optional[str] = None
    status: str
    phase_models: Optional[dict] = None
    cost_spent_usd: float
    duration_seconds: Optional[float] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    findings_count: int
    reproduced_count: int
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int


class FindingComparisonItem(BaseModel):
    id: str
    title: str
    cwe: Optional[str] = None
    file_path: Optional[str] = None
    line_number: Optional[int] = None
    severity: str
    detected_in_scan_ids: list[str]
    scan_statuses: dict[str, str]
    has_poc: dict[str, bool]
    has_patch: dict[str, bool]
    description: Optional[str] = None


class ScanComparisonResponse(BaseModel):
    same_repository: bool
    scans: list[ScanSummaryMetric]
    phase_models: dict[str, dict[str, str]]
    common_findings: list[FindingComparisonItem]
    exclusive_findings: dict[str, list[FindingComparisonItem]]
    all_findings: list[FindingComparisonItem]


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
    observation_id: Optional[str] = None
    source_sink_trace: Optional[dict[str, Any]] = None
    exploit_steps: Optional[str] = None
    mitigation: Optional[str] = None
    created_at: datetime


class ScanDetailResponse(ScanResponse):
    findings: list[FindingResponse] = []
    stage_observations: dict[str, str] = {}
    stage_observation_counts: dict[str, int] = {}


class TraceStepResponse(BaseModel):
    id: uuid.UUID
    scan_id: uuid.UUID
    step_number: int
    phase: str
    agent_name: str
    model: Optional[str] = None
    has_thinking: bool
    thinking_preview: Optional[str] = None
    thinking_content: Optional[str] = None
    prompt_raw: Optional[str] = None
    response_raw: Optional[str] = None
    tool_name: Optional[str] = None
    tool_input: Optional[dict[str, Any]] = None
    tool_output: Optional[str] = None
    candidate_vuln_title: Optional[str] = None
    decision_status: str
    decision_reason: Optional[str] = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    latency_ms: int = 0
    cost_usd: float = 0.0
    created_at: datetime


class TraceListResponse(BaseModel):
    scan_id: uuid.UUID
    total: int
    traces: list[TraceStepResponse]


class TraceSummaryResponse(BaseModel):
    scan_id: uuid.UUID
    total_steps: int
    total_reasoning_tokens: int
    tools_breakdown: dict[str, int]
    candidates_breakdown: dict[str, int]
    phases_breakdown: dict[str, int]


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
    scan_name = (body.name or "").strip()
    if not scan_name:
        scan_name = os.path.basename(body.source_target.rstrip("/").removesuffix(".git")) or body.source_target

    phase_models_dict = dict(body.phase_models or {})
    if body.fresh:
        phase_models_dict["fresh"] = True
        try:
            from app.pipeline.orchestrator import _get_repo_id, _purge_repo_knowledge_base
            _purge_repo_knowledge_base(_get_repo_id(body.source_target))
        except Exception as kb_err:
            logger.warning("purge_kb_on_create_failed", error=str(kb_err))

    scan = Scan(
        name=scan_name,
        source_type=body.source_type,
        source_target=body.source_target,
        branch=body.branch,
        git_token=body.git_token,
        triggered_by=current_user.id,
        status="queued",
        phase_models=phase_models_dict,
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
        metadata={"name": scan_name, "source_type": body.source_type, "source_target": body.source_target},
    )

    logger.info("scan_created", scan_id=str(scan.id), name=scan_name, user=current_user.email)
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
        select(Scan)
        .options(selectinload(Scan.findings))
        .order_by(Scan.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    scans = result.scalars().all()
    return [_scan_to_response(s) for s in scans]


@router.get("/compare", response_model=ScanComparisonResponse)
async def compare_scans(
    ids: str = Query(..., description="Comma-separated scan UUIDs to compare"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScanComparisonResponse:
    """Compare performance, model configurations, and findings across multiple scans."""
    raw_ids = [x.strip() for x in ids.split(",") if x.strip()]
    scan_uuids = []
    for raw in raw_ids:
        try:
            scan_uuids.append(uuid.UUID(raw))
        except ValueError:
            continue

    if len(scan_uuids) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least 2 valid scan IDs are required for comparison",
        )

    result = await db.execute(
        select(Scan).options(selectinload(Scan.findings)).where(Scan.id.in_(scan_uuids))
    )
    scans = result.scalars().all()
    if len(scans) < 2:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Could not find at least 2 of the requested scans to compare",
        )

    # Check same repository
    same_repo = len(set(s.source_target.lower().rstrip("/").removesuffix(".git") for s in scans)) == 1

    # Build scan summaries
    scans_meta: list[ScanSummaryMetric] = []
    for s in scans:
        scan_name = s.name or os.path.basename(s.source_target.rstrip("/").removesuffix(".git")) or s.source_target
        duration = (s.completed_at - s.created_at).total_seconds() if s.completed_at and s.created_at else None
        findings = s.findings or []
        reproduced = sum(1 for f in findings if f.status == "reproduced")
        critical = sum(1 for f in findings if (f.severity or "").lower() == "critical")
        high = sum(1 for f in findings if (f.severity or "").lower() == "high")
        medium = sum(1 for f in findings if (f.severity or "").lower() == "medium")
        low = sum(1 for f in findings if (f.severity or "").lower() == "low")

        scans_meta.append(
            ScanSummaryMetric(
                id=s.id,
                name=scan_name,
                source_type=s.source_type,
                source_target=s.source_target,
                branch=s.branch,
                status=s.status,
                phase_models=s.phase_models,
                cost_spent_usd=s.cost_spent_usd,
                duration_seconds=duration,
                created_at=s.created_at,
                completed_at=s.completed_at,
                findings_count=len(findings),
                reproduced_count=reproduced,
                critical_count=critical,
                high_count=high,
                medium_count=medium,
                low_count=low,
            )
        )

    # Build phase models comparison
    phases = ["recon", "threat_model", "research", "critic", "reproduce", "patch"]
    phase_models_map: dict[str, dict[str, str]] = {}
    for p in phases:
        phase_models_map[p] = {}
        for s in scans:
            pm = s.phase_models or {}
            phase_models_map[p][str(s.id)] = pm.get(p, "default")

    # Group & merge findings
    merged_findings: dict[str, FindingComparisonItem] = {}
    for s in scans:
        s_id = str(s.id)
        for f in (s.findings or []):
            cwe = (f.cwe or "").strip().upper()
            f_norm = (f.file_path or "").strip().lower().replace("\\", "/")
            fname = f_norm.split("/")[-1] if f_norm else ""
            t_norm = "".join(c for c in f.title.lower() if c.isalnum() or c.isspace()).strip()[:40]
            fp_key = f"{cwe}|{fname}|{t_norm}"

            if fp_key not in merged_findings:
                merged_findings[fp_key] = FindingComparisonItem(
                    id=f"{s_id}_{len(merged_findings)}",
                    title=f.title,
                    cwe=f.cwe,
                    file_path=f.file_path,
                    line_number=f.line_number,
                    severity=f.severity,
                    detected_in_scan_ids=[s_id],
                    scan_statuses={s_id: f.status},
                    has_poc={s_id: bool(f.poc_script and f.poc_script.strip())},
                    has_patch={s_id: bool(f.patch_diff and f.patch_diff.strip())},
                    description=f.description,
                )
            else:
                item = merged_findings[fp_key]
                if s_id not in item.detected_in_scan_ids:
                    item.detected_in_scan_ids.append(s_id)
                item.scan_statuses[s_id] = f.status
                item.has_poc[s_id] = bool(f.poc_script and f.poc_script.strip())
                item.has_patch[s_id] = bool(f.patch_diff and f.patch_diff.strip())
                if not item.description and f.description:
                    item.description = f.description

    all_list = list(merged_findings.values())
    total_scans_count = len(scans)
    common_list = [f for f in all_list if len(f.detected_in_scan_ids) == total_scans_count]

    exclusive_dict: dict[str, list[FindingComparisonItem]] = {str(s.id): [] for s in scans}
    for f in all_list:
        if len(f.detected_in_scan_ids) == 1:
            exclusive_dict[f.detected_in_scan_ids[0]].append(f)

    return ScanComparisonResponse(
        same_repository=same_repo,
        scans=scans_meta,
        phase_models=phase_models_map,
        common_findings=common_list,
        exclusive_findings=exclusive_dict,
        all_findings=all_list,
    )


def _terminate_scan_task_and_locks(scan_ids: list[str]) -> None:
    """Safely revoke running Celery tasks and purge Redis locks for the given scan IDs."""
    if not scan_ids:
        return
    scan_id_set = {str(sid) for sid in scan_ids}
    try:
        from app.pipeline.orchestrator import celery_app
        inspect = celery_app.control.inspect()
        active = inspect.active() or {}
        for worker_name, tasks in active.items():
            for t in tasks:
                t_sid = str(t.get("kwargs", {}).get("scan_id") or "")
                if t_sid in scan_id_set:
                    celery_app.control.revoke(t["id"], terminate=True, signal="SIGKILL")
                    logger.info("celery_task_revoked", scan_id=t_sid, task_id=t["id"])
    except Exception as ex:
        logger.warning("celery_task_revoke_failed", error=str(ex))

    try:
        import redis as redis_lib
        r = redis_lib.from_url(settings.REDIS_URL)
        for sid in scan_id_set:
            r.delete(f"scan:{sid}:running_lock")
    except Exception:
        pass


@router.post("/bulk-delete")
async def bulk_delete_scans(
    body: BulkDeleteRequest,
    request: FastAPIRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple scans at once."""
    if not body.scan_ids:
        return {"message": "No scans specified", "deleted_count": 0}

    # Immediately terminate any active worker tasks for deleted scans
    _terminate_scan_task_and_locks([str(sid) for sid in body.scan_ids])

    result = await db.execute(select(Scan).where(Scan.id.in_(body.scan_ids)))
    scans = result.scalars().all()
    if not scans:
        return {"message": "No matching scans found", "deleted_count": 0}

    deleted_ids = []
    target_to_ids: dict[str, list[str]] = {}
    for s in scans:
        deleted_ids.append(str(s.id))
        target_to_ids.setdefault(s.source_target, []).append(str(s.id))
        scan_dir = Path(f"/data/scans/{s.id}")
        if scan_dir.exists():
            shutil.rmtree(scan_dir, ignore_errors=True)

    await db.execute(delete(Scan).where(Scan.id.in_(body.scan_ids)))
    await db.commit()

    # Clean up knowledge base on disk so future scans start clean
    try:
        from app.pipeline.orchestrator import _get_repo_id, _purge_repo_knowledge_base
        for source_target, s_ids in target_to_ids.items():
            repo_id = _get_repo_id(source_target)
            rem_res = await db.execute(select(Scan.id).where(Scan.source_target == source_target))
            has_remaining = rem_res.scalars().first() is not None
            if not has_remaining:
                _purge_repo_knowledge_base(repo_id)
            else:
                for s_id in s_ids:
                    _purge_repo_knowledge_base(repo_id, scan_id=s_id)
    except Exception as exc:
        logger.warning("bulk_delete_kb_cleanup_failed", error=str(exc))

    log_user_action(
        background_tasks=background_tasks,
        request=request,
        user_id=current_user.id,
        user_email=current_user.email,
        action="scans.bulk_deleted",
        resource_type="scan",
        resource_id=",".join(deleted_ids),
        metadata={"count": len(deleted_ids)},
    )

    logger.info("scans_bulk_deleted", count=len(deleted_ids), user=current_user.email)
    return {
        "message": f"Successfully deleted {len(deleted_ids)} scans",
        "deleted_count": len(deleted_ids),
        "deleted_ids": deleted_ids,
    }


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

    stage_obs: dict[str, str] = {}
    stage_counts: dict[str, int] = {}
    try:
        obs_res = await db.execute(
            text(
                """
                SELECT 
                    phase,
                    (ARRAY_AGG(id::text ORDER BY step_number ASC))[1] AS first_trace_id,
                    COUNT(id) AS trace_count
                FROM agent_inference_traces
                WHERE scan_id = :scan_id
                GROUP BY phase
                """
            ),
            {"scan_id": scan_id},
        )
        for row in obs_res:
            if row.phase:
                stage_obs[row.phase] = str(row.first_trace_id)
                stage_counts[row.phase] = int(row.trace_count)
    except Exception as exc:
        logger.warning("fetch_stage_traces_failed", scan_id=str(scan_id), error=str(exc))

    return ScanDetailResponse(
        **_scan_to_response(scan).model_dump(),
        findings=[_finding_to_response(f) for f in scan.findings],
        stage_observations=stage_obs,
        stage_observation_counts=stage_counts,
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

    # Immediately terminate any running Celery task and locks
    _terminate_scan_task_and_locks([str(scan_id)])

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


@router.post("/{scan_id}/retry", response_model=ScanResponse)
async def retry_scan(
    scan_id: uuid.UUID,
    request: FastAPIRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScanResponse:
    """Retry a failed, error, or cancelled scan."""
    result = await db.execute(select(Scan).where(Scan.id == scan_id))
    scan = result.scalar_one_or_none()
    if scan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")

    if scan.status == "running":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot retry a scan that is currently running",
        )

    # Clean up previous findings
    await db.execute(delete(Finding).where(Finding.scan_id == scan_id))

    # Reset scan attributes to start fresh
    await db.execute(
        update(Scan)
        .where(Scan.id == scan_id)
        .values(
            status="queued",
            current_phase="ingest",
            error_message=None,
            completed_at=None,
            cost_spent_usd=0.0,
            architecture_summary=None,
            threat_model=None,
            hunting_plan=None,
            review_packet=None,
            exploit_chains=None,
        )
    )
    await db.flush()
    await db.refresh(scan)

    # Clean up previous scan disk artifacts if any
    scan_disk_dir = Path(f"/data/scans/{scan_id}")
    if scan_disk_dir.is_dir():
        for item in scan_disk_dir.iterdir():
            if item.is_file():
                try:
                    item.unlink(missing_ok=True)
                except Exception:
                    pass

    # Enqueue pipeline in Celery
    try:
        from app.pipeline.orchestrator import run_mantis_scan
        run_mantis_scan.delay(
            scan_id=str(scan.id),
            source_type=scan.source_type,
            source_target=scan.source_target,
            branch=scan.branch,
            git_token=scan.git_token,
        )
    except Exception as exc:
        logger.error("celery_dispatch_failed", scan_id=str(scan.id), error=str(exc))
        await db.execute(
            update(Scan)
            .where(Scan.id == scan_id)
            .values(status="failed", error_message=f"Celery dispatch failed: {exc}")
        )
        await db.flush()
        await db.refresh(scan)

    log_user_action(
        background_tasks=background_tasks,
        request=request,
        user_id=current_user.id,
        user_email=current_user.email,
        action="scan.retried",
        resource_type="scan",
        resource_id=str(scan_id),
    )

    logger.info("scan_retried", scan_id=str(scan_id), user=current_user.email)
    return _scan_to_response(scan)


@router.post("/{scan_id}/resume", response_model=ScanResponse)
async def resume_scan(
    scan_id: uuid.UUID,
    request: FastAPIRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScanResponse:
    """Resume a failed, error, or cancelled scan from its last completed checkpoint."""
    result = await db.execute(select(Scan).where(Scan.id == scan_id))
    scan = result.scalar_one_or_none()
    if scan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")

    if scan.status == "running":
        # Check if the scan is actively running in Celery or orphaned by a worker restart
        try:
            from app.pipeline.orchestrator import celery_app
            i = celery_app.control.inspect(timeout=1.0)
            active_workers = i.active() or {}
            is_active = False
            for w, tasks in active_workers.items():
                if any(t.get("kwargs", {}).get("scan_id") == str(scan_id) for t in tasks):
                    is_active = True
                    break
            if is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Scan is actively executing on a worker node",
                )
        except HTTPException:
            raise
        except Exception:
            pass

    # Clear any stale lock in Redis before resuming
    try:
        from app.pipeline.orchestrator import _get_redis
        redis = _get_redis()
        redis.delete(f"scan:{scan_id}:running_lock")
    except Exception:
        pass

    # Verify that a scan workspace exists to resume from
    scan_disk_dir = Path(f"/data/scans/{scan_id}")
    workspace_dir = scan_disk_dir / "workspace"
    if not workspace_dir.is_dir():
        # No workspace to resume from; fall back to retry
        return await retry_scan(scan_id, request, background_tasks, current_user, db)

    # Set scan status to queued without wiping existing artifacts, cost, or findings
    await db.execute(
        update(Scan)
        .where(Scan.id == scan_id)
        .values(
            status="queued",
            error_message=None,
            completed_at=None,
        )
    )
    await db.flush()
    await db.refresh(scan)

    # Enqueue pipeline in Celery with resume=True
    try:
        from app.pipeline.orchestrator import run_mantis_scan
        run_mantis_scan.delay(
            scan_id=str(scan.id),
            source_type=scan.source_type,
            source_target=scan.source_target,
            branch=scan.branch,
            git_token=scan.git_token,
            resume=True,
        )
    except Exception as exc:
        logger.error("celery_resume_dispatch_failed", scan_id=str(scan.id), error=str(exc))
        await db.execute(
            update(Scan)
            .where(Scan.id == scan_id)
            .values(status="failed", error_message=f"Celery dispatch failed: {exc}")
        )
        await db.flush()
        await db.refresh(scan)

    log_user_action(
        background_tasks=background_tasks,
        request=request,
        user_id=current_user.id,
        user_email=current_user.email,
        action="scan.resumed",
        resource_type="scan",
        resource_id=str(scan_id),
    )

    logger.info("scan_resumed", scan_id=str(scan_id), user=current_user.email)
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


@router.delete("/{scan_id}")
async def delete_scan(
    scan_id: uuid.UUID,
    request: FastAPIRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a single scan and all associated data."""
    result = await db.execute(select(Scan).where(Scan.id == scan_id))
    scan = result.scalar_one_or_none()
    if scan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")

    source_target = scan.source_target
    scan_id_str = str(scan_id)

    # Immediately terminate any running Celery task and locks
    _terminate_scan_task_and_locks([scan_id_str])

    scan_dir = Path(f"/data/scans/{scan_id}")
    if scan_dir.exists():
        shutil.rmtree(scan_dir, ignore_errors=True)

    await db.execute(delete(Scan).where(Scan.id == scan_id))
    await db.commit()

    # Clean up knowledge base on disk so future scans are not falsely treated as rescans
    try:
        from app.pipeline.orchestrator import _get_repo_id, _purge_repo_knowledge_base
        repo_id = _get_repo_id(source_target)
        rem_res = await db.execute(select(Scan.id).where(Scan.source_target == source_target))
        has_remaining = rem_res.scalars().first() is not None
        if not has_remaining:
            _purge_repo_knowledge_base(repo_id)
        else:
            _purge_repo_knowledge_base(repo_id, scan_id=scan_id_str)
    except Exception as exc:
        logger.warning("delete_scan_kb_cleanup_failed", error=str(exc))

    log_user_action(
        background_tasks=background_tasks,
        request=request,
        user_id=current_user.id,
        user_email=current_user.email,
        action="scan.deleted",
        resource_type="scan",
        resource_id=str(scan_id),
    )

    logger.info("scan_deleted", scan_id=str(scan_id), user=current_user.email)
    return {"message": "Scan deleted successfully", "id": str(scan_id)}


class PurgeKnowledgeBaseRequest(BaseModel):
    source_target: Optional[str] = None
    all_targets: Optional[bool] = False


@router.post("/purge-knowledge-base")
async def purge_knowledge_base(
    body: PurgeKnowledgeBaseRequest,
    current_user: User = Depends(get_current_user),
):
    """Purge cached repository knowledge base / historical learnings from disk."""
    from app.pipeline.orchestrator import _get_repo_id, _purge_repo_knowledge_base
    if body.all_targets:
        for base in ("/data/scans/.kb", "/data/knowledge_base"):
            p = Path(base)
            if p.exists():
                shutil.rmtree(p, ignore_errors=True)
                p.mkdir(parents=True, exist_ok=True)
        return {"message": "All repository knowledge bases successfully purged"}
    
    if body.source_target:
        repo_id = _get_repo_id(body.source_target)
        _purge_repo_knowledge_base(repo_id)
        return {"message": f"Knowledge base for {body.source_target} successfully purged"}
    
    raise HTTPException(status_code=400, detail="Must provide source_target or set all_targets=True")


@router.get("/{scan_id}/export/patch")
async def export_patch(
    scan_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download unified git patch file for all verified fixes in this scan."""
    result = await db.execute(
        select(Finding).where(Finding.scan_id == scan_id).order_by(Finding.created_at.asc())
    )
    findings = result.scalars().all()

    patches: list[str] = []
    for f in findings:
        if f.patch_diff and f.patch_diff.strip():
            header = f"# Finding: {f.title} ({f.cwe or 'CWE-Unknown'})\n# Severity: {f.severity}\n# Target: {f.file_path or 'unknown'}\n"
            patches.append(header + f.patch_diff.strip())

    combined_diff = "\n\n".join(patches)
    if not combined_diff:
        # Check if patch.diff exists on disk
        disk_patch = Path(f"/data/scans/{scan_id}/patch.diff")
        if disk_patch.exists():
            combined_diff = disk_patch.read_text(encoding="utf-8", errors="replace")

    if not combined_diff:
        combined_diff = "# No verified patches generated for this scan.\n"

    filename = f"mantis_patch_{str(scan_id)[:8]}.diff"
    return Response(
        content=combined_diff,
        media_type="text/x-diff",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{scan_id}/export/log")
async def export_log(
    scan_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
):
    """Download physical execution log file for this scan."""
    disk_log = Path(f"/data/scans/{scan_id}/pipeline.log")
    if not disk_log.exists():
        content = "# No log file generated for this scan yet.\n"
    else:
        content = disk_log.read_text(encoding="utf-8", errors="replace")

    filename = f"pipeline_{str(scan_id)[:8]}.log"
    return Response(
        content=content,
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{scan_id}/export/bundle")
async def export_bundle(
    scan_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download complete audit ZIP bundle (findings, patches, review packet, reproducers, logs)."""
    result = await db.execute(
        select(Scan).options(selectinload(Scan.findings)).where(Scan.id == scan_id)
    )
    scan = result.scalar_one_or_none()
    if scan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        # 1. findings.json
        findings_data = [_finding_to_response(f).model_dump(mode="json") for f in scan.findings]
        zf.writestr("findings.json", json.dumps(findings_data, indent=2, default=str))

        # 2. Combined patch.diff
        patches = [f.patch_diff.strip() for f in scan.findings if f.patch_diff and f.patch_diff.strip()]
        zf.writestr("patch.diff", "\n\n".join(patches) if patches else "# No patches available\n")

        # 3. Artifact markdown files
        scan_dir = Path(f"/data/scans/{scan_id}")
        for fname in ("architecture.md", "threat_model.md", "hunting_plan.md", "review_packet.md", "pipeline.log"):
            p = scan_dir / fname
            if p.exists():
                try:
                    zf.writestr(fname, p.read_bytes())
                except Exception:
                    pass

        # 4. PoC script if available
        for f in scan.findings:
            if f.poc_script:
                f_safe_title = "".join(c for c in f.title if c.isalnum() or c in ("-", "_")).lower()[:30]
                zf.writestr(f"reproducers/reproduce_{f_safe_title}.py", f.poc_script)

    zip_buffer.seek(0)
    filename = f"mantis_audit_bundle_{str(scan_id)[:8]}.zip"
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Helpers ───────────────────────────────────────────────────────────────────


def _scan_to_response(scan: Scan) -> ScanResponse:
    scan_name = scan.name
    if not scan_name:
        scan_name = os.path.basename(scan.source_target.rstrip("/").removesuffix(".git")) or scan.source_target

    findings_cnt = len(scan.findings) if "findings" in scan.__dict__ and scan.findings is not None else 0

    arch = getattr(scan, "architecture_summary", None)
    tm = getattr(scan, "threat_model", None)
    hp = getattr(scan, "hunting_plan", None)
    rp = getattr(scan, "review_packet", None)
    ec = getattr(scan, "exploit_chains", None)

    # Disk fallbacks if not yet in DB
    scan_dir = Path(f"/data/scans/{scan.id}")
    if not arch and (scan_dir / "architecture.md").exists():
        try:
            arch = (scan_dir / "architecture.md").read_text(encoding="utf-8", errors="replace")
        except Exception:
            pass
    if not tm and (scan_dir / "threat_model.md").exists():
        try:
            tm = (scan_dir / "threat_model.md").read_text(encoding="utf-8", errors="replace")
        except Exception:
            pass
    if not hp and (scan_dir / "hunting_plan.md").exists():
        try:
            hp = (scan_dir / "hunting_plan.md").read_text(encoding="utf-8", errors="replace")
        except Exception:
            pass
    if not rp and (scan_dir / "review_packet.md").exists():
        try:
            rp = (scan_dir / "review_packet.md").read_text(encoding="utf-8", errors="replace")
        except Exception:
            pass

    return ScanResponse(
        id=scan.id,
        name=scan_name,
        source_type=scan.source_type,
        source_target=scan.source_target,
        branch=scan.branch,
        status=scan.status,
        current_phase=scan.current_phase,
        phase_models=scan.phase_models,
        budget_limit_usd=scan.budget_limit_usd,
        cost_spent_usd=scan.cost_spent_usd,
        findings_count=findings_cnt,
        error_message=scan.error_message,
        architecture_summary=arch,
        threat_model=tm,
        hunting_plan=hp,
        review_packet=rp,
        exploit_chains=ec,
        total_tokens=getattr(scan, "total_tokens", 0) or 0,
        prompt_tokens=getattr(scan, "prompt_tokens", 0) or 0,
        completion_tokens=getattr(scan, "completion_tokens", 0) or 0,
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
        observation_id=getattr(finding, "observation_id", None),
        source_sink_trace=getattr(finding, "source_sink_trace", None),
        exploit_steps=getattr(finding, "exploit_steps", None),
        mitigation=getattr(finding, "mitigation", None),
        created_at=finding.created_at,
    )


# ── Native Swarm Traces & Low-Level Forensics ──────────────────────────────────


@router.get("/{scan_id}/traces", response_model=TraceListResponse)
async def get_scan_traces(
    scan_id: uuid.UUID,
    phase: Optional[str] = Query(None, description="Filter by phase (recon, research, critic, etc.)"),
    tool: Optional[str] = Query(None, description="Filter by tool name (grep_code, read_file, execute_sandbox, etc.)"),
    status: Optional[str] = Query(None, description="Filter by decision status (VERIFIED, REJECTED_BY_CRITIC, DISCARDED, TOOL_EXEC)"),
    q: Optional[str] = Query(None, description="Forensic search query across file names, thinking content, tool args & output"),
    limit: int = Query(250, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TraceListResponse:
    """Retrieve full low-level forensic traces for a scan with full text and tool filtering."""
    query = select(AgentInferenceTrace).where(AgentInferenceTrace.scan_id == scan_id)

    if phase:
        query = query.where(AgentInferenceTrace.phase == phase)
    if tool:
        query = query.where(AgentInferenceTrace.tool_name == tool)
    if status:
        query = query.where(AgentInferenceTrace.decision_status == status)
    if q and q.strip():
        search_pattern = f"%{q.strip()}%"
        from sqlalchemy import or_, cast, String
        query = query.where(
            or_(
                AgentInferenceTrace.thinking_content.ilike(search_pattern),
                AgentInferenceTrace.tool_output.ilike(search_pattern),
                AgentInferenceTrace.candidate_vuln_title.ilike(search_pattern),
                AgentInferenceTrace.decision_reason.ilike(search_pattern),
                cast(AgentInferenceTrace.tool_input, String).ilike(search_pattern),
                AgentInferenceTrace.prompt_raw.ilike(search_pattern),
            )
        )

    # Count total
    from sqlalchemy import func
    count_query = select(func.count()).select_from(query.subquery())
    total_res = await db.execute(count_query)
    total = total_res.scalar() or 0

    # Fetch ordered traces
    query = query.order_by(AgentInferenceTrace.step_number.asc()).offset(offset).limit(limit)
    res = await db.execute(query)
    rows = res.scalars().all()

    trace_items = [
        TraceStepResponse(
            id=r.id,
            scan_id=r.scan_id,
            step_number=r.step_number,
            phase=r.phase,
            agent_name=r.agent_name,
            model=r.model,
            has_thinking=bool(r.thinking_content),
            thinking_preview=(r.thinking_content[:300] + "...") if r.thinking_content and len(r.thinking_content) > 300 else r.thinking_content,
            thinking_content=r.thinking_content,
            prompt_raw=r.prompt_raw,
            response_raw=r.response_raw,
            tool_name=r.tool_name,
            tool_input=r.tool_input,
            tool_output=r.tool_output,
            candidate_vuln_title=r.candidate_vuln_title,
            decision_status=r.decision_status,
            decision_reason=r.decision_reason,
            prompt_tokens=r.prompt_tokens or 0,
            completion_tokens=r.completion_tokens or 0,
            total_tokens=r.total_tokens or 0,
            latency_ms=r.latency_ms or 0,
            cost_usd=r.cost_usd or 0.0,
            created_at=r.created_at,
        )
        for r in rows
    ]

    return TraceListResponse(
        scan_id=scan_id,
        total=total,
        traces=trace_items,
    )


@router.get("/{scan_id}/traces/summary", response_model=TraceSummaryResponse)
async def get_scan_traces_summary(
    scan_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TraceSummaryResponse:
    """Retrieve aggregate summary stats of inference traces for a scan."""
    total_res = await db.execute(
        text("SELECT COUNT(id), COALESCE(SUM(completion_tokens), 0) FROM agent_inference_traces WHERE scan_id = :scan_id"),
        {"scan_id": scan_id},
    )
    total_row = total_res.fetchone()
    total_steps = int(total_row[0] or 0) if total_row else 0
    total_reasoning_tokens = int(total_row[1] or 0) if total_row else 0

    # Tools breakdown
    tool_res = await db.execute(
        text("SELECT tool_name, COUNT(id) FROM agent_inference_traces WHERE scan_id = :scan_id AND tool_name IS NOT NULL GROUP BY tool_name"),
        {"scan_id": scan_id},
    )
    tools_breakdown = {row[0]: int(row[1]) for row in tool_res}

    # Candidates / Decisions breakdown
    dec_res = await db.execute(
        text("SELECT decision_status, COUNT(id) FROM agent_inference_traces WHERE scan_id = :scan_id AND decision_status != 'PROGRESS' GROUP BY decision_status"),
        {"scan_id": scan_id},
    )
    candidates_breakdown = {row[0]: int(row[1]) for row in dec_res}

    # Phases breakdown
    phase_res = await db.execute(
        text("SELECT phase, COUNT(id) FROM agent_inference_traces WHERE scan_id = :scan_id GROUP BY phase"),
        {"scan_id": scan_id},
    )
    phases_breakdown = {row[0]: int(row[1]) for row in phase_res}

    return TraceSummaryResponse(
        scan_id=scan_id,
        total_steps=total_steps,
        total_reasoning_tokens=total_reasoning_tokens,
        tools_breakdown=tools_breakdown,
        candidates_breakdown=candidates_breakdown,
        phases_breakdown=phases_breakdown,
    )


@router.get("/{scan_id}/traces/{trace_id}", response_model=TraceStepResponse)
async def get_single_trace(
    scan_id: uuid.UUID,
    trace_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TraceStepResponse:
    """Retrieve full unclipped details for a single trace step."""
    res = await db.execute(
        select(AgentInferenceTrace).where(
            AgentInferenceTrace.scan_id == scan_id,
            AgentInferenceTrace.id == trace_id,
        )
    )
    r = res.scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trace step not found")

    return TraceStepResponse(
        id=r.id,
        scan_id=r.scan_id,
        step_number=r.step_number,
        phase=r.phase,
        agent_name=r.agent_name,
        model=r.model,
        has_thinking=bool(r.thinking_content),
        thinking_preview=(r.thinking_content[:300] + "...") if r.thinking_content and len(r.thinking_content) > 300 else r.thinking_content,
        thinking_content=r.thinking_content,
        prompt_raw=r.prompt_raw,
        response_raw=r.response_raw,
        tool_name=r.tool_name,
        tool_input=r.tool_input,
        tool_output=r.tool_output,
        candidate_vuln_title=r.candidate_vuln_title,
        decision_status=r.decision_status,
        decision_reason=r.decision_reason,
        prompt_tokens=r.prompt_tokens or 0,
        completion_tokens=r.completion_tokens or 0,
        total_tokens=r.total_tokens or 0,
        latency_ms=r.latency_ms or 0,
        cost_usd=r.cost_usd or 0.0,
        created_at=r.created_at,
    )
