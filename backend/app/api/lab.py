"""Mantis Evaluation & Target Generation Lab API.

Exposes Google Mantis benchmark harnesses (Tier 1 surveyor, Tier 2 researcher,
stage evaluations, sweeps) and synthetic multi-hop vulnerable codebase generation.
"""

from __future__ import annotations

import json
import os
import subprocess
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.api.auth import get_current_user
from app.core.config import settings
from app.core.models import User

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/api/lab", tags=["Mantis Lab & Benchmarks"])

MANTIS_ENGINE_DIR = Path("/app/mantis_engine")
SYNTHETIC_TARGETS_DIR = Path("/data/scans/synthetic_targets")


# ── Pydantic Request & Response Schemas ────────────────────────────────────────

class TargetItem(BaseModel):
    id: str
    name: str
    target_type: str  # "builtin" or "synthetic"
    path: str
    file_count: int
    flaw_count: Optional[int] = None
    decoy_count: Optional[int] = None
    seed: Optional[int] = None
    size: Optional[str] = None
    ground_truth_path: Optional[str] = None
    description: str


class GenerateTargetRequest(BaseModel):
    seed: int = Field(default=1001, description="Random seed (1000-1099 for dev, 9000-9099 for holdout)")
    size: str = Field(default="small", pattern="^(small|medium|large)$")
    name: Optional[str] = None


class SurveyorBenchmarkRequest(BaseModel):
    mode: str = Field(default="synthetic", pattern="^(synthetic|target)$")
    target: Optional[str] = None
    ground_truth: Optional[str] = None


