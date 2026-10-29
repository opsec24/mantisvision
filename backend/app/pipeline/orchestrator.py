"""Celery pipeline orchestrator – runs the full Mantis scan pipeline."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import structlog
from celery import Celery
from redis import Redis
from sqlalchemy import create_engine, text

from app.core.config import settings
from app.pipeline.budget import BudgetExceededError, LLMBudgetTracker
from app.pipeline.sandbox import execute_poc_in_sandbox
from app.pipeline.skills_loader import format_skill_prompt, load_skill
from app.pipeline.tools import (
    apply_patch,
    collect_source_context,
    git_log_diff,
    grep_code,
    list_files,
    read_file,
    write_reproducer,
)

logger = structlog.get_logger(__name__)

# ── Celery App ────────────────────────────────────────────────────────────────

celery_app = Celery(
    "mantis_worker",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)

# ── Redis client for pub/sub progress ────────────────────────────────────────

_redis_client: Optional[Redis] = None


def _get_redis() -> Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = Redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis_client


# ── Sync DB engine for Celery workers ─────────────────────────────────────────

def _get_sync_url() -> str:
    """Convert the async DATABASE_URL to a synchronous psycopg2 URL."""
    url = settings.DATABASE_URL
    if "+asyncpg" in url:
        url = url.replace("+asyncpg", "")
    if "postgresql://" in url and "+psycopg2" not in url:
        url = url.replace("postgresql://", "postgresql+psycopg2://")
    return url


_sync_engine = None


def _get_sync_engine():
    global _sync_engine
    if _sync_engine is None:
        _sync_engine = create_engine(_get_sync_url(), pool_size=5, max_overflow=5)
    return _sync_engine


# ── Progress Publishing ──────────────────────────────────────────────────────


def publish_progress(
    scan_id: str,
    phase: str,
    message: str,
    cost: Optional[float] = None,
    status: Optional[str] = None,
) -> None:
    """Publish a progress event to the Redis Pub/Sub channel for real-time SSE
    streaming."""
    channel = f"scan:{scan_id}:progress"
    payload = {
        "scan_id": scan_id,
        "phase": phase,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if cost is not None:
        payload["cost"] = cost
    if status is not None:
        payload["status"] = status

    try:
        redis = _get_redis()
        serialized = json.dumps(payload)
        redis.publish(channel, serialized)
        # Store in Redis list so any client can replay full log history
        history_key = f"scan:{scan_id}:history"
        redis.rpush(history_key, serialized)
        redis.expire(history_key, 7 * 86400)
    except Exception as exc:
        logger.warning("publish_progress_failed", error=str(exc))


# ── Repository Ingestion ─────────────────────────────────────────────────────


def ingest_repository(
    scan_id: str,
    source_type: str,
    source_target: str,
    branch: Optional[str],
    git_token: Optional[str],
) -> str:
    """Clone or copy the target repository into the scan workspace.

    Returns the absolute path to the workspace directory.
    """
    workspace = Path(f"/data/scans/{scan_id}/workspace")
    workspace.mkdir(parents=True, exist_ok=True)

    if source_type == "git":
        clone_url = source_target
        if git_token and "github.com" in clone_url:
            # Inject token for private repos
            clone_url = clone_url.replace(
                "https://", f"https://{git_token}@"
            )

        cmd = ["git", "clone", "--depth", "1"]
        if branch:
            cmd.extend(["--branch", branch])
        cmd.extend([clone_url, str(workspace)])

        logger.info("git_clone_start", target=source_target, branch=branch)
        publish_progress(scan_id, "ingest", f"Cloning {source_target}...")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"git clone failed (exit {result.returncode}): {result.stderr}"
            )

        logger.info("git_clone_complete", workspace=str(workspace))

    elif source_type == "local":
        src = Path(source_target)
        if not src.is_dir():
            raise FileNotFoundError(f"Local path not found: {source_target}")

        logger.info("local_copy_start", source=source_target)
        publish_progress(scan_id, "ingest", f"Copying local repo {source_target}...")

        # Copy the directory tree
        if workspace.exists():
            shutil.rmtree(workspace)
        shutil.copytree(src, workspace, symlinks=False)

        logger.info("local_copy_complete", workspace=str(workspace))
    else:
        raise ValueError(f"Unknown source_type: {source_type}")

    return str(workspace)


# ── DB Helpers ────────────────────────────────────────────────────────────────


def _update_scan_status(
    scan_id: str,
    status: str,
    phase: Optional[str] = None,
    completed_at: Optional[datetime] = None,
    error_message: Optional[str] = None,
) -> None:
    """Update the scan row with a new status and optional phase."""
    engine = _get_sync_engine()
    params: dict[str, Any] = {"status": status, "scan_id": scan_id}
    set_clauses = ["status = :status"]

    if phase is not None:
        set_clauses.append("current_phase = :phase")
        params["phase"] = phase
    if completed_at is not None:
        set_clauses.append("completed_at = :completed_at")
        params["completed_at"] = completed_at
    if error_message is not None:
        set_clauses.append("error_message = :error_message")
        params["error_message"] = error_message

    sql = f"UPDATE scans SET {', '.join(set_clauses)} WHERE id = :scan_id"

    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _persist_finding(scan_id: str, finding: dict[str, Any]) -> str:
    """Insert a finding row and return its UUID."""
    engine = _get_sync_engine()
    finding_id = str(uuid.uuid4())

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO findings
                    (id, scan_id, title, cwe, severity, status,
                     file_path, line_number, description,
                     poc_script, poc_output, patch_diff)
                VALUES
                    (:id, :scan_id, :title, :cwe, :severity, :status,
                     :file_path, :line_number, :description,
                     :poc_script, :poc_output, :patch_diff)
                """
            ),
            {
                "id": finding_id,
                "scan_id": scan_id,
                "title": finding.get("title", "Untitled Finding"),
                "cwe": finding.get("cwe"),
                "severity": finding.get("severity", "medium"),
                "status": "open",
                "file_path": finding.get("file_path"),
                "line_number": finding.get("line_number"),
                "description": finding.get("description"),
                "poc_script": finding.get("poc_script"),
                "poc_output": finding.get("poc_output"),
                "patch_diff": finding.get("patch_diff"),
            },
        )

    return finding_id


