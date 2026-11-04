"""Provider and model settings API routes with dynamic model discovery and testing."""

from __future__ import annotations

import time
import uuid
from datetime import datetime
from typing import Any, Optional

import httpx
import litellm
import structlog
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi import Request as FastAPIRequest
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.core.audit import log_user_action
from app.core.database import get_db
from app.core.models import ProviderConfig, User, WhitelistedModel
from app.core.security import decrypt_value, encrypt_value

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/settings", tags=["settings"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class ProviderResponse(BaseModel):
    provider: str
    api_key_masked: Optional[str] = None
    api_base_url: Optional[str] = None
    is_active: bool
    updated_at: datetime


class ProviderUpdateRequest(BaseModel):
    api_key: Optional[str] = None
    api_base_url: Optional[str] = None
    is_active: Optional[bool] = None


class DiscoveredModelItem(BaseModel):
    id: str
    display_name: str
    context_window: Optional[int] = 128000
    cost_per_m_in: Optional[float] = 0.0
    cost_per_m_out: Optional[float] = 0.0


class DiscoverModelsRequest(BaseModel):
    api_key: Optional[str] = None
    api_base_url: Optional[str] = None


class DiscoverModelsResponse(BaseModel):
    provider: str
    connection_status: str
    message: str
    models: list[DiscoveredModelItem]


class WhitelistSelectedModelsRequest(BaseModel):
    api_key: Optional[str] = None
    api_base_url: Optional[str] = None
    models: list[DiscoveredModelItem]
    save_key: bool = True


class ModelTestResultItem(BaseModel):
    id: str
    display_name: str
    status: str  # "verified" or "failed"
    latency_ms: Optional[int] = None
    message: str


class WhitelistSelectedModelsResponse(BaseModel):
    provider: str
    success: bool
    verified_count: int
    results: list[ModelTestResultItem]


class ModelResponse(BaseModel):
    id: str
    provider: str
    display_name: str
    context_window: Optional[int] = None
    is_enabled: bool
    is_default_recon: bool
    is_default_reproduce: bool
    cost_per_m_in: Optional[float] = None
    cost_per_m_out: Optional[float] = None
    created_at: datetime


class ModelCreateRequest(BaseModel):
    id: str
    provider: str
    display_name: str
    context_window: Optional[int] = None
    is_enabled: bool = True
    is_default_recon: bool = False
    is_default_reproduce: bool = False
    cost_per_m_in: Optional[float] = None
    cost_per_m_out: Optional[float] = None


class ModelUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    is_enabled: Optional[bool] = None
    is_default_recon: Optional[bool] = None
    is_default_reproduce: Optional[bool] = None
    cost_per_m_in: Optional[float] = None
    cost_per_m_out: Optional[float] = None


# ── Pricing Resolver Helper ───────────────────────────────────────────────────


def _resolve_dynamic_pricing(model_id: str, provider: str) -> tuple[float, float, int]:
    """Dynamically looks up input/output token pricing per 1M tokens and context window
    from LiteLLM's internal registry. No hardcoded prices.
    """
    clean_id = model_id.split("/")[-1] if "/" in model_id else model_id
    candidates = [
        model_id,
        clean_id,
        f"{provider}/{clean_id}",
        f"{provider}/{model_id}",
    ]
    cost: Optional[dict[str, Any]] = None

    for c in candidates:
        if c in litellm.model_cost:
            cost = litellm.model_cost[c]
            break

    if not cost:
        for k, v in litellm.model_cost.items():
            if k == clean_id or clean_id in k:
                cost = v
                break

    if cost:
        in_cost = round((cost.get("input_cost_per_token") or 0.0) * 1_000_000, 4)
        out_cost = round((cost.get("output_cost_per_token") or 0.0) * 1_000_000, 4)
        ctx = cost.get("max_input_tokens") or cost.get("max_tokens") or 128000
        return in_cost, out_cost, ctx

    # Default fallback if unmapped
    return 0.0, 0.0, 128000


