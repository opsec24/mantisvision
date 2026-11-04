"""Authentication & TOTP API routes."""

from __future__ import annotations

import uuid
from typing import Optional

import structlog
import httpx
from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.models import User
from app.core.security import (
    create_access_token,
    decode_access_token,
    generate_totp_qr_base64,
    generate_totp_secret,
    get_totp_uri,
    hash_password,
    verify_password,
    verify_totp,
)

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TOTPVerifyRequest(BaseModel):
    email: EmailStr
    code: Optional[str] = None
    totp_code: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TOTPRequiredResponse(BaseModel):
    requires_totp: bool = True
    message: str = "TOTP verification required"


class TOTPSetupResponse(BaseModel):
    secret: str
    totp_secret: str
    otpauth_uri: str
    qr_code: str  # base64 data-URI


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    totp_enabled: bool


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


# ── Dependencies ──────────────────────────────────────────────────────────────


async def get_current_user(
    authorization: Optional[str] = Header(None),
    session_token: Optional[str] = Cookie(None),
    token_param: Optional[str] = Query(None, alias="token"),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Extract and validate the JWT from the ``Authorization`` header,
    ``token`` query parameter, or ``session_token`` cookie and return the
    corresponding ``User`` row."""
    token: Optional[str] = None

    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
    elif token_param:
        token = token_param.strip()
    elif session_token:
        token = session_token

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_access_token(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Server-side token revocation check
    try:
        import redis.asyncio as aioredis
        redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        is_revoked = await redis_client.exists(f"token_blacklist:{token}")
        await redis_client.close()
        if is_revoked:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session invalidated. Please log in again.",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except HTTPException:
        raise
    except Exception as err:
        logger.warning("redis_token_revocation_check_failed", error=str(err))

    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token payload missing subject",
        )

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    return user


# ── Langfuse SSO Synchronization Helpers ─────────────────────────────────────


async def sync_langfuse_session(email: str, password: str, response: Response) -> None:
    pass


async def sync_langfuse_signup(email: str, password: str) -> None:
    pass


# ── Routes ────────────────────────────────────────────────────────────────────


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)) -> UserResponse:
    """Register a new user account."""
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    await sync_langfuse_signup(body.email, body.password)
    logger.info("user_registered", email=body.email, user_id=str(user.id))
    return UserResponse(id=user.id, email=user.email, totp_enabled=user.totp_enabled)


@router.post("/login", response_model=TokenResponse | TOTPRequiredResponse)
async def login(
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse | TOTPRequiredResponse:
    """Authenticate with email + password.

    * If TOTP is **not** enabled → returns a JWT immediately.
    * If TOTP **is** enabled → returns ``requires_totp: true`` so the client
      can follow up with ``/verify-totp``.
    """
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if settings.REQUIRE_TOTP and user.totp_enabled:
        logger.info("login_totp_required", email=body.email)
        return TOTPRequiredResponse()

    token = create_access_token(data={"sub": str(user.id), "email": user.email})
    await sync_langfuse_session(body.email, body.password, response)
    logger.info("login_success", email=body.email)
    return TokenResponse(access_token=token)


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    authorization: Optional[str] = Header(None),
    session_token: Optional[str] = Cookie(None),
):
    """Server-side session invalidation for both NewGenSAST platform and Langfuse."""
    token: Optional[str] = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
    elif session_token:
        token = session_token

    # 1. Invalidate platform JWT session in Redis
    if token:
        try:
            import redis.asyncio as aioredis
            redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            # Blacklist token for 24 hours
            await redis_client.set(f"token_blacklist:{token}", "revoked", ex=86400)
            await redis_client.close()
            logger.info("platform_token_invalidated_server_side", token_prefix=token[:10])
        except Exception as err:
            logger.warning("token_revocation_failed", error=str(err))

    # 2. Invalidate Langfuse NextAuth session on Langfuse server
    langfuse_session_token = request.cookies.get("next-auth.session-token")
    try:
        async with httpx.AsyncClient(base_url="http://langfuse:3000", timeout=3.0) as client:
            csrf_resp = await client.get("/api/auth/csrf")
            csrf_token = csrf_resp.json().get("csrfToken")
            if csrf_token:
                cookies = dict(csrf_resp.cookies)
                if langfuse_session_token:
                    cookies["next-auth.session-token"] = langfuse_session_token
                await client.post(
                    "/api/auth/signout",
                    data={"csrfToken": csrf_token},
                    cookies=cookies,
                )
                logger.info("langfuse_session_invalidated_server_side")
    except Exception as exc:
        logger.warning("langfuse_signout_failed", error=str(exc))

    # 3. Explicitly expire session cookies across all relevant domains and paths
    for domain in [".localhost", "localhost", "langfuse.localhost", None]:
        response.delete_cookie(key="next-auth.session-token", domain=domain, path="/")
        response.delete_cookie(key="session_token", domain=domain, path="/")
        response.delete_cookie(key="access_token", domain=domain, path="/")

    # Set raw Set-Cookie headers for guaranteed cookie expulsion
    response.headers.append(
        "Set-Cookie",
        "next-auth.session-token=; Path=/; Domain=.localhost; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax",
    )
    response.headers.append(
        "Set-Cookie",
        "next-auth.session-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax",
    )

    return {"success": True, "message": "Sessions successfully invalidated"}


@router.get("/sso/langfuse")
async def langfuse_sso_gateway(
    request: Request,
):
    """Redirect to dashboard."""
    return RedirectResponse(url="/dashboard", status_code=status.HTTP_302_FOUND)


@router.post("/verify-totp", response_model=TokenResponse)
async def verify_totp_endpoint(
    body: TOTPVerifyRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Validate the 6-digit TOTP code and return a JWT session token."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    if not user.totp_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="TOTP is not configured for this user",
        )

    totp_val = body.totp_code or body.code
    if not totp_val or not verify_totp(user.totp_secret, totp_val):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid TOTP code")

    token = create_access_token(data={"sub": str(user.id), "email": user.email})
    logger.info("totp_verified", email=body.email)
    return TokenResponse(access_token=token)


@router.post("/setup-totp", response_model=TOTPSetupResponse)
async def setup_totp(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TOTPSetupResponse:
    """Generate a new TOTP secret, persist it on the user record, and return
    the ``otpauth://`` URI plus a QR-code image as a base64 data-URI."""
    secret = generate_totp_secret()
    uri = get_totp_uri(secret, current_user.email)
    qr = generate_totp_qr_base64(uri)

    current_user.totp_secret = secret
    current_user.totp_enabled = True
    db.add(current_user)
    await db.flush()

    logger.info("totp_setup", email=current_user.email)
    return TOTPSetupResponse(secret=secret, totp_secret=secret, otpauth_uri=uri, qr_code=qr)


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    """Return the currently authenticated user's profile."""
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        totp_enabled=current_user.totp_enabled,
    )