def _save_findings_json(scan_id: str, findings: list[dict[str, Any]]) -> None:
    """Mirror the findings list to a JSON file at ``/data/scans/{scan_id}/findings.json``."""
    output_dir = Path(f"/data/scans/{scan_id}")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "findings.json"
    output_path.write_text(json.dumps(findings, indent=2, default=str), encoding="utf-8")
    logger.info("findings_json_saved", path=str(output_path), count=len(findings))


# ── Phase Runner ──────────────────────────────────────────────────────────────


def _run_phase(
    tracker: LLMBudgetTracker,
    phase: str,
    skill_name: str,
    context: dict[str, Any],
    model: str,
    scan_id: str,
) -> str:
    """Load a skill, format it, call the LLM through the budget tracker, and
    return the raw response text."""
    publish_progress(
        scan_id, phase, f"Running {skill_name} ({phase})...", cost=tracker.total_spent
    )

    try:
        skill_content = load_skill(skill_name)
    except FileNotFoundError:
        logger.warning("skill_not_found", skill=skill_name, phase=phase)
        skill_content = f"# {phase}\nPerform {phase} analysis on the provided code."

    messages = format_skill_prompt(skill_content, context)
    response = tracker.call(
        model=model,
        messages=messages,
        phase=phase,
        skill_name=skill_name,
    )

    publish_progress(
        scan_id,
        phase,
        f"{skill_name} complete",
        cost=tracker.total_spent,
    )

    return response


