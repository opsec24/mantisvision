# NewGenSAST 🛡️

**Autonomous Agentic SAST & Dynamic Vulnerability Remediation Platform**  
*Inspired by Google Mantis • Self-Hosted Internal Edition*

---

## Overview

**NewGenSAST** is an internal, collaborative web platform that adapts the Google Mantis security testing methodology into a multi-user web application.

Unlike traditional SAST scanners that only read static text and produce overwhelming false-positive rates, NewGenSAST executes a **hybrid verification pipeline**:
1. **Static Analysis & Architecture Mapping** (`mantis-summarize`, `mantis-architecture`)
2. **Threat Surface & Attack Modeling** (`mantis-threat-model`)
3. **Deep Code Flow Research** (`mantis-researcher`)
4. **Adversarial False-Positive Filtering** (`mantis-critic`) using strict negative heuristics
5. **Zero-Network Docker Sandboxing** (`mantis-reproduce`): LLM authors a standalone `reproducer.py` and physically executes it inside an unprivileged container (`--network none`) to prove the crash
6. **Automated Patch Synthesis & Regression Testing** (`mantis-patch`): Authors a unified git diff and re-tests in the sandbox

---

## Key Features

- **Multi-Model Routing:** Select models per phase (Google Gemini, Anthropic Claude, OpenAI, or local/cloud Ollama instances like `deepseek-r1`).
- **Strict Budget Guardrails:** Hard per-scan dollar limits (e.g. max $5.00) enforced by `LiteLLM` cost tracking.
- **Collaborative Flat Access (AuthN without AuthZ):** All 5–10 team members log in securely with individual accounts + **TOTP (2FA)** and share access to all scans, findings, and company budget metrics.
- **Immutable Audit Trail:** Append-only database rules prevent modification or deletion of user activity logs.
- **Self-Hosted Langfuse Tracing:** Full LLM execution waterfall, prompt/response inspection, token counts, and latency graphs running locally on port `3001`.
- **Dynamic Model Whitelisting & Key Management:** Securely manage and encrypt provider API keys and toggle accessible models on the `/settings` page.

---

## Architecture Stack

| Service | Port | Technology |
| :--- | :--- | :--- |
| **Frontend UI** | `3000` | Next.js 14, Tailwind CSS, Lucide Icons, Monaco Diffs |
| **Backend REST API** | `8000` | FastAPI, Pydantic, SQLAlchemy 2.0 (asyncpg), SSE Streaming |
| **Worker Engine** | - | Celery with Redis broker, Docker Python SDK (`network_mode="none"`) |
| **Database** | `5432` | PostgreSQL 16 (7 tables, immutable audit triggers) |
| **Message Broker** | `6379` | Redis 7 (Pub/Sub & task queue) |
| **LLM Observability** | `3001` | Self-Hosted Langfuse 2 (Prompt traces & cost waterfall) |

---

## Quick Start (Docker Compose)

### 1. Configuration
```bash
cp .env.example .env
```
Edit `.env` to supply your API keys (or configure them later via the web UI at `/settings`):
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `OLLAMA_API_BASE` (default: `http://host.docker.internal:11434`)

### 2. Launch All Services
```bash
docker compose up --build
```

### 3. Create First User with TOTP
Run the onboarding helper to generate credentials and your authenticator QR code:
```bash
python3 scripts/create_admin.py --email admin@company.internal --password "AdminPass2026!"
```
Follow the terminal output to scan the QR code in Google Authenticator or 1Password, or run the printed SQL statement directly against PostgreSQL:
```bash
docker compose exec postgres psql -U mantis -d mantis_web -c "<SQL_STATEMENT>"
```

### 4. Access the Platform
- **Web Dashboard:** [http://localhost:3000](http://localhost:3000)
- **FastAPI Interactive Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Self-Hosted Langfuse UI:** [http://localhost:3001](http://localhost:3001)

---

## Repository Ingestion Modes

1. **Remote Git SCM:** Provide any Git clone URL (GitHub, GitLab, Bitbucket, Gitea) with an optional Personal Access Token (PAT) for private company repositories.
2. **Local Server Directory:** Point the scanner to any pre-mounted local path on the server (`/data/repos/...`).

---

## Updating Mantis Skills

The 15 Mantis prompt templates live as plain Markdown files in `backend/skills/*.md`:
```
backend/skills/
├── mantis-summarize.md
├── mantis-history.md
├── mantis-architecture.md
├── mantis-threat-model.md
├── mantis-plan.md
├── mantis-researcher.md
├── mantis-critic.md
├── mantis-dedupe.md
├── mantis-reproduce.md
└── mantis-patch.md
```
To update the heuristics from upstream `google/mantis`, simply update the corresponding `.md` file. The backend loads prompt templates dynamically off disk—**no code changes or database migrations are required**.

---

## License & Compliance

Licensed under the **Apache License 2.0**. You are free to adapt, modify, and run this system internally for your company.
