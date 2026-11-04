"""NewGenSAST Pipeline Orchestrator.

Thin adapter: translates a web scan config into a Google Mantis ADK run,
streams ADK graph events into Redis (SSE) and PostgreSQL (agent_inference_traces),
then ingests Mantis findings into the findings table on completion.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
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
        payload = json.dumps(event)
        redis.publish(f"scan:{scan_id}:progress", payload)
        # Persist event into Redis history list so reloads & new tabs replay past events
        redis.rpush(f"scan:{scan_id}:history", payload)
        redis.ltrim(f"scan:{scan_id}:history", -1500, -1)
        redis.expire(f"scan:{scan_id}:history", 86400 * 7)
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
                   :tool_name, CAST(:tool_input AS jsonb), :tool_output,
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

                    rca_summary = row["rca_summary"] if "rca_summary" in row.keys() else None
                    remediation = row["remediation"] if "remediation" in row.keys() else None

                    with engine.begin() as conn:
                        conn.execute(
                            text("""
                                INSERT INTO findings
                                  (scan_id, title, cwe, severity, status, file_path, line_number,
                                   description, patch_diff, mitigation, exploit_steps)
                                VALUES
                                  (:scan_id, :title, :cwe, :severity, 'open', :file_path, :line_number,
                                   :description, :patch_diff, :mitigation, :exploit_steps)
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
                                "mitigation": remediation,
                                "exploit_steps": rca_summary,
                            },
                        )
                    count += 1
                con.close()
            except Exception as exc:
                logger.warning("kb_ingest_failed", scan_id=scan_id, error=str(exc))

    return count


def _parse_tool_input(args_val: Any) -> Optional[dict[str, Any]]:
    """Parse tool input arguments into a structured JSON dictionary."""
    if not args_val:
        return None
    if isinstance(args_val, (dict, list)):
        return args_val if isinstance(args_val, dict) else {"items": args_val}
    if isinstance(args_val, str):
        try:
            parsed = json.loads(args_val)
            if isinstance(parsed, dict):
                return parsed
            if isinstance(parsed, list):
                return {"items": parsed}
        except Exception:
            pass
        try:
            import ast
            parsed = ast.literal_eval(args_val)
            if isinstance(parsed, dict):
                return parsed
            if isinstance(parsed, list):
                return {"items": parsed}
        except Exception:
            pass
        return {"args": args_val}
    return {"args": str(args_val)}


def _ingest_transcript(scan_id: str, workspace_dir: Path) -> int:
    """Parse Mantis JSONL transcript rows into agent_inference_traces, pairing tool calls and responses."""
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

                    phase_mapped = NODE_TO_PHASE.get(node, node)

                    # If this is a tool_response, merge it into the preceding pending tool_call
                    if r_type == "tool_response" and tool_name:
                        with engine.begin() as conn:
                            res = conn.execute(
                                text("""
                                    UPDATE agent_inference_traces
                                    SET tool_output = :tool_out
                                    WHERE id = (
                                        SELECT id FROM agent_inference_traces
                                        WHERE scan_id = :scan_id
                                          AND agent_name = :agent
                                          AND tool_name = :tool
                                          AND (tool_output IS NULL OR tool_output = '')
                                        ORDER BY step_number DESC
                                        LIMIT 1
                                    )
                                """),
                                {
                                    "scan_id": scan_id,
                                    "agent": node,
                                    "tool": tool_name,
                                    "tool_out": str(tool_output)[:16000] if tool_output else None,
                                },
                            )
                            if res.rowcount > 0:
                                count += 1
                                continue

                    parsed_inp = _parse_tool_input(tool_input) if tool_input else None
                    with engine.begin() as conn:
                        conn.execute(
                            text("""
                                INSERT INTO agent_inference_traces
                                  (scan_id, step_number, phase, agent_name,
                                   response_raw, tool_name, tool_input, tool_output,
                                   decision_status)
                                VALUES
                                  (:scan_id, :step, :phase, :agent,
                                   :resp, :tool, CAST(:tool_in AS jsonb), :tool_out,
                                   'PROGRESS')
                            """),
                            {
                                "scan_id": scan_id,
                                "step": 10000 + idx,
                                "phase": phase_mapped,
                                "agent": node,
                                "resp": resp_text,
                                "tool": tool_name,
                                "tool_in": json.dumps(parsed_inp) if parsed_inp else None,
                                "tool_out": str(tool_output)[:16000] if tool_output else None,
                            },
                        )
                    count += 1
                except Exception:
                    pass
    except Exception as exc:
        logger.warning("transcript_ingest_failed", scan_id=scan_id, error=str(exc))
    return count


