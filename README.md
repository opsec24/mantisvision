# MantisVision 🛡️

**Autonomous Multi-Agent Security & Dynamic Vulnerability Verification Platform**  
*Powered by Google Mantis ADK 2.0 • Self-Hosted Enterprise Edition • Obsidian Amber Aurora Theme*

<img width="1247" height="633" alt="Screenshot 2026-11-12 at 12 30 27 AM" src="https://github.com/user-attachments/assets/02470990-28be-43aa-a5dc-6435f02f9531" />


<img width="1247" height="633" alt="Screenshot 2026-11-12 at 12 30 27 AM" src="https://github.com/user-attachments/assets/c33c411a-fc13-44d0-a234-470846bbf1c0" />

<img width="1233" height="622" alt="image" src="https://github.com/user-attachments/assets/3cbbc5d9-8731-4ff8-bfce-ceeab551449b" />


---

## 1. Quick Start & Execution Guide

Get MantisVision up and running in under two minutes using the automated lifecycle manager or standard Docker Compose.

### System Requirements
* **Docker Engine & Docker Compose** (v2.20+)
* **RAM**: 8GB minimum (16GB recommended for parallel multi-agent swarms)
* **OS**: macOS (Apple Silicon / Intel), Linux (Ubuntu, Debian, Kali), or Windows 10/11 with WSL2

---

### Step 1: Clone Repository & Configure Environment

```bash
git clone https://github.com/opsec24/mantisvision.git
cd mantisvision
cp .env.example .env
```

Edit `.env` to configure your initial secrets and LLM API keys:
```ini
JWT_SECRET=use-a-strong-secret-32-chars-minimum
POSTGRES_PASSWORD=securepass

# Configure at least one LLM provider (or configure via Web UI Settings later):
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIzaSy...
OLLAMA_API_BASE=http://host.docker.internal:11434
```

---

### Step 2: Launch All Services

You can launch using the automated lifecycle script (includes macOS anti-sleep protection and health checking) or standard docker compose:

#### Option A: Automated Runner (Recommended)
```bash
./run.sh start
```
*Automatically validates Docker resource allocations, engages anti-sleep prevention, builds and launches containers, and waits for health checks.*

#### Option B: Standard Docker Compose
```bash
docker compose up -d --build
```

This starts the full container stack:
* **`newgensast-frontend-1`**: Next.js 14 Web Interface (`http://localhost:3000`)
* **`newgensast-backend-1`**: FastAPI REST & SSE Streaming Engine (`http://localhost:8000`)
* **`newgensast-worker-1`**: Celery Swarm Execution Worker (Prefork Concurrency)
* **`newgensast-postgres-1`**: PostgreSQL 16 Database (`:5432`)
* **`newgensast-redis-1`**: Redis 7 Task Queue & Broker (`:6379`)
* **`mantisvision-proxy-1`**: Nginx Reverse Proxy (`http://localhost:80`)

---

### Step 3: Seed Admin User & Access Web Platform

Create an initial administrator with TOTP two-factor authentication:
```bash
docker compose exec backend python3 scripts/create_admin.py --email admin@company.internal --password "AdminSecure2026!"
```

Copy the generated OTPAuth URI or TOTP secret into your authenticator app (Google Authenticator, 1Password, or Authy).

