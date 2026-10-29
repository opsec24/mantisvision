"""LLM budget tracker – wraps litellm.completion with cost tracking and
per-scan budget enforcement."""

from __future__ import annotations

import json
import os
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
        self._engine = create_engine(sync_url, pool_size=2, max_overflow=2)
        self._total_spent: float = 0.0

        # Initialise from existing spend in the DB
        self._load_current_spend()

    def _load_current_spend(self) -> None:
        """Load the current spend from the scans table."""
        with self._engine.connect() as conn:
            row = conn.execute(
                text("SELECT cost_spent_usd FROM scans WHERE id = :scan_id"),
                {"scan_id": self.scan_id},
            ).fetchone()
            if row:
                self._total_spent = float(row[0] or 0.0)

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
        if self.max_budget_usd is not None and self._total_spent >= self.max_budget_usd:
            raise BudgetExceededError(self.scan_id, self._total_spent, self.max_budget_usd)

        start_ms = time.monotonic_ns() // 1_000_000
        error_message: Optional[str] = None
        prompt_tokens = 0
        completion_tokens = 0
        total_tokens = 0
        cost_usd = 0.0
        response_text = ""

        try:
            api_key, api_base = self._get_provider_credentials(model)
            call_kwargs = dict(kwargs)
            if api_key and "api_key" not in call_kwargs:
                call_kwargs["api_key"] = api_key
            if api_base and "api_base" not in call_kwargs:
                call_kwargs["api_base"] = api_base

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

            response = litellm.completion(model=model, messages=messages, **call_kwargs)

            # Extract usage
            usage = getattr(response, "usage", None)
            if usage:
                prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
                completion_tokens = getattr(usage, "completion_tokens", 0) or 0
                total_tokens = getattr(usage, "total_tokens", 0) or 0

            # Compute cost via litellm helper
            try:
                cost_usd = litellm.completion_cost(completion_response=response) or 0.0
            except Exception:
                # Fallback: estimate from token counts
                cost_usd = 0.0

            # Extract response text
            choices = getattr(response, "choices", [])
            if choices:
                message = getattr(choices[0], "message", None)
                if message:
                    response_text = getattr(message, "content", "") or ""

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
            self._total_spent += cost_usd

            # Persist the trace and updated cost
            self._record_trace(
                phase=phase,
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                latency_ms=latency_ms,
                cost_usd=cost_usd,
                error_message=error_message,
                messages=messages,
                response_text=response_text,
                skill_name=skill_name,
            )
            self._update_scan_cost()

        # Post-call budget check
        if self.max_budget_usd is not None and self._total_spent > self.max_budget_usd:
            raise BudgetExceededError(self.scan_id, self._total_spent, self.max_budget_usd)

        logger.info(
            "llm_call_complete",
            model=model,
            phase=phase,
            skill=skill_name or phase,
            tokens=total_tokens,
            cost=f"${cost_usd:.6f}",
            total_spent=f"${self._total_spent:.6f}",
        )
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
        messages: Optional[list[dict[str, Any]]] = None,
        response_text: Optional[str] = None,
        skill_name: Optional[str] = None,
    ) -> None:
        """Insert a row into ``llm_traces`` and export trace to Langfuse."""
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
                        "id": str(uuid.uuid4()),
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

        self._send_to_langfuse(
            phase=phase,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            latency_ms=latency_ms,
            cost_usd=cost_usd,
            error_message=error_message,
            messages=messages,
            response_text=response_text,
            skill_name=skill_name,
        )

    def _send_to_langfuse(
        self,
        phase: str,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        latency_ms: int,
        cost_usd: float,
        error_message: Optional[str],
        messages: Optional[list[dict[str, Any]]],
        response_text: Optional[str],
        skill_name: Optional[str] = None,
    ) -> None:
        """Forward LLM generation trace to Langfuse v2 REST Ingestion API.
        
        Uses the scan ID as the root trace ID so that all pipeline phases
        and Mantis skills are grouped into a single unified trace tree.
        """
        import base64
        import os
        import urllib.request
        from datetime import datetime, timezone

        host = os.getenv("LANGFUSE_HOST", "http://langfuse:3000")
        pk = os.getenv("LANGFUSE_PUBLIC_KEY")
        sk = os.getenv("LANGFUSE_SECRET_KEY")
        if not pk or not sk:
            return

        try:
            auth = base64.b64encode(f"{pk}:{sk}".encode()).decode()
            now = datetime.now(timezone.utc).isoformat()
            trace_id = str(self.scan_id)
            gen_id = str(uuid.uuid4())
            display_name = f"{skill_name} [{phase.upper()}]" if skill_name else f"{phase}:{model}"

            batch = [
                {
                    "id": str(uuid.uuid4()),
                    "type": "trace-create",
                    "timestamp": now,
                    "body": {
                        "id": trace_id,
                        "name": f"Mantis Audit ({str(self.scan_id)[:8]})",
                        "userId": "admin@company.internal",
                        "sessionId": str(self.scan_id),
                        "tags": [f"scan:{self.scan_id}", f"phase:{phase}", f"skill:{skill_name or phase}"],
                        "metadata": {
                            "scan_id": str(self.scan_id),
                            "latest_phase": phase,
                        },
                    },
                },
                {
                    "id": str(uuid.uuid4()),
                    "type": "generation-create",
                    "timestamp": now,
                    "body": {
                        "id": gen_id,
                        "traceId": trace_id,
                        "name": display_name,
                        "model": model,
                        "input": messages or [],
                        "output": response_text or "",
                        "usage": {
                            "promptTokens": prompt_tokens,
                            "completionTokens": completion_tokens,
                            "totalTokens": total_tokens,
                        },
                        "metadata": {
                            "skill": skill_name or phase,
                            "phase": phase,
                            "latency_ms": latency_ms,
                            "cost_usd": cost_usd,
                        },
                        "level": "ERROR" if error_message else "DEFAULT",
                        "statusMessage": error_message,
                    },
                },
            ]

            payload_bytes = json.dumps({"batch": batch}).encode("utf-8")
            req = urllib.request.Request(
                f"{host}/api/public/ingestion",
                data=payload_bytes,
                headers={
                    "Authorization": f"Basic {auth}",
                    "Content-Type": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=5):
                pass
        except Exception as e:
            logger.warning("langfuse_ingest_failed", error=str(e))

    def _update_scan_cost(self) -> None:
        """Update the ``cost_spent_usd`` column on the scan row."""
        try:
            with self._engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE scans SET cost_spent_usd = :cost WHERE id = :scan_id"
                    ),
                    {"cost": self._total_spent, "scan_id": self.scan_id},
                )
        except Exception as exc:
            logger.error("scan_cost_update_failed", error=str(exc))

    @property
    def total_spent(self) -> float:
        """Return the cumulative spend for this scan."""
        return self._total_spent

    def dispose(self) -> None:
        """Dispose the internal engine when the tracker is no longer needed."""
        self._engine.dispose()
