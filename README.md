# NewGenSAST 🛡️

**Autonomous Multi-Agent SAST & Dynamic Vulnerability Verification Platform**  
*Powered by Google Mantis ADK 2.0 • Self-Hosted Enterprise Edition • Obsidian Amber Aurora Theme*

---

## 1. Overview & Architectural Philosophy

**NewGenSAST** transforms static application security testing from shallow pattern-matching into an **autonomous cognitive pentesting swarm**. Powered by the authentic **Google Mantis ADK 2.0 graph engine**, it pairs heterogeneous LLM reasoning models with deterministic code engines to discover, stress-test, dynamically prove, and autonomously patch critical vulnerabilities.

Traditional SAST scanners generate overwhelming false-positive rates (often >70%) because they flag syntax patterns without verifying taint-flow reachability, production viability, or runtime execution constraints. 

NewGenSAST solves this through an **adversarial state-machine architecture**:
1. **System Surface Grounding**: Deterministic Tree-Sitter AST symbol indexing + architectural ingress mapping.
2. **Threat-Led Campaign Planning**: STRIDE threat matrix mapping and prioritized hunting plans.
3. **Deep Vulnerability Auditing**: Multi-turn taint-flow tracing and SMT constraint solving.
4. **Adversarial Red-Team Falsification**: Independent cognitive critics stress-test hypotheses to eliminate false positives.
5. **Isolated Sandboxed Exploitation**: Synthesizes standalone Python PoC scripts and executes them inside an isolated sandbox (`--network none`) to prove code execution.
6. **Autonomous Patch Synthesis**: Generates unified git diffs and validates that the exploit is neutralized without regressions.

---

## 2. The 19-Node Mantis ADK 2.0 Pipeline (5 Security Squads)

Rather than an oversimplified linear stepper, Mantis executes as a **3-tier hybrid state machine**: **Global Reconnaissance** (1x per campaign scope) $\rightarrow$ **Vulnerability Audit Sweep** $\rightarrow$ **Per-Finding Adversarial Verification Funnel** (iterated per candidate finding) $\rightarrow$ **Global Advisory Reporting**.

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

## 3. Launching Scans: Options & Configuration Matrix

When launching an audit via `/scans/new`, you have granular control over model allocation, scanning methodology, and execution guardrails:

### A. Routing Modes: Single Model vs. Multi-Model Swarm
* **Single Model**: Routes all 14 LLM agents to a unified model (e.g. `vertex_ai/gemini-3.8-flash`, `claude-3-5-sonnet`, `openai/gpt-4o`, or local `ollama/deepseek-r1`).
* **Multi-Model Swarm**: Harnesses cross-vendor cognitive architectures via LiteLLM. Allows pairing a *Claude Researcher* with an *OpenAI GPT-4o Critic* to introduce orthogonal cognitive models that falsify consensus blind spots.

### B. Swarm Matrix Modes
* **Squad Matrix (5 Security Squads)**: Macro-level allocation. Setting a model for a squad automatically propagates to all constituent agents.
* **Individual Agent Matrix (All 15 LLM Agents)**: Granular per-node control. Set specific models and reasoning effort budgets (`low`, `medium`, `high`) for all 14 LLM agents independently.
* **Deterministic Badging**: `02 structural_index` is hard-pinned to Tree-Sitter AST (Zero-LLM), and all 4 routing gates (`findings_gate`, `reviewer_gate`, `critic_gate`, `repro_gate`) are badged as pure Python state-machine classifiers ($0.00).

### C. Curated Swarm Presets
* ⚡ **Balanced Hybrid** (Recommended): Gemini Flash-Lite (Recon) $\rightarrow$ Claude 3.5 Sonnet (Research) $\rightarrow$ GPT-4o (Critic).
* 🛡️ **Adversarial Check** (Zero-FP Focus): Claude Researcher vs. OpenAI GPT-4o Critic.
* 💰 **Budget Optimized**: Fast Gemini Flash-Lite across all sweeps ($0.05 - $0.20 per scan).
* 🚀 **Frontier Reasoning**: Claude 3.5 Sonnet & GPT-4o across all indexing, audit, and patch passes.

### D. Tactical Directives & Scope Controls
* **Focus Directive (`--focus`)**: Tactical CWE keyword filter (e.g. `cwe-89,ssrf,jwt,auth_bypass`). Instructs the planner to focus token budget strictly on specific vulnerability classes.
* **Exclude Patterns (`--exclude`)**: Comma-separated paths to ignore (e.g. `tests/**,docs/**,*.min.js,vendor/**`).
* **Scan Modes (`--scan-mode`)**:
  * `auto` (Default): Evaluates repository size and dynamically balances depth vs budget.
  * `whole`: Comprehensive monolithic analysis.
  * `file-by-file`: Exhaustive isolated per-file sweep.
  * `cross-functional`: Partitioned multi-file campaigns with dynamic replanning.

### E. Financial Guardrails
* **Budget Limit (USD)**: Hard financial stop (e.g. `$5.00`). If LiteLLM cost accumulation reaches this threshold, the scan halts gracefully and outputs findings gathered up to that point.
* **Max Tokens**: Token ceiling across the entire audit run (e.g. `10,000,000`).
* **Max LLM Calls**: Upper bound on model inferences allowed per campaign.

---

## 4. Key Platform Features & UI Tour

### Executive 5 Security Squads Pipeline (`/scans/[id]`)
* Clean overview displaying the 5 collaborative squads with real-time active pulsing indicators, done checkmarks, assigned models, and observation step counts.
* Direct click-to-filter trace routing on any squad node.

