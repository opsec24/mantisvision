-- NewGenSAST Database Schema
-- Initialisation script executed by postgres entrypoint on first run.

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    totp_secret TEXT,
    totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Scans ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS scans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255),
    source_type     VARCHAR(20) NOT NULL,
    source_target   TEXT NOT NULL,
    branch          VARCHAR(255),
    git_token       TEXT,
    triggered_by    UUID NOT NULL REFERENCES users(id),
    status          VARCHAR(30) NOT NULL DEFAULT 'queued',
    current_phase   VARCHAR(50),
    phase_models    JSONB,
    budget_limit_usd DOUBLE PRECISION,
    cost_spent_usd  DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    error_message   TEXT,
    architecture_summary TEXT,
    threat_model    TEXT,
    hunting_plan    TEXT,
    review_packet   TEXT,
    exploit_chains  JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_scans_status     ON scans (status);
CREATE INDEX IF NOT EXISTS ix_scans_created_at ON scans (created_at);

-- ── Findings ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS findings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id     UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    cwe         VARCHAR(20),
    severity    VARCHAR(20) NOT NULL DEFAULT 'medium',
    status      VARCHAR(30) NOT NULL DEFAULT 'open',
    file_path   TEXT,
    line_number INTEGER,
    description TEXT,
    poc_script  TEXT,
    poc_output  TEXT,
    patch_diff  TEXT,
    observation_id TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_findings_scan_id  ON findings (scan_id);
CREATE INDEX IF NOT EXISTS ix_findings_severity ON findings (severity);

-- ── Audit Logs ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id),
    user_email    VARCHAR(255) NOT NULL,
    action        VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id   VARCHAR(255),
    ip_address    VARCHAR(45),
    user_agent    TEXT,
    metadata      JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_audit_logs_user_id    ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS ix_audit_logs_action     ON audit_logs (action);
CREATE INDEX IF NOT EXISTS ix_audit_logs_created_at ON audit_logs (created_at);

-- Immutability: prevent UPDATE and DELETE on audit_logs
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs table is append-only; updates and deletes are forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_logs;
CREATE TRIGGER trg_audit_no_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

DROP TRIGGER IF EXISTS trg_audit_no_delete ON audit_logs;
CREATE TRIGGER trg_audit_no_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- ── Provider Configs ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS provider_configs (
    provider          VARCHAR(50) PRIMARY KEY,
    api_key_encrypted TEXT,
    api_base_url      TEXT,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by        UUID REFERENCES users(id),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default providers
INSERT INTO provider_configs (provider) VALUES
    ('openai'), ('anthropic'), ('google'), ('ollama')
ON CONFLICT (provider) DO NOTHING;

-- ── Whitelisted Models ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS whitelisted_models (
    id                  VARCHAR(255) PRIMARY KEY,
    provider            VARCHAR(50) NOT NULL,
    display_name        VARCHAR(255) NOT NULL,
    context_window      INTEGER,
    is_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    is_default_recon    BOOLEAN NOT NULL DEFAULT FALSE,
    is_default_reproduce BOOLEAN NOT NULL DEFAULT FALSE,
    cost_per_m_in       DOUBLE PRECISION,
    cost_per_m_out      DOUBLE PRECISION,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Whitelisted models are populated dynamically by user via Discovery & Whitelist UI
-- (No hardcoded demo models seeded)

-- ── LLM Traces ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS llm_traces (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id           UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    phase             VARCHAR(50) NOT NULL,
    model             VARCHAR(255) NOT NULL,
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens      INTEGER NOT NULL DEFAULT 0,
    latency_ms        INTEGER,
    cost_usd          DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    error_message     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_llm_traces_scan_id ON llm_traces (scan_id);
CREATE INDEX IF NOT EXISTS ix_llm_traces_phase   ON llm_traces (phase);

-- ── Agent Inference Traces (Low-Level Forensic Observability) ─────────────────

CREATE TABLE IF NOT EXISTS agent_inference_traces (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id              UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    step_number          INTEGER NOT NULL,
    phase                VARCHAR(50) NOT NULL,
    agent_name           VARCHAR(100) NOT NULL,
    model                VARCHAR(255),
    thinking_content     TEXT,
    prompt_raw           TEXT,
    response_raw         TEXT,
    tool_name            VARCHAR(100),
    tool_input           JSONB,
    tool_output          TEXT,
    candidate_vuln_title VARCHAR(255),
    decision_status      VARCHAR(50) NOT NULL DEFAULT 'PROGRESS',
    decision_reason      TEXT,
    prompt_tokens        INTEGER NOT NULL DEFAULT 0,
    completion_tokens    INTEGER NOT NULL DEFAULT 0,
    total_tokens         INTEGER NOT NULL DEFAULT 0,
    latency_ms           INTEGER NOT NULL DEFAULT 0,
    cost_usd             DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_agent_traces_scan_step ON agent_inference_traces (scan_id, step_number);
CREATE INDEX IF NOT EXISTS ix_agent_traces_tool      ON agent_inference_traces (scan_id, tool_name);
CREATE INDEX IF NOT EXISTS ix_agent_traces_decision  ON agent_inference_traces (scan_id, decision_status);
CREATE INDEX IF NOT EXISTS ix_agent_traces_phase     ON agent_inference_traces (scan_id, phase);

