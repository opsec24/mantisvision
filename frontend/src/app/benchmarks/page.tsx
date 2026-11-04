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
      <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 opacity-10 pointer-events-none bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-purple-400 via-transparent to-transparent"></div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="space-y-2">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-400/30 text-purple-200 text-xs font-mono font-medium">
              <FlaskConical className="w-3.5 h-3.5 text-purple-300" />
              <span>Google Mantis ADK Evaluation &amp; Benchmark Lab</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Target Generation &amp; Benchmark Suite
            </h1>
            <p className="text-sm text-purple-200/80 max-w-2xl leading-relaxed">
              Generate synthetic multi-hop vulnerable codebases with seeded bugs and decoys,
              run deterministic Tier 1 AST structural ranking benchmarks, and evaluate ADK stage precision.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <Link
              href="/scans/new"
              className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all shadow-md hover:shadow-lg"
            >
              <Play className="w-4 h-4" />
              <span>New Pipeline Scan</span>
            </Link>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-1 mt-6 border-b border-purple-800/60 pt-2">
          <button
            onClick={() => setActiveTab("targets")}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition-all border-b-2 ${
              activeTab === "targets"
                ? "bg-white/10 text-white border-purple-400"
                : "text-purple-300 hover:text-white border-transparent hover:bg-white/5"
            }`}
          >
            <Folder className="w-4 h-4" />
            <span>Target Studio &amp; Corpora ({targets.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("surveyor")}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition-all border-b-2 ${
              activeTab === "surveyor"
                ? "bg-white/10 text-white border-purple-400"
                : "text-purple-300 hover:text-white border-transparent hover:bg-white/5"
            }`}
          >
            <Zap className="w-4 h-4 text-amber-400" />
            <span>Tier 1: Surveyor Benchmark (0 Tokens)</span>
          </button>
          <button
            onClick={() => setActiveTab("stages")}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition-all border-b-2 ${
              activeTab === "stages"
                ? "bg-white/10 text-white border-purple-400"
                : "text-purple-300 hover:text-white border-transparent hover:bg-white/5"
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
          <div className="bg-white border border-purple-100 rounded-2xl p-6 space-y-5 shadow-xs h-fit">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <span>Synthetic Codebase Generator</span>
              </h2>
              <span className="text-[11px] font-mono bg-purple-50 text-purple-700 px-2 py-0.5 rounded-md border border-purple-200">
                gen.py v2.0
              </span>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Generates a synthetic multi-hop application containing real vulnerable patterns
              (SQLi, IDOR, Weak Random, Path Traversal) plus demoted decoy sanitizers for honest scoring.
            </p>

            {targetError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{targetError}</span>
              </div>
            )}

            {genSuccess && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700 flex items-start space-x-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{genSuccess}</span>
              </div>
            )}

            <form onSubmit={handleGenerateTarget} className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">Seed</label>
                  <div className="flex space-x-1.5">
                    <button
                      type="button"
                      onClick={() => setGenSeed(1000 + Math.floor(Math.random() * 100))}
                      className="text-[10px] text-purple-600 hover:text-purple-800 font-mono underline"
                    >
                      Random Dev
                    </button>
                    <button
                      type="button"
                      onClick={() => setGenSeed(9000 + Math.floor(Math.random() * 100))}
                      className="text-[10px] text-amber-600 hover:text-amber-800 font-mono underline"
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
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono text-slate-900 focus:outline-none focus:border-purple-600 focus:bg-white"
                />
                <span className="text-[10px] text-slate-400">
                  {genSeed >= 1000 && genSeed < 1100 ? "Dev Seed (Tuning/Testing allowed)" : genSeed >= 9000 && genSeed < 9100 ? "Holdout Seed (One-shot verification only)" : "Custom Seed"}
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Size / Pad Modules</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["small", "medium", "large"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setGenSize(s)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold capitalize transition-all border ${
                        genSize === s
                          ? "bg-purple-700 text-white border-purple-700"
                          : "bg-slate-50 text-slate-700 border-slate-200 hover:border-purple-300"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-slate-400">
                  {genSize === "small" ? "~25 files (fits in context)" : genSize === "medium" ? "~60 files (tests navigation)" : "~120 files (stress test)"}
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Custom Target Name (optional)</label>
                <input
                  type="text"
                  value={genName}
                  onChange={(e) => setGenName(e.target.value)}
                  placeholder="e.g. dev_eval_corpus_march"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono text-slate-900 focus:outline-none focus:border-purple-600 focus:bg-white"
                />
              </div>

              <button
                type="submit"
                disabled={generating}
                className="w-full py-2.5 rounded-xl bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                {generating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Synthesizing Codebase...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
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
                <h2 className="text-sm font-bold text-slate-900">Available Test Targets &amp; Corpora</h2>
                <p className="text-xs text-slate-500">Built-in test suites, seeded ground-truth targets, and synthetic codebases.</p>
              </div>
              <button
                onClick={loadTargets}
                disabled={loadingTargets}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                title="Refresh list"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingTargets ? "animate-spin" : ""}`} />
              </button>
            </div>

            <div className="space-y-3">
              {targets.map((t) => (
                <div
                  key={t.id}
                  className="bg-white border border-slate-200 hover:border-purple-300 rounded-2xl p-5 transition-all shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider ${
                          t.target_type === "builtin"
                            ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                            : "bg-purple-50 text-purple-700 border border-purple-200"
                        }`}>
                          {t.target_type}
                        </span>
                        <h3 className="text-sm font-bold text-slate-900">{t.name}</h3>
                      </div>
                      <p className="text-xs text-slate-500">{t.description}</p>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleQuickScan(t)}
                        className="px-3 py-1.5 rounded-xl bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold transition-all shadow-xs flex items-center space-x-1.5"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Scan Target</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-100 text-xs">
                    <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] text-slate-400 block font-medium">Files</span>
                      <span className="font-mono font-bold text-slate-800">{t.file_count}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] text-slate-400 block font-medium">Seeded Flaws</span>
                      <span className="font-mono font-bold text-rose-600">{t.flaw_count ?? "N/A"}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] text-slate-400 block font-medium">Decoys</span>
                      <span className="font-mono font-bold text-slate-600">{t.decoy_count ?? 0}</span>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-50 border border-slate-100 overflow-hidden">
                      <span className="text-[10px] text-slate-400 block font-medium">Local Path</span>
                      <span className="font-mono text-[10px] text-slate-700 truncate block" title={t.path}>
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
          <div className="bg-white border border-purple-100 rounded-2xl p-6 space-y-5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span>Tier 1 — Surveyor Ranking Benchmark</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Deterministic, zero LLM tokens. Scores Phase-0 AST structural ranking against known ground truth files.
                </p>
              </div>
              <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                0 Tokens / ~0.1s
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setSurveyorMode("synthetic")}
                className={`p-4 rounded-xl border text-left transition-all ${
                  surveyorMode === "synthetic"
                    ? "bg-purple-50 border-purple-600 text-purple-900"
                    : "bg-slate-50 border-slate-200 text-slate-700 hover:border-purple-300"
                }`}
              >
                <div className="font-bold text-xs">Hermetic Self-Check (Synthetic Webapp)</div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Generates an in-memory webapp with seeded files and decoys to verify ranking consistency.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSurveyorMode("target")}
                className={`p-4 rounded-xl border text-left transition-all ${
                  surveyorMode === "target"
                    ? "bg-purple-50 border-purple-600 text-purple-900"
                    : "bg-slate-50 border-slate-200 text-slate-700 hover:border-purple-300"
                }`}
              >
                <div className="font-bold text-xs">Custom Target + Ground Truth</div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Evaluate an external repository against a curated JSON ground-truth mapping.
                </div>
              </button>
            </div>

            {surveyorMode === "target" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Target Directory Path</label>
                  <input
                    type="text"
                    value={customTarget}
                    onChange={(e) => setCustomTarget(e.target.value)}
                    placeholder="/app/mantis_engine/test_targets"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Ground Truth JSON Path</label>
                  <input
                    type="text"
                    value={customGt}
                    onChange={(e) => setCustomGt(e.target.value)}
                    placeholder="/app/mantis_engine/evals/ground_truth/juice_shop.json"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleRunSurveyor}
              disabled={runningSurveyor}
              className="px-6 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold transition-all shadow-sm flex items-center space-x-2 disabled:opacity-50"
            >
              {runningSurveyor ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Computing AST Slices...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  <span>Run Surveyor Ranking Benchmark</span>
                </>
              )}
            </button>

            {surveyorError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                {surveyorError}
              </div>
            )}
          </div>

          {/* Surveyor Results Card */}
          {surveyorResult?.metrics && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-bold text-slate-900">Surveyor Ranking Report</h3>
                  <span className="text-[11px] font-mono text-slate-400">
                    Snapshot: {surveyorResult.metrics.snapshot_id} | Version: {surveyorResult.metrics.surveyor_version}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                    MRR: {surveyorResult.metrics.mrr}
                  </span>
                  <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-200">
                    Coverage: {(surveyorResult.metrics.coverage_ceiling * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              {/* KPI Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] text-slate-400 block font-medium">Recall @ 1</span>
                  <span className="text-lg font-mono font-bold text-slate-900">
                    {(surveyorResult.metrics.recall?.["recall@1"] * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] text-slate-400 block font-medium">Recall @ 5</span>
                  <span className="text-lg font-mono font-bold text-slate-900">
                    {(surveyorResult.metrics.recall?.["recall@5"] * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] text-slate-400 block font-medium">nDCG @ 3</span>
                  <span className="text-lg font-mono font-bold text-purple-700">
                    {surveyorResult.metrics.ndcg?.["ndcg@3"]}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] text-slate-400 block font-medium">Elapsed Time</span>
                  <span className="text-lg font-mono font-bold text-emerald-600">
                    {surveyorResult.metrics.survey_provenance?.elapsed_seconds}s
                  </span>
                </div>
              </div>

              {/* Placements Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-800">Ground-Truth Target Placement in Slices</h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Finding ID</th>
                        <th className="px-3 py-2 text-left font-semibold">Vulnerability Class</th>
                        <th className="px-3 py-2 text-left font-semibold">File Location</th>
                        <th className="px-3 py-2 text-center font-semibold">Slice Rank</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white font-mono">
                      {surveyorResult.metrics.per_file?.map((pf: any, i: number) => (
                        <tr key={i} className="hover:bg-purple-50/50">
                          <td className="px-3 py-2 font-bold text-purple-900">{pf.id}</td>
                          <td className="px-3 py-2 text-slate-700 capitalize">{pf.class?.replace("_", " ")}</td>
                          <td className="px-3 py-2 text-slate-600 truncate max-w-xs">{pf.file}</td>
                          <td className="px-3 py-2 text-center">
                            <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 font-bold">
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
                  <h4 className="text-xs font-bold text-slate-800">Emitted Slices &amp; Risk Weights</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {surveyorResult.metrics.slice_order.map((sl: any, i: number) => (
                      <div key={i} className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 text-xs space-y-1">
                        <div className="flex items-center justify-between font-mono">
                          <span className="font-bold text-purple-700">Priority #{sl.priority}</span>
                          <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded">Risk: {sl.risk_score}</span>
                        </div>
                        <div className="font-semibold text-slate-800 truncate">{sl.archetype}</div>
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
        <div className="bg-white border border-purple-100 rounded-2xl p-6 space-y-6 shadow-xs">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <Cpu className="w-4 h-4 text-emerald-600" />
              <span>Tier 2 — ADK Stage-Level Benchmarking</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Judges individual pipeline stages in isolation (researcher, critic, deduplicator, reviewer, reproducer)
              so regressions are attributed to the exact stage that caused them.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Stage</label>
              <select
                value={stageName}
                onChange={(e) => setStageName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-medium"
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
              <label className="text-xs font-semibold text-slate-700">Model</label>
              <input
                type="text"
                value={stageModel}
                onChange={(e) => setStageModel(e.target.value)}
                placeholder="gemini-3.5-flash-lite"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700">Effort</label>
              <select
                value={stageEffort}
                onChange={(e) => setStageEffort(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>

            {stageName === "research" && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Toolset A/B</label>
                <select
                  value={stageToolset}
                  onChange={(e) => setStageToolset(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium"
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
            className="px-6 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold transition-all shadow-sm flex items-center space-x-2 disabled:opacity-50"
          >
            {runningStage ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Running ADK Stage Benchmark...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>Execute Stage Evaluation</span>
              </>
            )}
          </button>

          {stageError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
              {stageError}
            </div>
          )}

          {stageResult && (
            <div className="space-y-3 pt-3 border-t border-slate-100">
              <h3 className="text-xs font-bold text-slate-800">Stage Evaluation Log Output</h3>
              <pre className="p-4 rounded-xl bg-slate-900 text-slate-100 font-mono text-xs overflow-x-auto max-h-96 leading-relaxed">
                {stageResult.stdout || stageResult.stderr || "Benchmark completed."}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