### Dedicated Live Dynamic Topology Flow (`/scans/[id]/flow`)
* Full-screen interactive vector canvas (SVG + Canvas) with smooth drag-to-pan, zoom in/out, fit-to-screen, and fullscreen mode.
* **True Non-Linear DAG Representation**: Visualizes all 19 nodes, 4 decision gates, the clean bypass line, and falsification dropout paths.
* **Live Funnel Counter**: Real-time counter showing:
  $$\text{Hypotheses Formulated} \longrightarrow \text{Critic-Viable} \longrightarrow \text{Docker-Proven} \longrightarrow \text{Patched}$$
* **Interactive Slide-Over Drawer**: Clicking any node opens a right-side drawer revealing its exact prompt mission, allowed tool arsenal, observation step count, latency, and chronological inference logs.

### Forensic Swarm Trace Inspector
* Low-level chronological inspection of model chain-of-thought, tool arguments, terminal tool stdout/stderr, and critic falsification reasons.
* Filter by specific agent (`history`, `architect`, `planner`, `researcher`, `reviewer`, `critic`, `reproducer`, `patcher`, etc.), event type (Thinking, Tools, Verified, Vetoed), or search string.

### Pentest Advisory Report View & Finding Drawer
* Click **"Open"** on any confirmed finding to open the full Pentest Advisory report:
  * Full CWE classification, Mantis Risk Score, and CVSS 4.0 blast radius.
  * Source-to-sink AST execution trace.
  * Standalone, executable Python proof-of-concept exploit script (`reproducer.py`).
  * Autonomous zero-regression patch diff (`patch.diff`).

### Interactive Architecture & STRIDE Threat Model Visualizers
* Interactive vector diagram displaying software components, API servers, ORMs, and ingress sinks parsed directly from `workspace/kb/ARCHITECTURE.md`.
* Tabular STRIDE matrix mapping threat categories to target components.

### Enterprise Model Whitelisting & Key Management (`/settings`)
* Securely store, encrypt, and manage API keys for OpenAI, Anthropic, Google Gemini, DeepSeek, and Ollama.
* Toggle individual models on or off, add custom provider endpoints, and verify connectivity with one click.

---

## 5. Deployment & Execution Guide (Cross-Platform)

### System Requirements
* **Docker & Docker Compose** installed.
* **RAM**: 8GB minimum (16GB recommended for multi-agent scans).
* **OS**: macOS (Apple Silicon / Intel), Linux (Ubuntu, Debian, Kali), or Windows 10/11 with WSL2.

---

### Quick Start (Docker Compose)

#### 1. Clone & Configure Environment
```bash
git clone https://github.com/your-org/NewGenSAST.git
cd NewGenSAST
cp .env.example .env
```
Edit `.env` to configure your initial keys (or configure them via the web UI later):
```ini
JWT_SECRET=use-a-strong-secret-32-chars-minimum
POSTGRES_PASSWORD=securepass
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIzaSy...
OLLAMA_API_BASE=http://host.docker.internal:11434
```

#### 2. Launch All Services
```bash
docker compose up -d --build
```
This spins up all 6 core containers:
* `newgensast-frontend-1`: Next.js 14 Web Interface (`:3000`)
* `newgensast-backend-1`: FastAPI REST & SSE Streaming Engine (`:8000`)
* `newgensast-worker-1`: Celery Swarm Execution Worker
* `newgensast-postgres-1`: PostgreSQL 16 Database (`:5432`)
* `newgensast-redis-1`: Redis 7 Task Queue & Broker (`:6379`)
* `newgensast-proxy-1`: Nginx Reverse Proxy (`:80`)

#### 3. Create Admin User with TOTP 2FA
Run the onboarding helper to generate credentials and your authenticator QR code:
```bash
docker compose exec backend python3 -c "
import asyncio, pyotp
from app.db.session import AsyncSessionLocal
from app.core.models import User
from app.core.security import get_password_hash

async def create():
    async with AsyncSessionLocal() as db:
        totp_secret = pyotp.random_base32()
        u = User(
            email='admin@company.internal',
            hashed_password=get_password_hash('AdminPass2026!'),
            role='admin',
            is_active=True,
            totp_secret=totp_secret,
            totp_enabled=True
        )
        db.add(u)
        await db.commit()
        print('Admin created! Login: admin@company.internal / AdminPass2026!')
        print('TOTP Secret:', totp_secret)
        print('TOTP Provisioning URI:', pyotp.TOTP(totp_secret).provisioning_uri('admin@company.internal', issuer_name='NewGenSAST'))

asyncio.run(create())
"
```
Scan the provisioning URI in Google Authenticator, 1Password, or Authy.

#### 4. Access the Platform
* **Web UI Dashboard**: [http://localhost:3000](http://localhost:3000)
* **Interactive API Documentation**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

### Sandbox Environment Matrix (Cross-Platform Dynamic Execution)

| Host Platform | Recommended Sandbox | Status | Notes |
| :--- | :--- | :---: | :--- |
| **macOS (Apple Silicon)** | `static-only` |  **Recommended** | Zero virtualization friction. Executes 17 of 19 stages at 100% fidelity. |
| **Windows PC (WSL2)** | `static-only` or Docker |  **Supported** | Docker Desktop on Windows runs via WSL2. |
| **Kali Linux on VMware** | `gvisor` or `microsandbox` |  **Full Dynamic PoC** | 100% free local pentesting. Just `sudo apt install runsc && sudo runsc install`. |
| **AWS EC2 (Ubuntu 22.04/24.04)** | `gvisor` |  **Production Gold Standard** | Standard EC2 instance with `runsc` installed in 3 commands. |

#### Setting Up `gVisor` on EC2 or Kali VM in 60 Seconds:
```bash
sudo apt-get update && sudo apt-get install -y runsc
sudo runsc install -- --network=none
sudo systemctl restart docker
```

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