def _parse_findings_from_response(response: str) -> list[dict[str, Any]]:
    """Best-effort extraction of structured findings from the LLM response.

    Looks for JSON arrays or JSON objects within the response text.
    """
    import re
    findings: list[dict[str, Any]] = []

    # Look for ```json ... ``` fenced blocks first
    json_blocks = re.findall(r"```(?:json)?\s*\n(.*?)```", response, re.DOTALL)
    for block in json_blocks:
        try:
            parsed = json.loads(block.strip())
            if isinstance(parsed, list):
                findings.extend(parsed)
            elif isinstance(parsed, dict):
                findings.append(parsed)
        except json.JSONDecodeError:
            continue

    # If no fenced blocks found, try to parse the whole response as JSON
    if not findings:
        try:
            parsed = json.loads(response.strip())
            if isinstance(parsed, list):
                findings = parsed
            elif isinstance(parsed, dict):
                findings = [parsed]
        except json.JSONDecodeError:
            pass

    # Filter out empty or non-dict items and dummy fallback findings
    valid_findings: list[dict[str, Any]] = []
    for item in findings:
        if isinstance(item, dict):
            title = str(item.get("title", "")).strip()
            if not title:
                continue
            if title == "Analysis Result" and not item.get("cwe") and not item.get("file_path"):
                continue
            valid_findings.append(item)

    return valid_findings


# ── Main Celery Task ──────────────────────────────────────────────────────────


