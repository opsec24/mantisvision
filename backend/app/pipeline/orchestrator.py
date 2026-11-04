"""NewGenSAST Pipeline Orchestrator.

Thin adapter: translates a web scan config into a Google Mantis ADK run,
streams ADK graph events into Redis (SSE) and PostgreSQL (agent_inference_traces),
then ingests Mantis findings into the findings table on completion.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import structlog
from celery import Celery
from redis import Redis
from sqlalchemy import create_engine, text

from app.core.config import settings

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
    broker_transport_options={"visibility_timeout": 86400 * 3},
    task_time_limit=86400 * 3,
    task_soft_time_limit=86400 * 3,
)

# ── Redis ─────────────────────────────────────────────────────────────────────

_redis_client: Optional[Redis] = None


def _get_redis() -> Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = Redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis_client


# ── Sync DB ───────────────────────────────────────────────────────────────────

_sync_engine = None


def _get_sync_engine():
    global _sync_engine
    if _sync_engine is None:
        url = settings.DATABASE_URL
        if "+asyncpg" in url:
            url = url.replace("+asyncpg", "")
        if "postgresql://" in url and "+psycopg2" not in url:
            url = url.replace("postgresql://", "postgresql+psycopg2://")
        _sync_engine = create_engine(url, pool_size=5, max_overflow=5)
    return _sync_engine


# ── SSE Publisher ─────────────────────────────────────────────────────────────

def _publish_progress(scan_id: str, event: dict) -> None:
    try:
        redis = _get_redis()
        redis.publish(f"scan:{scan_id}:progress", json.dumps(event))
    except Exception as exc:
        logger.warning("sse_publish_failed", scan_id=scan_id, error=str(exc))


def _update_scan(scan_id: str, **fields) -> None:
    engine = _get_sync_engine()
    if not fields:
        return
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE scans SET {set_clause} WHERE id = :id"), {"id": scan_id, **fields})


def _record_trace(scan_id: str, step: int, phase: str, agent: str, **kwargs) -> None:
    engine = _get_sync_engine()
    with engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO agent_inference_traces
                  (scan_id, step_number, phase, agent_name, model,
                   thinking_content, prompt_raw, response_raw,
                   tool_name, tool_input, tool_output,
                   candidate_vuln_title, decision_status, decision_reason,
                   prompt_tokens, completion_tokens, total_tokens, latency_ms, cost_usd)
                VALUES
                  (:scan_id, :step, :phase, :agent, :model,
                   :thinking, :prompt, :response,
                   :tool_name, :tool_input::jsonb, :tool_output,
                   :vuln_title, :status, :reason,
                   :ptok, :ctok, :ttok, :latency, :cost)
            """),
            {
                "scan_id": scan_id,
                "step": step,
                "phase": phase,
                "agent": agent,
                "model": kwargs.get("model", ""),
                "thinking": kwargs.get("thinking_content"),
                "prompt": kwargs.get("prompt_raw"),
                "response": kwargs.get("response_raw"),
                "tool_name": kwargs.get("tool_name"),
                "tool_input": json.dumps(kwargs.get("tool_input")) if kwargs.get("tool_input") else None,
                "tool_output": kwargs.get("tool_output"),
                "vuln_title": kwargs.get("candidate_vuln_title"),
                "status": kwargs.get("decision_status", "PROGRESS"),
                "reason": kwargs.get("decision_reason"),
                "ptok": kwargs.get("prompt_tokens", 0),
                "ctok": kwargs.get("completion_tokens", 0),
                "ttok": kwargs.get("total_tokens", 0),
                "latency": kwargs.get("latency_ms", 0),
                "cost": kwargs.get("cost_usd", 0.0),
            },
        )


