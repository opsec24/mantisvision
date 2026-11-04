"""LLM budget tracker – wraps litellm.completion with cost tracking and
per-scan budget enforcement."""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from typing import Any, Optional

import structlog
from sqlalchemy import text, create_engine

logger = structlog.get_logger(__name__)


class BudgetExceededError(Exception):
    """Raised when a scan's cumulative LLM spend exceeds its budget limit."""

    def __init__(self, scan_id: str, spent: float, limit: float) -> None:
        self.scan_id = scan_id
        self.spent = spent
        self.limit = limit
        super().__init__(
            f"Budget exceeded for scan {scan_id}: "
            f"${spent:.4f} spent of ${limit:.4f} limit"
        )


def get_provider_concurrency(provider: str, model_name: str = "", is_local: bool = False) -> dict[str, int]:
    """Dynamically resolve optimal worker concurrency and rate-limit semaphore
    based on the active LLM provider and model tier.
    
    Returns
    -------
    dict with keys:
      - wave1_workers: concurrency for lightweight rapid triage (target: 100% repo sweep)
      - wave2_workers: concurrency for deep hotspot vulnerability audits
      - max_inflight: global concurrent request semaphore
    """
    p = (provider or "").lower().strip()
    m = (model_name or "").lower().strip()

    # Check if local Ollama or custom local server
    if is_local or p == "local" or ("localhost" in m or "127.0.0.1" in m):
        return {
            "wave1_workers": 4,
            "wave2_workers": 2,
            "max_inflight": 4,
        }

    if p in ("openai",) or m.startswith("openai/") or m.startswith("gpt-"):
        return {
            "wave1_workers": 14,
            "wave2_workers": 6,
            "max_inflight": 16,
        }
    elif p in ("anthropic",) or m.startswith("anthropic/") or "claude" in m:
        return {
            "wave1_workers": 10,
            "wave2_workers": 5,
            "max_inflight": 12,
        }
    elif p in ("google", "gemini") or m.startswith("gemini/") or m.startswith("google/"):
        return {
            "wave1_workers": 14,
            "wave2_workers": 6,
            "max_inflight": 16,
        }
    elif p == "ollama" or m.startswith("ollama/") or m.startswith("ollama_chat/"):
        # Ollama cloud (api.ollama.com or ollama.com endpoints)
        return {
            "wave1_workers": 10,
            "wave2_workers": 5,
            "max_inflight": 12,
        }
    else:
        # Default fallback for custom / litellm proxies
        return {
            "wave1_workers": 8,
            "wave2_workers": 4,
            "max_inflight": 10,
        }