@celery_app.task(bind=True, name="mantis.run_scan", max_retries=0)
def run_mantis_scan(
    self,
    scan_id: str,
    source_type: str,
    source_target: str,
    branch: Optional[str] = None,
    git_token: Optional[str] = None,
) -> dict[str, Any]:
    """Execute the full Mantis SAST pipeline for a scan.

    Phases:
      1. ingest    – clone / copy repository
      2. recon     – summarise, history, architecture
      3. threat_model – threat modelling
      4. research  – deep analysis
      5. critic    – review and deduplicate
      6. reproduce – write PoC and execute in sandbox
      7. patch     – generate fix patches
    """
    logger.info("scan_start", scan_id=scan_id, source=source_target)
    tracker: Optional[LLMBudgetTracker] = None

    try:
        # ── Update status to running ──────────────────────────────────
        _update_scan_status(scan_id, "running", phase="ingest")
        publish_progress(scan_id, "ingest", "Scan started", status="running")

        # ── Retrieve scan metadata ────────────────────────────────────
        engine = _get_sync_engine()
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT budget_limit_usd, phase_models FROM scans WHERE id = :id"
                ),
                {"id": scan_id},
            ).fetchone()

        budget_limit = float(row[0]) if row and row[0] else None
        phase_models_raw = row[1] if row and row[1] else None
        if isinstance(phase_models_raw, dict):
            phase_models_config = phase_models_raw
        elif isinstance(phase_models_raw, str):
            try:
                phase_models_config = json.loads(phase_models_raw)
            except Exception:
                phase_models_config = {}
        else:
            phase_models_config = {}

        # Default model for all phases
        default_model = phase_models_config.get("default", "gpt-4")

        # ── Init budget tracker ───────────────────────────────────────
        tracker = LLMBudgetTracker(
            scan_id=scan_id,
            max_budget_usd=budget_limit,
            db_url=settings.DATABASE_URL,
        )

        # ── Phase 1: Ingest ───────────────────────────────────────────
        workspace = ingest_repository(
            scan_id=scan_id,
            source_type=source_type,
            source_target=source_target,
            branch=branch,
            git_token=git_token,
        )
        publish_progress(scan_id, "ingest", "Repository ingested successfully")

        # Build a file listing and collect source context
        file_list = list_files(workspace)
        file_listing = "\n".join(file_list[:500])  # Cap at 500 files
        git_history = git_log_diff(workspace, limit=20)
        source_context = collect_source_context(workspace, max_chars=120_000)

        # ── Phase 2: Recon ────────────────────────────────────────────
        _update_scan_status(scan_id, "running", phase="recon")

        recon_model = phase_models_config.get("recon", default_model)
        recon_context = {
            "file_listing": file_listing,
            "git_history": git_history,
            "source_code": source_context,
        }

        summary_response = _run_phase(
            tracker, "recon", "mantis-summarize", recon_context, recon_model, scan_id
        )

        history_response = _run_phase(
            tracker, "recon", "mantis-history",
            {**recon_context, "summary": summary_response},
            recon_model, scan_id,
        )

        architecture_response = _run_phase(
            tracker, "recon", "mantis-architecture",
            {**recon_context, "summary": summary_response, "history": history_response},
            recon_model, scan_id,
        )

        # ── Phase 3: Threat Model ─────────────────────────────────────
        _update_scan_status(scan_id, "running", phase="threat_model")

        threat_model = phase_models_config.get("threat_model", default_model)
        threat_response = _run_phase(
            tracker, "threat_model", "mantis-threat-model",
            {
                "summary": summary_response,
                "architecture": architecture_response,
                "file_listing": file_listing,
                "source_code": source_context,
            },
            threat_model, scan_id,
        )

        # ── Phase 4: Research ─────────────────────────────────────────
        _update_scan_status(scan_id, "running", phase="research")

        research_model = phase_models_config.get("research", default_model)
        research_response = _run_phase(
            tracker, "research", "mantis-researcher",
            {
                "summary": summary_response,
                "architecture": architecture_response,
                "threat_model": threat_response,
                "file_listing": file_listing,
                "source_code": source_context,
            },
            research_model, scan_id,
        )

        # ── Phase 5: Critic ───────────────────────────────────────────
        _update_scan_status(scan_id, "running", phase="critic")

        critic_model = phase_models_config.get("critic", default_model)
        critic_response = _run_phase(
            tracker, "critic", "mantis-critic",
            {
                "research_findings": research_response,
                "architecture": architecture_response,
                "source_code": source_context,
            },
            critic_model, scan_id,
        )

        # Deduplicate
        deduped_response = _run_phase(
            tracker, "critic", "mantis-dedupe",
            {"findings": critic_response},
            critic_model, scan_id,
        )

        # Parse findings from the critic/dedup output
        raw_findings = _parse_findings_from_response(deduped_response)

        # ── Phase 6: Reproduce ────────────────────────────────────────
        _update_scan_status(scan_id, "running", phase="reproduce")

        reproduce_model = phase_models_config.get("reproduce", default_model)
        final_findings: list[dict[str, Any]] = []

        for idx, finding in enumerate(raw_findings):
            publish_progress(
                scan_id,
                "reproduce",
                f"Reproducing finding {idx + 1}/{len(raw_findings)}: {finding.get('title', 'N/A')}",
                cost=tracker.total_spent,
            )

            # Retrieve vulnerable file content if available
            target_file = finding.get("file_path", "")
            target_content = ""
            if target_file:
                try:
                    target_content = read_file(workspace, target_file)
                except Exception:
                    pass

            # Generate PoC script
            poc_response = _run_phase(
                tracker, "reproduce", "mantis-reproduce",
                {
                    "finding": json.dumps(finding, indent=2),
                    "file_path": target_file,
                    "target_code": target_content,
                    "file_listing": file_listing,
                },
                reproduce_model, scan_id,
            )

            # Extract Python code from the response
            poc_code = _extract_code_block(poc_response)

            if poc_code:
                # Write reproducer and execute in sandbox
                write_reproducer(workspace, poc_code)
                sandbox_result = execute_poc_in_sandbox(workspace, timeout_seconds=30)
                finding["poc_script"] = poc_code
                finding["poc_output"] = sandbox_result.get("logs", "")
                if sandbox_result.get("reproduced"):
                    finding["status"] = "reproduced"
                else:
                    finding["status"] = "not_reproduced"
            else:
                finding["poc_script"] = None
                finding["poc_output"] = "Could not extract PoC code from LLM response"

            final_findings.append(finding)

        # ── Phase 7: Patch ────────────────────────────────────────────
        _update_scan_status(scan_id, "running", phase="patch")

        patch_model = phase_models_config.get("patch", default_model)

        for idx, finding in enumerate(final_findings):
            publish_progress(
                scan_id,
                "patch",
                f"Generating patch {idx + 1}/{len(final_findings)}: {finding.get('title', 'N/A')}",
                cost=tracker.total_spent,
            )

            target_file = finding.get("file_path", "")
            target_content = ""
            if target_file:
                try:
                    target_content = read_file(workspace, target_file)
                except Exception:
                    pass

            patch_response = _run_phase(
                tracker, "patch", "mantis-patch",
                {
                    "finding": json.dumps(finding, indent=2),
                    "file_path": target_file,
                    "target_code": target_content,
                    "file_listing": file_listing,
                },
                patch_model, scan_id,
            )

            patch_diff = _extract_code_block(patch_response, language="diff")
            if patch_diff:
                finding["patch_diff"] = patch_diff

        # ── Persist Findings ──────────────────────────────────────────
        for finding in final_findings:
            _persist_finding(scan_id, finding)

        # Mirror to JSON file
        _save_findings_json(scan_id, final_findings)

        # ── Complete ──────────────────────────────────────────────────
        _update_scan_status(
            scan_id,
            "completed",
            phase="done",
            completed_at=datetime.now(timezone.utc),
        )
        publish_progress(
            scan_id,
            "done",
            f"Scan complete – {len(final_findings)} findings",
            cost=tracker.total_spent,
            status="completed",
        )

        logger.info(
            "scan_complete",
            scan_id=scan_id,
            findings=len(final_findings),
            cost=tracker.total_spent,
        )

        return {
            "scan_id": scan_id,
            "status": "completed",
            "findings_count": len(final_findings),
            "cost_usd": tracker.total_spent,
        }

    except BudgetExceededError as exc:
        err_msg = str(exc)
        logger.warning("scan_budget_exceeded", scan_id=scan_id, error=err_msg)
        _update_scan_status(
            scan_id,
            "budget_exceeded",
            completed_at=datetime.now(timezone.utc),
            error_message=err_msg,
        )
        publish_progress(
            scan_id,
            "error",
            err_msg,
            cost=exc.spent,
            status="budget_exceeded",
        )
        return {"scan_id": scan_id, "status": "budget_exceeded", "error": err_msg}

    except Exception as exc:
        err_msg = str(exc)
        logger.error("scan_failed", scan_id=scan_id, error=err_msg, exc_info=True)
        _update_scan_status(
            scan_id,
            "failed",
            completed_at=datetime.now(timezone.utc),
            error_message=err_msg,
        )
        publish_progress(
            scan_id,
            "error",
            f"Scan failed: {err_msg}",
            cost=tracker.total_spent if tracker else 0,
            status="failed",
        )
        return {"scan_id": scan_id, "status": "failed", "error": err_msg}

    finally:
        if tracker:
            tracker.dispose()


# ── Utilities ─────────────────────────────────────────────────────────────────


def _extract_code_block(text: str, language: str = "python") -> Optional[str]:
    """Extract the first fenced code block from *text*.

    Tries language-specific fences first (e.g. ```python), then generic fences.
    """
    import re

    # Try language-specific fence
    pattern = rf"```{language}\s*\n(.*?)```"
    match = re.search(pattern, text, re.DOTALL)
    if match:
        return match.group(1).strip()

    # Try generic fence
    pattern = r"```\s*\n(.*?)```"
    match = re.search(pattern, text, re.DOTALL)
    if match:
        return match.group(1).strip()

    return None
