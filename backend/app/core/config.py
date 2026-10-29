"""Application configuration loaded from environment variables."""

from __future__ import annotations

from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central application settings backed by .env / environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Database ──────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://mantis:securepass@postgres:5432/mantis_web"

    # ── Redis ─────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://redis:6379/0"

    # ── JWT & Authentication ──────────────────────────────────────────
    JWT_SECRET: str = "change-this-in-production-use-openssl-rand-hex-32"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    REQUIRE_TOTP: bool = False

    # ── Encryption ────────────────────────────────────────────────────
    SETTINGS_ENCRYPTION_KEY: str = "generate-with-python-cryptography-fernet"

    # ── LLM / Ollama ──────────────────────────────────────────────────
    OLLAMA_API_BASE: Optional[str] = None

    # ── Langfuse Observability ────────────────────────────────────────
    LANGFUSE_HOST: Optional[str] = None
    LANGFUSE_PUBLIC_KEY: Optional[str] = None
    LANGFUSE_SECRET_KEY: Optional[str] = None


settings = Settings()