def _clean_display_name(model_id: str) -> str:
    name = model_id.split("/")[-1]
    name = name.replace(":latest", "")
    replacements = {
        "gpt-4o": "GPT-4o (Omni)",
        "gpt-4o-mini": "GPT-4o Mini",
        "o3-mini": "o3-mini Reasoning",
        "o1-preview": "o1 Preview",
        "o1-mini": "o1 Mini",
        "claude-3-5-sonnet-20241022": "Claude 3.5 Sonnet v2",
        "claude-3-5-haiku-20241022": "Claude 3.5 Haiku",
        "claude-3-opus-20240229": "Claude 3 Opus",
        "gemini-1.5-flash": "Gemini 1.5 Flash",
        "gemini-1.5-pro": "Gemini 1.5 Pro",
        "gemini-2.0-flash": "Gemini 2.0 Flash",
        "qwen2.5-coder": "Qwen 2.5 Coder",
        "deepseek-r1": "DeepSeek R1",
    }
    for k, v in replacements.items():
        if k in name.lower():
            return v

    parts = name.replace("_", "-").split("-")
    return " ".join([p.upper() if len(p) <= 3 else p.capitalize() for p in parts])


def _normalize_ollama_base(url: Optional[str]) -> str:
    """Normalizes Ollama base URLs by stripping redundant path suffixes
    like /api, /v1, /api/tags and mapping localhost to host.docker.internal when inside Docker.
    """
    if not url or not url.strip():
        return "https://ollama.com"
    clean = url.strip().rstrip("/")
    for suffix in ["/api/tags", "/v1/models", "/api/generate", "/api/chat", "/api", "/v1"]:
        if clean.endswith(suffix):
            clean = clean[:-len(suffix)].rstrip("/")
            break
    if "localhost:11434" in clean:
        clean = clean.replace("localhost:11434", "host.docker.internal:11434")
    elif "127.0.0.1:11434" in clean:
        clean = clean.replace("127.0.0.1:11434", "host.docker.internal:11434")
    return clean


# ── Provider Routes ───────────────────────────────────────────────────────────


@router.get("/providers", response_model=list[ProviderResponse])
async def list_providers(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ProviderResponse]:
    """List all provider configurations with masked API keys."""
    result = await db.execute(select(ProviderConfig).order_by(ProviderConfig.provider))
    providers = result.scalars().all()
    return [_provider_to_response(p) for p in providers]


@router.put("/providers/{provider}", response_model=ProviderResponse)
async def update_provider(
    provider: str,
    body: ProviderUpdateRequest,
    request: FastAPIRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProviderResponse:
    """Update a provider's API key, base URL, or active status."""
    result = await db.execute(
        select(ProviderConfig).where(ProviderConfig.provider == provider)
    )
    config = result.scalar_one_or_none()
    if config is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Provider '{provider}' not found",
        )

    if body.api_key is not None:
        config.api_key_encrypted = encrypt_value(body.api_key)
    if body.api_base_url is not None:
        config.api_base_url = _normalize_ollama_base(body.api_base_url) if provider == "ollama" else body.api_base_url
    if body.is_active is not None:
        config.is_active = body.is_active

    config.updated_by = current_user.id
    db.add(config)
    await db.flush()
    await db.refresh(config)

    log_user_action(
        background_tasks=background_tasks,
        request=request,
        user_id=current_user.id,
        user_email=current_user.email,
        action="provider.updated",
        resource_type="provider",
        resource_id=provider,
        metadata={"api_base_url": body.api_base_url, "is_active": body.is_active},
    )

    logger.info("provider_updated", provider=provider, user=current_user.email)
    return _provider_to_response(config)


# ── Dynamic Model Discovery & Verification Routes ─────────────────────────────


