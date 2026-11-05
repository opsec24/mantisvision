"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FlaskConical,
  Sparkles,
  Zap,
  Play,
  CheckCircle2,
  AlertCircle,
  Folder,
  Layers,
  FileCode,
  Bug,
  ShieldCheck,
  ChevronRight,
  TrendingUp,
  Cpu,
  RefreshCw,
  Clock,
  Activity,
  Sliders,
  ExternalLink,
} from "lucide-react";
import { api } from "@/lib/api";

interface TargetItem {
  id: string;
  name: string;
  target_type: "builtin" | "synthetic";
  path: string;
  file_count: number;
  flaw_count?: number;
  decoy_count?: number;
  seed?: number;
  size?: string;
  ground_truth_path?: string;
  description: string;
}

export default function BenchmarksLabPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"targets" | "surveyor" | "stages">("targets");

  // Targets state
  const [targets, setTargets] = useState<TargetItem[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);

  // Generator state
  const [genSeed, setGenSeed] = useState(1001);
  const [genSize, setGenSize] = useState<"small" | "medium" | "large">("small");
  const [genName, setGenName] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genSuccess, setGenSuccess] = useState<string | null>(null);

  // Surveyor Benchmark state
  const [surveyorMode, setSurveyorMode] = useState<"synthetic" | "target">("synthetic");
  const [customTarget, setCustomTarget] = useState("");
  const [customGt, setCustomGt] = useState("");
  const [runningSurveyor, setRunningSurveyor] = useState(false);
  const [surveyorResult, setSurveyorResult] = useState<any | null>(null);
  const [surveyorError, setSurveyorError] = useState<string | null>(null);

  // Stage Benchmark state
  const [stageName, setStageName] = useState("research");
  const [stageModel, setStageModel] = useState("gemini-3.5-flash-lite");
  const [stageEffort, setStageEffort] = useState("medium");
  const [stageToolset, setStageToolset] = useState<"structural" | "baseline">("structural");
  const [runningStage, setRunningStage] = useState(false);
  const [stageResult, setStageResult] = useState<any | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);

  const loadTargets = async () => {
    setLoadingTargets(true);
    setTargetError(null);
    try {
      const res = await api.getLabTargets();
      setTargets(res);
    } catch (err: any) {
      setTargetError(err.message || "Failed to load targets");
    } finally {
      setLoadingTargets(false);
    }
  };

  useEffect(() => {
    loadTargets();
  }, []);

  const handleGenerateTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    setGenSuccess(null);
    setTargetError(null);
    try {
      const res = await api.generateSyntheticTarget({
        seed: genSeed,
        size: genSize,
        name: genName.trim() || undefined,
      });
      setGenSuccess(`Generated ${res.name} with ${res.flaw_count ?? 0} seeded flaws!`);
      setGenName("");
      await loadTargets();
    } catch (err: any) {
      setTargetError(err.message || "Failed to generate target");
    } finally {
      setGenerating(false);
    }
  };

  const handleRunSurveyor = async () => {
    setRunningSurveyor(true);
    setSurveyorError(null);
    setSurveyorResult(null);
    try {
      const res = await api.runSurveyorBenchmark({
        mode: surveyorMode,
        target: surveyorMode === "target" ? customTarget.trim() : undefined,
        ground_truth: surveyorMode === "target" ? customGt.trim() : undefined,
      });
      setSurveyorResult(res);
    } catch (err: any) {
      setSurveyorError(err.message || "Surveyor benchmark failed");
    } finally {
      setRunningSurveyor(false);
    }
  };

  const handleRunStage = async () => {
    setRunningStage(true);
    setStageError(null);
    setStageResult(null);
    try {
      const res = await api.runStageBenchmark({
        stage: stageName,
        model: stageModel,
        effort: stageEffort,
        toolset: stageToolset,
        runs: 1,
      });
      setStageResult(res);
    } catch (err: any) {
      setStageError(err.message || "Stage evaluation failed");
    } finally {
      setRunningStage(false);
    }
  };

  const handleQuickScan = (target: TargetItem) => {
    // Navigate to /scans/new with prefilled params
    const query = new URLSearchParams({
      source_type: "local",
      source_target: target.path,
      name: `Scan - ${target.name}`,
    });
    router.push(`/scans/new?${query.toString()}`);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* Header Banner */}
      <div className="glass-card rounded-3xl p-6 sm:p-8 text-white shadow-2xl relative overflow-hidden border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="space-y-2">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-mono font-medium">
              <FlaskConical className="w-3.5 h-3.5 text-amber-400" />
              <span>Security Swarm Evaluation &amp; Benchmark Lab</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Target Generation &amp; Benchmark Suite
            </h1>
            <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
              Generate synthetic multi-hop vulnerable codebases with seeded bugs and decoys,
              run deterministic Tier 1 AST structural ranking benchmarks, and evaluate ADK stage precision.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <Link
              href="/scans/new"
              className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-black transition-all shadow-md glow-amber-btn"
            >
              <Play className="w-4 h-4 text-slate-950" />
              <span>New Pipeline Scan</span>
            </Link>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-1 mt-6 border-b border-slate-800 pt-2 font-mono">
          <button
            onClick={() => setActiveTab("targets")}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition-all border-b-2 ${
              activeTab === "targets"
                ? "bg-slate-900/90 text-amber-400 border-amber-500"
                : "text-slate-400 hover:text-white border-transparent hover:bg-slate-900/50"
            }`}
          >
            <Folder className="w-4 h-4" />
            <span>Target Studio &amp; Corpora ({targets.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("surveyor")}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition-all border-b-2 ${
              activeTab === "surveyor"
                ? "bg-slate-900/90 text-amber-400 border-amber-500"
                : "text-slate-400 hover:text-white border-transparent hover:bg-slate-900/50"
            }`}
          >
            <Zap className="w-4 h-4 text-amber-400" />
            <span>Tier 1: Surveyor Benchmark (0 Tokens)</span>
          </button>
          <button
            onClick={() => setActiveTab("stages")}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition-all border-b-2 ${
              activeTab === "stages"
                ? "bg-slate-900/90 text-amber-400 border-amber-500"
                : "text-slate-400 hover:text-white border-transparent hover:bg-slate-900/50"
            }`}
          >
            <Cpu className="w-4 h-4 text-emerald-400" />
            <span>Tier 2: Stage-Level Evaluations</span>
          </button>
        </div>
      </div>

      {/* TAB 1: Synthetic Target Studio & Corpora */}
      {activeTab === "targets" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Target Generator Form */}
          <div className="glass-card border border-slate-800 rounded-2xl p-6 space-y-5 shadow-xl h-fit text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>Synthetic Codebase Generator</span>
              </h2>
              <span className="text-[11px] font-mono bg-amber-950/80 text-amber-300 px-2 py-0.5 rounded-md border border-amber-500/40">
                gen.py v2.0
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Generates a synthetic multi-hop application containing real vulnerable patterns
              (SQLi, IDOR, Weak Random, Path Traversal) plus demoted decoy sanitizers for honest scoring.
            </p>

            {targetError && (
              <div className="p-3 bg-rose-950/60 border border-rose-800/80 rounded-xl text-xs text-rose-300 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{targetError}</span>
              </div>
            )}

            {genSuccess && (
              <div className="p-3 bg-emerald-950/60 border border-emerald-800/80 rounded-xl text-xs text-emerald-300 flex items-start space-x-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{genSuccess}</span>
              </div>
            )}

            <form onSubmit={handleGenerateTarget} className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300 font-mono">Seed</label>
                  <div className="flex space-x-1.5 font-mono">
                    <button
                      type="button"
                      onClick={() => setGenSeed(1000 + Math.floor(Math.random() * 100))}
                      className="text-[10px] text-amber-400 hover:text-amber-300 underline"
                    >
                      Random Dev
                    </button>
                    <button
                      type="button"
                      onClick={() => setGenSeed(9000 + Math.floor(Math.random() * 100))}
                      className="text-[10px] text-amber-400 hover:text-amber-300 underline"
                    >
                      Holdout
                    </button>
                  </div>
                </div>
                <input
                  type="number"
                  required
                  value={genSeed}
                  onChange={(e) => setGenSeed(parseInt(e.target.value) || 1001)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-amber-500"
                />
                <span className="text-[10px] text-slate-500 font-mono">
                  {genSeed >= 1000 && genSeed < 1100 ? "Dev Seed (Tuning/Testing allowed)" : genSeed >= 9000 && genSeed < 9100 ? "Holdout Seed (One-shot verification only)" : "Custom Seed"}
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 font-mono">Size / Pad Modules</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["small", "medium", "large"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setGenSize(s)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold capitalize transition-all border ${
                        genSize === s
                          ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black border-amber-500 glow-amber-btn"
                          : "bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-slate-500 font-mono">
                  {genSize === "small" ? "~25 files (fits in context)" : genSize === "medium" ? "~60 files (tests navigation)" : "~120 files (stress test)"}
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 font-mono">Custom Target Name (optional)</label>
                <input
                  type="text"
                  value={genName}
                  onChange={(e) => setGenName(e.target.value)}
                  placeholder="e.g. dev_eval_corpus_march"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <button
                type="submit"
                disabled={generating}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-black transition-all shadow-md flex items-center justify-center space-x-2 disabled:opacity-50 glow-amber-btn"
              >
                {generating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Synthesizing Codebase...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-slate-950" />
                    <span>Generate Synthetic Target</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Targets List */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-white">Available Test Targets &amp; Corpora</h2>
                <p className="text-xs text-slate-400">Built-in test suites, seeded ground-truth targets, and synthetic codebases.</p>
              </div>
              <button
                onClick={loadTargets}
                disabled={loadingTargets}
                className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-900"
                title="Refresh list"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingTargets ? "animate-spin" : ""}`} />
              </button>
            </div>

            <div className="space-y-3">
              {targets.map((t) => (
                <div
                  key={t.id}
                  className="glass-card border border-slate-800 hover:border-amber-500/40 rounded-2xl p-5 transition-all shadow-xl space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider ${
                          t.target_type === "builtin"
                            ? "bg-sky-950/80 text-sky-300 border border-sky-700/60"
                            : "bg-amber-950/80 text-amber-300 border border-amber-500/60"
                        }`}>
                          {t.target_type}
                        </span>
                        <h3 className="text-sm font-bold text-white">{t.name}</h3>
                      </div>
                      <p className="text-xs text-slate-400">{t.description}</p>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleQuickScan(t)}
                        className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-black transition-all shadow-xs flex items-center space-x-1.5 glow-amber-btn"
                      >
                        <Play className="w-3.5 h-3.5 text-slate-950" />
                        <span>Scan Target</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800 text-xs">
                    <div className="p-2 rounded-xl bg-slate-950/80 border border-slate-800">
                      <span className="text-[10px] text-slate-500 block font-mono">Files</span>
                      <span className="font-mono font-bold text-white">{t.file_count}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950/80 border border-slate-800">
                      <span className="text-[10px] text-slate-500 block font-mono">Seeded Flaws</span>
                      <span className="font-mono font-bold text-rose-400">{t.flaw_count ?? "N/A"}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950/80 border border-slate-800">
                      <span className="text-[10px] text-slate-500 block font-mono">Decoys</span>
                      <span className="font-mono font-bold text-slate-400">{t.decoy_count ?? 0}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950/80 border border-slate-800 overflow-hidden">
                      <span className="text-[10px] text-slate-500 block font-mono">Local Path</span>
                      <span className="font-mono text-[10px] text-slate-400 truncate block" title={t.path}>
                        {t.path}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Surveyor Benchmark (Tier 1) */}
      {activeTab === "surveyor" && (
        <div className="space-y-6">
          <div className="glass-card border border-slate-800 rounded-2xl p-6 space-y-5 shadow-xl text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>Tier 1 — Surveyor Ranking Benchmark</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Deterministic, zero LLM tokens. Scores Phase-0 AST structural ranking against known ground truth files.
                </p>
              </div>
              <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 font-mono">
                0 Tokens / ~0.1s
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setSurveyorMode("synthetic")}
                className={`p-4 rounded-xl border text-left transition-all ${
                  surveyorMode === "synthetic"
                    ? "bg-slate-900 border-amber-500 text-white shadow-md ring-1 ring-amber-500/30"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                }`}
              >
                <div className="font-bold text-xs">Hermetic Self-Check (Synthetic Webapp)</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Generates an in-memory webapp with seeded files and decoys to verify ranking consistency.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSurveyorMode("target")}
                className={`p-4 rounded-xl border text-left transition-all ${
                  surveyorMode === "target"
                    ? "bg-slate-900 border-amber-500 text-white shadow-md ring-1 ring-amber-500/30"
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                }`}
              >
                <div className="font-bold text-xs">Custom Target + Ground Truth</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  Evaluate an external repository against a curated JSON ground-truth mapping.
                </div>
              </button>
            </div>

            {surveyorMode === "target" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 font-mono">Target Directory Path</label>
                  <input
                    type="text"
                    value={customTarget}
                    onChange={(e) => setCustomTarget(e.target.value)}
                    placeholder="/app/mantis_engine/test_targets"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-white focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1 font-mono">Ground Truth JSON Path</label>
                  <input
                    type="text"
                    value={customGt}
                    onChange={(e) => setCustomGt(e.target.value)}
                    placeholder="/app/mantis_engine/evals/ground_truth/juice_shop.json"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-white focus:border-amber-500"
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleRunSurveyor}
              disabled={runningSurveyor}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-black transition-all shadow-md flex items-center space-x-2 disabled:opacity-50 glow-amber-btn"
            >
              {runningSurveyor ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                  <span>Computing AST Slices...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 text-slate-950" />
                  <span>Run Surveyor Ranking Benchmark</span>
                </>
              )}
            </button>

            {surveyorError && (
              <div className="p-3 bg-rose-950/60 border border-rose-800/80 rounded-xl text-xs text-rose-300">
                {surveyorError}
              </div>
            )}
          </div>

          {/* Surveyor Results Card */}
          {surveyorResult?.metrics && (
            <div className="glass-card border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl text-slate-100">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-bold text-white">Surveyor Ranking Report</h3>
                  <span className="text-[11px] font-mono text-slate-400">
                    Snapshot: {surveyorResult.metrics.snapshot_id} | Version: {surveyorResult.metrics.surveyor_version}
                  </span>
                </div>
                <div className="flex items-center space-x-2 font-mono">
                  <span className="text-xs font-bold text-emerald-300 bg-emerald-950/80 px-3 py-1 rounded-full border border-emerald-700/60 glow-emerald-repro">
                    MRR: {surveyorResult.metrics.mrr}
                  </span>
                  <span className="text-xs font-bold text-amber-300 bg-amber-950/80 px-3 py-1 rounded-full border border-amber-500/60 font-mono">
                    Coverage: {(surveyorResult.metrics.coverage_ceiling * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              {/* KPI Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-[10px] text-slate-500 block font-mono">Recall @ 1</span>
                  <span className="text-lg font-mono font-bold text-white">
                    {(surveyorResult.metrics.recall?.["recall@1"] * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-[10px] text-slate-500 block font-mono">Recall @ 5</span>
                  <span className="text-lg font-mono font-bold text-white">
                    {(surveyorResult.metrics.recall?.["recall@5"] * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-[10px] text-slate-500 block font-mono">nDCG @ 3</span>
                  <span className="text-lg font-mono font-bold text-amber-400">
                    {surveyorResult.metrics.ndcg?.["ndcg@3"]}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-[10px] text-slate-500 block font-mono">Elapsed Time</span>
                  <span className="text-lg font-mono font-bold text-emerald-400">
                    {surveyorResult.metrics.survey_provenance?.elapsed_seconds}s
                  </span>
                </div>
              </div>

              {/* Placements Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-white">Ground-Truth Target Placement in Slices</h4>
                <div className="border border-slate-800 rounded-xl overflow-hidden">
                  <table className="min-w-full divide-y divide-slate-800 text-xs">
                    <thead className="bg-slate-950 text-slate-400 font-mono">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Finding ID</th>
                        <th className="px-3 py-2 text-left font-semibold">Vulnerability Class</th>
                        <th className="px-3 py-2 text-left font-semibold">File Location</th>
                        <th className="px-3 py-2 text-center font-semibold">Slice Rank</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 bg-slate-900/60 font-mono">
                      {surveyorResult.metrics.per_file?.map((pf: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-800/40">
                          <td className="px-3 py-2 font-bold text-amber-400">{pf.id}</td>
                          <td className="px-3 py-2 text-slate-300 capitalize">{pf.class?.replace("_", " ")}</td>
                          <td className="px-3 py-2 text-slate-400 truncate max-w-xs">{pf.file}</td>
                          <td className="px-3 py-2 text-center">
                            <span className="px-2 py-0.5 rounded-md bg-amber-950/80 text-amber-300 font-bold border border-amber-500/40">
                              #{pf.rank}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Slices emitted */}
              {surveyorResult.metrics.slice_order && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-white">Emitted Slices &amp; Risk Weights</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {surveyorResult.metrics.slice_order.map((sl: any, i: number) => (
                      <div key={i} className="p-3 rounded-xl border border-slate-800 bg-slate-950/80 text-xs space-y-1">
                        <div className="flex items-center justify-between font-mono">
                          <span className="font-bold text-amber-400">Priority #{sl.priority}</span>
                          <span className="text-[10px] bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded text-slate-400">Risk: {sl.risk_score}</span>
                        </div>
                        <div className="font-semibold text-slate-200 truncate">{sl.archetype}</div>
                        <div className="font-mono text-[10px] text-slate-500 truncate">{sl.root}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Stage Evaluations (Tier 2) */}
      {activeTab === "stages" && (
        <div className="glass-card border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl text-slate-100">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-white flex items-center space-x-2">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <span>Tier 2 — ADK Stage-Level Benchmarking</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Judges individual pipeline stages in isolation (researcher, critic, deduplicator, reviewer, reproducer)
              so regressions are attributed to the exact stage that caused them.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 font-mono">Stage</label>
              <select
                value={stageName}
                onChange={(e) => setStageName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono font-medium text-white focus:border-amber-500"
              >
                <option value="research">research (Tier-2 Researcher)</option>
                <option value="review">review (Verdict Accuracy)</option>
                <option value="critic">critic (Adversarial Challenge)</option>
                <option value="dedupe">dedupe (Finding Clustering)</option>
                <option value="calibrate">calibrate (Severity Calibration)</option>
                <option value="reproduce">reproduce (PoC Verification)</option>
                <option value="patch">patch (Remediation Diff)</option>
                <option value="report">report (Executive SARIF)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 font-mono">Model</label>
              <input
                type="text"
                value={stageModel}
                onChange={(e) => setStageModel(e.target.value)}
                placeholder="gemini-3.5-flash-lite"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-white focus:border-amber-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 font-mono">Effort</label>
              <select
                value={stageEffort}
                onChange={(e) => setStageEffort(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-medium text-white focus:border-amber-500"
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>

            {stageName === "research" && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 font-mono">Toolset A/B</label>
                <select
                  value={stageToolset}
                  onChange={(e) => setStageToolset(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-medium text-white focus:border-amber-500"
                >
                  <option value="structural">structural (AST symbols &amp; callers)</option>
                  <option value="baseline">baseline (plain file reading)</option>
                </select>
              </div>
            )}
          </div>

          <button
            onClick={handleRunStage}
            disabled={runningStage}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-black transition-all shadow-md flex items-center space-x-2 disabled:opacity-50 glow-amber-btn"
          >
            {runningStage ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                <span>Running ADK Stage Benchmark...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 text-slate-950" />
                <span>Execute Stage Evaluation</span>
              </>
            )}
          </button>

          {stageError && (
            <div className="p-3 bg-rose-950/60 border border-rose-800/80 rounded-xl text-xs text-rose-300">
              {stageError}
            </div>
          )}

          {stageResult && (
            <div className="space-y-3 pt-3 border-t border-slate-800">
              <h3 className="text-xs font-bold text-white">Stage Evaluation Log Output</h3>
              <pre className="p-4 rounded-xl bg-slate-950 text-slate-100 font-mono text-xs overflow-x-auto max-h-96 leading-relaxed border border-slate-800">
                {stageResult.stdout || stageResult.stderr || "Benchmark completed."}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
