"""Security utilities: password hashing, JWT, TOTP, and Fernet encryption."""

from __future__ import annotations

import base64
import io
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import pyotp
import qrcode
import qrcode.constants
from cryptography.fernet import Fernet, InvalidToken
import bcrypt
from jose import JWTError, jwt

from app.core.config import settings

# ── Password Hashing ─────────────────────────────────────────────────────────


def hash_password(plain: str) -> str:
    """Return a bcrypt hash of the plaintext password."""
    pwd_bytes = plain.encode("utf-8")[:72]
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against its bcrypt hash."""
    try:
        pwd_bytes = plain.encode("utf-8")[:72]
        return bcrypt.checkpw(pwd_bytes, hashed.encode("utf-8"))
    except Exception:
        return False


# ── JWT ───────────────────────────────────────────────────────────────────────


def create_access_token(
    data: dict[str, Any],
    expires_delta: Optional[timedelta] = None,
) -> str:
    """Create a signed JWT access token."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta
        if expires_delta
        else timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and validate a JWT access token.

    Raises ``JWTError`` on invalid / expired tokens.
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except JWTError:
        raise


# ── TOTP ──────────────────────────────────────────────────────────────────────


def generate_totp_secret() -> str:
    """Generate a new random TOTP secret (base32-encoded)."""
    return pyotp.random_base32()


def get_totp_uri(secret: str, email: str, issuer: str = "NewGenSAST") -> str:
    """Return an ``otpauth://`` provisioning URI for authenticator apps."""
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=email, issuer_name=issuer)


def generate_totp_qr_base64(uri: str) -> str:
    """Generate a QR-code PNG for the given ``otpauth://`` URI and return it as
    a base64-encoded data-URI string."""
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64}"


def verify_totp(secret: str, code: str) -> bool:
    """Verify a 6-digit TOTP code against the stored secret.

    Allows ±1 window for clock drift.
    """
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


# ── Fernet Encryption (API Keys) ─────────────────────────────────────────────

_fernet: Optional[Fernet] = None


def _get_fernet() -> Fernet:
    """Lazily initialise and cache a ``Fernet`` instance."""
    global _fernet
    if _fernet is None:
        key = settings.SETTINGS_ENCRYPTION_KEY.encode()
        # If the key isn't valid Fernet-base64, derive one via padding.
        try:
            _fernet = Fernet(key)
        except (ValueError, Exception):
            # Derive a URL-safe base64 key from the raw secret
            padded = base64.urlsafe_b64encode(key.ljust(32, b"\0")[:32])
            _fernet = Fernet(padded)
    return _fernet


def encrypt_value(plaintext: str) -> str:
    """Encrypt a plaintext string and return the ciphertext as a UTF-8 string."""
    f = _get_fernet()
    return f.encrypt(plaintext.encode()).decode()


def decrypt_value(ciphertext: str) -> str:
    """Decrypt a Fernet-encrypted ciphertext back to plaintext.

    Raises ``cryptography.fernet.InvalidToken`` on failure.
    """
    f = _get_fernet()
    try:
        return f.decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        raise