def _ingest_findings(scan_id: str, workspace_dir: Path) -> int:
    """Parse Mantis SARIF output and ingest findings into our findings table."""
    engine = _get_sync_engine()
    count = 0

    # Try SARIF file first
    sarif_path = workspace_dir / "report.sarif"
    if sarif_path.exists():
        try:
            sarif = json.loads(sarif_path.read_text())
            for run in sarif.get("runs", []):
                for result in run.get("results", []):
                    rule_id = result.get("ruleId", "UNKNOWN")
                    message = result.get("message", {}).get("text", "")
                    severity = "medium"
                    level = result.get("level", "warning")
                    if level == "error":
                        severity = "high"
                    elif level == "note":
                        severity = "low"
                    file_path = None
                    line_number = None
                    locs = result.get("locations", [])
                    if locs:
                        phys = locs[0].get("physicalLocation", {})
                        file_path = phys.get("artifactLocation", {}).get("uri")
                        line_number = phys.get("region", {}).get("startLine")
                    with engine.begin() as conn:
                        conn.execute(
                            text("""
                                INSERT INTO findings (scan_id, title, cwe, severity, status, file_path, line_number, description)
                                VALUES (:scan_id, :title, :cwe, :severity, 'open', :file_path, :line_number, :description)
                            """),
                            {
                                "scan_id": scan_id,
                                "title": rule_id,
                                "cwe": None,
                                "severity": severity,
                                "file_path": file_path,
                                "line_number": line_number,
                                "description": message,
                            },
                        )
                    count += 1
        except Exception as exc:
            logger.warning("sarif_ingest_failed", scan_id=scan_id, error=str(exc))

    # Also try knowledge.db findings table if SARIF not present or empty
    if count == 0:
        kb_path = workspace_dir / "knowledge.db"
        if kb_path.exists():
            try:
                import sqlite3
                con = sqlite3.connect(str(kb_path))
                con.row_factory = sqlite3.Row
                cur = con.execute("""
                    SELECT title, cwe, severity, filepath, line_numbers, description,
                           remediation, patch_diff, triage_reasoning, mantis_risk_score
                    FROM findings
                    WHERE status NOT IN ('rejected', 'duplicate')
                    ORDER BY id
                """)
                for row in cur.fetchall():
                    line_number = None
                    try:
                        lns = json.loads(row["line_numbers"]) if row["line_numbers"] else []
                        if lns and isinstance(lns, list) and len(lns) > 0:
                            line_number = int(lns[0])
                    except Exception:
                        pass

                    with engine.begin() as conn:
                        conn.execute(
                            text("""
                                INSERT INTO findings
                                  (scan_id, title, cwe, severity, status, file_path, line_number,
                                   description, patch_diff)
                                VALUES
                                  (:scan_id, :title, :cwe, :severity, 'open', :file_path, :line_number,
                                   :description, :patch_diff)
                            """),
                            {
                                "scan_id": scan_id,
                                "title": row["title"] or "Untitled Finding",
                                "cwe": row["cwe"],
                                "severity": (row["severity"] or "medium").lower(),
                                "file_path": row["filepath"],
                                "line_number": line_number,
                                "description": row["description"] or row["triage_reasoning"] or "",
                                "patch_diff": row["patch_diff"],
                            },
                        )
                    count += 1
                con.close()
            except Exception as exc:
                logger.warning("kb_ingest_failed", scan_id=scan_id, error=str(exc))

    return count


def _ingest_transcript(scan_id: str, workspace_dir: Path) -> int:
    """Parse Mantis JSONL transcript rows into agent_inference_traces."""
    transcript_path = workspace_dir / "transcript.jsonl"
    if not transcript_path.exists():
        return 0
    engine = _get_sync_engine()
    count = 0
    try:
        with open(transcript_path, "r", encoding="utf-8") as f:
            for idx, line in enumerate(f):
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                    node = row.get("node") or row.get("author") or "mantis"
                    r_type = row.get("type", "text")
                    tool_name = row.get("name") if r_type in ("tool_call", "tool_response") else None
                    tool_input = row.get("args") if r_type == "tool_call" else None
                    tool_output = row.get("response") if r_type == "tool_response" else None
                    resp_text = row.get("text") if r_type == "text" else None

                    with engine.begin() as conn:
                        conn.execute(
                            text("""
                                INSERT INTO agent_inference_traces
                                  (scan_id, step_number, phase, agent_name,
                                   response_raw, tool_name, tool_input, tool_output,
                                   decision_status)
                                VALUES
                                  (:scan_id, :step, :phase, :agent,
                                   :resp, :tool, :tool_in::jsonb, :tool_out,
                                   'PROGRESS')
                            """),
                            {
                                "scan_id": scan_id,
                                "step": 10000 + idx,
                                "phase": node,
                                "agent": node,
                                "resp": resp_text,
                                "tool": tool_name,
                                "tool_in": json.dumps(tool_input) if isinstance(tool_input, (dict, list)) else json.dumps({"args": tool_input}) if tool_input else None,
                                "tool_out": tool_output,
                            },
                        )
                    count += 1
                except Exception:
                    pass
    except Exception as exc:
        logger.warning("transcript_ingest_failed", scan_id=scan_id, error=str(exc))
    return count