# ── Node to Visual Funnel Phase Mapping ───────────────────────────────────────

NODE_TO_PHASE = {
    "setup": "ingest",
    "clone": "ingest",
    "ready": "ingest",
    "ingest": "ingest",
    "history": "indexing",
    "structural_index": "indexing",
    "indexing": "indexing",
    "architect": "threat_model",
    "threat_modeler": "threat_model",
    "threat_model": "threat_model",
    "planner": "research",
    "researcher": "research",
    "research": "research",
    "deduplicator": "critic",
    "reviewer": "critic",
    "critic": "critic",
    "findings_gate": "critic",
    "reproducer": "reproduce",
    "chainer": "reproduce",
    "reproduce": "reproduce",
    "patcher": "patch",
    "calibrator": "patch",
    "reflector": "patch",
    "reporter": "patch",
    "patch": "patch",
    "completed": "patch",
}


def _format_threat_model_md(content: str) -> str:
    """Format JSON or Markdown threat model artifacts into clean Markdown for UI visualization."""
    if not content or not content.strip():
        return ""
    if content.strip().startswith("#"):
        return content

    try:
        data = json.loads(content)
        lines = ["# Threat Model & Attack Surface Matrix\n"]
        threats = data.get("threats", [])
        if threats:
            lines.append("## Identified Threats & Attack Vectors\n")
            for t in threats:
                if isinstance(t, str):
                    # Mantis format: "target_component: ...; title: ...; threat_id: ...; impact: ...; attack_vector: ..."
                    parts = [p.strip() for p in t.split(";") if p.strip()]
                    fields = {}
                    for p in parts:
                        if ":" in p:
                            k, v = p.split(":", 1)
                            fields[k.strip().lower()] = v.strip()
                    threat_title = fields.get("title", "Identified Threat")
                    threat_id = fields.get("threat_id", "THRT")
                    lines.append(f"### {threat_id}: {threat_title}\n")
                    if "target_component" in fields:
                        lines.append(f"- **Target Component**: {fields['target_component']}")
                    if "attack_vector" in fields:
                        lines.append(f"- **Attack Vector**: {fields['attack_vector']}")
                    if "impact" in fields:
                        lines.append(f"- **Impact**: {fields['impact']}")
                    lines.append("")
                elif isinstance(t, dict):
                    title = t.get("title", "Identified Threat")
                    lines.append(f"### {t.get('threat_id', 'THRT')}: {title}\n")
                    for k, v in t.items():
                        if k not in ("title", "threat_id") and v:
                            lines.append(f"- **{k.replace('_', ' ').title()}**: {v}")
                    lines.append("")
        return "\n".join(lines)
    except Exception:
        return content