class StageBenchmarkRequest(BaseModel):
    stage: str = Field(default="research", description="dedupe | review | critic | calibrate | research | reproduce | patch | report")
    model: Optional[str] = None
    effort: Optional[str] = "medium"
    toolset: Optional[str] = "structural"  # "baseline" or "structural"
    runs: Optional[int] = 1
    max_tokens: Optional[int] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_provider_env() -> dict[str, str]:
    """Retrieve decrypted environment variables for providers."""
    env = os.environ.copy()
    for key in ("GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
                "DEEPSEEK_API_KEY", "VERTEXAI_PROJECT", "GOOGLE_CLOUD_PROJECT",
                "GOOGLE_APPLICATION_CREDENTIALS", "OLLAMA_API_BASE"):
        val = getattr(settings, key, None) or os.environ.get(key)
        if val:
            env[key] = val

    try:
        from app.core.security import decrypt_value
        from app.pipeline.orchestrator import _get_sync_engine
        from sqlalchemy import text
        engine = _get_sync_engine()
        with engine.connect() as conn:
            rows = conn.execute(text("SELECT provider, api_key_encrypted, api_base_url FROM provider_configs WHERE is_active = true")).fetchall()
            for p_name, p_enc, p_base in rows:
                p_lower = str(p_name).lower()
                if p_enc:
                    try:
                        k = decrypt_value(p_enc)
                        if p_lower == "openai":
                            env["OPENAI_API_KEY"] = k
                        elif p_lower in ("anthropic", "claude"):
                            env["ANTHROPIC_API_KEY"] = k
                        elif p_lower in ("gemini", "google"):
                            env["GEMINI_API_KEY"] = k
                            env["GOOGLE_API_KEY"] = k
                        elif p_lower == "deepseek":
                            env["DEEPSEEK_API_KEY"] = k
                    except Exception:
                        pass
                if p_base and p_lower == "ollama":
                    env["OLLAMA_API_BASE"] = p_base
    except Exception as exc:
        logger.warning("lab_env_load_failed", error=str(exc))

    if env.get("GEMINI_API_KEY") and not env.get("GOOGLE_API_KEY"):
        env["GOOGLE_API_KEY"] = env["GEMINI_API_KEY"]
    elif env.get("GOOGLE_API_KEY") and not env.get("GEMINI_API_KEY"):
        env["GEMINI_API_KEY"] = env["GOOGLE_API_KEY"]

    return env


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/targets", response_model=List[TargetItem])
def list_test_targets(current_user: User = Depends(get_current_user)) -> List[TargetItem]:
    """Enumerate all available test targets (built-in test suites and generated synthetic corpora)."""
    targets: List[TargetItem] = []

    # 1. Built-in test_targets
    builtin_tt = MANTIS_ENGINE_DIR / "test_targets"
    if builtin_tt.exists():
        py_files = list(builtin_tt.glob("*.py"))
        targets.append(
            TargetItem(
                id="builtin-test-targets",
                name="Mantis Built-in Suite (Flask & Vault)",
                target_type="builtin",
                path=str(builtin_tt),
                file_count=len(py_files),
                flaw_count=4,
                decoy_count=0,
                description="Fast test targets containing SQL injection, IDOR, and token authorization vulnerabilities.",
            )
        )

    # 2. Built-in evals/research_target
    research_corpus = MANTIS_ENGINE_DIR / "evals" / "research_target"
    if research_corpus.exists():
        all_py = list(research_corpus.rglob("*.py"))
        gt_path = research_corpus / "ground_truth.json"
        flaw_count = 11
        if gt_path.exists():
            try:
                data = json.loads(gt_path.read_text())
                findings = data.get("findings", [])
                flaw_count = len([f for f in findings if f.get("kind") != "decoy"]) or len(findings)
            except Exception:
                pass

        targets.append(
            TargetItem(
                id="builtin-research-target",
                name="Mantis Tier-2 Seeded Corpus",
                target_type="builtin",
                path=str(research_corpus),
                file_count=len(all_py),
                flaw_count=flaw_count,
                decoy_count=0,
                ground_truth_path=str(gt_path) if gt_path.exists() else None,
                description="Official 26-file deliberately vulnerable corpus for measuring researcher agent precision & recall.",
            )
        )

    # 3. User-generated synthetic targets
    SYNTHETIC_TARGETS_DIR.mkdir(parents=True, exist_ok=True)
    for p in sorted(SYNTHETIC_TARGETS_DIR.iterdir()):
        if p.is_dir():
            all_files = [f for f in p.rglob("*") if f.is_file()]
            gt_file = p / "ground_truth.json"
            flaws = None
            decoys = None
            seed_val = None
            size_val = None
            if gt_file.exists():
                try:
                    gt_data = json.loads(gt_file.read_text())
                    findings = gt_data.get("findings", [])
                    seeded_list = [f for f in findings if f.get("kind") == "seeded"]
                    decoy_list = [f for f in findings if f.get("kind") == "decoy"]
                    flaws = len(seeded_list) if seeded_list else len(findings)
                    decoys = len(decoy_list)
                    gen_meta = gt_data.get("generator", {})
                    seed_val = gen_meta.get("seed")
                    size_val = gen_meta.get("size")
                except Exception:
                    pass

            targets.append(
                TargetItem(
                    id=f"synthetic-{p.name}",
                    name=f"Synthetic Target ({p.name})",
                    target_type="synthetic",
                    path=str(p),
                    file_count=len(all_files),
                    flaw_count=flaws,
                    decoy_count=decoys,
                    seed=seed_val,
                    size=size_val,
                    ground_truth_path=str(gt_file) if gt_file.exists() else None,
                    description=f"Generated multi-hop codebase with {flaws or '?'} seeded flaws and {decoys or '?'} decoys.",
                )
            )

    return targets


@router.post("/generate-target", response_model=TargetItem)
def generate_synthetic_target(
    req: GenerateTargetRequest,
    current_user: User = Depends(get_current_user),
) -> TargetItem:
    """Generate a realistic synthetic vulnerable codebase using Mantis evals/research_targets/gen.py."""
    SYNTHETIC_TARGETS_DIR.mkdir(parents=True, exist_ok=True)

    folder_name = req.name or f"target_{req.seed}_{req.size}_{uuid.uuid4().hex[:6]}"
    out_dir = SYNTHETIC_TARGETS_DIR / folder_name

    gen_script = MANTIS_ENGINE_DIR / "evals" / "research_targets" / "gen.py"
    if not gen_script.exists():
        raise HTTPException(status_code=500, detail="Mantis gen.py script not found.")

    cmd = [
        "python3",
        str(gen_script),
        "--seed", str(req.seed),
        "--size", req.size,
        "--out", str(out_dir),
    ]

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(MANTIS_ENGINE_DIR),
            capture_output=True,
            text=True,
            timeout=120,
        )
        if proc.returncode != 0:
            logger.error("target_gen_failed", stdout=proc.stdout, stderr=proc.stderr)
            raise HTTPException(status_code=500, detail=f"Generation failed: {proc.stderr or proc.stdout}")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Synthetic target generation timed out.")

    gt_file = out_dir / "ground_truth.json"
    flaws = 0
    decoys = 0
    if gt_file.exists():
        try:
            gt_data = json.loads(gt_file.read_text())
            flaws = len(gt_data.get("flaws", []))
            decoys = len(gt_data.get("decoys", []))
        except Exception:
            pass

    all_files = [f for f in out_dir.rglob("*") if f.is_file()]

    return TargetItem(
        id=f"synthetic-{folder_name}",
        name=f"Synthetic Target (Seed {req.seed}, {req.size})",
        target_type="synthetic",
        path=str(out_dir),
        file_count=len(all_files),
        flaw_count=flaws,
        decoy_count=decoys,
        seed=req.seed,
        size=req.size,
        ground_truth_path=str(gt_file),
        description=f"Generated multi-hop codebase with {flaws} seeded flaws and {decoys} decoy sanitizers.",
    )


