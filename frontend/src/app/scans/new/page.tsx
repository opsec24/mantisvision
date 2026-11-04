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

export default function NewScanPage() {
  const router = useRouter();

  // Source configuration
  const [scanName, setScanName] = useState("");
  const [sourceType, setSourceType] = useState<"git" | "local">("git");
  const [sourceTarget, setSourceTarget] = useState("");
  const [branch, setBranch] = useState("");
  const [gitToken, setGitToken] = useState("");

  // Budget
  const [budgetLimit, setBudgetLimit] = useState(5.0);

  // Audit Mode
  const [freshScan, setFreshScan] = useState(false);

  // Providers & Whitelisted Models
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [preset, setPreset] = useState<string>("ollama");
  const [showCustomPhases, setShowCustomPhases] = useState(true);

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

    try {
      const res = await api.createScan({
        name: scanName.trim() || undefined,
        source_type: sourceType,
        source_target: sourceTarget.trim(),
        branch: sourceType === "git" ? branch.trim() : undefined,
        git_token: gitToken.trim() ? gitToken.trim() : undefined,
        budget_limit_usd: budgetLimit,
        fresh: freshScan,
        phase_models: {
          ...phaseModels,
          _efforts: phaseEfforts,
        },
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
          Configure repository source ingestion, autonomous agent routing strategy, and hard financial guardrails.
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

        {/* Section 2: Model Routing Strategy & Provider Tiering */}
        <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-6 space-y-5 shadow-xs backdrop-blur-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
                <Cpu className="w-4 h-4 text-purple-700" />
                <span>Provider Strategy &amp; Stage Optimization</span>
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Select a configured provider to auto-assign optimal models and reasoning efforts for each Mantis stage.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCustomPhases(!showCustomPhases)}
              className="text-xs font-semibold text-purple-700 hover:text-purple-800 underline self-start sm:self-auto"
            >
              {showCustomPhases ? "Hide Stage Details" : "Customize Per Stage"}
            </button>
          </div>

          {/* Provider Preset Selection Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {[
              {
                id: "ollama",
                label: isOllamaCloud ? "Ollama Cloud" : "Ollama Endpoint",
                providerKey: "ollama",
                description: isOllamaCloud ? "Endpoint with API Key (https://ollama.com)" : "Custom Host / Remote Endpoint",
                configured: isProviderConfigured("ollama"),
                whitelistedCount: getProviderModels("ollama").length,
              },
              {
                id: "openai",
                label: "OpenAI Tiered",
                providerKey: "openai",
                description: "GPT-4o Mini + GPT-4o Frontier",
                configured: isProviderConfigured("openai"),
                whitelistedCount: getProviderModels("openai").length,
              },
              {
                id: "anthropic",
                label: "Anthropic Tiered",
                providerKey: "anthropic",
                description: "Claude 3.5 Haiku + Sonnet",
                configured: isProviderConfigured("anthropic"),
                whitelistedCount: getProviderModels("anthropic").length,
              },
              {
                id: "gemini",
                label: "Google Gemini Tiered",
                providerKey: "google",
                description: "Gemini 1.5 Flash + Pro",
                configured: isProviderConfigured("google"),
                whitelistedCount: getProviderModels("google").length,
              },
              {
                id: "frontier",
                label: "Mantis Benchmark",
                providerKey: "multi",
                description: "Multi-Provider Frontier Synthesis",
                configured: availableModels.length > 0,
                whitelistedCount: availableModels.length,
              },
              {
                id: "custom",
                label: "Fully Custom",
                providerKey: "custom",
                description: "Manual Model & Effort Selection",
                configured: true,
                whitelistedCount: availableModels.length,
              },
            ].map((p) => {
              const active = preset === p.id;
              const disabled = !p.configured && p.whitelistedCount === 0;

              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    applyPreset(p.id);
                  }}
                  className={`p-3.5 rounded-xl text-left border transition-all flex flex-col justify-between relative ${
                    disabled
                      ? "bg-slate-100/60 border-dashed border-slate-200 opacity-60 cursor-not-allowed"
                      : active
                      ? "bg-purple-700 border-purple-700 text-white shadow-xs"
                      : "bg-slate-50/80 border-slate-200 text-slate-800 hover:border-purple-300 hover:bg-purple-50/40 cursor-pointer"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs">{p.label}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                        disabled
                          ? "bg-slate-200 text-slate-500"
                          : active
                          ? "bg-purple-800/80 text-purple-100"
                          : p.whitelistedCount > 0
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {disabled
                        ? "Key Required"
                        : p.whitelistedCount > 0
                        ? `${p.whitelistedCount} Whitelisted`
                        : "Key Ready"}
                    </span>
                  </div>
                  <p className={`text-[11px] mt-2 line-clamp-1 ${active ? "text-purple-200" : "text-slate-500"}`}>
                    {disabled ? "Configure API Key in Settings to unlock" : p.description}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Missing Curated Models Action Banner */}
          {missingCuratedModels.length > 0 && preset !== "custom" && isProviderConfigured(preset === "gemini" ? "google" : preset) && (
            <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50/70 border border-amber-200/80 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-amber-900 font-bold text-xs">
                  <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Curated Frontier Model Available for {preset.toUpperCase()}</span>
                </div>
                <span className="text-[10px] text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md font-mono">
                  Recommended for Mantis Precision
                </span>
              </div>
              <p className="text-[11px] text-slate-700 leading-relaxed">
                Your endpoint is configured, but the optimal frontier reasoning model for <strong>Researcher, Critic &amp; PoC Reproducer</strong> is not yet whitelisted:
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {missingCuratedModels.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleWhitelistCuratedModel(m, preset)}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-xs transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>+ Add &ldquo;{m.id.split("/")[1]}&rdquo; to Whitelist</span>
                  </button>
                ))}
                <Link
                  href="/settings"
                  className="text-[11px] text-amber-900 hover:underline inline-flex items-center space-x-1 ml-auto"
                >
                  <span>Manage in Settings</span>
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            </div>
          )}

          {/* Strategy Insight Banner */}
          <div className="p-3.5 bg-gradient-to-r from-purple-50/70 to-indigo-50/50 rounded-xl border border-purple-200/70 text-xs space-y-1.5">
            <div className="flex items-center space-x-2 text-purple-900 font-bold">
              <Zap className="w-4 h-4 text-purple-600" />
              <span>Google Mantis Allocation &amp; Reasoning Effort Strategy:</span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Mantis uses <strong>Low effort + High throughput models</strong> for Phase 1 (Recon &amp; Cartography) to process large codebases with zero token fatigue, and automatically scales to <strong>High reasoning effort + Frontier models</strong> for the Researcher, Critic, Dynamic PoC Reproducer, and Patching.
            </p>
          </div>

          {/* Per-phase Model Dropdowns & Effort Controls */}
          {showCustomPhases && (
            <div className="pt-2 border-t border-slate-100 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Phase-by-Phase Model &amp; Effort Assignment
                </span>
                <span className="text-[11px] text-slate-400">
                  Select model and reasoning effort per stage
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { phase: "recon", label: "Phase 1: Recon & Summarize", desc: "Cartography, History & Summary Tree", role: "fast" },
                  { phase: "threat_model", label: "Phase 2: Threat Modeling", desc: "Threat Matrix & Hunting Plan", role: "smart" },
                  { phase: "research", label: "Phase 3: Code Researcher", desc: "AST & Tool Exploration Loop", role: "smart" },
                  { phase: "critic", label: "Phase 4: Adversarial Critic", desc: "Peer Review & Negative Heuristics", role: "smart" },
                  { phase: "reproduce", label: "Phase 5: Exploit Reproducer", desc: "Docker Sandbox PoC Synthesis", role: "smart" },
                  { phase: "patch", label: "Phase 6: Remediation & Patch", desc: "Diff Generation & Fix Verification", role: "smart" },
                ].map(({ phase, label, desc, role }) => (
                  <div key={phase} className="bg-slate-50/70 p-3 rounded-xl border border-slate-200/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-xs font-bold text-slate-800 block">{label}</label>
                        <span className="text-[10px] text-slate-400 block">{desc}</span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono ${
                        role === "fast" ? "bg-amber-100 text-amber-800" : "bg-purple-100 text-purple-800"
                      }`}>
                        {role === "fast" ? "Fast / Low Token Cost" : "Frontier Reasoning"}
                      </span>
                    </div>

                    <select
                      value={phaseModels[phase] || ""}
                      onChange={(e) => {
                        setPhaseModels({ ...phaseModels, [phase]: e.target.value });
                        setPreset("custom");
                      }}
                      className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-200 font-mono transition-all"
                    >
                      {availableModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.display_name} ({m.provider})
                        </option>
                      ))}
                    </select>

                    {/* Reasoning Effort Selector */}
                    <div className="flex items-center justify-between pt-1 text-[11px]">
                      <span className="text-slate-500 font-medium">Reasoning Effort:</span>
                      <div className="inline-flex rounded-lg bg-slate-200/70 p-0.5 text-[10px] font-bold">
                        {(["low", "medium", "high"] as const).map((eff) => (
                          <button
                            key={eff}
                            type="button"
                            onClick={() => {
                              setPhaseEfforts({ ...phaseEfforts, [phase]: eff });
                              setPreset("custom");
                            }}
                            className={`px-2 py-0.5 rounded capitalize transition-all ${
                              phaseEfforts[phase] === eff
                                ? "bg-purple-700 text-white shadow-xs"
                                : "text-slate-600 hover:text-slate-900"
                            }`}
                          >
                            {eff}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
          disabled={loading || availableModels.length === 0}
          className="w-full py-3.5 px-4 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white font-bold text-sm rounded-xl flex items-center justify-center space-x-2 transition-all shadow-xs hover:-translate-y-0.5 cursor-pointer"
        >
          <Play className="w-4 h-4 fill-white" />
          <span>{loading ? "Initializing Scan Pipeline..." : "Start Autonomous Audit"}</span>
        </button>
      </form>
    </div>
  );
}
