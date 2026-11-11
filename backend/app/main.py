"""FastAPI application entry-point with lifespan management."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import audit, auth, health, lab, scans, settings, stream
from app.core.database import engine

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup / shutdown lifecycle.

    * On startup  – store the async engine on ``app.state`` and verify the
      connection pool is alive.
    * On shutdown – dispose of the engine and release all pooled connections.
    """
    logger.info("startup", message="Initialising database connection pool")
    app.state.db_engine = engine
    # Warm up the pool with a simple connection check
    async with engine.begin() as conn:
        await conn.execute(__import__("sqlalchemy").text("SELECT 1"))
    logger.info("startup", message="Database connection pool ready")
    yield
    logger.info("shutdown", message="Disposing database engine")
    await engine.dispose()
    logger.info("shutdown", message="Engine disposed – goodbye")


app = FastAPI(
    title="MantisVision",
    description="Autonomous Agentic Security & Exploit Telemetry Platform powered by Google Mantis ADK 2.0",
    version="2.0.0",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(auth.router)
app.include_router(scans.router)
app.include_router(lab.router)
app.include_router(audit.router)
app.include_router(settings.router)
app.include_router(stream.router)
app.include_router(health.router)