@router.post("/surveyor-benchmark")
def run_surveyor_benchmark(
    req: SurveyorBenchmarkRequest,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Execute Tier 1 Surveyor static AST structural ranking benchmark (deterministic, 0 LLM tokens)."""
    script_path = MANTIS_ENGINE_DIR / "evals" / "surveyor_benchmark.py"
    if not script_path.exists():
        raise HTTPException(status_code=500, detail="surveyor_benchmark.py not found.")

    out_file = Path(f"/tmp/surveyor_out_{uuid.uuid4().hex[:8]}.json")
    cmd = ["python3", str(script_path), "--json-out", str(out_file)]

    if req.mode == "synthetic":
        cmd.append("--synthetic")
    else:
        if not req.target or not os.path.exists(req.target):
            raise HTTPException(status_code=400, detail=f"Target path does not exist: {req.target}")
        cmd += ["--target", req.target]
        if req.ground_truth and os.path.exists(req.ground_truth):
            cmd += ["--ground-truth", req.ground_truth]

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(MANTIS_ENGINE_DIR),
            capture_output=True,
            text=True,
            timeout=120,
        )
        if proc.returncode != 0:
            logger.error("surveyor_bench_failed", stdout=proc.stdout, stderr=proc.stderr)
            raise HTTPException(status_code=500, detail=f"Surveyor benchmark failed: {proc.stderr or proc.stdout}")

        if not out_file.exists():
            raise HTTPException(status_code=500, detail="Surveyor output JSON was not written.")

        data = json.loads(out_file.read_text())
        out_file.unlink(missing_ok=True)
        return {
            "status": "success",
            "stdout": proc.stdout,
            "metrics": data,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Surveyor benchmark timed out.")


@router.post("/stage-benchmark")
def run_stage_benchmark(
    req: StageBenchmarkRequest,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Run an isolated Mantis ADK stage benchmark (Tier 2 researcher or downstream stage gates)."""
    env = _get_provider_env()
    model = req.model or "gemini-3.5-flash-lite"
    if env.get("GEMINI_API_KEY") and not model.startswith("gemini/"):
        model = f"gemini/{model}"

    out_file = Path(f"/tmp/stage_bench_{uuid.uuid4().hex[:8]}.json")

    if req.stage == "research":
        script_path = MANTIS_ENGINE_DIR / "evals" / "research_eval.py"
        cmd = [
            "python3", str(script_path),
            "--model", model,
            "--effort", req.effort or "medium",
            "--toolset", req.toolset or "structural",
            "--json-out", str(out_file),
        ]
        if req.max_tokens:
            cmd += ["--max-tokens", str(req.max_tokens)]
    else:
        script_path = MANTIS_ENGINE_DIR / "evals" / "run_eval.py"
        cmd = [
            "python3", str(script_path),
            "--stage", req.stage,
            "--runs", str(req.runs or 1),
        ]

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(MANTIS_ENGINE_DIR),
            env=env,
            capture_output=True,
            text=True,
            timeout=600,
        )
        res_data = None
        if out_file.exists():
            try:
                res_data = json.loads(out_file.read_text())
                out_file.unlink(missing_ok=True)
            except Exception:
                pass

        return {
            "status": "completed" if proc.returncode == 0 else "failed",
            "exit_code": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "metrics": res_data,
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Stage benchmark execution timed out.")