class LLMBudgetTracker:
    """Track LLM costs per scan and enforce budget limits.

    Uses a *synchronous* SQLAlchemy engine because the tracker is called from
    Celery workers (which are synchronous).
    """

    def __init__(
        self,
        scan_id: str,
        max_budget_usd: Optional[float],
        db_url: str,
    ) -> None:
        self.scan_id = scan_id
        self.max_budget_usd = max_budget_usd
        # Convert asyncpg URL to psycopg2 for sync usage inside Celery
        sync_url = db_url.replace("+asyncpg", "").replace("postgresql://", "postgresql+psycopg2://") if "+asyncpg" in db_url else db_url
        if "postgresql://" in sync_url and "+psycopg2" not in sync_url:
            sync_url = sync_url.replace("postgresql://", "postgresql+psycopg2://")
        # Fallback: just use the URL directly if it's already fine
        self._engine = create_engine(sync_url, pool_size=10, max_overflow=15)
        self._total_spent: float = 0.0
        self._total_tokens: int = 0
        self._prompt_tokens: int = 0
        self._completion_tokens: int = 0
        self._lock = threading.Lock()
        self._abort_event = threading.Event()
        self.last_observation_id: Optional[str] = None

        # Initialise from existing spend in the DB
        self._step_counter: int = 0
        self._load_current_spend()

    @property
    def is_aborted(self) -> bool:
        """True if budget ceiling was breached or abort was signaled."""
        return self._abort_event.is_set()

    @property
    def total_tokens(self) -> int:
        return self._total_tokens

    @property
    def prompt_tokens(self) -> int:
        return self._prompt_tokens

    @property
    def completion_tokens(self) -> int:
        return self._completion_tokens

    def check_budget(self) -> None:
        """Raise BudgetExceededError immediately if budget ceiling was reached."""
        if self._abort_event.is_set() or (self.max_budget_usd is not None and self._total_spent >= self.max_budget_usd):
            self._abort_event.set()
            raise BudgetExceededError(self.scan_id, self._total_spent, self.max_budget_usd or 0.0)

    def _load_current_spend(self) -> None:
        """Load the current spend and token metrics from the scans table."""
        with self._engine.connect() as conn:
            row = conn.execute(
                text("SELECT cost_spent_usd, name, total_tokens, prompt_tokens, completion_tokens FROM scans WHERE id = :scan_id"),
                {"scan_id": self.scan_id},
            ).fetchone()
            if row:
                self._total_spent = float(row[0] or 0.0)
                self.scan_name = str(row[1] or "")
                self._total_tokens = int(row[2] or 0)
                self._prompt_tokens = int(row[3] or 0)
                self._completion_tokens = int(row[4] or 0)
            try:
                max_step = conn.execute(
                    text("SELECT COALESCE(MAX(step_number), 0) FROM agent_inference_traces WHERE scan_id = :scan_id"),
                    {"scan_id": self.scan_id},
                ).scalar()
                self._step_counter = int(max_step or 0)
            except Exception:
                self._step_counter = 0

    def _get_provider_credentials(self, model: str) -> tuple[Optional[str], Optional[str]]:
        """Resolve api_key and api_base from provider_configs or environment."""
        import os
        from app.core.security import decrypt_value

        provider = "openai"
        if model.startswith("ollama/") or model.startswith("ollama_chat/"):
            provider = "ollama"
        elif model.startswith("gemini/") or model.startswith("google/"):
            provider = "google"
        elif model.startswith("anthropic/") or "claude" in model:
            provider = "anthropic"
        elif model.startswith("openai/") or model.startswith("gpt-") or model.startswith("o1") or model.startswith("o3"):
            provider = "openai"

        api_key: Optional[str] = None
        api_base: Optional[str] = None

        try:
            with self._engine.connect() as conn:
                row = conn.execute(
                    text("SELECT api_key_encrypted, api_base_url, is_active FROM provider_configs WHERE provider = :provider"),
                    {"provider": provider},
                ).fetchone()
                if row and row[2]:  # is_active
                    encrypted_key, base_url, _ = row
                    if encrypted_key:
                        try:
                            api_key = decrypt_value(encrypted_key)
                        except Exception as e:
                            logger.error("failed_decrypting_provider_key", provider=provider, error=str(e))
                    if base_url:
                        api_base = base_url
        except Exception as e:
            logger.error("failed_fetching_provider_config", provider=provider, error=str(e))

        # Fallback to environment variables
        if not api_base and provider == "ollama":
            api_base = os.getenv("OLLAMA_API_BASE")
        if not api_key:
            if provider == "openai":
                api_key = os.getenv("OPENAI_API_KEY")
            elif provider == "anthropic":
                api_key = os.getenv("ANTHROPIC_API_KEY")
            elif provider == "google":
                api_key = os.getenv("GEMINI_API_KEY")
            elif provider == "ollama":
                api_key = os.getenv("OLLAMA_API_KEY")

        if provider == "ollama" and api_base:
            from app.api.settings import _normalize_ollama_base
            api_base = _normalize_ollama_base(api_base)

        return api_key, api_base

    def _calculate_call_cost(
        self,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        response: Any = None,
    ) -> tuple[float, float, float]:
        """Calculate (input_cost_usd, output_cost_usd, total_cost_usd) for an LLM call.

        Tries:
        1. litellm.completion_cost() helper
        2. Query whitelisted_models in database for cost_per_m_in / cost_per_m_out
        3. Match in litellm.model_cost dictionary using bare model names
        """
        import litellm

        # 1. First attempt: litellm helper if response object is available
        if response is not None:
            try:
                cost = litellm.completion_cost(completion_response=response)
                if cost and float(cost) > 0.0:
                    cost_val = float(cost)
                    tot_tok = (prompt_tokens + completion_tokens) or 1
                    in_cost = cost_val * (prompt_tokens / tot_tok)
                    out_cost = cost_val * (completion_tokens / tot_tok)
                    return round(in_cost, 6), round(out_cost, 6), round(cost_val, 6)
            except Exception:
                pass

        # 2. Second attempt: Check whitelisted_models in DB
        try:
            with self._engine.connect() as conn:
                row = conn.execute(
                    text("SELECT cost_per_m_in, cost_per_m_out FROM whitelisted_models WHERE id = :m"),
                    {"m": model},
                ).fetchone()

                if not row and "/" in model:
                    bare_name = model.split("/", 1)[1]
                    row = conn.execute(
                        text("SELECT cost_per_m_in, cost_per_m_out FROM whitelisted_models WHERE id LIKE :pat OR id = :bare"),
                        {"pat": f"%{bare_name}%", "bare": bare_name},
                    ).fetchone()

                if row and (row[0] is not None or row[1] is not None):
                    cost_in_per_m = float(row[0] or 0.0)
                    cost_out_per_m = float(row[1] or 0.0)
                    in_cost = prompt_tokens * (cost_in_per_m / 1_000_000.0)
                    out_cost = completion_tokens * (cost_out_per_m / 1_000_000.0)
                    total_cost = in_cost + out_cost
                    if total_cost > 0.0:
                        return round(in_cost, 6), round(out_cost, 6), round(total_cost, 6)
        except Exception as e:
            logger.warning("whitelisted_models_cost_query_failed", model=model, error=str(e))

        # 3. Third attempt: Match in litellm.model_cost dictionary
        try:
            bare_model = model.split("/")[-1].lower()
            candidates = [model, bare_model]
            if "deepseek" in bare_model:
                candidates.extend(["deepseek-chat", "deepseek-coder", "deepseek-v3"])
            elif "claude" in bare_model:
                candidates.extend(["claude-3-5-sonnet-20241022", "claude-3-5-sonnet", "claude-3-haiku"])
            elif "gpt-4" in bare_model:
                candidates.extend(["gpt-4o", "gpt-4o-mini"])
            elif "gemini" in bare_model:
                candidates.extend(["gemini-1.5-flash", "gemini-1.5-pro"])

            for c in candidates:
                if c in litellm.model_cost:
                    pricing = litellm.model_cost[c]
                    in_per_tok = pricing.get("input_cost_per_token") or 0.0
                    out_per_tok = pricing.get("output_cost_per_token") or 0.0
                    in_cost = prompt_tokens * in_per_tok
                    out_cost = completion_tokens * out_per_tok
                    total_cost = in_cost + out_cost
                    if total_cost > 0.0:
                        return round(in_cost, 6), round(out_cost, 6), round(total_cost, 6)
        except Exception:
            pass

        return 0.0, 0.0, 0.0

    def call(
        self,
        model: str,
        messages: list[dict[str, str]],
        phase: str,
        skill_name: Optional[str] = None,
        **kwargs: Any,
    ) -> str:
        """Call ``litellm.completion``, record the trace, update the scan cost,
        and enforce the budget limit.

        Parameters
        ----------
        model:
            The model identifier (e.g. ``"gpt-4"``).
        messages:
            Chat messages in OpenAI format.
        phase:
            The pipeline phase name for tracing.
        skill_name:
            Optional Mantis skill name (e.g. ``"mantis-researcher"``).
        **kwargs:
            Additional keyword arguments forwarded to ``litellm.completion``.

        Returns
        -------
        str
            The assistant's response text.

        Raises
        ------
        BudgetExceededError
            If the cumulative cost exceeds the scan's budget limit.
        """
        import os
        import litellm

        # Pre-flight budget check
        self.check_budget()

        start_ms = time.monotonic_ns() // 1_000_000
        error_message: Optional[str] = None
        prompt_tokens = 0
        completion_tokens = 0
        total_tokens = 0
        cost_usd = 0.0
        in_cost_usd = 0.0
        out_cost_usd = 0.0
        response_text = ""
        thinking_content: Optional[str] = None

        try:
            api_key, api_base = self._get_provider_credentials(model)
            call_kwargs = dict(kwargs)
            if api_key and "api_key" not in call_kwargs:
                call_kwargs["api_key"] = api_key
            if api_base and "api_base" not in call_kwargs:
                call_kwargs["api_base"] = api_base

            # Anti-token hang protection: default strict 90s socket timeout
            if "timeout" not in call_kwargs and "request_timeout" not in call_kwargs:
                call_kwargs["timeout"] = 90

            # Metadata for Langfuse tracing
            display_skill = skill_name or phase
            trace_metadata = {
                "trace_user_id": "admin@company.internal",
                "session_id": str(self.scan_id),
                "tags": [f"scan:{self.scan_id}", f"phase:{phase}", f"skill:{display_skill}"],
                "generation_name": f"{display_skill} [{phase.upper()}]",
            }
            if "metadata" not in call_kwargs:
                call_kwargs["metadata"] = trace_metadata
            elif isinstance(call_kwargs["metadata"], dict):
                call_kwargs["metadata"].update(trace_metadata)

            # Resilient completion call with automatic retry on transient connection drops
            max_retries = 2
            response = None
            for attempt in range(max_retries + 1):
                try:
                    response = litellm.completion(model=model, messages=messages, **call_kwargs)
                    break
                except Exception as call_err:
                    err_str = str(call_err).lower()
                    exc_type = type(call_err).__name__.lower()
                    # Fail fast on non-transient billing/auth errors to prevent token & time burn
                    if any(k in err_str for k in ("401", "402", "unauthorized", "insufficient_quota", "payment_required", "credit balance")):
                        logger.error("llm_call_auth_billing_error_fail_fast", error=str(call_err))
                        raise
                    is_transient = any(k in err_str or k in exc_type for k in (
                        "connection", "disconnected", "timeout", "rate_limit", "502", "503", "504", "reset"
                    ))
                    if attempt < max_retries and is_transient:
                        logger.warning(
                            "llm_call_transient_retry",
                            attempt=attempt + 1,
                            model=model,
                            phase=phase,
                            error=str(call_err),
                        )
                        time.sleep(2 * (attempt + 1))
                        continue
                    raise

            # Extract usage
            usage = getattr(response, "usage", None)
            if usage:
                prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
                completion_tokens = getattr(usage, "completion_tokens", 0) or 0
                total_tokens = getattr(usage, "total_tokens", 0) or 0

            # Compute cost via litellm helper with database & model dictionary fallback
            in_cost_usd, out_cost_usd, cost_usd = self._calculate_call_cost(
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                response=response if "response" in locals() else None,
            )

            # Extract response text and thinking/reasoning content
            choices = getattr(response, "choices", [])
            if choices:
                message = getattr(choices[0], "message", None)
                if message:
                    # 1. Native reasoning_content attribute (OpenAI o1/o3, LiteLLM deepseek-r1)
                    thinking_content = getattr(message, "reasoning_content", None) or getattr(message, "reasoning", None)
                    raw_content = getattr(message, "content", "") or ""
                    # 2. Extract <think>...</think> from raw content (Ollama, DeepSeek-R1, Qwen)
                    if not thinking_content and "<think>" in raw_content:
                        import re
                        m = re.search(r"<think>(.*?)</think>", raw_content, flags=re.DOTALL)
                        if m:
                            thinking_content = m.group(1).strip()
                            response_text = re.sub(r"<think>.*?</think>", "", raw_content, flags=re.DOTALL).strip()
                        else:
                            response_text = raw_content
                    else:
                        response_text = raw_content

        except Exception as exc:
            error_message = str(exc)
            logger.error(
                "llm_call_failed",
                model=model,
                phase=phase,
                scan_id=self.scan_id,
                error=error_message,
            )
            raise

        finally:
            latency_ms = (time.monotonic_ns() // 1_000_000) - start_ms
            with self._lock:
                self._total_spent += cost_usd
                self._total_tokens += total_tokens
                self._prompt_tokens += prompt_tokens
                self._completion_tokens += completion_tokens
                if self.max_budget_usd is not None and self._total_spent >= self.max_budget_usd:
                    self._abort_event.set()

            # If response_text is empty but there are tool_calls, record them for the trace
            recorded_text = response_text
            if not recorded_text and "response" in locals():
                try:
                    c = getattr(response, "choices", [])
                    if c:
                        msg = getattr(c[0], "message", None)
                        if msg and getattr(msg, "tool_calls", None):
                            recorded_text = json.dumps([
                                {"name": tc.function.name, "arguments": tc.function.arguments}
                                for tc in msg.tool_calls
                            ])
                except Exception:
                    pass

            # Persist the trace and updated cost
            self._record_trace(
                phase=phase,
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                latency_ms=latency_ms,
                cost_usd=cost_usd,
                in_cost_usd=in_cost_usd,
                out_cost_usd=out_cost_usd,
                error_message=error_message,
                messages=messages,
                response_text=recorded_text,
                skill_name=skill_name,
                thinking_content=thinking_content,
            )
            self._update_scan_cost()

        # Post-call budget check
        self.check_budget()

        logger.info(
            "llm_call_complete",
            model=model,
            phase=phase,
            skill=skill_name or phase,
            tokens=total_tokens,
            cost=f"${cost_usd:.6f}",
            total_spent=f"${self._total_spent:.6f}",
        )
        if kwargs.get("return_raw") and "response" in locals():
            return response
        return response_text

    def _record_trace(
        self,
        phase: str,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        latency_ms: int,
        cost_usd: float,
        error_message: Optional[str],
        in_cost_usd: float = 0.0,
        out_cost_usd: float = 0.0,
        messages: Optional[list[dict[str, Any]]] = None,
        response_text: Optional[str] = None,
        skill_name: Optional[str] = None,
        thinking_content: Optional[str] = None,
    ) -> None:
        """Insert trace rows into llm_traces and agent_inference_traces."""
        trace_id = str(uuid.uuid4())
        try:
            with self._engine.begin() as conn:
                conn.execute(
                    text(
                        """
                        INSERT INTO llm_traces
                            (id, scan_id, phase, model, prompt_tokens,
                             completion_tokens, total_tokens, latency_ms,
                             cost_usd, error_message)
                        VALUES
                            (:id, :scan_id, :phase, :model, :prompt_tokens,
                             :completion_tokens, :total_tokens, :latency_ms,
                             :cost_usd, :error_message)
                        """
                    ),
                    {
                        "id": trace_id,
                        "scan_id": self.scan_id,
                        "phase": phase,
                        "model": model,
                        "prompt_tokens": prompt_tokens,
                        "completion_tokens": completion_tokens,
                        "total_tokens": total_tokens,
                        "latency_ms": latency_ms,
                        "cost_usd": cost_usd,
                        "error_message": error_message,
                    },
                )
        except Exception as exc:
            logger.error("trace_write_failed", error=str(exc))

        # Record into Native Agent Inference Traces table
        self.record_inference_trace(
            phase=phase,
            agent_name=skill_name or f"mantis-{phase}",
            model=model,
            thinking_content=thinking_content,
            prompt_raw=messages,
            response_raw=response_text,
            decision_status="PROGRESS",
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            latency_ms=latency_ms,
            cost_usd=cost_usd,
        )

    def record_inference_trace(
        self,
        phase: str,
        agent_name: str,
        step_number: Optional[int] = None,
        model: Optional[str] = None,
        thinking_content: Optional[str] = None,
        prompt_raw: Optional[Any] = None,
        response_raw: Optional[str] = None,
        tool_name: Optional[str] = None,
        tool_input: Optional[dict[str, Any]] = None,
        tool_output: Optional[Any] = None,
        candidate_vuln_title: Optional[str] = None,
        decision_status: str = "PROGRESS",
        decision_reason: Optional[str] = None,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        total_tokens: int = 0,
        latency_ms: int = 0,
        cost_usd: float = 0.0,
    ) -> str:
        """Insert a step into agent_inference_traces and publish over Redis for real-time streaming."""
        import json
        import os
        from datetime import datetime, timezone
        from redis import Redis

        with self._lock:
            if step_number is None:
                self._step_counter += 1
                current_step = self._step_counter
            else:
                current_step = step_number
                if step_number > self._step_counter:
                    self._step_counter = step_number

        trace_id = str(uuid.uuid4())
        self.last_observation_id = trace_id
        now = datetime.now(timezone.utc)

        # Format prompt_raw if needed
        serialized_prompt = None
        if prompt_raw is not None:
            if isinstance(prompt_raw, (dict, list)):
                try:
                    serialized_prompt = json.dumps(prompt_raw, indent=2)
                except Exception:
                    serialized_prompt = str(prompt_raw)
            else:
                serialized_prompt = str(prompt_raw)

        # Format tool_output if needed
        serialized_tool_output = None
        if tool_output is not None:
            if isinstance(tool_output, (dict, list)):
                try:
                    serialized_tool_output = json.dumps(tool_output, indent=2)
                except Exception:
                    serialized_tool_output = str(tool_output)
            else:
                serialized_tool_output = str(tool_output)

        try:
            with self._engine.begin() as conn:
                conn.execute(
                    text(
                        """
                        INSERT INTO agent_inference_traces
                            (id, scan_id, step_number, phase, agent_name, model,
                             thinking_content, prompt_raw, response_raw,
                             tool_name, tool_input, tool_output,
                             candidate_vuln_title, decision_status, decision_reason,
                             prompt_tokens, completion_tokens, total_tokens,
                             latency_ms, cost_usd, created_at)
                        VALUES
                            (:id, :scan_id, :step_number, :phase, :agent_name, :model,
                             :thinking_content, :prompt_raw, :response_raw,
                             :tool_name, :tool_input, :tool_output,
                             :candidate_vuln_title, :decision_status, :decision_reason,
                             :prompt_tokens, :completion_tokens, :total_tokens,
                             :latency_ms, :cost_usd, :created_at)
                        """
                    ),
                    {
                        "id": trace_id,
                        "scan_id": self.scan_id,
                        "step_number": current_step,
                        "phase": phase,
                        "agent_name": agent_name,
                        "model": model,
                        "thinking_content": thinking_content,
                        "prompt_raw": serialized_prompt,
                        "response_raw": response_raw,
                        "tool_name": tool_name,
                        "tool_input": json.dumps(tool_input) if tool_input is not None else None,
                        "tool_output": serialized_tool_output,
                        "candidate_vuln_title": candidate_vuln_title,
                        "decision_status": decision_status,
                        "decision_reason": decision_reason,
                        "prompt_tokens": prompt_tokens,
                        "completion_tokens": completion_tokens,
                        "total_tokens": total_tokens,
                        "latency_ms": latency_ms,
                        "cost_usd": cost_usd,
                        "created_at": now,
                    },
                )
        except Exception as exc:
            logger.error("agent_trace_insert_failed", scan_id=self.scan_id, error=str(exc))

        # Publish to Redis Pub/Sub progress channel for real-time frontend streaming
        try:
            redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
            r = Redis.from_url(redis_url)
            channel = f"scan:{self.scan_id}:progress"
            history_key = f"scan:{self.scan_id}:history"

            event_payload = {
                "type": "trace_step",
                "id": trace_id,
                "step_number": current_step,
                "phase": phase,
                "agent_name": agent_name,
                "model": model,
                "thinking_content": thinking_content[:1500] if thinking_content else None,
                "has_thinking": bool(thinking_content),
                "tool_name": tool_name,
                "tool_input": tool_input,
                "tool_output_preview": serialized_tool_output[:500] if serialized_tool_output else None,
                "candidate_vuln_title": candidate_vuln_title,
                "decision_status": decision_status,
                "decision_reason": decision_reason[:500] if decision_reason else None,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
                "latency_ms": latency_ms,
                "cost_usd": cost_usd,
                "timestamp": now.isoformat(),
            }
            raw_event = json.dumps(event_payload)
            r.publish(channel, raw_event)
            r.rpush(history_key, raw_event)
            r.expire(history_key, 604800)
        except Exception as ex:
            logger.debug("redis_trace_publish_failed", error=str(ex))

        return trace_id

    def _update_scan_cost(self) -> None:
        """Update the ``cost_spent_usd`` and token counter columns on the scan row."""
        try:
            with self._engine.begin() as conn:
                row = conn.execute(
                    text(
                        """
                        UPDATE scans 
                        SET cost_spent_usd = (
                            SELECT COALESCE(SUM(cost_usd), :fallback_cost) 
                            FROM llm_traces 
                            WHERE scan_id = :scan_id
                        ),
                        prompt_tokens = (
                            SELECT COALESCE(SUM(prompt_tokens), :fallback_prompt)
                            FROM llm_traces
                            WHERE scan_id = :scan_id
                        ),
                        completion_tokens = (
                            SELECT COALESCE(SUM(completion_tokens), :fallback_completion)
                            FROM llm_traces
                            WHERE scan_id = :scan_id
                        ),
                        total_tokens = (
                            SELECT COALESCE(SUM(total_tokens), :fallback_total)
                            FROM llm_traces
                            WHERE scan_id = :scan_id
                        )
                        WHERE id = :scan_id
                        RETURNING cost_spent_usd, total_tokens, prompt_tokens, completion_tokens
                        """
                    ),
                    {
                        "fallback_cost": self._total_spent,
                        "fallback_prompt": self._prompt_tokens,
                        "fallback_completion": self._completion_tokens,
                        "fallback_total": self._total_tokens,
                        "scan_id": self.scan_id,
                    },
                ).fetchone()
                if row and row[0] is not None:
                    self._total_spent = float(row[0])
                    self._total_tokens = int(row[1] or 0)
                    self._prompt_tokens = int(row[2] or 0)
                    self._completion_tokens = int(row[3] or 0)
        except Exception as exc:
            logger.error("scan_cost_update_failed", error=str(exc))

    @property
    def total_spent(self) -> float:
        """Return the cumulative spend for this scan."""
        return self._total_spent

    def dispose(self) -> None:
        """Dispose the internal engine when the tracker is no longer needed."""
        self._engine.dispose()