@router.post("/providers/{provider}/discover-models", response_model=DiscoverModelsResponse)
async def discover_provider_models(
    provider: str,
    body: DiscoverModelsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DiscoverModelsResponse:
    """Send live API query to provider to discover all accessible models and fetch dynamic pricing."""
    # Resolve API Key & Base URL
    api_key = body.api_key
    base_url = body.api_base_url

    if not api_key:
        result = await db.execute(
            select(ProviderConfig).where(ProviderConfig.provider == provider)
        )
        conf = result.scalar_one_or_none()
        if conf and conf.api_key_encrypted:
            try:
                api_key = decrypt_value(conf.api_key_encrypted)
            except Exception:
                pass
        if not base_url and conf:
            base_url = conf.api_base_url

    if not api_key and provider != "ollama":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Please provide an API key for {provider} to discover available models.",
        )

    discovered: list[DiscoveredModelItem] = []

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if provider == "openai":
                endpoint = (base_url or "https://api.openai.com/v1").rstrip("/") + "/models"
                headers = {"Authorization": f"Bearer {api_key}"}
                resp = await client.get(endpoint, headers=headers)
                if resp.status_code != 200:
                    err_msg = resp.text
                    try:
                        err_msg = resp.json().get("error", {}).get("message", resp.text)
                    except Exception:
                        pass
                    raise HTTPException(status_code=resp.status_code, detail=f"OpenAI API Error: {err_msg}")

                data = resp.json().get("data", [])
                for item in data:
                    mid = item.get("id", "")
                    # Filter out non-chat models
                    if any(bad in mid for bad in ["whisper", "tts", "dall-e", "embedding", "moderation", "babbage", "davinci"]):
                        continue
                    in_c, out_c, ctx = _resolve_dynamic_pricing(mid, "openai")
                    discovered.append(
                        DiscoveredModelItem(
                            id=mid,
                            display_name=_clean_display_name(mid),
                            context_window=ctx,
                            cost_per_m_in=in_c,
                            cost_per_m_out=out_c,
                        )
                    )

            elif provider == "google":
                endpoint = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
                resp = await client.get(endpoint)
                if resp.status_code != 200:
                    err_msg = resp.text
                    try:
                        err_msg = resp.json().get("error", {}).get("message", resp.text)
                    except Exception:
                        pass
                    raise HTTPException(status_code=resp.status_code, detail=f"Google Gemini API Error: {err_msg}")

                data = resp.json().get("models", [])
                for item in data:
                    methods = item.get("supportedGenerationMethods", [])
                    if "generateContent" not in methods:
                        continue
                    raw_name = item.get("name", "")
                    mid = raw_name.replace("models/", "")
                    disp = item.get("displayName") or _clean_display_name(mid)
                    ctx = item.get("inputTokenLimit") or 1048576
                    in_c, out_c, _ = _resolve_dynamic_pricing(mid, "gemini")
                    discovered.append(
                        DiscoveredModelItem(
                            id=f"gemini/{mid}",
                            display_name=disp,
                            context_window=ctx,
                            cost_per_m_in=in_c,
                            cost_per_m_out=out_c,
                        )
                    )

            elif provider == "anthropic":
                endpoint = "https://api.anthropic.com/v1/models"
                headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
                resp = await client.get(endpoint, headers=headers)
                models_to_process = []
                if resp.status_code == 200:
                    data = resp.json().get("data", [])
                    for item in data:
                        models_to_process.append((item.get("id"), item.get("display_name")))
                else:
                    # Fallback to standard Anthropic Claude models if models endpoint restricted
                    models_to_process = [
                        ("claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet"),
                        ("claude-3-5-haiku-20241022", "Claude 3.5 Haiku"),
                        ("claude-3-opus-20240229", "Claude 3 Opus"),
                    ]

                for mid, disp in models_to_process:
                    in_c, out_c, ctx = _resolve_dynamic_pricing(mid, "anthropic")
                    discovered.append(
                        DiscoveredModelItem(
                            id=f"anthropic/{mid}",
                            display_name=disp or _clean_display_name(mid),
                            context_window=ctx,
                            cost_per_m_in=in_c,
                            cost_per_m_out=out_c,
                        )
                    )

            elif provider == "ollama":
                raw_base = (base_url or "https://ollama.com").strip().rstrip("/")
                norm_base = _normalize_ollama_base(raw_base)
                headers = {}
                if api_key:
                    headers["Authorization"] = f"Bearer {api_key}"

                # Generate candidate probe URLs in priority order
                candidates: list[tuple[str, str]] = [
                    ("tags", f"{norm_base}/api/tags"),
                    ("v1", f"{norm_base}/v1/models"),
                ]
                if raw_base != norm_base:
                    if raw_base.endswith("/api"):
                        candidates.append(("tags", f"{raw_base}/tags"))
                    elif raw_base.endswith("/v1"):
                        candidates.append(("v1", f"{raw_base}/models"))
                    candidates.append(("tags", f"{raw_base}/api/tags"))
                    candidates.append(("v1", f"{raw_base}/v1/models"))

                if "host.docker.internal" in norm_base:
                    local_norm = norm_base.replace("host.docker.internal", "localhost")
                    candidates.append(("tags", f"{local_norm}/api/tags"))
                    candidates.append(("v1", f"{local_norm}/v1/models"))

                success = False
                probe_errors: list[str] = []

                for mode, url in candidates:
                    try:
                        resp = await client.get(url, headers=headers, timeout=8.0)
                        if resp.status_code == 200:
                            data = resp.json()
                            if mode == "tags":
                                models_data = data.get("models", [])
                                for item in models_data:
                                    raw_name = item.get("name", "")
                                    clean_name = raw_name.replace(":latest", "")
                                    in_c, out_c, ctx = _resolve_dynamic_pricing(clean_name, "ollama")
                                    discovered.append(
                                        DiscoveredModelItem(
                                            id=f"ollama/{clean_name}",
                                            display_name=_clean_display_name(clean_name),
                                            context_window=ctx,
                                            cost_per_m_in=in_c,
                                            cost_per_m_out=out_c,
                                        )
                                    )
                                success = True
                                break
                            elif mode == "v1":
                                models_data = data.get("data", [])
                                for item in models_data:
                                    mid = item.get("id", "")
                                    clean_name = mid.replace(":latest", "")
                                    in_c, out_c, ctx = _resolve_dynamic_pricing(clean_name, "ollama")
                                    discovered.append(
                                        DiscoveredModelItem(
                                            id=f"ollama/{clean_name}",
                                            display_name=_clean_display_name(clean_name),
                                            context_window=ctx,
                                            cost_per_m_in=in_c,
                                            cost_per_m_out=out_c,
                                        )
                                    )
                                success = True
                                break
                        else:
                            probe_errors.append(f"{url} (HTTP {resp.status_code})")
                    except Exception as err:
                        probe_errors.append(f"{url} ({str(err)})")

                if not success:
                    summary = "; ".join(probe_errors[:2])
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail=f"Could not connect to Ollama endpoint at '{raw_base}'. Probed: {summary}. Check URL and Bearer token if required.",
                    )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("discover_models_failed", provider=provider, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to connect to {provider}: {str(exc)}",
        )

    return DiscoverModelsResponse(
        provider=provider,
        connection_status="connected",
        message=f"Successfully discovered {len(discovered)} available models from {provider}.",
        models=discovered,
    )