# ── Mantis Workspace ──────────────────────────────────────────────────────────

SCAN_DATA_ROOT = Path(os.getenv("SCAN_DATA_ROOT", "/data/scans"))
MANTIS_ENGINE_DIR = Path("/app/mantis_engine")


def _build_workspace(scan_id: str, source_target: str, source_type: str,
                     branch: Optional[str], git_token: Optional[str]) -> Path:
    """Clone or symlink the target repo into a fresh scan workspace."""
    ws = SCAN_DATA_ROOT / scan_id
    ws.mkdir(parents=True, exist_ok=True)
    target_dir = ws / "target"

    if source_type == "git":
        url = source_target
        if git_token:
            # Inject token into URL
            from urllib.parse import urlparse, urlunparse
            parsed = urlparse(url)
            authed = parsed._replace(netloc=f"{git_token}@{parsed.netloc}")
            url = urlunparse(authed)
        cmd = ["git", "clone", "--depth", "1"]
        if branch:
            cmd += ["--branch", branch]
        cmd += [url, str(target_dir)]
        subprocess.run(cmd, check=True, timeout=300, capture_output=True)
    elif source_type == "local":
        src = Path(source_target)
        if not src.exists():
            raise FileNotFoundError(f"Local path does not exist: {source_target}")
        # Symlink the local directory read-only
        if target_dir.exists() or target_dir.is_symlink():
            target_dir.unlink()
        target_dir.symlink_to(src.resolve())
    else:
        raise ValueError(f"Unsupported source_type: {source_type}")

    return ws


def _write_workflow_override(workspace: Path, config: dict) -> Path:
    """Write workflow.local.json with scan-specific model and flags."""
    override = {
        "config": {
            "db_path": str(workspace / "knowledge.db"),
        }
    }
    # Model
    if config.get("model"):
        override["config"]["default_model"] = config["model"]
    # Reasoning effort
    if config.get("reasoning_effort"):
        override["config"]["reasoning_effort"] = config["reasoning_effort"]
    # Sandbox
    if config.get("sandbox"):
        override["config"]["sandbox"] = {"type": config["sandbox"], "options": {}}
    # Budget
    if config.get("max_tokens"):
        override["budget"] = {"max_tokens": config["max_tokens"]}

    path = workspace / "workflow.local.json"
    path.write_text(json.dumps(override, indent=2))
    return path


# ── Celery Task ───────────────────────────────────────────────────────────────

