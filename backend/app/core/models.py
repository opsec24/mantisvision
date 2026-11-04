"""SQLAlchemy ORM models for every table in the NewGenSAST schema."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Shared declarative base for all models."""

    pass


# ── Users ─────────────────────────────────────────────────────────────────────


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    totp_secret: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=text("now()"),
    )

    # Relationships
    scans: Mapped[list["Scan"]] = relationship(back_populates="triggered_by_user", lazy="selectin")
    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="user", lazy="selectin")


# ── Scans ─────────────────────────────────────────────────────────────────────


class Scan(Base):
    __tablename__ = "scans"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)  # 'git' or 'local'
    source_target: Mapped[str] = mapped_column(Text, nullable=False)
    branch: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    git_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    triggered_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="queued", server_default=text("'queued'")
    )
    current_phase: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    phase_models: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    budget_limit_usd: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cost_spent_usd: Mapped[float] = mapped_column(Float, default=0.0, server_default=text("0.0"))
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    architecture_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    threat_model: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    hunting_plan: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    review_packet: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    exploit_chains: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    total_tokens: Mapped[int] = mapped_column(BigInteger, default=0, server_default=text("0"))
    prompt_tokens: Mapped[int] = mapped_column(BigInteger, default=0, server_default=text("0"))
    completion_tokens: Mapped[int] = mapped_column(BigInteger, default=0, server_default=text("0"))
    model: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    reasoning_effort: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    focus: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    exclude_patterns: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    sandbox: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, default="static-only")
    mantis_run_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=text("now()"),
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    triggered_by_user: Mapped["User"] = relationship(back_populates="scans", lazy="selectin")
    findings: Mapped[list["Finding"]] = relationship(
        back_populates="scan", lazy="selectin", cascade="all, delete-orphan", passive_deletes=True
    )
    llm_traces: Mapped[list["LLMTrace"]] = relationship(
        back_populates="scan", lazy="selectin", cascade="all, delete-orphan", passive_deletes=True
    )
    agent_traces: Mapped[list["AgentInferenceTrace"]] = relationship(
        back_populates="scan", lazy="selectin", cascade="all, delete-orphan", passive_deletes=True
    )

    __table_args__ = (
        Index("ix_scans_status", "status"),
        Index("ix_scans_created_at", "created_at"),
    )


# ── Findings ──────────────────────────────────────────────────────────────────


class Finding(Base):
    __tablename__ = "findings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    scan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scans.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    cwe: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="medium")
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="open", server_default=text("'open'")
    )
    file_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    line_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    poc_script: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    poc_output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    patch_diff: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    observation_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_sink_trace: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    exploit_steps: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    mitigation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=text("now()"),
    )

    # Relationships
    scan: Mapped["Scan"] = relationship(back_populates="findings", lazy="selectin")

    __table_args__ = (
        Index("ix_findings_scan_id", "scan_id"),
        Index("ix_findings_severity", "severity"),
    )


# ── Audit Logs ────────────────────────────────────────────────────────────────


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    user_email: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    metadata_: Mapped[Optional[dict[str, Any]]] = mapped_column(
        "metadata", JSONB, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=text("now()"),
    )

    # Relationships
    user: Mapped["User"] = relationship(back_populates="audit_logs", lazy="selectin")

    __table_args__ = (
        Index("ix_audit_logs_user_id", "user_id"),
        Index("ix_audit_logs_action", "action"),
        Index("ix_audit_logs_created_at", "created_at"),
    )


# ── Provider Configs ──────────────────────────────────────────────────────────


class ProviderConfig(Base):
    __tablename__ = "provider_configs"

    provider: Mapped[str] = mapped_column(String(50), primary_key=True)
    api_key_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    api_base_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=text("now()"),
        onupdate=lambda: datetime.now(timezone.utc),
    )


# ── Whitelisted Models ───────────────────────────────────────────────────────


class WhitelistedModel(Base):
    __tablename__ = "whitelisted_models"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    context_window: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    is_default_recon: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    is_default_reproduce: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )
    cost_per_m_in: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cost_per_m_out: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=text("now()"),
    )


# ── LLM Traces ───────────────────────────────────────────────────────────────


class LLMTrace(Base):
    __tablename__ = "llm_traces"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    scan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scans.id", ondelete="CASCADE"), nullable=False
    )
    phase: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str] = mapped_column(String(255), nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=text("now()"),
    )

    # Relationships
    scan: Mapped["Scan"] = relationship(back_populates="llm_traces", lazy="selectin")

    __table_args__ = (
        Index("ix_llm_traces_scan_id", "scan_id"),
        Index("ix_llm_traces_phase", "phase"),
    )


# ── Agent Inference Traces (Low-Level Forensic Observability) ─────────────────


class AgentInferenceTrace(Base):
    __tablename__ = "agent_inference_traces"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    scan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("scans.id", ondelete="CASCADE"), nullable=False
    )
    step_number: Mapped[int] = mapped_column(Integer, nullable=False)
    phase: Mapped[str] = mapped_column(String(50), nullable=False)
    agent_name: Mapped[str] = mapped_column(String(100), nullable=False)
    model: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    thinking_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    prompt_raw: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    response_raw: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tool_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    tool_input: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    tool_output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    candidate_vuln_title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    decision_status: Mapped[str] = mapped_column(
        String(50), default="PROGRESS", server_default=text("'PROGRESS'")
    )  # 'PROGRESS', 'DISCOVERY', 'TOOL_EXEC', 'VERIFIED', 'DISCARDED', 'REJECTED_BY_CRITIC', 'FAILED'
    decision_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    total_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    latency_ms: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0, server_default=text("0.0"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=text("now()"),
    )

    # Relationships
    scan: Mapped["Scan"] = relationship(back_populates="agent_traces", lazy="selectin")

    __table_args__ = (
        Index("ix_agent_traces_scan_step", "scan_id", "step_number"),
        Index("ix_agent_traces_tool", "scan_id", "tool_name"),
        Index("ix_agent_traces_decision", "scan_id", "decision_status"),
        Index("ix_agent_traces_phase", "scan_id", "phase"),
    )