* **Web UI Dashboard**: [http://localhost:3000](http://localhost:3000) (or [http://localhost](http://localhost))
* **FastAPI Interactive Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

### Lifecycle Management Commands

```bash
./run.sh status    # Check container health, Docker memory, and active scan tasks
./run.sh logs      # Tail consolidated service logs (or ./run.sh logs worker)
./run.sh restart   # Graceful restart with broker flush
./run.sh stop      # Clean shutdown of all services
```

---

### Execution & Sandbox Matrix

| Host Environment | Recommended Sandbox Mode | Execution Capability |
| :--- | :--- | :--- |
| **macOS (Apple Silicon / Intel)** | `static-only` | Full 17-stage AST code audit, cross-functional taint analysis, and patch synthesis. |
| **Linux (Ubuntu / Kali on VMware)** | `gvisor` or `microsandbox` | Complete isolated PoC execution (`--network=none`) with dynamic verification. |
| **Windows 10/11 (WSL2)** | `static-only` | Full code audit and heuristic patch verification via Docker Desktop WSL2 backend. |
| **AWS EC2 (Ubuntu 22.04/24.04)** | `gvisor` (`runsc`) | Enterprise production standard with hardware-isolated microcontainer execution. |

To enable **gVisor** on Linux in 60 seconds:
```bash
sudo apt-get update && sudo apt-get install -y runsc
sudo runsc install -- --network=none
sudo systemctl restart docker
```

---

## 2. Overview & Architectural Philosophy

**MantisVision** transforms application security testing from shallow pattern-matching into an **autonomous cognitive pentesting swarm**. Powered by the authentic **Google Mantis ADK 2.0 graph engine**, it pairs heterogeneous LLM reasoning models with deterministic code engines to discover, stress-test, dynamically prove, and autonomously patch critical vulnerabilities.

Traditional SAST scanners generate overwhelming false-positive rates (often >70%) because they flag syntax patterns without verifying taint-flow reachability, production viability, or runtime execution constraints. 

MantisVision solves this through an **adversarial state-machine architecture**:
1. **System Surface Grounding**: Deterministic Tree-Sitter AST symbol indexing + architectural ingress mapping.
2. **Threat-Led Campaign Planning**: STRIDE threat matrix mapping and prioritized hunting plans.
3. **Deep Vulnerability Auditing**: Multi-turn taint-flow tracing and cross-file import navigation.
4. **Adversarial Red-Team Falsification**: Independent cognitive critics stress-test hypotheses to eliminate false positives.
5. **Isolated Sandboxed Exploitation**: Synthesizes standalone Python PoC scripts and executes them inside an isolated sandbox (`--network none`) to prove code execution.
6. **Autonomous Patch Synthesis**: Generates unified git diffs and validates that the exploit is neutralized without regressions.

---

## 3. The 19-Node Mantis ADK 2.0 Pipeline (5 Security Squads)

Mantis executes as a **3-tier hybrid state machine**: **Global Reconnaissance** (1x per campaign scope) $\rightarrow$ **Vulnerability Audit Sweep** $\rightarrow$ **Per-Finding Adversarial Verification Funnel** (iterated per candidate finding) $\rightarrow$ **Global Advisory Reporting**.

```
  Tier 1: Global Recon & Architecture (1x per campaign scope)
  [01 history] ──> [02 structural_index] ──> [03 architect] ──> [04 threat_modeler] ──> [05 planner]
                                                                                              │
  Tier 2: Vulnerability Audit Sweep                                                           │
  [06 researcher] <───────────────────────────────────────────────────────────────────────────┘
       │
       ▼
  {07 findings_gate} ═════ [Zero-Findings Fastpath (clean)] ═══════════════════════╗
       │                                                                            ║
       ▼ (Findings Present)                                                         ║
  Tier 3: Per-Finding Adversarial Verification Funnel (Iterated Per Candidate)     ║
  [08 deduplicator] ──> [09 reviewer] ──> {10 reviewer_gate}                        ║
                                              │                \ (Discarded FP)     ║
                                              ▼ (Confirmed)     \                   ║
                                        [11 critic] ──> {12 critic_gate}            ║
                                                           │            \ (Vetoed)  ║
                                                           ▼ (Viable)    \          ║
  [16 patcher] <── [15 chainer] <── {14 repro_gate} <── [13 reproducer]   \         ║
       │                                   \ (PoC Failed)                  \        ║
       ▼                                    \───────────────────────────────\───────╫──> [17 calibrator]
  Tier 4: Global Distillation & Pentest Advisory Report                             ║           │
  [END: SARIF Advisory] <── [19 reporter] <═════════════════════════════════════════╝           ▼
                                   ▲                                                      [18 reflector]
                                   ╚════════════════════════════════════════════════════════════╝
```

### The 5 Security Squads Breakdown

| Squad | Phase Nodes Included | Operational Role |
| :--- | :--- | :--- |
| **Squad 01: Recon & Surface Mapping** | `01 history`, `02 structural_index` *(AST)*, `03 architect` | Mines git delta churn, builds the Tree-Sitter AST catalog, and maps ingress boundaries. |
| **Squad 02: Threat & Strategy** | `04 threat_modeler`, `05 planner` | Formulates the STRIDE threat matrix and budgets tactical hunting campaigns. |
| **Squad 03: Vulnerability Audit** | `06 researcher`, `07 findings_gate` *(Gate)* | Deep taint flow analysis. If 0 findings, `findings_gate` bypasses downstream stages ($0 spent). |
| **Squad 04: Adversarial Triage** | `08 deduplicator`, `09 reviewer`, `10 reviewer_gate` *(Gate)*, `11 critic`, `12 critic_gate` *(Gate)* | Deduplicates findings and stress-tests hypotheses via an adversarial Red-Team critic. |
| **Squad 05: Exploitation & Fix** | `13 reproducer`, `14 repro_gate` *(Gate)*, `15 chainer`, `16 patcher`, `17 calibrator`, `18 reflector`, `19 reporter` | Sandboxed PoC execution, multi-step exploit chaining, zero-regression patching, CVSS 4.0 calibration, and SARIF 2.1.0 generation. |

> 📖 **Full Engineering Specification**: For detailed schema, tool catalog, and input/output contracts for every single stage, see [docs/MANTIS_19_STAGES.md](docs/MANTIS_19_STAGES.md).

---

## 4. Scan Configuration & Methodologies

When launching an audit via `/scans/new`, you have granular control over model allocation, scanning methodology, and execution guardrails:

### A. Scan Modes (`--scan-mode`)
* **`cross-functional` (Recommended for Application Repositories)**:
  Partitions the codebase into ranked architectural subsystems via Tree-Sitter ASTM surveying. Disables single-file sandbox boundaries and grants the agent unrestricted cross-file reading privileges to trace tainted data flows from HTTP controllers into database or shell sinks.
* **`whole` (Recommended for Compact Libraries & SDKs)**:
  Examines the entire repository as a single unified campaign with global context. Ideal for packages under 100 source files (e.g. MCP-Go SDK).
* **`file-by-file`**:
  Exhaustive per-file sweep with strict single-file sandboxing.
* **`auto`**:
  Selects `whole` for repositories under 200 files, or `file-by-file` on first-time unindexed repositories.

### B. Routing Modes: Single Model vs. Multi-Model Swarm
* **Single Model**: Routes all 14 LLM agents to a unified model (e.g. `vertex_ai/gemini-3.8-flash`, `claude-3-5-sonnet`, `openai/gpt-4o`, or local `ollama/deepseek-r1`).
* **Multi-Model Swarm**: Harnesses cross-vendor cognitive architectures via LiteLLM. Allows pairing a *Claude Researcher* with an *OpenAI GPT-4o Critic* to introduce orthogonal cognitive models that falsify consensus blind spots.

### C. Tactical Directives & Scope Controls
* **Focus Directive (`--focus`)**: Tactical CWE keyword category (e.g. `database queries, task handling` or `command handling, upload processing`). Steers the AST planner to prioritize relevant subsystems without leaking file names or function hints.
* **Exclude Patterns (`--exclude`)**: Comma-separated paths to ignore (e.g. `tests/**,docs/**,*.min.js,vendor/**`).
* **Financial Guardrails**: Set hard financial stops (`budget_limit_usd`) or token caps (`max_tokens`) to prevent runaway API spend.

---

## 5. Key Platform Features & UI Tour

### Main Dashboard (`/dashboard`)
* Real-time metrics overview displaying active pipeline runs, completed audits, verified exploits, and aggregate token spend.
* Fast search and status-filtered table with one-click multi-scan comparison and batch management.

### Real-Time Swarm Progress View (`/scans/[id]`)
* Clean overview displaying the 5 collaborative squads with active pulsing indicators, done checkmarks, assigned models, and observation step counts.
* Live step-by-step agent inference stream and finding alerts.

### Dedicated Dynamic Topology Flow (`/scans/[id]/flow`)
* Full-screen interactive vector canvas with smooth drag-to-pan, zoom, and fullscreen controls.
* Visualizes the non-linear 19-node DAG, decision gates, and falsification dropouts.
* Interactive slide-over drawer detailing each node's prompt mission, tool arsenal, latency, and chronological inference logs.

### Forensic Swarm Trace Inspector
* Low-level chronological inspection of model chain-of-thought, tool arguments, terminal tool stdout/stderr, and critic falsification reasons.
* Filter by specific agent (`history`, `architect`, `planner`, `researcher`, `reviewer`, `critic`, `reproducer`, `patcher`, etc.) or event type.

### Pentest Advisory Report View & Finding Drawer
* Click **"Open"** on any confirmed finding to open the full Pentest Advisory report:
  * Full CWE classification, Mantis Risk Score, and CVSS 4.0 blast radius.
  * Source-to-sink AST execution trace.
  * Standalone, executable Python proof-of-concept exploit script (`reproducer.py`).
  * Autonomous zero-regression patch diff (`patch.diff`).

### Enterprise Model Whitelisting & Key Management (`/settings`)
* Securely store, encrypt, and manage API keys for OpenAI, Anthropic, Google Gemini, DeepSeek, and Ollama.
* Toggle individual models on or off, add custom provider endpoints, and verify connectivity with one click.

---

## 6. Technology Stack

* **Frontend**: Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Lucide Icons.
* **Backend API**: Python 3.12, FastAPI, Pydantic 2, SQLAlchemy 2.0 (asyncpg), LiteLLM, Structlog.
* **Pipeline Engine**: Celery, Redis, Google Mantis ADK 2.0, Tree-Sitter AST parser.
* **Database & Storage**: PostgreSQL 16, SQLite (Mantis Knowledge DB).
* **Styling**: Obsidian Amber Aurora design system with responsive SVG vector canvases.

---

## 7. License

Licensed under the **Apache License 2.0**. You are free to adapt, modify, and run this system internally for your organization.