@celery_app.task(bind=True, name="mantis.run_scan", max_retries=0)
def run_mantis_scan(
    self,
    scan_id: str,
    source_type: str,
    source_target: str,
    branch: Optional[str] = None,
    git_token: Optional[str] = None,
    resume: bool = False,
    scan_config: Optional[dict] = None,
) -> dict[str, Any]:
    """Execute a full Mantis ADK scan and stream events into Redis + Postgres."""
    scan_config = scan_config or {}
    redis = _get_redis()

    # Distributed lock
    lock_key = f"scan:{scan_id}:running_lock"
    task_id = str(self.request.id or f"pid_{os.getpid()}")
    if not redis.set(lock_key, task_id, nx=True, ex=604800):
        return {"status": "skipped_duplicate", "scan_id": scan_id}

    step_counter = 0

    def emit(phase: str, node: str, event_type: str, data: dict):
        nonlocal step_counter
        step_counter += 1
        payload = {
            "step": step_counter,
            "phase": phase,
            "node": node,
            "event_type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **data,
        }
        _publish_progress(scan_id, payload)
        # Persist to agent_inference_traces
        try:
            _record_trace(
                scan_id=scan_id,
                step=step_counter,
                phase=phase,
                agent=node,
                **{k: v for k, v in data.items() if k in (
                    "model", "thinking_content", "prompt_raw", "response_raw",
                    "tool_name", "tool_input", "tool_output",
                    "candidate_vuln_title", "decision_status", "decision_reason",
                    "prompt_tokens", "completion_tokens", "total_tokens",
                    "latency_ms", "cost_usd",
                )}
            )
        except Exception as exc:
            logger.warning("trace_record_failed", error=str(exc))

    try:
        _update_scan(scan_id, status="running", current_phase="setup")
        emit("setup", "orchestrator", "scan_start", {"message": f"Preparing workspace for {source_target}"})

        # 1. Build workspace
        if resume:
            workspace = SCAN_DATA_ROOT / scan_id
            if not workspace.exists():
                raise FileNotFoundError(f"Cannot resume — workspace not found: {workspace}")
            emit("setup", "orchestrator", "resume", {"message": "Resuming from existing workspace"})
        else:
            emit("setup", "orchestrator", "clone", {"message": f"Cloning {source_target}"})
            workspace = _build_workspace(scan_id, source_target, source_type, branch, git_token)

        target_dir = workspace / "target"
        emit("setup", "orchestrator", "ready", {"message": f"Workspace ready: {workspace}"})

        # 2. Write workflow override
        _write_workflow_override(workspace, scan_config)

        # 3. Determine focus and exclude flags
        focus = scan_config.get("focus")
        exclude = scan_config.get("exclude", [])

        # 4. Build Mantis CLI command
        # We run the upstream reference harness directly as a subprocess,
        # streaming its stdout line-by-line into Redis.
        mantis_run_sh = MANTIS_ENGINE_DIR / "run.sh"

        env = os.environ.copy()
        # Pass model credentials through — from settings or environment
        for key in ("GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
                    "DEEPSEEK_API_KEY", "VERTEXAI_PROJECT", "GOOGLE_CLOUD_PROJECT",
                    "GOOGLE_APPLICATION_CREDENTIALS", "OLLAMA_API_BASE"):
            val = getattr(settings, key, None) or os.environ.get(key)
            if val:
                env[key] = val

        # Also load encrypted API keys saved via the Web UI Settings page
        try:
            from app.core.security import decrypt_value
            engine = _get_sync_engine()
            with engine.connect() as conn:
                rows = conn.execute(text("SELECT provider, api_key_encrypted, api_base_url FROM provider_configs WHERE is_active = true")).fetchall()
                for p_name, p_enc, p_base in rows:
                    p_lower = str(p_name).lower()
                    if p_enc:
                        try:
                            key_val = decrypt_value(p_enc)
                            if p_lower == "openai":
                                env["OPENAI_API_KEY"] = key_val
                            elif p_lower in ("anthropic", "claude"):
                                env["ANTHROPIC_API_KEY"] = key_val
                            elif p_lower in ("gemini", "google"):
                                env["GEMINI_API_KEY"] = key_val
                            elif p_lower == "deepseek":
                                env["DEEPSEEK_API_KEY"] = key_val
                        except Exception:
                            pass
                    if p_base:
                        if p_lower == "ollama":
                            env["OLLAMA_API_BASE"] = p_base
        except Exception as prov_err:
            logger.warning("provider_keys_load_failed", error=str(prov_err))

        # Build command
        transcript_file = workspace / "transcript.jsonl"
        cmd = [
            "bash", str(mantis_run_sh),
            str(target_dir),
            "--workflow", str(MANTIS_ENGINE_DIR / "workflow.json"),
            "--db", str(workspace / "knowledge.db"),
            "--transcript-out", str(transcript_file),
            "--yes",
        ]

        if focus:
            cmd += ["--focus", focus]
        for ex in exclude:
            cmd += ["--exclude", ex]
        if scan_config.get("max_tokens"):
            cmd += ["--max-tokens", str(scan_config["max_tokens"])]
        if scan_config.get("model"):
            cmd += ["--model", scan_config["model"]]
        if scan_config.get("reasoning_effort"):
            cmd += ["--reasoning-effort", scan_config["reasoning_effort"]]
        if scan_config.get("sandbox"):
            cmd += ["--sandbox", scan_config["sandbox"]]
        if resume and (workspace / "knowledge.db").exists():
            # Find most recent run_id from knowledge.db to resume
            try:
                import sqlite3
                con = sqlite3.connect(str(workspace / "knowledge.db"))
                row = con.execute("SELECT run_id FROM runs ORDER BY rowid DESC LIMIT 1").fetchone()
                con.close()
                if row:
                    cmd += ["--resume", row[0]]
            except Exception:
                pass

        _update_scan(scan_id, current_phase="running")
        emit("running", "mantis_engine", "launch", {
            "message": "Launching Google Mantis ADK harness",
            "command": " ".join(cmd[:6]) + " ...",
        })

        # 5. Stream subprocess output line-by-line
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
            cwd=str(MANTIS_ENGINE_DIR),
        )

        current_node = "mantis_engine"
        for line in proc.stdout:
            line = line.rstrip()
            if not line:
                continue

            # Detect node transitions from Mantis output banners
            # Mantis prints: ╔══ [history] ══╗ or similar
            if "╔" in line or "══" in line:
                for node_name in ["history", "structural_index", "architect", "threat_modeler",
                                   "planner", "researcher", "deduplicator", "reviewer",
                                   "critic", "reproducer", "chainer", "patcher",
                                   "calibrator", "reflector", "reporter"]:
                    if node_name in line.lower():
                        current_node = node_name
                        _update_scan(scan_id, current_phase=node_name)
                        break

            emit("running", current_node, "log_line", {
                "message": line,
                "decision_status": "PROGRESS",
            })

        proc.wait(timeout=86400 * 3)
        exit_code = proc.returncode

        if exit_code != 0:
            raise RuntimeError(f"Mantis exited with code {exit_code}")

        # 6. Ingest findings
        _update_scan(scan_id, current_phase="ingesting_findings")
        emit("ingesting", "orchestrator", "ingest", {"message": "Ingesting Mantis findings into database"})

        findings_count = _ingest_findings(scan_id, workspace)
        _ingest_transcript(scan_id, workspace)

        # 7. Ingest threat model and architecture summary from KB
        kb_dir = workspace / "workspace" / "kb"
        threat_model_text = None
        arch_summary = None
        if (kb_dir / "THREAT_MODEL.md").exists():
            threat_model_text = (kb_dir / "THREAT_MODEL.md").read_text(encoding="utf-8", errors="replace")
        if (kb_dir / "architecture.md").exists():
            arch_summary = (kb_dir / "architecture.md").read_text(encoding="utf-8", errors="replace")

        update_fields: dict = {
            "status": "completed",
            "current_phase": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        if threat_model_text:
            update_fields["threat_model"] = threat_model_text
        if arch_summary:
            update_fields["architecture_summary"] = arch_summary
        _update_scan(scan_id, **update_fields)

        emit("completed", "orchestrator", "scan_complete", {
            "message": f"Scan complete. {findings_count} findings ingested.",
            "findings_count": findings_count,
            "decision_status": "COMPLETE",
        })

        redis.delete(lock_key)
        return {"status": "completed", "scan_id": scan_id, "findings_count": findings_count}

    except Exception as exc:
        logger.error("scan_failed", scan_id=scan_id, error=str(exc), exc_info=True)
        _update_scan(scan_id, status="failed", error_message=str(exc)[:2000])
        emit("failed", "orchestrator", "scan_error", {
            "message": f"Scan failed: {exc}",
            "decision_status": "FAILED",
        })
        redis.delete(lock_key)
        raise