@router.post("/providers/{provider}/test-and-whitelist", response_model=WhitelistSelectedModelsResponse)
async def test_and_whitelist_models(
    provider: str,
    body: WhitelistSelectedModelsRequest,
    request: FastAPIRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WhitelistSelectedModelsResponse:
    """Tests that the API key has live access to the selected models, and if successful,
    saves the credentials and adds the models to the whitelist with real dynamic pricing.
    """
    if not body.models:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No models selected.")

    # 1. Resolve credentials
    result = await db.execute(select(ProviderConfig).where(ProviderConfig.provider == provider))
    config = result.scalar_one_or_none()

    api_key = body.api_key
    base_url = body.api_base_url
    if not api_key and config and config.api_key_encrypted:
        try:
            api_key = decrypt_value(config.api_key_encrypted)
        except Exception:
            pass
    if not base_url and config:
        base_url = config.api_base_url

    test_results: list[ModelTestResultItem] = []
    verified_models: list[DiscoveredModelItem] = []

    # 2. Test each model with a live 1-token test prompt
    for model_item in body.models:
        model_id = model_item.id
        # Ensure litellm routing format
        target_model = model_id
        if provider == "google" and not target_model.startswith("gemini/"):
            target_model = f"gemini/{target_model}"
        elif provider == "anthropic" and not target_model.startswith("anthropic/"):
            target_model = f"anthropic/{target_model}"
        elif provider == "openai" and not target_model.startswith("openai/"):
            target_model = f"openai/{target_model}"
        elif provider == "ollama" and not target_model.startswith("ollama/"):
            target_model = f"ollama/{target_model}"

        call_kwargs: dict[str, Any] = {
            "model": target_model,
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 1,
            "timeout": 12,
        }
        if api_key:
            call_kwargs["api_key"] = api_key
        if base_url:
            call_kwargs["api_base"] = _normalize_ollama_base(base_url) if provider == "ollama" else base_url

        start_time = time.time()
        try:
            await litellm.acompletion(**call_kwargs)
            latency_ms = int((time.time() - start_time) * 1000)
            test_results.append(
                ModelTestResultItem(
                    id=model_id,
                    display_name=model_item.display_name,
                    status="verified",
                    latency_ms=latency_ms,
                    message=f"Live response verified ({latency_ms}ms)",
                )
            )
            verified_models.append(model_item)
        except Exception as exc:
            err_msg = str(exc)
            # Simplify litellm error message
            if "AuthenticationError" in err_msg or "invalid_api_key" in err_msg:
                err_msg = "Invalid API key or authentication rejected"
            elif "NotFoundError" in err_msg or "model_not_found" in err_msg:
                err_msg = "Model not accessible or not found on this account"
            elif "RateLimitError" in err_msg:
                err_msg = "Rate limit or quota reached on account"
            test_results.append(
                ModelTestResultItem(
                    id=model_id,
                    display_name=model_item.display_name,
                    status="failed",
                    latency_ms=None,
                    message=err_msg,
                )
            )

    # 3. If at least one model verified and save_key requested, persist provider credentials
    if verified_models and body.save_key and config:
        if body.api_key:
            config.api_key_encrypted = encrypt_value(body.api_key)
        if body.api_base_url is not None:
            config.api_base_url = _normalize_ollama_base(body.api_base_url) if provider == "ollama" else body.api_base_url
        config.is_active = True
        config.updated_by = current_user.id
        db.add(config)

    # 4. Upsert verified models into whitelisted_models table
    for vm in verified_models:
        existing_res = await db.execute(select(WhitelistedModel).where(WhitelistedModel.id == vm.id))
        existing_model = existing_res.scalar_one_or_none()
        if existing_model:
            existing_model.display_name = vm.display_name
            existing_model.is_enabled = True
            existing_model.cost_per_m_in = vm.cost_per_m_in
            existing_model.cost_per_m_out = vm.cost_per_m_out
            existing_model.context_window = vm.context_window
            db.add(existing_model)
        else:
            new_model = WhitelistedModel(
                id=vm.id,
                provider=provider,
                display_name=vm.display_name,
                context_window=vm.context_window,
                is_enabled=True,
                cost_per_m_in=vm.cost_per_m_in,
                cost_per_m_out=vm.cost_per_m_out,
            )
            db.add(new_model)

    await db.flush()

    log_user_action(
        background_tasks=background_tasks,
        request=request,
        user_id=current_user.id,
        user_email=current_user.email,
        action="models.whitelisted_batch",
        resource_type="provider",
        resource_id=provider,
        metadata={"verified": [m.id for m in verified_models]},
    )

    logger.info("models_whitelisted_batch", provider=provider, count=len(verified_models))

    return WhitelistSelectedModelsResponse(
        provider=provider,
        success=len(verified_models) > 0,
        verified_count=len(verified_models),
        results=test_results,
    )


# ── Model Management Routes ───────────────────────────────────────────────────


@router.get("/models", response_model=list[ModelResponse])
async def list_models(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ModelResponse]:
    """List all whitelisted models."""
    result = await db.execute(
        select(WhitelistedModel).order_by(WhitelistedModel.provider, WhitelistedModel.id)
    )
    models = result.scalars().all()
    return [_model_to_response(m) for m in models]


@router.post("/models", response_model=ModelResponse, status_code=status.HTTP_201_CREATED)
async def create_model(
    body: ModelCreateRequest,
    request: FastAPIRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ModelResponse:
    """Add a new model to the whitelist."""
    existing = await db.execute(
        select(WhitelistedModel).where(WhitelistedModel.id == body.id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Model '{body.id}' already exists",
        )

    # If pricing not supplied, resolve dynamically
    in_c, out_c, ctx = _resolve_dynamic_pricing(body.id, body.provider)
    cost_in = body.cost_per_m_in if body.cost_per_m_in is not None else in_c
    cost_out = body.cost_per_m_out if body.cost_per_m_out is not None else out_c
    c_window = body.context_window if body.context_window is not None else ctx

    model = WhitelistedModel(
        id=body.id,
        provider=body.provider,
        display_name=body.display_name,
        context_window=c_window,
        is_enabled=body.is_enabled,
        is_default_recon=body.is_default_recon,
        is_default_reproduce=body.is_default_reproduce,
        cost_per_m_in=cost_in,
        cost_per_m_out=cost_out,
    )
    db.add(model)
    await db.flush()
    await db.refresh(model)

    log_user_action(
        background_tasks=background_tasks,
        request=request,
        user_id=current_user.id,
        user_email=current_user.email,
        action="model.created",
        resource_type="model",
        resource_id=body.id,
    )

    logger.info("model_created", model_id=body.id, user=current_user.email)
    return _model_to_response(model)


@router.post("/models/{model_id:path}/test", response_model=ModelTestResultItem)
async def test_single_model(
    model_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ModelTestResultItem:
    """Live ping test for a single model currently on the whitelist."""
    result = await db.execute(select(WhitelistedModel).where(WhitelistedModel.id == model_id))
    model = result.scalar_one_or_none()
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Model {model_id} not found")

    # Fetch provider key
    prov_res = await db.execute(select(ProviderConfig).where(ProviderConfig.provider == model.provider))
    prov_config = prov_res.scalar_one_or_none()

    api_key = None
    base_url = None
    if prov_config:
        base_url = prov_config.api_base_url
        if prov_config.api_key_encrypted:
            try:
                api_key = decrypt_value(prov_config.api_key_encrypted)
            except Exception:
                pass

    call_kwargs: dict[str, Any] = {
        "model": model.id,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 1,
        "timeout": 12,
    }
    if api_key:
        call_kwargs["api_key"] = api_key
    if base_url:
        call_kwargs["api_base"] = _normalize_ollama_base(base_url) if model.provider == "ollama" else base_url

    start_time = time.time()
    try:
        await litellm.acompletion(**call_kwargs)
        latency_ms = int((time.time() - start_time) * 1000)
        return ModelTestResultItem(
            id=model.id,
            display_name=model.display_name,
            status="verified",
            latency_ms=latency_ms,
            message=f"Live connection verified ({latency_ms}ms)",
        )
    except Exception as exc:
        return ModelTestResultItem(
            id=model.id,
            display_name=model.display_name,
            status="failed",
            latency_ms=None,
            message=str(exc),
        )


@router.put("/models/{model_id:path}", response_model=ModelResponse)
async def update_model(
    model_id: str,
    body: ModelUpdateRequest,
    request: FastAPIRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ModelResponse:
    """Update a whitelisted model's settings."""
    result = await db.execute(
        select(WhitelistedModel).where(WhitelistedModel.id == model_id)
    )
    model = result.scalar_one_or_none()
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model '{model_id}' not found",
        )

    if body.display_name is not None:
        model.display_name = body.display_name
    if body.is_enabled is not None:
        model.is_enabled = body.is_enabled
    if body.is_default_recon is not None:
        model.is_default_recon = body.is_default_recon
    if body.is_default_reproduce is not None:
        model.is_default_reproduce = body.is_default_reproduce
    if body.cost_per_m_in is not None:
        model.cost_per_m_in = body.cost_per_m_in
    if body.cost_per_m_out is not None:
        model.cost_per_m_out = body.cost_per_m_out

    db.add(model)
    await db.flush()
    await db.refresh(model)

    log_user_action(
        background_tasks=background_tasks,
        request=request,
        user_id=current_user.id,
        user_email=current_user.email,
        action="model.updated",
        resource_type="model",
        resource_id=model_id,
        metadata=body.model_dump(exclude_none=True),
    )

    logger.info("model_updated", model_id=model_id, user=current_user.email)
    return _model_to_response(model)


@router.delete("/models", status_code=status.HTTP_200_OK)
async def clear_all_models(
    request: FastAPIRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Remove all models from the whitelist."""
    await db.execute(delete(WhitelistedModel))
    await db.flush()

    log_user_action(
        background_tasks=background_tasks,
        request=request,
        user_id=current_user.id,
        user_email=current_user.email,
        action="models.cleared_all",
        resource_type="model",
        resource_id="all",
    )
    return {"message": "All models removed from whitelist"}


@router.delete("/models/{model_id:path}", status_code=status.HTTP_200_OK)
async def delete_model(
    model_id: str,
    request: FastAPIRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Remove a single model from the whitelist."""
    import urllib.parse

    # Support matching both raw slash and url-encoded %2F formats
    candidate_ids = [model_id]
    if "%2F" in model_id or "%2f" in model_id:
        candidate_ids.append(urllib.parse.unquote(model_id))
    elif "/" in model_id:
        candidate_ids.append(urllib.parse.quote(model_id, safe=""))

    result = await db.execute(
        select(WhitelistedModel).where(WhitelistedModel.id.in_(candidate_ids))
    )
    model = result.scalar_one_or_none()
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model '{model_id}' not found",
        )

    target_id = model.id
    await db.execute(delete(WhitelistedModel).where(WhitelistedModel.id == target_id))
    await db.flush()

    log_user_action(
        background_tasks=background_tasks,
        request=request,
        user_id=current_user.id,
        user_email=current_user.email,
        action="model.deleted",
        resource_type="model",
        resource_id=target_id,
    )

    logger.info("model_deleted", model_id=target_id, user=current_user.email)
    return {"message": f"Model '{target_id}' successfully removed from whitelist", "id": target_id}


# ── Helpers ───────────────────────────────────────────────────────────────────


def _mask_key(encrypted: Optional[str]) -> Optional[str]:
    """Decrypt an API key and return a masked version showing only the last 4
    characters."""
    if not encrypted:
        return None
    try:
        plain = decrypt_value(encrypted)
        if len(plain) <= 4:
            return "****"
        return "****" + plain[-4:]
    except Exception:
        return "****"


def _provider_to_response(p: ProviderConfig) -> ProviderResponse:
    return ProviderResponse(
        provider=p.provider,
        api_key_masked=_mask_key(p.api_key_encrypted),
        api_base_url=p.api_base_url,
        is_active=p.is_active,
        updated_at=p.updated_at,
    )


def _model_to_response(m: WhitelistedModel) -> ModelResponse:
    return ModelResponse(
        id=m.id,
        provider=m.provider,
        display_name=m.display_name,
        context_window=m.context_window,
        is_enabled=m.is_enabled,
        is_default_recon=m.is_default_recon,
        is_default_reproduce=m.is_default_reproduce,
        cost_per_m_in=m.cost_per_m_in,
        cost_per_m_out=m.cost_per_m_out,
        created_at=m.created_at,
    )


# ── Google Mantis Upstream Synchronizer Endpoints ──────────────────────────────


@router.get("/mantis/status", status_code=status.HTTP_200_OK)
async def get_mantis_status(
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Retrieve current vendored Google Mantis version, commit, and installed skills."""
    from app.pipeline.mantis import sync_service
    return sync_service.get_version_info()


@router.post("/mantis/check-updates", status_code=status.HTTP_200_OK)
async def check_mantis_updates(
    force: bool = False,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Check upstream google/mantis for updates, perform diff and safety analysis."""
    from app.pipeline.mantis import sync_service
    try:
        return sync_service.check_upstream_updates(force_diff=force)
    except Exception as ex:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to check upstream Google Mantis updates: {ex}",
        )


@router.post("/mantis/apply-update", status_code=status.HTTP_200_OK)
async def apply_mantis_update(
    request: FastAPIRequest,
    background_tasks: BackgroundTasks,
    payload: Optional[dict[str, Any]] = None,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Apply upstream Google Mantis update with automatic backup and rollback."""
    from app.pipeline.mantis import sync_service
    target_commit = payload.get("target_commit") if payload else None
    try:
        result = sync_service.apply_upstream_update(target_commit=target_commit)
        log_user_action(
            background_tasks=background_tasks,
            request=request,
            user_id=current_user.id,
            user_email=current_user.email,
            action="mantis.synced_upstream",
            resource_type="mantis",
            resource_id=result.get("version", {}).get("short_hash", "unknown"),
        )
        return result
    except Exception as ex:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(ex),
        )

