"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  GitBranch,
  Folder,
  Cpu,
  DollarSign,
  Play,
  Key,
  Shield,
  AlertCircle,
  Sliders,
  CheckCircle2,
  PlusCircle,
  ExternalLink,
  Sparkles,
  Zap,
  Search,
  Filter,
  Box,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";

interface ProviderInfo {
  provider: string;
  api_key_masked?: string;
  api_base_url?: string;
  is_active: boolean;
}

interface CuratedModelDef {
  id: string;
  display_name: string;
  context_window: number;
  role: "fast" | "smart";
}

const MODEL_PRESETS = [
  { id: "gemini/gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite (Google AI)" },
  { id: "gemini/gemini-3.8-flash", label: "Gemini 3.8 Flash (Google AI)" },
  { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet (Anthropic)" },
  { id: "openai/gpt-4o", label: "GPT-4o (OpenAI)" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
  { id: "custom", label: "Custom (type below)" },
];

const SANDBOX_OPTIONS = [
  { id: "static-only", label: "Static Only", desc: "No code execution — fast, safe" },
  { id: "microsandbox", label: "MicroSandbox (Docker)", desc: "Isolated Docker execution for PoC" },
  { id: "gvisor", label: "gVisor", desc: "Kernel-level isolation for PoC" },
];

export default function NewScanPage() {
  const router = useRouter();

  // Source configuration
  const [scanName, setScanName] = useState("");
  const [sourceType, setSourceType] = useState<"git" | "local">("git");
  const [sourceTarget, setSourceTarget] = useState("");
  const [branch, setBranch] = useState("");
  const [gitToken, setGitToken] = useState("");

  // Mantis-native flags
  const [modelPreset, setModelPreset] = useState("gemini/gemini-3.5-flash-lite");
  const [customModel, setCustomModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<"low" | "medium" | "high">("medium");
  const [focus, setFocus] = useState("");
  const [excludePatterns, setExcludePatterns] = useState("");
  const [sandbox, setSandbox] = useState("static-only");
  const [maxTokens, setMaxTokens] = useState<number | "">("");
  const [resumeScan, setResumeScan] = useState(false);
  const [scanMode, setScanMode] = useState<"auto" | "whole" | "file-by-file" | "cross-functional">("auto");
  const [objective, setObjective] = useState("");
  const [seedReport, setSeedReport] = useState("");
  const [deterministicOnly, setDeterministicOnly] = useState(false);
  const [noReplan, setNoReplan] = useState(false);
  const [parallel, setParallel] = useState(1);
  const [maxLlmCalls, setMaxLlmCalls] = useState<number | "">("");
  const [showAdvancedMantis, setShowAdvancedMantis] = useState(false);

  // Budget
  const [budgetLimit, setBudgetLimit] = useState(5.0);

  // Audit Mode
  const [freshScan, setFreshScan] = useState(false);

  // Providers & Whitelisted Models
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [preset, setPreset] = useState<string>("ollama");
  const [showCustomPhases, setShowCustomPhases] = useState(false);

  // Per-phase model assignments
  const [phaseModels, setPhaseModels] = useState<Record<string, string>>({
    recon: "",
    threat_model: "",
    research: "",
    critic: "",
    reproduce: "",
    patch: "",
  });

  // Per-phase reasoning efforts
  const [phaseEfforts, setPhaseEfforts] = useState<Record<string, "low" | "medium" | "high">>({
    recon: "low",
    threat_model: "medium",
    research: "high",
    critic: "high",
    reproduce: "high",
    patch: "high",
  });

  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [whitelistSuccessMsg, setWhitelistSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refresh data from backend
  const loadData = async () => {
    try {
      const [provList, modelList] = await Promise.all([
        api.getProviders().catch(() => []),
        api.getModels().catch(() => []),
      ]);
      setProviders(provList);
      const enabled = modelList.filter((m) => m.is_enabled);
      setAvailableModels(enabled);

      return { provList, enabled };
    } catch {
      return { provList: [], enabled: [] };
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const st = sp.get("source_type");
      const target = sp.get("source_target");
      const name = sp.get("name");
      if (st === "local" || st === "git") setSourceType(st);
      if (target) setSourceTarget(target);
      if (name) setScanName(name);
    }

    loadData().then(({ provList, enabled }) => {
      // Auto-select first configured provider with models
      const hasOllama = isProviderConfigured("ollama", provList);
      const hasOpenAI = isProviderConfigured("openai", provList);
      const hasAnthropic = isProviderConfigured("anthropic", provList);
      const hasGoogle = isProviderConfigured("google", provList);

      let initialPreset = "custom";
      if (hasOllama && enabled.some((m) => m.provider === "ollama")) {
        initialPreset = "ollama";
      } else if (hasOpenAI && enabled.some((m) => m.provider === "openai")) {
        initialPreset = "openai";
      } else if (hasAnthropic && enabled.some((m) => m.provider === "anthropic")) {
        initialPreset = "anthropic";
      } else if (hasGoogle && enabled.some((m) => m.provider === "google")) {
        initialPreset = "gemini";
      } else if (enabled.length > 0) {
        initialPreset = "frontier";
      }

      applyPreset(initialPreset, enabled);
    });
  }, []);

  const isProviderConfigured = (pName: string, provList: ProviderInfo[] = providers): boolean => {
    const p = provList.find((item) => item.provider === pName);
    if (!p) return false;
    if (pName === "ollama") {
      return Boolean((p.api_key_masked && p.api_key_masked.trim()) || (p.api_base_url && p.api_base_url.trim()));
    }
    return Boolean(p.api_key_masked && p.api_key_masked.trim());
  };

  const getProviderModels = (pName: string, models: any[] = availableModels): any[] => {
    return models.filter((m) => m.provider === pName);
  };

  // Curated recommended models per provider
  const curatedRecommendations: Record<string, CuratedModelDef[]> = {
    ollama: [
      {
        id: "ollama/deepseek-v4.1-flash",
        display_name: "DeepSeek V4.1 Flash (Ollama Cloud)",
        context_window: 128000,
        role: "fast",
      },
      {
        id: "ollama/deepseek-v4-pro:0813",
        display_name: "DeepSeek V4 Pro (Ollama Cloud)",
        context_window: 128000,
        role: "smart",
      },
    ],
    openai: [
      {
        id: "openai/gpt-4o-mini",
        display_name: "GPT-4o Mini",
        context_window: 128000,
        role: "fast",
      },
      {
        id: "openai/gpt-4o",
        display_name: "GPT-4o",
        context_window: 128000,
        role: "smart",
      },
    ],
    anthropic: [
      {
        id: "anthropic/claude-3-5-haiku",
        display_name: "Claude 3.5 Haiku",
        context_window: 200000,
        role: "fast",
      },
      {
        id: "anthropic/claude-3-5-sonnet",
        display_name: "Claude 3.5 Sonnet",
        context_window: 200000,
        role: "smart",
      },
    ],
    gemini: [
      {
        id: "gemini/gemini-1.5-flash",
        display_name: "Gemini 1.5 Flash (1M Ctx)",
        context_window: 1048576,
        role: "fast",
      },
      {
        id: "gemini/gemini-1.5-pro",
        display_name: "Gemini 1.5 Pro",
        context_window: 1048576,
        role: "smart",
      },
    ],
  };

  const applyPreset = (selectedPreset: string, models: any[] = availableModels) => {
    setPreset(selectedPreset);
    if (models.length === 0) return;

    const findModel = (predicate: (m: any) => boolean, fallback: string) => {
      const found = models.find(predicate);
      return found ? found.id : (models[0]?.id || fallback);
    };

    if (selectedPreset === "ollama") {
      const ollamaModels = models.filter((m) => m.provider === "ollama");
      const fast = findModel(
        (m) => m.provider === "ollama" && (m.id.includes("flash") || m.id.includes("nano") || m.id.includes("mini")),
        ollamaModels[0]?.id || models[0]?.id
      );
      const smart = findModel(
        (m) => m.provider === "ollama" && (m.id.includes("pro") || m.id.includes("code") || m.id.includes("large") || m.id.includes("120b")),
        ollamaModels[ollamaModels.length - 1]?.id || fast
      );
      setPhaseModels({
        recon: fast,
        threat_model: smart,
        research: smart,
        critic: smart,
        reproduce: smart,
        patch: smart,
      });
      setPhaseEfforts({
        recon: "low",
        threat_model: "medium",
        research: "high",
        critic: "high",
        reproduce: "high",
        patch: "high",
      });
    } else if (selectedPreset === "openai") {
      const fast = findModel((m) => m.provider === "openai" && m.id.includes("mini"), models[0]?.id);
      const smart = findModel((m) => m.provider === "openai" && (m.id.includes("gpt-4o") || m.id.includes("o1")), fast);
      setPhaseModels({
        recon: fast,
        threat_model: fast,
        research: smart,
        critic: smart,
        reproduce: smart,
        patch: smart,
      });
      setPhaseEfforts({
        recon: "low",
        threat_model: "medium",
        research: "high",
        critic: "high",
        reproduce: "high",
        patch: "high",
      });
    } else if (selectedPreset === "anthropic") {
      const fast = findModel((m) => m.provider === "anthropic" && m.id.includes("haiku"), models[0]?.id);
      const smart = findModel((m) => m.provider === "anthropic" && m.id.includes("sonnet"), fast);
      setPhaseModels({
        recon: fast,
        threat_model: smart,
        research: smart,
        critic: smart,
        reproduce: smart,
        patch: smart,
      });
      setPhaseEfforts({
        recon: "low",
        threat_model: "medium",
        research: "high",
        critic: "high",
        reproduce: "high",
        patch: "high",
      });
    } else if (selectedPreset === "gemini") {
      const fast = findModel((m) => m.provider === "google" && m.id.includes("flash"), models[0]?.id);
      const smart = findModel((m) => m.provider === "google" && m.id.includes("pro"), fast);
      setPhaseModels({
        recon: fast,
        threat_model: fast,
        research: smart,
        critic: smart,
        reproduce: smart,
        patch: smart,
      });
      setPhaseEfforts({
        recon: "low",
        threat_model: "medium",
        research: "high",
        critic: "high",
        reproduce: "high",
        patch: "high",
      });
    } else if (selectedPreset === "frontier") {
      const fast = findModel((m) => m.id.includes("flash") || m.id.includes("mini") || m.id.includes("haiku"), models[0]?.id);
      const smart = findModel((m) => m.id.includes("sonnet") || m.id.includes("gpt-4o") || m.id.includes("pro"), fast);
      setPhaseModels({
        recon: fast,
        threat_model: smart,
        research: smart,
        critic: smart,
        reproduce: smart,
        patch: smart,
      });
      setPhaseEfforts({
        recon: "low",
        threat_model: "medium",
        research: "high",
        critic: "high",
        reproduce: "high",
        patch: "high",
      });
    }
  };

  // Add missing curated model to whitelist directly
  const handleWhitelistCuratedModel = async (modelDef: CuratedModelDef, targetProvider: string) => {
    setActionLoading(true);
    setWhitelistSuccessMsg(null);
    setError(null);

    try {
      const prov = targetProvider === "gemini" ? "google" : targetProvider;
      await api.addModel({
        id: modelDef.id,
        provider: prov,
        display_name: modelDef.display_name,
        context_window: modelDef.context_window,
        is_enabled: true,
      });

      const { enabled } = await loadData();
      applyPreset(preset, enabled);
      setWhitelistSuccessMsg(`Model "${modelDef.display_name}" added to whitelist and assigned to stages!`);
      setTimeout(() => setWhitelistSuccessMsg(null), 5000);
    } catch (err: any) {
      setError(`Failed to add model to whitelist: ${err.message || err}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceTarget.trim()) {
      setError("Please provide a repository URL or local server directory.");
      return;
    }

    setError(null);
    setLoading(true);

    // Resolve effective model
    const effectiveModel = modelPreset === "custom" ? customModel.trim() || undefined : modelPreset || undefined;

    // Parse exclude patterns
    const excludeList = excludePatterns
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await api.createScan({
        name: scanName.trim() || undefined,
        source_type: sourceType,
        source_target: sourceTarget.trim(),
        branch: sourceType === "git" ? branch.trim() : undefined,
        git_token: gitToken.trim() ? gitToken.trim() : undefined,
        budget_limit_usd: budgetLimit,
        fresh: freshScan,
        // Mantis-native flags
        model: effectiveModel,
        reasoning_effort: reasoningEffort,
        focus: focus.trim() || undefined,
        exclude: excludeList.length > 0 ? excludeList : undefined,
        sandbox: sandbox,
        max_tokens: maxTokens !== "" ? maxTokens : undefined,
        resume: resumeScan,
        scan_mode: scanMode,
        objective: objective.trim() || undefined,
        seed_report: seedReport.trim() || undefined,
        deterministic_only: deterministicOnly,
        no_replan: noReplan,
        parallel: parallel > 1 ? parallel : undefined,
        max_llm_calls: maxLlmCalls !== "" ? Number(maxLlmCalls) : undefined,
      });

      router.push(`/scans/${res.id}`);
    } catch (err: any) {
      setError(err.message || "Failed to initialize scan.");
      setLoading(false);
    }
  };

  const ollamaConfig = providers.find((p) => p.provider === "ollama");
  const isOllamaCloud = Boolean(ollamaConfig?.api_base_url?.includes("ollama.com") || ollamaConfig?.api_key_masked);

  // Missing recommended models for current active preset
  const currentRecommendations = curatedRecommendations[preset] || [];
  const missingCuratedModels = currentRecommendations.filter(
    (rec) => !availableModels.some((m) => m.id === rec.id)
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="border-b border-purple-100/90 pb-3">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-purple-600"></span>
          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
            Pipeline Configuration
          </span>
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 mt-1 flex items-center space-x-2">
          <span>Launch Security Audit</span>
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Configure repository source ingestion, Google Mantis ADK flags, and hard financial guardrails.
        </p>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start space-x-2.5 text-xs text-rose-800 shadow-xs">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {whitelistSuccessMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center space-x-2 text-xs text-emerald-800 shadow-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{whitelistSuccessMsg}</span>
        </div>
      )}

      <form onSubmit={handleLaunch} className="space-y-6">
        {/* Section 0: Audit Identification */}
        <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-6 space-y-4 shadow-xs backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <Shield className="w-4 h-4 text-purple-700" />
              <span>Audit Identification</span>
            </h2>
            <span className="text-[11px] text-slate-400">Custom label for tracking &amp; model benchmark comparison</span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
              <span>Scan Name</span>
              <span className="text-[11px] text-slate-400 font-normal">Optional (defaults to repository name)</span>
            </label>
            <input
              type="text"
              value={scanName}
              onChange={(e) => setScanName(e.target.value)}
              placeholder="e.g. JuiceShop DeepSeek-V4 Audit, sBank-v2.1-Security-Review"
              className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 transition-all font-mono"
            />
          </div>
        </div>

        {/* Section 1: Ingestion Target */}
        <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-6 space-y-5 shadow-xs backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <GitBranch className="w-4 h-4 text-purple-700" />
              <span>Target Source Code</span>
            </h2>
            <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => setSourceType("git")}
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg font-bold transition-all ${
                  sourceType === "git" ? "bg-purple-700 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>Git Remote</span>
              </button>
              <button
                type="button"
                onClick={() => setSourceType("local")}
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg font-bold transition-all ${
                  sourceType === "local" ? "bg-purple-700 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Folder className="w-3.5 h-3.5" />
                <span>Local Workspace</span>
              </button>
            </div>
          </div>

          {/* Quick Target Presets */}
          <div className="flex flex-wrap items-center gap-2 pt-1 pb-1">
            <span className="text-[11px] font-semibold text-slate-400">Quick Test Targets:</span>
            <button
              type="button"
              onClick={() => {
                setSourceType("local");
                setSourceTarget("/app/mantis_engine/test_targets");
                setScanName("Built-in Test Suite (Flask & Vault)");
              }}
              className="px-2.5 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 text-xs font-mono font-medium transition-colors"
            >
              🧪 test_targets
            </button>
            <button
              type="button"
              onClick={() => {
                setSourceType("local");
                setSourceTarget("/app/mantis_engine/evals/research_target");
                setScanName("Mantis 26-File Seeded Corpus");
              }}
              className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-mono font-medium transition-colors"
            >
              🎯 research_target
            </button>
            <button
              type="button"
              onClick={() => {
                setSourceType("git");
                setSourceTarget("https://github.com/juice-shop/juice-shop.git");
                setScanName("OWASP Juice Shop Audit");
              }}
              className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-mono font-medium transition-colors"
            >
              🧃 Juice Shop
            </button>
            <Link
              href="/benchmarks"
              className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 text-xs font-mono font-medium transition-colors flex items-center space-x-1"
            >
              <Sparkles className="w-3 h-3 text-amber-600" />
              <span>Target Studio &amp; Benchmarks →</span>
            </Link>
          </div>

          {sourceType === "git" ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Git Repository URL
                </label>
                <input
                  type="text"
                  required
                  value={sourceTarget}
                  onChange={(e) => setSourceTarget(e.target.value)}
                  placeholder="https://github.com/juice-shop/juice-shop.git"
                  className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 font-mono transition-all"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Branch / Tag / Commit
                  </label>
                  <input
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="e.g. main, master (optional)"
                    className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 font-mono transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                    <span>Personal Access Token</span>
                    <span className="text-[11px] text-slate-400 font-normal">Optional</span>
                  </label>
                  <div className="relative">
                    <Key className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="password"
                      value={gitToken}
                      onChange={(e) => setGitToken(e.target.value)}
                      placeholder="ghp_••••••••••••••••••••"
                      className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 font-mono transition-all"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Mounted Server Directory Path
              </label>
              <input
                type="text"
                required
                value={sourceTarget}
                onChange={(e) => setSourceTarget(e.target.value)}
                placeholder="/Users/username/project or /data/repos/my-repo"
                className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 font-mono transition-all"
              />
            </div>
          )}
        </div>

        {/* Section 2: Mantis ADK Engine Flags */}
        <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-6 space-y-5 shadow-xs backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <Cpu className="w-4 h-4 text-purple-700" />
              <span>Google Mantis ADK Engine Flags</span>
            </h2>
            <span className="text-[11px] text-purple-700 font-mono bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md">
              Mantis Native
            </span>
          </div>

          {/* Model Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-700">
                Model Architecture
              </label>
              {providers.find((p) => p.provider === "ollama")?.is_active && (
                <span className="flex items-center space-x-1.5 text-[11px] font-mono text-purple-700 bg-purple-50 px-2.5 py-0.5 rounded-full border border-purple-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Ollama Cloud Connected (https://ollama.com)</span>
                </span>
              )}
            </div>

            {/* Whitelisted Models from Settings (Ollama Cloud & Google) */}
            {availableModels.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                  Your Configured &amp; Whitelisted Models ({availableModels.length})
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {availableModels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setModelPreset(m.id)}
                      className={`px-3 py-2 rounded-xl border text-xs text-left font-medium transition-all ${
                        modelPreset === m.id
                          ? "bg-purple-700 border-purple-700 text-white shadow-xs ring-2 ring-purple-300"
                          : "bg-white border-slate-200 text-slate-700 hover:border-purple-300 hover:bg-purple-50/50"
                      }`}
                    >
                      <div className="font-bold truncate">{m.display_name || m.id}</div>
                      <div className={`text-[10px] font-mono truncate mt-0.5 ${modelPreset === m.id ? "text-purple-200" : "text-slate-400"}`}>
                        {m.provider} &bull; {m.id}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Standard Cloud Presets */}
            <div className="space-y-1.5 pt-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
                Standard Cloud Presets
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {MODEL_PRESETS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModelPreset(m.id)}
                    className={`px-3 py-2 rounded-xl border text-xs text-left font-medium transition-all ${
                      modelPreset === m.id
                        ? "bg-purple-700 border-purple-700 text-white shadow-xs ring-2 ring-purple-300"
                        : "bg-slate-50 border-slate-200 text-slate-700 hover:border-purple-300 hover:bg-white"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {modelPreset === "custom" && (
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="e.g. ollama/deepseek-v4.1-flash, openai/gpt-4o-mini"
                className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 font-mono transition-all mt-1"
              />
            )}
          </div>

          {/* Reasoning Effort */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700">
              Reasoning Effort
            </label>
            <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200 text-xs gap-1">
              {(["low", "medium", "high"] as const).map((eff) => (
                <button
                  key={eff}
                  type="button"
                  onClick={() => setReasoningEffort(eff)}
                  className={`px-4 py-1.5 rounded-lg capitalize font-bold transition-all ${
                    reasoningEffort === eff
                      ? "bg-purple-700 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {eff}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              Controls thinking budget per LLM call. <strong>High</strong> = deeper reasoning but more tokens.
            </p>
          </div>

          {/* Focus */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700 flex items-center space-x-1">
              <Search className="w-3.5 h-3.5 text-purple-600" />
              <span>Focus Directive</span>
              <span className="text-[11px] text-slate-400 font-normal ml-1">Optional</span>
            </label>
            <input
              type="text"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="e.g. look for IDOR and broken authentication, find SSRF vulnerabilities"
              className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 font-mono transition-all"
            />
            <p className="text-[11px] text-slate-500">
              Direct Mantis to focus on specific vulnerability classes or attack surfaces.
            </p>
          </div>

          {/* Exclude Patterns */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700 flex items-center space-x-1">
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <span>Exclude Patterns</span>
              <span className="text-[11px] text-slate-400 font-normal ml-1">Comma-separated, optional</span>
            </label>
            <input
              type="text"
              value={excludePatterns}
              onChange={(e) => setExcludePatterns(e.target.value)}
              placeholder="e.g. vendor, testdata, *.min.js, node_modules"
              className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 font-mono transition-all"
            />
          </div>

          {/* Sandbox Mode */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700 flex items-center space-x-1">
              <Box className="w-3.5 h-3.5 text-slate-600" />
              <span>Sandbox Mode</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {SANDBOX_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSandbox(opt.id)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    sandbox === opt.id
                      ? "bg-purple-700 border-purple-700 text-white"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:border-purple-300"
                  }`}
                >
                  <div className={`font-bold text-xs ${sandbox === opt.id ? "text-white" : "text-slate-800"}`}>
                    {opt.label}
                  </div>
                  <div className={`text-[10px] mt-0.5 ${sandbox === opt.id ? "text-purple-200" : "text-slate-400"}`}>
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Token Budget */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700 flex items-center justify-between">
              <span>Token Budget Ceiling</span>
              <span className="text-[11px] text-slate-400 font-normal">Optional</span>
            </label>
            <input
              type="number"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value ? parseInt(e.target.value) : "")}
              placeholder="e.g. 500000 (leave blank for no limit)"
              min={10000}
              step={10000}
              className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 font-mono transition-all"
            />
          </div>

          {/* Resume */}
          <label className="flex items-start space-x-3 cursor-pointer group pt-1 border-t border-slate-100">
            <input
              type="checkbox"
              checked={resumeScan}
              onChange={(e) => setResumeScan(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-purple-700 focus:ring-purple-500 cursor-pointer"
            />
            <div className="space-y-0.5">
              <div className="flex items-center space-x-1.5">
                <RefreshCw className="w-3.5 h-3.5 text-purple-600" />
                <span className="text-xs font-bold text-slate-800 group-hover:text-purple-900 transition-colors">
                  Resume from Last Checkpoint
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                If a previous scan workspace exists for this target, resume from where it left off rather than starting fresh.
              </p>
            </div>
          </label>

          {/* Advanced Mantis ADK Controls Toggle */}
          <div className="pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowAdvancedMantis(!showAdvancedMantis)}
              className="flex items-center justify-between w-full py-1 text-xs font-bold text-purple-700 hover:text-purple-900"
            >
              <div className="flex items-center space-x-2">
                <Sliders className="w-3.5 h-3.5" />
                <span>Advanced Mantis ADK Engine Flags ({showAdvancedMantis ? "Hide" : "Show"})</span>
              </div>
              <span className="text-[10px] font-mono bg-purple-50 px-2 py-0.5 rounded text-purple-600">
                mode: {scanMode} | {parallel} worker(s)
              </span>
            </button>

            {showAdvancedMantis && (
              <div className="mt-4 space-y-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                {/* Scan Mode */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Scan Mode (--scan-mode)
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: "auto", label: "Auto", desc: "Adaptive campaign plan" },
                      { id: "whole", label: "Whole", desc: "Entire repo single graph" },
                      { id: "file-by-file", label: "File-by-File", desc: "Isolated single-file hunt" },
                      { id: "cross-functional", label: "Cross-Functional", desc: "Multi-file defect chaining" },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setScanMode(m.id as any)}
                        className={`p-2.5 rounded-lg border text-left text-xs transition-all ${
                          scanMode === m.id
                            ? "bg-purple-700 border-purple-700 text-white"
                            : "bg-white border-slate-200 text-slate-700 hover:border-purple-300"
                        }`}
                      >
                        <div className="font-bold">{m.label}</div>
                        <div className={`text-[10px] mt-0.5 ${scanMode === m.id ? "text-purple-200" : "text-slate-400"}`}>
                          {m.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Campaign Objective */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Natural Language Objective (--objective)
                  </label>
                  <input
                    type="text"
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    placeholder="e.g. Find privilege escalation from customer to tenant admin"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-900 focus:outline-none focus:border-purple-600"
                  />
                  <p className="text-[10px] text-slate-400">
                    Steers research graph synthesis towards a specific security goal.
                  </p>
                </div>

                {/* Seed Report */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Variant Bug Hunting Report (--seed-report)
                  </label>
                  <input
                    type="text"
                    value={seedReport}
                    onChange={(e) => setSeedReport(e.target.value)}
                    placeholder="e.g. /app/reports/cve-2024-1234.md"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-900 focus:outline-none focus:border-purple-600"
                  />
                  <p className="text-[10px] text-slate-400">
                    Path to a prior bug report; Mantis will search for structural variants of the reported bug.
                  </p>
                </div>

                {/* Grid for Parallel & Limits */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700">
                      Parallel Campaigns Concurrency (--parallel)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={parallel}
                      onChange={(e) => setParallel(parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700">
                      Max LLM Calls Ceiling (--max-llm-calls)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={maxLlmCalls}
                      onChange={(e) => setMaxLlmCalls(e.target.value ? parseInt(e.target.value) : "")}
                      placeholder="e.g. 100 (leave blank for workflow default)"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono"
                    />
                  </div>
                </div>

                {/* Toggles */}
                <div className="pt-2 border-t border-slate-200 space-y-2">
                  <label className="flex items-center space-x-2 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deterministicOnly}
                      onChange={(e) => setDeterministicOnly(e.target.checked)}
                      className="rounded border-slate-300 text-purple-700 focus:ring-purple-500"
                    />
                    <span>Force Deterministic Archetype Synthesis (--deterministic-only)</span>
                  </label>

                  <label className="flex items-center space-x-2 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={noReplan}
                      onChange={(e) => setNoReplan(e.target.checked)}
                      className="rounded border-slate-300 text-purple-700 focus:ring-purple-500"
                    />
                    <span>Freeze Campaign Plan at Start (--no-replan) for exact reproducibility</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 3: Hard Cost Ceiling */}
        <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-6 space-y-5 shadow-xs backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <DollarSign className="w-4 h-4 text-amber-600" />
              <span>Hard Cost Ceiling</span>
            </h2>
            <span className="px-3 py-1 rounded-full text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 font-mono">
              ${budgetLimit.toFixed(2)} USD
            </span>
          </div>

          <div>
            <input
              type="range"
              min="0.50"
              max="20.00"
              step="0.50"
              value={budgetLimit}
              onChange={(e) => setBudgetLimit(parseFloat(e.target.value))}
              className="w-full accent-amber-600 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-slate-400 mt-1.5 font-medium">
              <span>$0.50 (Frugal)</span>
              <span>$5.00 (Standard)</span>
              <span>$10.00 (Deep Multi-Pass)</span>
              <span>$20.00 (Max)</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            If this audit exceeds the specified cost ceiling, the execution pipeline immediately halts with a{" "}
            <code className="text-amber-800 font-bold bg-amber-50 px-1 py-0.5 rounded border border-amber-200">budget_exceeded</code> safety state.
          </p>
        </div>

        {/* Section 4: Audit Mode & Knowledge Base Reset */}
        <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-6 space-y-4 shadow-xs backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-purple-700" />
              <span>Audit Mode &amp; Knowledge Base Reset</span>
            </h2>
          </div>
          <label className="flex items-start space-x-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={freshScan}
              onChange={(e) => setFreshScan(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-purple-700 focus:ring-purple-500 cursor-pointer"
            />
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-slate-800 group-hover:text-purple-900 transition-colors">
                Fresh Baseline Scan (Clean Slate)
              </span>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Purge and ignore any historical learnings, past reflections, or archived findings for this repository. Mantis will treat this as a brand-new first-time scan rather than a continuation pass.
              </p>
            </div>
          </label>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 px-4 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white font-bold text-sm rounded-xl flex items-center justify-center space-x-2 transition-all shadow-xs hover:-translate-y-0.5 cursor-pointer"
        >
          <Play className="w-4 h-4 fill-white" />
          <span>{loading ? "Initializing Scan Pipeline..." : "Start Autonomous Audit"}</span>
        </button>
      </form>
    </div>
  );
}
