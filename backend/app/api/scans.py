"""Scan management API routes."""

from __future__ import annotations

import csv
import html
import io
import json
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
from app.pipeline.orchestrator import NODE_TO_PHASE, _format_threat_model_md, calculate_cost_usd

PHASE_NODE_MAP = {
    "ingest": ["setup", "clone", "ready", "ingest", "orchestrator"],
    "indexing": ["history", "structural_index", "indexing"],
    "threat_model": ["architect", "threat_modeler", "threat_model"],
    "research": ["planner", "researcher", "research"],
    "critic": ["deduplicator", "reviewer", "critic", "findings_gate"],
    "reproduce": ["reproducer", "chainer", "reproduce"],
    "patch": ["patcher", "calibrator", "reflector", "reporter", "patch", "completed"],
}

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/scans", tags=["scans"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class ScanCreateRequest(BaseModel):
    name: Optional[str] = None
    source_type: str  # "git" or "local"
    source_target: str
    branch: Optional[str] = None
    git_token: Optional[str] = None
    # Mantis-native flags
    model: Optional[str] = None                    # e.g. "openai/gpt-4o", "gemini-3.5-flash-lite"
    phase_models: Optional[dict[str, str]] = None  # Per-stage model routing
    phase_efforts: Optional[dict[str, str]] = None # Per-stage reasoning effort
    reasoning_effort: Optional[str] = "medium"     # "low", "medium", "high"
    focus: Optional[str] = None                    # e.g. "look for IDOR", "find SSRF"
    exclude: Optional[list[str]] = None            # e.g. ["vendor", "testdata", "*.min.js"]
    max_tokens: Optional[int] = None               # token budget ceiling
    budget_limit_usd: Optional[float] = None       # USD budget ceiling
    sandbox: Optional[str] = "static-only"         # "static-only", "microsandbox", "gvisor"
    resume: Optional[bool] = False                 # resume from last checkpoint
    fresh: Optional[bool] = False                  # wipe workspace and start clean
    scan_mode: Optional[str] = "auto"              # "auto", "whole", "file-by-file", "cross-functional", "changed"
    objective: Optional[str] = None                # natural language objective for graph synthesizer
    seed_report: Optional[str] = None              # path or content for variant bug hunting
    deterministic_only: Optional[bool] = False     # force deterministic archetype synthesis
    no_replan: Optional[bool] = False              # freeze campaign plan at start
    parallel: Optional[int] = 1                    # concurrent campaigns
    max_llm_calls: Optional[int] = None            # LLM calls limit
    api_base: Optional[str] = None                 # custom API base endpoint


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
    # Mantis-native fields
    model: Optional[str] = None
    reasoning_effort: Optional[str] = None
    focus: Optional[str] = None
    sandbox: Optional[str] = None
    scan_config: Optional[dict[str, Any]] = None


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

    # Fresh scan option: each scan operates in an isolated workspace under /data/scans/{scan_id}

    # Clean phase models if provided
    clean_phase_models = None
    if body.phase_models and isinstance(body.phase_models, dict):
        clean_phase_models = {k: v.strip() for k, v in body.phase_models.items() if v and str(v).strip()}
        if not clean_phase_models:
            clean_phase_models = None

    scan_config = {
        "model": body.model,
        "phase_models": clean_phase_models,
        "phase_efforts": body.phase_efforts,
        "reasoning_effort": body.reasoning_effort,
        "focus": body.focus,
        "exclude": body.exclude or [],
        "max_tokens": body.max_tokens,
        "sandbox": body.sandbox or "static-only",
        "scan_mode": body.scan_mode or "auto",
        "objective": body.objective,
        "seed_report": body.seed_report,
        "deterministic_only": body.deterministic_only or False,
        "no_replan": body.no_replan or False,
        "parallel": body.parallel or 1,
        "max_llm_calls": body.max_llm_calls,
        "api_base": body.api_base,
    }

    scan = Scan(
        name=scan_name,
        source_type=body.source_type,
        source_target=body.source_target,
        branch=body.branch,
        git_token=body.git_token,
        triggered_by=current_user.id,
        status="queued",
        budget_limit_usd=body.budget_limit_usd,
        # Mantis-native fields
        model=body.model or ("Swarm (Multi-Model)" if clean_phase_models else None),
        reasoning_effort=body.reasoning_effort,
        focus=body.focus,
        sandbox=body.sandbox or "static-only",
        exclude_patterns=body.exclude or [],
        phase_models=clean_phase_models or ({"recon": body.model, "threat_model": body.model, "research": body.model, "critic": body.model, "reproduce": body.model, "patch": body.model} if body.model else None),
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
            resume=body.resume or False,
            scan_config=scan_config,
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
            phase_models_map[p][str(s.id)] = pm.get(p) or s.model or "default"

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

    # On-demand sync of architecture, threat model, hunting plan, review packet from knowledge.db if missing in DB
    db_updates = {}
    kb_path = Path(f"/data/scans/{scan_id}/knowledge.db")
    if kb_path.exists() and (not scan.architecture_summary or not scan.threat_model or not scan.hunting_plan or not scan.review_packet):
        try:
            import sqlite3
            con = sqlite3.connect(str(kb_path))
            rows = con.execute("SELECT filepath, content FROM campaign_artifacts").fetchall()
            con.close()
            for fpath, content in rows:
                if not scan.architecture_summary and not db_updates.get("architecture_summary") and "architecture.md" in fpath and content:
                    scan.architecture_summary = content
                    db_updates["architecture_summary"] = content
                elif not scan.threat_model and not db_updates.get("threat_model") and "threat_model" in fpath.lower() and content:
                    formatted_tm = _format_threat_model_md(content)
                    scan.threat_model = formatted_tm
                    db_updates["threat_model"] = formatted_tm
                elif not scan.hunting_plan and not db_updates.get("hunting_plan") and ("plan.json" in fpath or "hunting_plan" in fpath) and content:
                    scan.hunting_plan = content
                    db_updates["hunting_plan"] = content
                elif not scan.review_packet and not db_updates.get("review_packet") and ("review_packet" in fpath or "report.json" in fpath) and content:
                    scan.review_packet = content
                    db_updates["review_packet"] = content
        except Exception as kb_err:
            logger.warning("get_scan_kb_sync_failed", scan_id=str(scan_id), error=str(kb_err))

    # On-demand sync of token spend and calculated USD cost from knowledge.db if missing or 0
    if kb_path.exists() and (not scan.total_tokens or scan.total_tokens == 0 or not scan.cost_spent_usd or scan.cost_spent_usd == 0.0):
        try:
            import sqlite3
            con = sqlite3.connect(str(kb_path))
            spend_row = con.execute("SELECT COALESCE(SUM(tokens), 0), COALESCE(SUM(llm_calls), 0) FROM campaign_spend").fetchone()
            con.close()
            if spend_row and spend_row[0] > 0:
                ttok = int(spend_row[0])
                ptok = int(ttok * 0.75)
                ctok = ttok - ptok
                cost_val = calculate_cost_usd(scan.model, ttok, ptok, ctok)
                scan.total_tokens = ttok
                scan.prompt_tokens = ptok
                scan.completion_tokens = ctok
                scan.cost_spent_usd = cost_val
                db_updates["total_tokens"] = ttok
                db_updates["prompt_tokens"] = ptok
                db_updates["completion_tokens"] = ctok
                db_updates["cost_spent_usd"] = cost_val
        except Exception as spend_err:
            logger.warning("get_scan_spend_sync_failed", scan_id=str(scan_id), error=str(spend_err))

    if db_updates:
        try:
            await db.execute(update(Scan).where(Scan.id == scan_id).values(**db_updates))
            await db.commit()
        except Exception:
            pass

    stage_obs: dict[str, str] = {}
    stage_counts: dict[str, int] = {}
    try:
        obs_res = await db.execute(
            text(
                """
                SELECT 
                    phase,
                    agent_name,
                    (ARRAY_AGG(id::text ORDER BY step_number ASC))[1] AS first_trace_id,
                    COUNT(id) AS trace_count
                FROM agent_inference_traces
                WHERE scan_id = :scan_id
                GROUP BY phase, agent_name
                """
            ),
            {"scan_id": scan_id},
        )
        for row in obs_res:
            raw_phase = row.phase or "indexing"
            raw_agent = row.agent_name or ""
            target_phase = NODE_TO_PHASE.get(raw_phase) or NODE_TO_PHASE.get(raw_agent) or raw_phase
            c = int(row.trace_count)
            stage_counts[target_phase] = stage_counts.get(target_phase, 0) + c
            if target_phase not in stage_obs and row.first_trace_id:
                stage_obs[target_phase] = str(row.first_trace_id)
            if row.phase:
                stage_obs[row.phase] = str(row.first_trace_id)
                stage_counts[row.phase] = stage_counts.get(row.phase, 0) + c
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


@router.get("/{scan_id}/export/csv")
async def export_csv(
    scan_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export all verified vulnerability findings in CSV spreadsheet format."""
    result = await db.execute(
        select(Finding).where(Finding.scan_id == scan_id).order_by(Finding.created_at.asc())
    )
    findings = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_ALL)
    writer.writerow([
        "Finding_ID",
        "Scan_ID",
        "Title",
        "Severity",
        "CWE",
        "Status",
        "File_Path",
        "Line_Number",
        "Description",
        "Exploit_Steps",
        "Remediation",
        "PoC_Script",
        "Patch_Diff",
        "Created_At",
    ])

    for f in findings:
        writer.writerow([
            str(f.id),
            str(f.scan_id),
            f.title,
            f.severity,
            f.cwe or "",
            f.status,
            f.file_path or "",
            f.line_number or "",
            f.description or "",
            f.exploit_steps or "",
            f.mitigation or "",
            f.poc_script or "",
            f.patch_diff or "",
            f.created_at.isoformat() if f.created_at else "",
        ])

    csv_content = output.getvalue()
    filename = f"mantis_findings_{str(scan_id)[:8]}.csv"
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{scan_id}/export/json")
async def export_json(
    scan_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export complete audit and vulnerability findings in structured JSON format."""
    result = await db.execute(
        select(Scan).options(selectinload(Scan.findings)).where(Scan.id == scan_id)
    )
    scan = result.scalar_one_or_none()
    if scan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")

    findings_data = [_finding_to_response(f).model_dump(mode="json") for f in scan.findings]
    
    # Severity distribution
    severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    for f in scan.findings:
        sev = (f.severity or "medium").lower()
        if sev in severity_counts:
            severity_counts[sev] += 1
        else:
            severity_counts["medium"] += 1

    payload = {
        "report_type": "Google Mantis Autonomous Security Audit Report",
        "schema_version": "2.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scan_metadata": {
            "id": str(scan.id),
            "name": scan.name or scan.source_target,
            "source_type": scan.source_type,
            "source_target": scan.source_target,
            "branch": scan.branch,
            "status": scan.status,
            "model": scan.model,
            "reasoning_effort": scan.reasoning_effort,
            "focus": scan.focus,
            "sandbox": scan.sandbox,
            "total_tokens": scan.total_tokens or 0,
            "prompt_tokens": scan.prompt_tokens or 0,
            "completion_tokens": scan.completion_tokens or 0,
            "cost_spent_usd": scan.cost_spent_usd or 0.0,
            "created_at": scan.created_at.isoformat() if scan.created_at else None,
            "completed_at": scan.completed_at.isoformat() if scan.completed_at else None,
        },
        "executive_summary": {
            "total_findings": len(scan.findings),
            "severity_breakdown": severity_counts,
            "reproduced_count": sum(1 for f in scan.findings if f.status == "reproduced"),
            "patches_available": sum(1 for f in scan.findings if f.patch_diff and f.patch_diff.strip()),
        },
        "threat_model_summary": scan.threat_model,
        "architecture_summary": scan.architecture_summary,
        "findings": findings_data,
    }

    filename = f"mantis_audit_report_{str(scan_id)[:8]}.json"
    return Response(
        content=json.dumps(payload, indent=2, default=str),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{scan_id}/export/sarif")
async def export_sarif(
    scan_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export findings in OASIS SARIF v2.1.0 standard (Static Analysis Results Interchange Format)."""
    result = await db.execute(
        select(Scan).options(selectinload(Scan.findings)).where(Scan.id == scan_id)
    )
    scan = result.scalar_one_or_none()
    if scan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")

    rules = []
    results = []
    seen_rules = set()

    for idx, f in enumerate(scan.findings):
        rule_id = f.cwe or f"MANTIS-RULE-{(idx+1):03d}"
        if rule_id not in seen_rules:
            seen_rules.add(rule_id)
            rules.append({
                "id": rule_id,
                "name": f.title,
                "shortDescription": {"text": f.title},
                "fullDescription": {"text": f.description or f.title},
                "help": {
                    "text": f.mitigation or "Review and sanitize input parameters before use in sensitive operations.",
                    "markdown": f"**Mitigation:**\n\n{f.mitigation or 'No mitigation provided.'}\n\n**Exploit Steps:**\n\n{f.exploit_steps or 'N/A'}",
                },
                "properties": {
                    "tags": ["security", "sast", f.cwe or "Vulnerability"],
                    "precision": "high",
                    "problem.severity": "error" if f.severity in ("critical", "high") else "warning",
                },
            })

        # Map Mantis severity to SARIF level
        level = "error" if f.severity in ("critical", "high") else ("warning" if f.severity == "medium" else "note")

        result_item = {
            "ruleId": rule_id,
            "ruleIndex": [r["id"] for r in rules].index(rule_id),
            "level": level,
            "message": {
                "text": f"{f.title}: {f.description or ''}".strip(),
            },
            "locations": [
                {
                    "physicalLocation": {
                        "artifactLocation": {
                            "uri": f.file_path or "unknown",
                            "uriBaseId": "%SRCROOT%",
                        },
                        "region": {
                            "startLine": f.line_number or 1,
                            "startColumn": 1,
                        },
                    }
                }
            ],
            "properties": {
                "severity": f.severity,
                "status": f.status,
                "findingId": str(f.id),
                "remediation": f.mitigation,
            },
        }

        # Include patch fix if available
        if f.patch_diff and f.patch_diff.strip():
            result_item["fixes"] = [
                {
                    "description": {"text": f"Remediation patch for {f.title}"},
                    "artifactChanges": [
                        {
                            "artifactLocation": {"uri": f.file_path or "unknown"},
                            "replacements": [],
                        }
                    ],
                }
            ]

        results.append(result_item)

    sarif_doc = {
        "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
        "version": "2.1.0",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "Google Mantis ADK",
                        "fullName": "Google Mantis Autonomous SAST & Pentest Engine",
                        "version": "2.0.0",
                        "informationUri": "https://github.com/google/mantis",
                        "rules": rules,
                    }
                },
                "invocations": [
                    {
                        "executionSuccessful": scan.status == "completed",
                        "endTimeUtc": scan.completed_at.isoformat() if scan.completed_at else datetime.now(timezone.utc).isoformat(),
                    }
                ],
                "results": results,
            }
        ],
    }

    filename = f"mantis_scan_{str(scan_id)[:8]}.sarif"
    return Response(
        content=json.dumps(sarif_doc, indent=2),
        media_type="application/sarif+json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{scan_id}/export/report")
@router.get("/{scan_id}/export/pdf")
async def export_pentest_report(
    scan_id: uuid.UUID,
    print_view: Optional[bool] = Query(False, alias="print"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate high-fidelity, printable Executive & Technical Pentest Report (PDF printable)."""
    result = await db.execute(
        select(Scan).options(selectinload(Scan.findings)).where(Scan.id == scan_id)
    )
    scan = result.scalar_one_or_none()
    if scan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")

    html_content = _generate_pentest_html_report(scan, scan.findings, auto_print=print_view or False)
    return Response(content=html_content, media_type="text/html")


def _generate_pentest_html_report(scan: Scan, findings: list[Finding], auto_print: bool = False) -> str:
    """Generate high-fidelity, printable executive Penetration Testing & SAST Audit Report."""
    e = html.escape
    scan_id_short = str(scan.id)[:8].upper()
    scan_title = e(scan.name or scan.source_target or "Security Audit")
    target_path = e(scan.source_target)
    branch_name = e(scan.branch or "main / default")
    audit_date = scan.completed_at.strftime("%B %d, %Y - %H:%M UTC") if scan.completed_at else (scan.created_at.strftime("%B %d, %Y - %H:%M UTC") if scan.created_at else "Recent")
    
    # Severity calculation
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    for f in findings:
        sev = (f.severity or "medium").lower()
        if sev in counts:
            counts[sev] += 1
        else:
            counts["medium"] += 1

    overall_posture = "CRITICAL RISK" if counts["critical"] > 0 else ("HIGH RISK" if counts["high"] > 0 else ("MODERATE RISK" if counts["medium"] > 0 else "LOW RISK"))
    posture_color = "#b91c1c" if counts["critical"] > 0 else ("#c2410c" if counts["high"] > 0 else ("#7c3aed" if counts["medium"] > 0 else "#059669"))
    
    # Tokens & Cost
    tokens_str = f"{(scan.total_tokens or 0):,}"
    cost_str = f"${(scan.cost_spent_usd or 0.0):.4f} USD"
    model_str = e(scan.model or "Configured Swarm Ensemble")
    
    findings_rows_html = []
    findings_deep_dive_html = []

    for idx, f in enumerate(findings):
        find_ref = f"MANTIS-FIND-{(idx+1):03d}"
        f_title = e(f.title)
        f_cwe = e(f.cwe or "CWE-Unknown")
        f_sev = (f.severity or "medium").lower()
        f_path = e(f.file_path or "Target Repository")
        f_line = f.line_number or "N/A"
        f_status = "Exploit Confirmed" if f.status == "reproduced" else e(f.status.capitalize())
        f_desc = e(f.description or "No detailed description provided.")
        f_exploit = e(f.exploit_steps or "")
        f_mitigation = e(f.mitigation or "Review input handling, enforce parameter sanitization, and deploy defense-in-depth controls.")
        f_poc_script = e(f.poc_script or "")
        f_poc_output = e(f.poc_output or "")
        f_patch = e(f.patch_diff or "")

        # CVSS score estimation
        cvss_score = "9.8" if f_sev == "critical" else ("8.2" if f_sev == "high" else ("5.5" if f_sev == "medium" else "3.1"))
        
        # Color mapping
        sev_bg = "#fef2f2" if f_sev == "critical" else ("#fff7ed" if f_sev == "high" else ("#faf5ff" if f_sev == "medium" else "#eff6ff"))
        sev_text = "#b91c1c" if f_sev == "critical" else ("#c2410c" if f_sev == "high" else ("#6b21a8" if f_sev == "medium" else "#1d4ed8"))
        sev_border = "#fecaca" if f_sev == "critical" else ("#fed7aa" if f_sev == "high" else ("#e9d5ff" if f_sev == "medium" else "#bfdbfe"))

        # Table Row
        findings_rows_html.append(f"""
        <tr>
            <td style="font-family: monospace; font-size: 11px; font-weight: bold; color: #475569;">{find_ref}</td>
            <td style="font-weight: 600; color: #0f172a;">{f_title}</td>
            <td><span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 800; text-transform: uppercase; background: {sev_bg}; color: {sev_text}; border: 1px solid {sev_border};">{f_sev}</span></td>
            <td style="font-family: monospace; font-size: 11px; color: #64748b;">{f_cwe}</td>
            <td style="font-family: monospace; font-size: 11px; color: #334155;">{f_path}:{f_line}</td>
            <td><span style="font-size: 11px; font-weight: 600; color: #059669;">{f_status}</span></td>
        </tr>
        """)

        # Deep Dive Card
        poc_block = ""
        if f_poc_script or f_poc_output:
            poc_block = f"""
            <div style="margin-top: 14px; background: #0f172a; border-radius: 8px; padding: 14px; color: #e2e8f0; font-family: monospace; font-size: 11px;">
                <div style="color: #94a3b8; font-size: 10px; text-transform: uppercase; font-weight: bold; margin-bottom: 6px;">Proof of Concept & Verification Output</div>
                {f'<div style="color: #38bdf8; margin-bottom: 8px;"># Exploit Script</div><pre style="margin: 0 0 10px 0; overflow-x: auto; color: #cbd5e1; white-space: pre-wrap;">{f_poc_script}</pre>' if f_poc_script else ''}
                {f'<div style="color: #f59e0b; margin-bottom: 4px;"># Execution Evidence / Sandbox Log</div><pre style="margin: 0; overflow-x: auto; color: #fde68a; white-space: pre-wrap;">{f_poc_output}</pre>' if f_poc_output else ''}
            </div>
            """

        patch_block = ""
        if f_patch:
            patch_block = f"""
            <div style="margin-top: 14px; background: #0b1329; border-radius: 8px; padding: 14px; color: #e2e8f0; font-family: monospace; font-size: 11px; border: 1px solid #1e293b;">
                <div style="color: #10b981; font-size: 10px; text-transform: uppercase; font-weight: bold; margin-bottom: 6px;">Verified Remediation Patch (Unified Git Diff)</div>
                <pre style="margin: 0; overflow-x: auto; color: #a7f3d0; white-space: pre-wrap;">{f_patch}</pre>
            </div>
            """

        findings_deep_dive_html.append(f"""
        <div class="finding-card" style="margin-top: 24px; padding: 22px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; page-break-inside: avoid; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #f1f5f9; padding-bottom: 14px; margin-bottom: 14px;">
                <div>
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                        <span style="font-family: monospace; font-size: 12px; font-weight: 800; color: #64748b;">{find_ref}</span>
                        <span style="display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 11px; font-weight: 800; text-transform: uppercase; background: {sev_bg}; color: {sev_text}; border: 1px solid {sev_border};">{f_sev.upper()} (CVSS {cvss_score})</span>
                        <span style="padding: 2px 8px; border-radius: 6px; font-family: monospace; font-size: 11px; font-weight: bold; background: #f1f5f9; color: #475569;">{f_cwe}</span>
                    </div>
                    <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: #0f172a;">{f_title}</h3>
                    <div style="margin-top: 4px; font-family: monospace; font-size: 12px; color: #64748b;">Target: {f_path} (Line {f_line})</div>
                </div>
                <div style="text-align: right;">
                    <span style="display: inline-block; padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 700; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;">{f_status}</span>
                </div>
            </div>

            <div style="margin-bottom: 14px;">
                <h4 style="margin: 0 0 6px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #475569;">Technical Vulnerability Description</h4>
                <div style="font-size: 13px; color: #334155; line-height: 1.6; white-space: pre-wrap;">{f_desc}</div>
            </div>

            {f'''
            <div style="margin-bottom: 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
                <h4 style="margin: 0 0 4px 0; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #475569;">Root Cause & Exploitation Scenario</h4>
                <div style="font-size: 12px; color: #334155; line-height: 1.5; font-family: monospace; white-space: pre-wrap;">{f_exploit}</div>
            </div>
            ''' if f_exploit else ''}

            {poc_block}

            <div style="margin-top: 14px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px;">
                <h4 style="margin: 0 0 6px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #166534;">Remediation & Prevention Guidance</h4>
                <div style="font-size: 13px; color: #14532d; line-height: 1.6; white-space: pre-wrap;">{f_mitigation}</div>
            </div>

            {patch_block}
        </div>
        """)

    html_template = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Penetration Testing Report - {scan_title} ({scan_id_short})</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        
        * {{ box-sizing: border-box; }}
        body {{
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f8fafc;
            color: #0f172a;
            margin: 0;
            padding: 0;
            font-size: 13px;
            line-height: 1.5;
        }}

        .container {{
            max-width: 1040px;
            margin: 0 auto;
            padding: 40px 24px 80px 24px;
        }}

        .no-print {{
            position: sticky;
            top: 0;
            z-index: 999;
            background: #ffffff;
            border-bottom: 1px solid #e2e8f0;
            padding: 12px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-shadow: 0 2px 4px rgba(0,0,0,0.04);
        }}

        .btn {{
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px;
            font-size: 12px;
            font-weight: 700;
            border-radius: 8px;
            cursor: pointer;
            text-decoration: none;
            transition: all 0.15s ease;
            border: none;
        }}
        .btn-primary {{
            background: #6d28d9;
            color: #ffffff;
        }}
        .btn-primary:hover {{
            background: #5b21b6;
        }}
        .btn-secondary {{
            background: #f1f5f9;
            color: #334155;
            border: 1px solid #cbd5e1;
        }}
        .btn-secondary:hover {{
            background: #e2e8f0;
        }}

        table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            text-align: left;
        }}
        th {{
            background: #f8fafc;
            padding: 10px 12px;
            font-weight: 700;
            color: #475569;
            border-bottom: 2px solid #e2e8f0;
            text-transform: uppercase;
            font-size: 10px;
            letter-spacing: 0.05em;
        }}
        td {{
            padding: 10px 12px;
            border-bottom: 1px solid #f1f5f9;
        }}

        @media print {{
            .no-print {{ display: none !important; }}
            body {{ background: #ffffff !important; font-size: 12px; }}
            .container {{ max-width: 100% !important; padding: 0 !important; }}
            .finding-card {{ break-inside: avoid; page-break-inside: avoid; border: 1px solid #cbd5e1 !important; }}
            @page {{
                size: A4;
                margin: 15mm;
            }}
        }}
    </style>
</head>
<body>

    <!-- Floating Top Toolbar (Hidden on Print) -->
    <div class="no-print">
        <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-weight: 800; font-size: 14px; color: #6d28d9;">🛡️ Mantis Pentest Report</span>
            <span style="font-family: monospace; font-size: 11px; background: #f1f5f9; padding: 2px 6px; rounded: 4px; color: #475569;">REF: {scan_id_short}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
            <button class="btn btn-primary" onclick="window.print()">
                <span>🖨️ Print / Save as PDF</span>
            </button>
            <a class="btn btn-secondary" href="/api/scans/{scan.id}/export/csv">
                <span>📊 Export CSV</span>
            </a>
            <a class="btn btn-secondary" href="/api/scans/{scan.id}/export/json">
                <span>📦 Export JSON</span>
            </a>
            <a class="btn btn-secondary" href="/api/scans/{scan.id}/export/sarif">
                <span>🛡️ Export SARIF</span>
            </a>
            <button class="btn btn-secondary" onclick="window.close()">
                <span>✖ Close</span>
            </button>
        </div>
    </div>

    <div class="container">
        <!-- Cover Header -->
        <div style="background: linear-gradient(135deg, #1e1b4b 0%, #31104b 100%); color: #ffffff; padding: 36px 32px; border-radius: 16px; margin-bottom: 30px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <span style="text-transform: uppercase; font-weight: 800; font-size: 11px; letter-spacing: 0.15em; color: #c084fc;">Confidential Security Assessment</span>
                <span style="font-family: monospace; font-size: 12px; background: rgba(255,255,255,0.15); padding: 4px 10px; border-radius: 6px;">REF ID: MANTIS-{scan_id_short}</span>
            </div>
            <h1 style="margin: 0 0 10px 0; font-size: 26px; font-weight: 800; letter-spacing: -0.02em;">Autonomous Penetration Testing &amp; SAST Audit Deliverable</h1>
            <p style="margin: 0 0 20px 0; font-size: 15px; color: #cbd5e1;">Target System: <strong>{scan_title}</strong></p>

            <div style="display: grid; grid-cols: 2; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,0.15); font-size: 12px;">
                <div><span style="color: #94a3b8;">Repository / Source:</span> <div style="font-family: monospace; font-weight: 600;">{target_path}</div></div>
                <div><span style="color: #94a3b8;">Branch / Tag:</span> <div style="font-family: monospace; font-weight: 600;">{branch_name}</div></div>
                <div><span style="color: #94a3b8;">Assessment Swarm:</span> <div style="font-weight: 600;">Google Mantis ADK 2.0</div></div>
                <div><span style="color: #94a3b8;">Audit Date:</span> <div style="font-weight: 600;">{audit_date}</div></div>
            </div>
        </div>

        <!-- Executive Summary & Metrics -->
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 26px; margin-bottom: 30px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
                <h2 style="margin: 0; font-size: 18px; font-weight: 800; color: #0f172a;">Executive Risk &amp; Posture Assessment</h2>
                <span style="display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 800; background: {posture_color}; color: #ffffff;">{overall_posture}</span>
            </div>

            <p style="color: #475569; font-size: 13px; line-height: 1.6; margin-bottom: 20px;">
                An automated, deep multi-agent penetration testing sweep was conducted against the target repository using Google Mantis ADK's 7-stage swarm architecture. The assessment performed architectural component modeling, automated threat modeling, hypothesis generation, and dynamic sandbox verification.
            </p>

            <!-- Metrics Cards -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 20px;">
                <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 14px; text-align: center;">
                    <div style="font-size: 24px; font-weight: 800; color: #b91c1c;">{counts['critical']}</div>
                    <div style="font-size: 11px; font-weight: 700; color: #991b1b; text-transform: uppercase;">Critical</div>
                </div>
                <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 14px; text-align: center;">
                    <div style="font-size: 24px; font-weight: 800; color: #c2410c;">{counts['high']}</div>
                    <div style="font-size: 11px; font-weight: 700; color: #9a3412; text-transform: uppercase;">High</div>
                </div>
                <div style="background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 10px; padding: 14px; text-align: center;">
                    <div style="font-size: 24px; font-weight: 800; color: #6b21a8;">{counts['medium']}</div>
                    <div style="font-size: 11px; font-weight: 700; color: #581c87; text-transform: uppercase;">Medium</div>
                </div>
                <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 14px; text-align: center;">
                    <div style="font-size: 24px; font-weight: 800; color: #1d4ed8;">{counts['low']}</div>
                    <div style="font-size: 11px; font-weight: 700; color: #1e40af; text-transform: uppercase;">Low / Info</div>
                </div>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; text-align: center;">
                    <div style="font-size: 24px; font-weight: 800; color: #0f172a;">{len(findings)}</div>
                    <div style="font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Total Findings</div>
                </div>
            </div>

            <!-- Audit Telemetry -->
            <div style="display: flex; flex-wrap: wrap; gap: 16px; background: #f8fafc; border-radius: 8px; padding: 12px 16px; font-size: 12px; color: #475569;">
                <div>Tokens Ingested: <strong style="color: #0f172a;">{tokens_str}</strong></div>
                <div>Compute Spend: <strong style="color: #0f172a;">{cost_str}</strong></div>
                <div>Model Ensemble: <strong style="color: #0f172a;">{model_str}</strong></div>
                <div>Dynamic PoC Verified: <strong style="color: #059669;">{sum(1 for f in findings if f.status == 'reproduced')} findings</strong></div>
            </div>
        </div>

        <!-- Vulnerability Matrix Table -->
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; margin-bottom: 30px;">
            <h2 style="margin: 0 0 14px 0; font-size: 16px; font-weight: 800; color: #0f172a;">Vulnerability Matrix ({len(findings)})</h2>
            <div style="overflow-x: auto;">
                <table>
                    <thead>
                        <tr>
                            <th>Ref</th>
                            <th>Vulnerability Title</th>
                            <th>Severity</th>
                            <th>CWE</th>
                            <th>Affected Target</th>
                            <th>Exploit Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {''.join(findings_rows_html) if findings_rows_html else '<tr><td colspan="6" style="text-align: center; color: #64748b;">No verified vulnerabilities found.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Detailed Findings Reports -->
        <div>
            <h2 style="font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 6px;">Technical Vulnerability Disclosures</h2>
            <p style="color: #64748b; font-size: 13px; margin: 0 0 20px 0;">Detailed root cause analysis, proof-of-concept exploits, and remediation patches verified by Mantis.</p>
            {''.join(findings_deep_dive_html) if findings_deep_dive_html else '<div style="background: #ffffff; padding: 30px; text-align: center; border-radius: 12px; border: 1px solid #e2e8f0; color: #059669; font-weight: 600;">No vulnerabilities confirmed. Codebase cleared all critic and reproduction gates.</div>'}
        </div>

        <!-- Deliverable Signoff Footer -->
        <div style="margin-top: 50px; padding-top: 20px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #94a3b8;">
            <div>Generated autonomously by <strong>Google Mantis Autonomous Security Swarm</strong></div>
            <div>Report Ref: MANTIS-{scan_id_short} &bull; {audit_date}</div>
        </div>
    </div>

    {'''<script>
        window.onload = function() {
            setTimeout(function() { window.print(); }, 600);
        };
    </script>''' if auto_print else ''}
</body>
</html>
"""
    return html_template


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

    # Disk & knowledge.db fallbacks if not yet in DB
    scan_dir = Path(f"/data/scans/{scan.id}")
    if (not arch or not tm or not hp or not rp) and (scan_dir / "knowledge.db").exists():
        try:
            import sqlite3
            con = sqlite3.connect(str(scan_dir / "knowledge.db"))
            rows = con.execute("SELECT filepath, content FROM campaign_artifacts").fetchall()
            con.close()
            for fpath, content in rows:
                if not arch and "architecture.md" in fpath and content:
                    arch = content
                elif not tm and "threat_model" in fpath.lower() and content:
                    tm = _format_threat_model_md(content)
                elif not hp and ("plan.json" in fpath or "hunting_plan" in fpath) and content:
                    hp = content
                elif not rp and ("review_packet" in fpath or "report.json" in fpath) and content:
                    rp = content
        except Exception:
            pass

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

    ttok = getattr(scan, "total_tokens", 0) or 0
    ptok = getattr(scan, "prompt_tokens", 0) or 0
    ctok = getattr(scan, "completion_tokens", 0) or 0
    cost = getattr(scan, "cost_spent_usd", 0.0) or 0.0

    if ttok == 0 and (scan_dir / "knowledge.db").exists():
        try:
            import sqlite3
            con = sqlite3.connect(str(scan_dir / "knowledge.db"))
            spend_row = con.execute("SELECT COALESCE(SUM(tokens), 0), COALESCE(SUM(llm_calls), 0) FROM campaign_spend").fetchone()
            con.close()
            if spend_row and spend_row[0] > 0:
                ttok = int(spend_row[0])
                ptok = int(ttok * 0.75)
                ctok = ttok - ptok
                cost = calculate_cost_usd(getattr(scan, "model", None), ttok, ptok, ctok)
        except Exception:
            pass

    cfg = getattr(scan, "phase_models", None) or {}
    if not isinstance(cfg, dict):
        cfg = {}

    scan_mode_val = cfg.get("scan_mode") or "auto"
    if (scan_dir / "knowledge.db").exists():
        try:
            import sqlite3
            con = sqlite3.connect(str(scan_dir / "knowledge.db"))
            sm_row = con.execute("SELECT scan_mode FROM campaign_spend WHERE scan_mode IS NOT NULL LIMIT 1").fetchone()
            if sm_row and sm_row[0]:
                scan_mode_val = sm_row[0]
            con.close()
        except Exception:
            pass

    full_config = {
        "model": getattr(scan, "model", None) or cfg.get("model") or "gemini-3.5-flash-lite",
        "reasoning_effort": getattr(scan, "reasoning_effort", None) or cfg.get("reasoning_effort") or "medium",
        "sandbox": getattr(scan, "sandbox", None) or cfg.get("sandbox") or "static-only",
        "scan_mode": scan_mode_val,
        "focus": getattr(scan, "focus", None) or cfg.get("focus"),
        "exclude": getattr(scan, "exclude_patterns", None) or cfg.get("exclude") or [],
        "max_tokens": cfg.get("max_tokens"),
        "budget_limit_usd": scan.budget_limit_usd or cfg.get("budget_limit_usd"),
        "objective": cfg.get("objective"),
        "seed_report": cfg.get("seed_report"),
        "deterministic_only": bool(cfg.get("deterministic_only", False)),
        "no_replan": bool(cfg.get("no_replan", False)),
        "parallel": cfg.get("parallel", 1),
        "max_llm_calls": cfg.get("max_llm_calls"),
        "api_base": cfg.get("api_base"),
        "source_type": scan.source_type,
        "source_target": scan.source_target,
        "branch": scan.branch,
    }

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
        cost_spent_usd=cost,
        findings_count=findings_cnt,
        error_message=scan.error_message,
        architecture_summary=arch,
        threat_model=tm,
        hunting_plan=hp,
        review_packet=rp,
        exploit_chains=ec,
        total_tokens=ttok,
        prompt_tokens=ptok,
        completion_tokens=ctok,
        created_at=scan.created_at,
        completed_at=scan.completed_at,
        triggered_by=scan.triggered_by,
        model=getattr(scan, "model", None),
        reasoning_effort=getattr(scan, "reasoning_effort", None),
        focus=getattr(scan, "focus", None),
        sandbox=getattr(scan, "sandbox", None),
        scan_config=full_config,
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
        from sqlalchemy import or_
        nodes = PHASE_NODE_MAP.get(phase, [phase])
        query = query.where(
            or_(
                AgentInferenceTrace.phase.in_(nodes),
                AgentInferenceTrace.agent_name.in_(nodes),
                AgentInferenceTrace.phase == phase,
            )
        )
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