def calculate_cost_usd(
    model: Optional[str],
    total_tokens: int,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
) -> float:
    """Calculate USD spend based on token counts and model pricing."""
    if not total_tokens or total_tokens <= 0:
        return 0.0

    if prompt_tokens <= 0 and completion_tokens <= 0:
        prompt_tokens = int(total_tokens * 0.75)
        completion_tokens = total_tokens - prompt_tokens

    m_lower = (model or "").lower()

    # Try litellm cost lookup if available
    try:
        import litellm
        clean_model = m_lower.removeprefix("gemini/").removeprefix("openai/").removeprefix("anthropic/")
        info = litellm.model_cost.get(m_lower) or litellm.model_cost.get(clean_model)
        if info:
            in_cost = float(info.get("input_cost_per_token") or 0.0)
            out_cost = float(info.get("output_cost_per_token") or 0.0)
            if in_cost > 0 or out_cost > 0:
                return round(prompt_tokens * in_cost + completion_tokens * out_cost, 4)
    except Exception:
        pass

    # Standard model tier pricing (prices per 1M tokens)
    if any(k in m_lower for k in ("flash-lite", "1.5-flash-8b")):
        return round((prompt_tokens * 0.075 + completion_tokens * 0.30) / 1_000_000, 4)
    elif any(k in m_lower for k in ("flash", "3.8-flash", "2.5-flash")):
        return round((prompt_tokens * 0.15 + completion_tokens * 0.60) / 1_000_000, 4)
    elif "pro" in m_lower:
        return round((prompt_tokens * 1.25 + completion_tokens * 5.00) / 1_000_000, 4)
    elif "gpt-4o-mini" in m_lower:
        return round((prompt_tokens * 0.15 + completion_tokens * 0.60) / 1_000_000, 4)
    elif "gpt-4o" in m_lower:
        return round((prompt_tokens * 2.50 + completion_tokens * 10.00) / 1_000_000, 4)
    elif "sonnet" in m_lower:
        return round((prompt_tokens * 3.00 + completion_tokens * 15.00) / 1_000_000, 4)
    elif "haiku" in m_lower:
        return round((prompt_tokens * 0.80 + completion_tokens * 4.00) / 1_000_000, 4)
    elif "ollama" in m_lower:
        return 0.0
    else:
        return round(total_tokens * (0.20 / 1_000_000), 4)


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
        # Copy the local directory into workspace (Mantis refuses symlinks for jail safety)
        if target_dir.is_symlink() or target_dir.is_file():
            target_dir.unlink()
        elif target_dir.exists():
            shutil.rmtree(target_dir)

        if src.is_dir():
            shutil.copytree(src.resolve(), target_dir)
        else:
            target_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src.resolve(), target_dir / src.name)
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
    current_total_tokens = 0
    current_prompt_tokens = 0
    current_completion_tokens = 0
    current_cost_usd = 0.0

    def emit(phase: str, node: str, event_type: str, data: dict):
        nonlocal step_counter
        step_counter += 1
        payload = {
            "step": step_counter,
            "phase": phase,
            "node": node,
            "event_type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "cost": current_cost_usd,
            "total_tokens": current_total_tokens,
            "prompt_tokens": current_prompt_tokens,
            "completion_tokens": current_completion_tokens,
            **data,
        }
        _publish_progress(scan_id, payload)
        # Persist to agent_inference_traces
        try:
            trace_data = {k: v for k, v in data.items() if k in (
                "model", "thinking_content", "prompt_raw", "response_raw",
                "tool_name", "tool_input", "tool_output",
                "candidate_vuln_title", "decision_status", "decision_reason",
                "prompt_tokens", "completion_tokens", "total_tokens",
                "latency_ms", "cost_usd",
            )}
            if "response_raw" not in trace_data and "message" in data:
                trace_data["response_raw"] = data["message"]
            _record_trace(
                scan_id=scan_id,
                step=step_counter,
                phase=phase,
                agent=node,
                **trace_data,
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
        provider_base_urls = {}
        try:
            from app.core.security import decrypt_value
            engine = _get_sync_engine()
            with engine.connect() as conn:
                rows = conn.execute(text("SELECT provider, api_key_encrypted, api_base_url FROM provider_configs WHERE is_active = true")).fetchall()
                for p_name, p_enc, p_base in rows:
                    p_lower = str(p_name).lower()
                    if p_base:
                        provider_base_urls[p_lower] = p_base
                    if p_enc:
                        try:
                            key_val = decrypt_value(p_enc)
                            if p_lower == "openai":
                                env["OPENAI_API_KEY"] = key_val
                            elif p_lower in ("anthropic", "claude"):
                                env["ANTHROPIC_API_KEY"] = key_val
                            elif p_lower in ("gemini", "google"):
                                env["GEMINI_API_KEY"] = key_val
                                env["GOOGLE_API_KEY"] = key_val
                            elif p_lower == "deepseek":
                                env["DEEPSEEK_API_KEY"] = key_val
                        except Exception:
                            pass
                    if p_base:
                        if p_lower == "ollama":
                            env["OLLAMA_API_BASE"] = p_base
        except Exception as prov_err:
            logger.warning("provider_keys_load_failed", error=str(prov_err))

        # Ensure symmetric google/gemini env var mapping
        if env.get("GEMINI_API_KEY") and not env.get("GOOGLE_API_KEY"):
            env["GOOGLE_API_KEY"] = env["GEMINI_API_KEY"]
        elif env.get("GOOGLE_API_KEY") and not env.get("GEMINI_API_KEY"):
            env["GEMINI_API_KEY"] = env["GOOGLE_API_KEY"]

        # Determine effective model
        model = scan_config.get("model")
        if not model or model.strip() in ("", "default"):
            if env.get("GEMINI_API_KEY") or env.get("GOOGLE_API_KEY"):
                model = "gemini-3.5-flash-lite"
            elif env.get("OPENAI_API_KEY"):
                model = "openai/gpt-4o"
            elif env.get("ANTHROPIC_API_KEY"):
                model = "anthropic/claude-3-5-sonnet-20241022"
            elif env.get("OLLAMA_API_BASE"):
                model = "ollama/qwen2.5-coder"
            elif env.get("VERTEXAI_PROJECT") or env.get("GOOGLE_CLOUD_PROJECT"):
                model = "vertex_ai/gemini-3.8-flash"
            else:
                model = "gemini-3.5-flash-lite"

        # Update scan model record in DB if it was empty
        _update_scan(scan_id, model=model)

        # Build command
        transcript_file = workspace / "transcript.jsonl"
        cmd = [
            "bash", str(mantis_run_sh),
            str(target_dir),
            "--workflow", str(MANTIS_ENGINE_DIR / "workflow.json"),
            "--db", str(workspace / "knowledge.db"),
            "--transcript-out", str(transcript_file),
            "--yes",
            "--model", model,
        ]

        if focus:
            cmd += ["--focus", focus]
        for ex in exclude:
            cmd += ["--exclude", ex]
        if scan_config.get("max_tokens"):
            cmd += ["--max-tokens", str(scan_config["max_tokens"])]
        if scan_config.get("reasoning_effort"):
            cmd += ["--reasoning-effort", scan_config["reasoning_effort"]]
        if scan_config.get("sandbox"):
            cmd += ["--sandbox", scan_config["sandbox"]]
        if scan_config.get("scan_mode"):
            cmd += ["--scan-mode", scan_config["scan_mode"]]
        if scan_config.get("objective"):
            cmd += ["--objective", scan_config["objective"]]
        if scan_config.get("seed_report"):
            cmd += ["--seed-report", scan_config["seed_report"]]
        if scan_config.get("deterministic_only"):
            cmd += ["--deterministic-only"]
        if scan_config.get("no_replan"):
            cmd += ["--no-replan"]
        if scan_config.get("parallel"):
            cmd += ["--parallel", str(scan_config["parallel"])]
        if scan_config.get("max_llm_calls"):
            cmd += ["--max-llm-calls", str(scan_config["max_llm_calls"])]
        if scan_config.get("api_base"):
            cmd += ["--api-base", scan_config["api_base"]]
        elif model.startswith("ollama/") and env.get("OLLAMA_API_BASE"):
            cmd += ["--api-base", env["OLLAMA_API_BASE"]]
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
            "message": f"Launching Google Mantis ADK harness (model: {model})",
            "command": " ".join(cmd[:8]) + " ...",
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

        current_node = "setup"
        current_phase = "indexing"
        recent_output_lines = []
        arch_saved = False
        threat_saved = False
        plan_saved = False
        review_saved = False
        line_count = 0
        transcript_ingested_lines = 0

        for line in proc.stdout:
            line = line.rstrip()
            if not line:
                continue

            recent_output_lines.append(line)
            if len(recent_output_lines) > 60:
                recent_output_lines.pop(0)

            line_count += 1

            # Detect node transitions from Mantis ADK output banners
            # e.g.: -- mantis_vulnerability_pipeline@1/architect@1
            # or:   -- mantis_vulnerability_pipeline@1/threat_modeler@1
            node_match = re.search(
                r"/(history|structural_index|architect|threat_modeler|planner|researcher|deduplicator|reviewer|critic|findings_gate|reproducer|chainer|patcher|calibrator|reflector|reporter)@",
                line,
            )
            if node_match:
                current_node = node_match.group(1)
                new_phase = NODE_TO_PHASE.get(current_node, "indexing")
                if new_phase != current_phase:
                    current_phase = new_phase
                    _update_scan(scan_id, current_phase=current_phase)
            elif "╔" in line or "══" in line or "node '" in line:
                for candidate in NODE_TO_PHASE.keys():
                    if candidate in line.lower():
                        current_node = candidate
                        new_phase = NODE_TO_PHASE.get(current_node, "indexing")
                        if new_phase != current_phase:
                            current_phase = new_phase
                            _update_scan(scan_id, current_phase=current_phase)
                        break

            # Parse tool calls and responses for instant swarm trace visibility
            extra_trace = {}
            tool_call_match = re.search(r"\[TOOL CALL:\s*(\w+)\](?:\s*args=(.+))?", line)
            tool_resp_match = re.search(r"\[TOOL RESPONSE:\s*(\w+)\](?:\s*(.+))?", line)
            if tool_call_match:
                extra_trace["tool_name"] = tool_call_match.group(1)
                raw_args = tool_call_match.group(2)
                if raw_args:
                    try:
                        import ast
                        extra_trace["tool_input"] = ast.literal_eval(raw_args.strip())
                    except Exception:
                        extra_trace["tool_input"] = {"args": raw_args.strip()}
            elif tool_resp_match:
                extra_trace["tool_name"] = tool_resp_match.group(1)
                extra_trace["tool_output"] = (tool_resp_match.group(2) or "")[:3000]

            emit(current_phase, current_node, "log_line", {
                "message": line,
                "decision_status": "PROGRESS",
                **extra_trace,
            })

            # Check for newly produced artifacts and transcript lines every 10 lines
            if line_count % 10 == 0:
                # 1. Ingest newly appended lines from transcript.jsonl
                t_file = workspace / "transcript.jsonl"
                if t_file.exists():
                    try:
                        with open(t_file, "r", encoding="utf-8") as tf:
                            all_tlines = tf.readlines()
                        if len(all_tlines) > transcript_ingested_lines:
                            new_tlines = all_tlines[transcript_ingested_lines:]
                            engine = _get_sync_engine()
                            for t_idx, t_raw in enumerate(new_tlines):
                                t_raw = t_raw.strip()
                                if not t_raw:
                                    continue
                                try:
                                    t_row = json.loads(t_raw)
                                    t_node = t_row.get("node") or t_row.get("author") or current_node
                                    t_phase = NODE_TO_PHASE.get(t_node, current_phase)
                                    t_type = t_row.get("type", "text")
                                    t_name = t_row.get("name") if t_type in ("tool_call", "tool_response") else None
                                    t_args = t_row.get("args") if t_type == "tool_call" else None
                                    t_resp = t_row.get("response") if t_type == "tool_response" else None
                                    t_text = t_row.get("text") if t_type == "text" else None

                                    # If this is a tool_response, merge it into the preceding pending tool_call
                                    if t_type == "tool_response" and t_name:
                                        with engine.begin() as conn:
                                            res = conn.execute(
                                                text("""
                                                    UPDATE agent_inference_traces
                                                    SET tool_output = :tool_out
                                                    WHERE id = (
                                                        SELECT id FROM agent_inference_traces
                                                        WHERE scan_id = :scan_id
                                                          AND agent_name = :agent
                                                          AND tool_name = :tool
                                                          AND (tool_output IS NULL OR tool_output = '')
                                                        ORDER BY step_number DESC
                                                        LIMIT 1
                                                    )
                                                """),
                                                {
                                                    "scan_id": scan_id,
                                                    "agent": t_node,
                                                    "tool": t_name,
                                                    "tool_out": str(t_resp)[:16000] if t_resp else None,
                                                },
                                            )
                                            if res.rowcount > 0:
                                                continue

                                    parsed_t_args = _parse_tool_input(t_args) if t_args else None
                                    with engine.begin() as conn:
                                        conn.execute(
                                            text("""
                                                INSERT INTO agent_inference_traces
                                                  (scan_id, step_number, phase, agent_name,
                                                   response_raw, tool_name, tool_input, tool_output,
                                                   decision_status)
                                                VALUES
                                                  (:scan_id, :step, :phase, :agent,
                                                   :resp, :tool, CAST(:tool_in AS jsonb), :tool_out,
                                                   'PROGRESS')
                                            """),
                                            {
                                                "scan_id": scan_id,
                                                "step": 20000 + transcript_ingested_lines + t_idx,
                                                "phase": t_phase,
                                                "agent": t_node,
                                                "resp": t_text,
                                                "tool": t_name,
                                                "tool_in": json.dumps(parsed_t_args) if parsed_t_args else None,
                                                "tool_out": str(t_resp)[:16000] if t_resp else None,
                                            },
                                        )
                                except Exception:
                                    pass
                            transcript_ingested_lines = len(all_tlines)
                    except Exception:
                        pass

                # 2. Extract architecture, threat model, hunting plan from knowledge.db
                kb_path = workspace / "knowledge.db"
                if kb_path.exists() and (not arch_saved or not threat_saved or not plan_saved or not review_saved):
                    try:
                        import sqlite3
                        con = sqlite3.connect(str(kb_path))
                        rows = con.execute("SELECT filepath, content FROM campaign_artifacts").fetchall()
                        con.close()
                        kb_updates = {}
                        for fpath, content in rows:
                            if not arch_saved and "architecture.md" in fpath and content:
                                kb_updates["architecture_summary"] = content
                                arch_saved = True
                            elif not threat_saved and "threat_model" in fpath.lower() and content:
                                kb_updates["threat_model"] = _format_threat_model_md(content)
                                threat_saved = True
                            elif not plan_saved and ("plan.json" in fpath or "hunting_plan" in fpath) and content:
                                kb_updates["hunting_plan"] = content
                                plan_saved = True
                            elif not review_saved and ("review_packet" in fpath or "report.json" in fpath) and content:
                                kb_updates["review_packet"] = content
                                review_saved = True
                        if kb_updates:
                            _update_scan(scan_id, **kb_updates)

                        # 3. Extract accumulated token spend and calculate live USD cost from knowledge.db
                        spend_row = con.execute("SELECT COALESCE(SUM(tokens), 0), COALESCE(SUM(llm_calls), 0) FROM campaign_spend").fetchone()
                        if spend_row and spend_row[0] > 0:
                            toks_sum = int(spend_row[0])
                            if toks_sum != current_total_tokens:
                                current_total_tokens = toks_sum
                                current_prompt_tokens = int(current_total_tokens * 0.75)
                                current_completion_tokens = current_total_tokens - current_prompt_tokens
                                current_cost_usd = calculate_cost_usd(
                                    model,
                                    current_total_tokens,
                                    current_prompt_tokens,
                                    current_completion_tokens,
                                )
                                _update_scan(
                                    scan_id,
                                    total_tokens=current_total_tokens,
                                    prompt_tokens=current_prompt_tokens,
                                    completion_tokens=current_completion_tokens,
                                    cost_spent_usd=current_cost_usd,
                                )
                    except Exception:
                        pass

                # Live token estimation from transcript.jsonl if knowledge.db campaign_spend is not yet populated
                t_file = workspace / "transcript.jsonl"
                if (current_total_tokens == 0 or line_count % 20 == 0) and t_file.exists():
                    try:
                        t_size = t_file.stat().st_size
                        # Estimate ~3.5 chars per token in raw JSONL transcript
                        est_tokens = max(current_total_tokens, int(t_size / 3.5))
                        if est_tokens > current_total_tokens:
                            current_total_tokens = est_tokens
                            current_prompt_tokens = int(est_tokens * 0.75)
                            current_completion_tokens = est_tokens - current_prompt_tokens
                            current_cost_usd = calculate_cost_usd(
                                model,
                                current_total_tokens,
                                current_prompt_tokens,
                                current_completion_tokens,
                            )
                            _update_scan(
                                scan_id,
                                total_tokens=current_total_tokens,
                                prompt_tokens=current_prompt_tokens,
                                completion_tokens=current_completion_tokens,
                                cost_spent_usd=current_cost_usd,
                            )
                    except Exception:
                        pass

        proc.wait(timeout=86400 * 3)
        exit_code = proc.returncode

        # Check if findings or artifacts were produced in knowledge.db
        kb_path = workspace / "knowledge.db"
        findings_in_kb = 0
        if kb_path.exists():
            try:
                import sqlite3
                con = sqlite3.connect(str(kb_path))
                findings_in_kb = con.execute("SELECT count(*) FROM findings").fetchone()[0]
                spend_row = con.execute("SELECT COALESCE(SUM(tokens), 0), COALESCE(SUM(llm_calls), 0) FROM campaign_spend").fetchone()
                if spend_row and spend_row[0] > 0:
                    current_total_tokens = int(spend_row[0])
                    current_prompt_tokens = int(current_total_tokens * 0.75)
                    current_completion_tokens = current_total_tokens - current_prompt_tokens
                    current_cost_usd = calculate_cost_usd(
                        model,
                        current_total_tokens,
                        current_prompt_tokens,
                        current_completion_tokens,
                    )
                    _update_scan(
                        scan_id,
                        total_tokens=current_total_tokens,
                        prompt_tokens=current_prompt_tokens,
                        completion_tokens=current_completion_tokens,
                        cost_spent_usd=current_cost_usd,
                    )
                con.close()
            except Exception:
                pass

        if exit_code not in (0, 2):
            tail_err = "\n".join(recent_output_lines[-15:]) if recent_output_lines else f"Exit code {exit_code}"
            # Mantis returns exit code 1 when one or more campaigns had non-fatal stage warnings (e.g. static sandbox).
            # If findings or deliverables were generated, this is a successful audit with partial warnings, NOT a fatal crash.
            if exit_code == 1 and (findings_in_kb > 0 or (workspace / "transcript.jsonl").exists()):
                logger.warning("mantis_completed_with_warnings", scan_id=scan_id, exit_code=exit_code, findings=findings_in_kb)
                emit(current_phase, "orchestrator", "stage_warning", {
                    "message": f"Mantis completed audit with {findings_in_kb} verified findings (subtask notices logged).",
                    "decision_status": "PROGRESS",
                })
            else:
                raise RuntimeError(f"Mantis exited with code {exit_code}: {tail_err}")

        if exit_code == 2:
            emit("running", "orchestrator", "budget_paused", {
                "message": "Mantis reached configured budget limit and paused gracefully. Processing discovered findings.",
                "decision_status": "PROGRESS",
            })

        # 6. Ingest findings
        _update_scan(scan_id, current_phase="ingesting_findings")
        emit("ingesting", "orchestrator", "ingest", {"message": "Ingesting Mantis findings into database"})

        findings_count = _ingest_findings(scan_id, workspace)
        _ingest_transcript(scan_id, workspace)

        # 7. Ingest threat model and architecture summary from KB directory or knowledge.db artifacts
        threat_model_text = None
        arch_summary = None
        kb_dir = workspace / "workspace" / "kb"
        if (kb_dir / "THREAT_MODEL.md").exists():
            threat_model_text = (kb_dir / "THREAT_MODEL.md").read_text(encoding="utf-8", errors="replace")
        if (kb_dir / "architecture.md").exists():
            arch_summary = (kb_dir / "architecture.md").read_text(encoding="utf-8", errors="replace")

        hunting_plan_text = None
        review_packet_text = None
        kb_path = workspace / "knowledge.db"
        if kb_path.exists():
            try:
                import sqlite3
                con = sqlite3.connect(str(kb_path))
                for fpath, content in con.execute("SELECT filepath, content FROM campaign_artifacts").fetchall():
                    if not arch_summary and "architecture.md" in fpath and content:
                        arch_summary = content
                    elif not threat_model_text and ("threat" in fpath.lower()) and content:
                        threat_model_text = _format_threat_model_md(content)
                    elif not hunting_plan_text and ("plan.json" in fpath or "hunting_plan" in fpath) and content:
                        hunting_plan_text = content
                    elif not review_packet_text and ("review_packet" in fpath or "report.json" in fpath) and content:
                        review_packet_text = content

                spend_row = con.execute("SELECT COALESCE(SUM(tokens), 0), COALESCE(SUM(llm_calls), 0) FROM campaign_spend").fetchone()
                if spend_row and spend_row[0] > 0:
                    current_total_tokens = int(spend_row[0])
                    current_prompt_tokens = int(current_total_tokens * 0.75)
                    current_completion_tokens = current_total_tokens - current_prompt_tokens
                    current_cost_usd = calculate_cost_usd(
                        model,
                        current_total_tokens,
                        current_prompt_tokens,
                        current_completion_tokens,
                    )
                con.close()
            except Exception:
                pass

        if threat_model_text:
            threat_model_text = _format_threat_model_md(threat_model_text)

        update_fields: dict = {
            "status": "completed",
            "current_phase": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "total_tokens": current_total_tokens,
            "prompt_tokens": current_prompt_tokens,
            "completion_tokens": current_completion_tokens,
            "cost_spent_usd": current_cost_usd,
        }
        if threat_model_text:
            update_fields["threat_model"] = threat_model_text
        if arch_summary:
            update_fields["architecture_summary"] = arch_summary
        if hunting_plan_text:
            update_fields["hunting_plan"] = hunting_plan_text
        if review_packet_text:
            update_fields["review_packet"] = review_packet_text
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
