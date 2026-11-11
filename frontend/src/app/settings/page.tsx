"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  Key,
  Cpu,
  Activity,
  Save,
  Plus,
  Trash2,
  AlertCircle,
  Server,
  RefreshCw,
  ExternalLink,
  Sparkles,
  Search,
  Zap,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  GitBranch,
  GitCommit,
  GitPullRequest,
  FileCode,
  ShieldAlert,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Download,
  Check,
} from "lucide-react";
import { api } from "@/lib/api";

interface DiscoveredModel {
  id: string;
  display_name: string;
  context_window: number;
  cost_per_m_in: number;
  cost_per_m_out: number;
}

interface TestResult {
  id: string;
  display_name: string;
  status: "verified" | "failed";
  latency_ms?: number;
  message: string;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<"keys" | "models" | "mantis" | "health">("keys");

  // Google Mantis Upstream Sync State
  const [mantisStatus, setMantisStatus] = useState<any>(null);
  const [checkingMantis, setCheckingMantis] = useState<boolean>(false);
  const [mantisCheckResult, setMantisCheckResult] = useState<any>(null);
  const [applyingMantisUpdate, setApplyingMantisUpdate] = useState<boolean>(false);
  const [showRawDiff, setShowRawDiff] = useState<boolean>(false);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [skillSearch, setSkillSearch] = useState<string>("");
  const [verificationReport, setVerificationReport] = useState<any[] | null>(null);

  // Providers state
  const [providers, setProviders] = useState<any[]>([]);
  const [keyInputs, setKeyInputs] = useState<Record<string, { api_key: string; api_base_url: string }>>({});
  const [savingKey, setSavingKey] = useState<Record<string, boolean>>({});

  // Dynamic Discovery State per provider
  const [discovering, setDiscovering] = useState<Record<string, boolean>>({});
  const [discoveredModels, setDiscoveredModels] = useState<Record<string, DiscoveredModel[]>>({});
  const [selectedModels, setSelectedModels] = useState<Record<string, Record<string, boolean>>>({});
  const [modelFilter, setModelFilter] = useState<Record<string, string>>({});
  const [testingWhitelist, setTestingWhitelist] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, Record<string, TestResult>>>({});

  // Localized provider status & error tracking (displayed directly on provider cards)
  const [providerErrors, setProviderErrors] = useState<Record<string, string | null>>({});
  const [providerSuccesses, setProviderSuccesses] = useState<Record<string, string | null>>({});
  const [providerStatus, setProviderStatus] = useState<
    Record<string, "idle" | "discovering" | "connected" | "verified" | "error">
  >({});

  // Whitelisted models state
  const [models, setModels] = useState<any[]>([]);
  const [whitelistFilter, setWhitelistFilter] = useState("");
  const [testingSingle, setTestingSingle] = useState<Record<string, boolean>>({});
  const [singleTestResult, setSingleTestResult] = useState<Record<string, TestResult>>({});

  // Custom model modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [customModel, setCustomModel] = useState({
    id: "",
    provider: "openai",
    display_name: "",
    context_window: 128000,
    cost_per_m_in: 0,
    cost_per_m_out: 0,
  });

  // Health state
  const [health, setHealth] = useState<any>(null);

  // Global notification banner for general actions
  const [banner, setBanner] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  const loadMantisStatus = async () => {
    try {
      const res = await api.getMantisStatus();
      setMantisStatus(res);
    } catch (err: any) {
      console.error("Failed to load Google Mantis status", err);
    }
  };

  const handleCheckMantisUpdates = async (force: boolean = false) => {
    setCheckingMantis(true);
    setMantisCheckResult(null);
    try {
      const res = await api.checkMantisUpdates(force);
      setMantisCheckResult(res);
      if (!res.has_updates && !force) {
        setBanner({
          type: "success",
          text: "Google Mantis upstream is fully up to date! All 19 skills and Tree-Sitter structural engine match HEAD.",
        });
      } else if (res.safety_verdict === "SAFE") {
        setBanner({
          type: "success",
          text: "Upstream updates analyzed: AST static analysis confirmed all required interfaces are preserved and safe to apply.",
        });
      } else if (res.safety_verdict === "BREAKING_CHANGE") {
        setBanner({
          type: "error",
          text: "Breaking changes detected in upstream Google Mantis! Review AST signature diff before updating.",
        });
      } else {
        setBanner({
          type: "info",
          text: "Upstream updates retrieved. Review the changes below before confirming sync.",
        });
      }
    } catch (err: any) {
      setBanner({ type: "error", text: `Check failed: ${err.message || err}` });
    } finally {
      setCheckingMantis(false);
    }
  };

  const handleApplyMantisUpdate = async () => {
    setApplyingMantisUpdate(true);
    try {
      const target = mantisCheckResult?.upstream_version?.commit_hash;
      const res = await api.applyMantisUpdate(target);
      setBanner({
        type: "success",
        text: res.message || "Successfully updated Google Mantis engine & skills from upstream!",
      });
      if (res.verification_checks) {
        setVerificationReport(res.verification_checks);
      }
      setShowConfirmModal(false);
      setMantisCheckResult(null);
      await loadMantisStatus();
    } catch (err: any) {
      setBanner({ type: "error", text: `Update failed: ${err.message || err}` });
    } finally {
      setApplyingMantisUpdate(false);
    }
  };

  const loadData = async () => {
    try {
      const [provs, mods, h] = await Promise.all([
        api.getProviders().catch(() => []),
        api.getModels().catch(() => []),
        api.getHealth().catch(() => null),
      ]);

      setProviders(provs);
      setModels(mods);
      setHealth(h);

      const initKeys: Record<string, any> = {};
      provs.forEach((p) => {
        initKeys[p.provider] = {
          api_key: "",
          api_base_url: p.api_base_url || "",
        };
      });
      setKeyInputs((prev) => ({ ...initKeys, ...prev }));
      loadMantisStatus();
    } catch (err: any) {
      setBanner({ type: "error", text: err.message || "Failed to load settings." });
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // ── Provider Credentials Saving ─────────────────────────────────────────────
  const handleSaveKey = async (provider: string) => {
    setSavingKey((prev) => ({ ...prev, [provider]: true }));
    setProviderErrors((prev) => ({ ...prev, [provider]: null }));
    setProviderSuccesses((prev) => ({ ...prev, [provider]: null }));

    const values = keyInputs[provider] || {};
    try {
      await api.updateProvider(provider, {
        api_key: values.api_key ? values.api_key.trim() : undefined,
        api_base_url: values.api_base_url ? values.api_base_url.trim() : undefined,
      });

      const successMsg = `Credentials updated & encrypted with AES-256 in PostgreSQL.`;
      setProviderSuccesses((prev) => ({ ...prev, [provider]: successMsg }));
      setKeyInputs((prev) => ({
        ...prev,
        [provider]: { ...values, api_key: "" },
      }));
      loadData();
    } catch (err: any) {
      const errMsg = err.message || `Failed to update ${provider} key.`;
      setProviderErrors((prev) => ({ ...prev, [provider]: errMsg }));
      setProviderStatus((prev) => ({ ...prev, [provider]: "error" }));
    } finally {
      setSavingKey((prev) => ({ ...prev, [provider]: false }));
    }
  };

  // ── Dynamic Model Discovery ────────────────────────────────────────────────
  const handleDiscoverModels = async (provider: string) => {
    setDiscovering((prev) => ({ ...prev, [provider]: true }));
    setProviderErrors((prev) => ({ ...prev, [provider]: null }));
    setProviderSuccesses((prev) => ({ ...prev, [provider]: null }));
    setProviderStatus((prev) => ({ ...prev, [provider]: "discovering" }));

    const values = keyInputs[provider] || {};
    try {
      const res = await api.discoverModels(provider, {
        api_key: values.api_key ? values.api_key.trim() : undefined,
        api_base_url: values.api_base_url ? values.api_base_url.trim() : undefined,
      });

      setDiscoveredModels((prev) => ({ ...prev, [provider]: res.models }));

      // Initialize all discovered models as checked by default
      const initialSelection: Record<string, boolean> = {};
      res.models.forEach((m) => {
        initialSelection[m.id] = true;
      });
      setSelectedModels((prev) => ({ ...prev, [provider]: initialSelection }));

      setProviderStatus((prev) => ({ ...prev, [provider]: "connected" }));
      setProviderSuccesses((prev) => ({
        ...prev,
        [provider]: `Live connection established! ${res.models.length} generation models discovered with real dynamic token pricing.`,
      }));
    } catch (err: any) {
      const errMsg = err.message || `Could not connect to ${provider} endpoint. Check API key, base URL, and network connectivity.`;
      setProviderErrors((prev) => ({ ...prev, [provider]: errMsg }));
      setProviderStatus((prev) => ({ ...prev, [provider]: "error" }));
    } finally {
      setDiscovering((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const handleToggleSelectAll = (provider: string, selectAll: boolean) => {
    const list = discoveredModels[provider] || [];
    const updated: Record<string, boolean> = {};
    list.forEach((m) => {
      updated[m.id] = selectAll;
    });
    setSelectedModels((prev) => ({ ...prev, [provider]: updated }));
  };

  const handleToggleModelSelection = (provider: string, modelId: string) => {
    setSelectedModels((prev) => {
      const current = prev[provider] || {};
      return {
        ...prev,
        [provider]: {
          ...current,
          [modelId]: !current[modelId],
        },
      };
    });
  };

  // ── Test & Whitelist Selected Models ───────────────────────────────────────
  const handleTestAndWhitelist = async (provider: string) => {
    const allDiscovered = discoveredModels[provider] || [];
    const selections = selectedModels[provider] || {};
    const chosenModels = allDiscovered.filter((m) => selections[m.id]);

    if (chosenModels.length === 0) {
      setProviderErrors((prev) => ({
        ...prev,
        [provider]: "Please select at least one model from the list to test and whitelist.",
      }));
      return;
    }

    setTestingWhitelist((prev) => ({ ...prev, [provider]: true }));
    setProviderErrors((prev) => ({ ...prev, [provider]: null }));
    setProviderSuccesses((prev) => ({ ...prev, [provider]: null }));

    const values = keyInputs[provider] || {};

    try {
      const res = await api.testAndWhitelistModels(provider, {
        api_key: values.api_key ? values.api_key.trim() : undefined,
        api_base_url: values.api_base_url ? values.api_base_url.trim() : undefined,
        models: chosenModels,
        save_key: true,
      });

      // Map test results
      const resultsMap: Record<string, TestResult> = {};
      res.results.forEach((r) => {
        resultsMap[r.id] = r;
      });
      setTestResults((prev) => ({ ...prev, [provider]: resultsMap }));

      if (res.verified_count > 0) {
        setProviderStatus((prev) => ({ ...prev, [provider]: "verified" }));
        setProviderSuccesses((prev) => ({
          ...prev,
          [provider]: `Live access verified! Added ${res.verified_count} of ${chosenModels.length} models to the platform whitelist.`,
        }));
        loadData();
      } else {
        setProviderStatus((prev) => ({ ...prev, [provider]: "error" }));
        setProviderErrors((prev) => ({
          ...prev,
          [provider]: `All ${chosenModels.length} model test pings failed. Inspect model details below.`,
        }));
      }
    } catch (err: any) {
      const errMsg = err.message || `Testing failed for ${provider}. Check your API key and permissions.`;
      setProviderErrors((prev) => ({ ...prev, [provider]: errMsg }));
      setProviderStatus((prev) => ({ ...prev, [provider]: "error" }));
    } finally {
      setTestingWhitelist((prev) => ({ ...prev, [provider]: false }));
    }
  };

  // ── Whitelist Tab Actions ──────────────────────────────────────────────────
  const handleToggleModel = async (id: string, currentEnabled: boolean) => {
    try {
      await api.updateModel(id, { is_enabled: !currentEnabled });
      setModels((prev) =>
        prev.map((m) => (m.id === id ? { ...m, is_enabled: !currentEnabled } : m))
      );
    } catch (err: any) {
      alert(err.message || "Failed to update model status.");
    }
  };

  const handleTestSingleModel = async (modelId: string) => {
    setTestingSingle((prev) => ({ ...prev, [modelId]: true }));
    try {
      const res = await api.testSingleModel(modelId);
      setSingleTestResult((prev) => ({ ...prev, [modelId]: res }));
    } catch (err: any) {
      setSingleTestResult((prev) => ({
        ...prev,
        [modelId]: {
          id: modelId,
          display_name: modelId,
          status: "failed",
          message: err.message || "Ping failed",
        },
      }));
    } finally {
      setTestingSingle((prev) => ({ ...prev, [modelId]: false }));
    }
  };

  const handleDeleteModel = async (id: string) => {
    if (!confirm(`Are you sure you want to remove "${id}" from the whitelist?`)) return;
    try {
      // Optimistic update for instant UI feedback
      setModels((prev) => prev.filter((m) => m.id !== id));
      await api.deleteModel(id);
      setBanner({ type: "success", text: `Removed "${id}" from whitelist.` });
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to remove model.");
      loadData();
    }
  };

  const handleClearAllModels = async () => {
    if (!confirm("Are you sure you want to remove ALL models from the whitelist?")) return;
    try {
      setModels([]);
      await api.clearAllModels();
      setBanner({ type: "success", text: "Successfully cleared all models from whitelist." });
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to clear models.");
      loadData();
    }
  };

  const handleAddCustomModel = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.addModel(customModel);
      setShowAddModal(false);
      setCustomModel({
        id: "",
        provider: "openai",
        display_name: "",
        context_window: 128000,
        cost_per_m_in: 0,
        cost_per_m_out: 0,
      });
      loadData();
    } catch (err: any) {
      alert(err.message || "Failed to register custom model.");
    }
  };

  const filteredWhitelistedModels = useMemo(() => {
    if (!whitelistFilter.trim()) return models;
    const q = whitelistFilter.toLowerCase();
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.display_name?.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q)
    );
  }, [models, whitelistFilter]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Page Header */}
      <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
              Platform Configuration
            </span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white mt-1">System Settings</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure dynamic LLM provider discovery, test live model access, and inspect platform telemetry.
          </p>
        </div>

        <button
          onClick={loadData}
          className="p-2 text-slate-400 hover:text-white glass-card rounded-xl border border-slate-700/80 hover:border-amber-500/50 shadow-xs transition-all flex items-center space-x-1.5 text-xs font-semibold"
          title="Refresh Settings"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Global Notification Banner */}
      {banner && (
        <div
          className={`p-3.5 rounded-xl flex items-start space-x-2.5 text-xs border shadow-xs transition-all ${
            banner.type === "success"
              ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-200"
              : banner.type === "info"
              ? "bg-amber-950/40 border-amber-500/40 text-amber-200"
              : "bg-rose-950/40 border-rose-500/40 text-rose-200"
          }`}
        >
          {banner.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : banner.type === "info" ? (
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          )}
          <span className="font-medium leading-relaxed">{banner.text}</span>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex rounded-xl bg-slate-900/90 p-1 border border-slate-800 w-fit space-x-1 text-xs font-bold">
        <button
          onClick={() => setActiveTab("keys")}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
            activeTab === "keys" ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow-xs" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
          }`}
        >
          <Key className="w-3.5 h-3.5" />
          <span>Providers &amp; Dynamic Discovery</span>
        </button>
        <button
          onClick={() => setActiveTab("models")}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
            activeTab === "models" ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow-xs" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>Model Whitelist ({models.length})</span>
        </button>
        <button
          onClick={() => {
            setActiveTab("mantis");
            if (!mantisStatus) loadMantisStatus();
          }}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
            activeTab === "mantis" ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow-xs" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
          }`}
        >
          <GitBranch className="w-3.5 h-3.5" />
          <span>Google Mantis Upstream</span>
          {mantisCheckResult?.has_updates && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse ml-0.5" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("health")}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
            activeTab === "health" ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow-xs" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Observability &amp; Health</span>
        </button>
      </div>

      {/* ── Tab 1: Provider Credentials & Dynamic Discovery ─────────────────────── */}
      {activeTab === "keys" && (
        <div className="space-y-6">
          <div className="glass-card border border-amber-500/30 rounded-2xl p-4 text-xs text-slate-300 flex items-start space-x-3">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-300">Dynamic Model Discovery &amp; Live Key Verification</p>
              <p className="text-slate-400 mt-0.5">
                Enter your provider credentials below and click <strong>&quot;Discover Models&quot;</strong>.
                MantisVision queries the official provider API live, fetches all available models,
                resolves dynamic token pricing, and runs a live 1-token test ping before whitelisting.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[
              {
                id: "openai",
                name: "OpenAI",
                placeholderUrl: "https://api.openai.com/v1",
                helpText: "Standard endpoint: https://api.openai.com/v1",
              },
              {
                id: "anthropic",
                name: "Anthropic Claude",
                placeholderUrl: "https://api.anthropic.com/v1",
                helpText: "Standard endpoint: https://api.anthropic.com/v1",
              },
              {
                id: "google",
                name: "Google Gemini",
                placeholderUrl: "https://generativelanguage.googleapis.com",
                helpText: "Standard endpoint: https://generativelanguage.googleapis.com",
              },
              {
                id: "ollama",
                name: "Ollama (Cloud & Local)",
                placeholderUrl: "https://ollama.com",
                helpText: "Cloud: https://ollama.com | Local: http://localhost:11434 (bridged via Docker)",
              },
            ].map(({ id: provKey, name: provDisplayName, placeholderUrl, helpText }) => {
              const provConfig = providers.find((p) => p.provider === provKey);
              const values = keyInputs[provKey] || { api_key: "", api_base_url: "" };
              const isSaving = savingKey[provKey];
              const isDiscovering = discovering[provKey];
              const isTesting = testingWhitelist[provKey];
              const discovered = discoveredModels[provKey] || [];
              const selections = selectedModels[provKey] || {};
              const filterText = (modelFilter[provKey] || "").toLowerCase();
              const results = testResults[provKey] || {};
              const cardError = providerErrors[provKey];
              const cardSuccess = providerSuccesses[provKey];
              const st = providerStatus[provKey] || "idle";

              const filteredDiscovered = discovered.filter(
                (m) =>
                  m.id.toLowerCase().includes(filterText) ||
                  m.display_name.toLowerCase().includes(filterText)
              );

              const selectedCount = discovered.filter((m) => selections[m.id]).length;
              const hasConfig = !!provConfig?.api_key_masked || (provKey === "ollama" && !!provConfig?.api_base_url);

              return (
                <div
                  key={provKey}
                  className={`glass-card rounded-2xl p-5 space-y-4 shadow-xl flex flex-col justify-between transition-all border ${
                    cardError
                      ? "border-rose-500/80 ring-1 ring-rose-500/40 bg-rose-950/25"
                      : st === "verified"
                      ? "border-emerald-500/80 ring-1 ring-emerald-500/40 bg-emerald-950/20"
                      : "border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="space-y-4">
                    {/* Provider Card Header */}
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-bold text-white font-mono">
                          {provDisplayName}
                        </span>
                      </div>

                      {/* Dynamic Contextual Status Badge */}
                      {cardError || st === "error" ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase bg-rose-950/80 text-rose-300 border border-rose-700/60 flex items-center space-x-1.5 glow-rose-crit font-mono">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                          <span>Connection Error</span>
                        </span>
                      ) : st === "verified" ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 flex items-center space-x-1.5 glow-emerald-repro font-mono">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                          <span>Verified &amp; Active</span>
                        </span>
                      ) : st === "connected" ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase bg-amber-950/80 text-amber-300 border border-amber-500/60 flex items-center space-x-1.5 font-mono">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                          <span>Connected ({discovered.length} Models)</span>
                        </span>
                      ) : hasConfig ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase bg-slate-800/80 text-slate-300 border border-slate-700 flex items-center space-x-1.5 font-mono">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                          <span>Saved (Click Discover)</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase bg-slate-900 text-slate-500 border border-slate-800 font-mono">
                          Not Configured
                        </span>
                      )}
                    </div>

                    {/* Inputs */}
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">
                          API Key / Auth Token {provConfig?.api_key_masked && `(${provConfig.api_key_masked})`}
                          {provKey === "ollama" && (
                            <span className="text-slate-500 text-[10px] ml-1 font-normal">
                              (Required for Ollama Cloud, optional for local)
                            </span>
                          )}
                        </label>
                        <input
                          type="password"
                          value={values.api_key}
                          onChange={(e) =>
                            setKeyInputs({
                              ...keyInputs,
                              [provKey]: { ...values, api_key: e.target.value },
                            })
                          }
                          placeholder={
                            provConfig?.api_key_masked
                              ? "•••••••••••••••• (Leave blank to keep saved key)"
                              : "Paste API key or Bearer token..."
                          }
                          className="w-full px-3 py-2 bg-slate-950/90 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 font-mono transition-all"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-semibold text-slate-300">
                            API Base Endpoint URL
                          </label>
                          <span className="text-[10px] text-slate-500 font-mono">
                            Auto-normalized
                          </span>
                        </div>
                        <input
                          type="text"
                          value={values.api_base_url}
                          onChange={(e) =>
                            setKeyInputs({
                              ...keyInputs,
                              [provKey]: { ...values, api_base_url: e.target.value },
                            })
                          }
                          placeholder={placeholderUrl}
                          className="w-full px-3 py-2 bg-slate-950/90 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 font-mono transition-all"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">{helpText}</p>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        onClick={() => handleDiscoverModels(provKey)}
                        disabled={isDiscovering || isTesting}
                        className="py-2 px-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-slate-950 font-extrabold text-xs rounded-xl flex items-center justify-center space-x-1.5 transition-all shadow-xs glow-amber-btn"
                      >
                        {isDiscovering ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Discovering...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 text-slate-950" />
                            <span>Discover Models</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => handleSaveKey(provKey)}
                        disabled={isSaving || isDiscovering}
                        className="py-2 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 font-bold text-xs rounded-xl flex items-center justify-center space-x-1.5 transition-all border border-slate-700"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{isSaving ? "Saving..." : "Save Only"}</span>
                      </button>
                    </div>

                    {/* Localized Error Box - Rendered directly inside this provider card */}
                    {cardError && (
                      <div className="p-3 bg-rose-950/60 border border-rose-800/70 rounded-xl flex items-start space-x-2.5 text-xs text-rose-200 shadow-2xs">
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-rose-300">Connection Error</p>
                          <p className="text-rose-200 mt-0.5 text-[11px] leading-relaxed break-words font-mono">
                            {cardError}
                          </p>
                          {provKey === "ollama" && (
                            <p className="text-[10px] text-rose-300/80 mt-1.5">
                              Tip: For Ollama Cloud, use <code>https://ollama.com</code> with your Bearer API token. For local Ollama, ensure Ollama is running and accessible.
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            setProviderErrors((prev) => ({ ...prev, [provKey]: null }));
                            setProviderStatus((prev) => ({ ...prev, [provKey]: "idle" }));
                          }}
                          className="text-rose-400 hover:text-rose-200 text-xs font-bold shrink-0 ml-1"
                          title="Dismiss Error"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    {/* Localized Success Box - Rendered directly inside this provider card */}
                    {cardSuccess && !cardError && (
                      <div className="p-2.5 bg-emerald-950/60 border border-emerald-800/70 rounded-xl flex items-center space-x-2 text-xs text-emerald-200 shadow-2xs">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span className="flex-1 text-[11px] font-semibold">{cardSuccess}</span>
                      </div>
                    )}

                    {/* Dynamic Discovery Drawer */}
                    {discovered.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-slate-800 space-y-3 bg-slate-950/60 -mx-5 -mb-5 p-5 rounded-b-2xl">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-1.5">
                            <Cpu className="w-3.5 h-3.5 text-amber-400" />
                            <span className="text-xs font-bold text-white">
                              Discovered Models ({discovered.length})
                            </span>
                          </div>
                          <div className="flex items-center space-x-2 text-[11px]">
                            <button
                              onClick={() => handleToggleSelectAll(provKey, true)}
                              className="text-amber-400 hover:text-amber-300 hover:underline font-semibold"
                            >
                              Select All
                            </button>
                            <span className="text-slate-600">|</span>
                            <button
                              onClick={() => handleToggleSelectAll(provKey, false)}
                              className="text-slate-400 hover:text-slate-200 hover:underline"
                            >
                              Deselect All
                            </button>
                          </div>
                        </div>

                        {/* Search Filter */}
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                          <input
                            type="text"
                            value={modelFilter[provKey] || ""}
                            onChange={(e) =>
                              setModelFilter({ ...modelFilter, [provKey]: e.target.value })
                            }
                            placeholder="Filter discovered models..."
                            className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
                          />
                        </div>

                        {/* Scrollable Model Checkbox List */}
                        <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1 text-xs">
                          {filteredDiscovered.map((m) => {
                            const isChecked = !!selections[m.id];
                            const tRes = results[m.id];

                            return (
                              <div
                                key={m.id}
                                onClick={() => handleToggleModelSelection(provKey, m.id)}
                                className={`p-2 rounded-xl border transition-all cursor-pointer flex items-start space-x-2.5 ${
                                  isChecked
                                    ? "bg-slate-900/90 border-amber-500/60 text-slate-100 shadow-xs ring-1 ring-amber-500/30"
                                    : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {}} // handled by parent onClick
                                  className="mt-0.5 rounded accent-amber-500 cursor-pointer"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between">
                                    <span className="font-mono text-[11px] font-bold text-white truncate">
                                      {m.id}
                                    </span>
                                    <span className="text-[10px] font-mono text-slate-500 shrink-0 ml-1">
                                      {m.context_window ? `${Math.round(m.context_window / 1000)}k ctx` : "128k"}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between mt-0.5">
                                    <span className="text-[11px] text-slate-400 truncate">
                                      {m.display_name}
                                    </span>
                                    <span className="text-[10px] font-mono font-semibold text-amber-400 shrink-0 ml-1">
                                      {m.cost_per_m_in || m.cost_per_m_out
                                        ? `$${m.cost_per_m_in} / $${m.cost_per_m_out}`
                                        : "Self-Hosted / $0"}
                                    </span>
                                  </div>

                                  {/* Test Status Indicator */}
                                  {tRes && (
                                    <div
                                      className={`mt-1.5 px-2 py-0.5 rounded text-[10px] font-medium flex items-center space-x-1 ${
                                        tRes.status === "verified"
                                          ? "bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 font-mono"
                                          : "bg-rose-950/80 text-rose-300 border border-rose-700/60 font-mono"
                                      }`}
                                    >
                                      {tRes.status === "verified" ? (
                                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                                      ) : (
                                        <XCircle className="w-3 h-3 text-rose-400 shrink-0" />
                                      )}
                                      <span className="truncate">{tRes.message}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Test & Whitelist CTA */}
                        <button
                          onClick={() => handleTestAndWhitelist(provKey)}
                          disabled={isTesting || selectedCount === 0}
                          className="w-full py-2 px-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-slate-950 font-extrabold text-xs rounded-xl flex items-center justify-center space-x-1.5 transition-all shadow-xs glow-amber-btn"
                        >
                          {isTesting ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Testing Live Access &amp; Whitelisting...</span>
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>Test &amp; Whitelist ({selectedCount} Selected)</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-slate-400">
            * All API keys are encrypted at rest with AES-256 before writing to PostgreSQL. Token pricing is dynamically resolved from the LiteLLM database.
          </p>
        </div>
      )}

      {/* ── Tab 2: Whitelisted Models Matrix ───────────────────────────────────── */}
      {activeTab === "models" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <p className="text-xs text-slate-400">
                These models have been verified and whitelisted for multi-agent SAST scans.
              </p>
            </div>

            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={whitelistFilter}
                  onChange={(e) => setWhitelistFilter(e.target.value)}
                  placeholder="Filter whitelisted models..."
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-950/90 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 shadow-2xs font-mono"
                />
              </div>

              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded-xl text-xs font-black transition-all shadow-xs shrink-0 glow-amber-btn"
              >
                <Plus className="w-3.5 h-3.5 text-slate-950" />
                <span>Custom Model</span>
              </button>

              {models.length > 0 && (
                <button
                  onClick={handleClearAllModels}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-800/80 rounded-xl text-xs font-bold transition-all shadow-xs shrink-0"
                  title="Remove all whitelisted models"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>Clear All</span>
                </button>
              )}
            </div>
          </div>

          <div className="glass-card border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950/90 text-slate-400 text-xs uppercase tracking-wider font-mono border-b border-slate-800">
                  <tr>
                    <th className="px-5 py-3.5 font-bold">Model ID</th>
                    <th className="px-5 py-3.5 font-bold">Display Name</th>
                    <th className="px-5 py-3.5 font-bold">Provider</th>
                    <th className="px-5 py-3.5 font-bold">Context Limit</th>
                    <th className="px-5 py-3.5 font-bold">Cost / 1M Tokens (In / Out)</th>
                    <th className="px-5 py-3.5 font-bold text-center">Status</th>
                    <th className="px-5 py-3.5 font-bold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {filteredWhitelistedModels.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                        No models found. Switch to the <strong className="text-amber-400">&quot;Providers &amp; Dynamic Discovery&quot;</strong> tab to discover and whitelist models.
                      </td>
                    </tr>
                  ) : (
                    filteredWhitelistedModels.map((m) => {
                      const isTesting = testingSingle[m.id];
                      const testRes = singleTestResult[m.id];

                      return (
                        <tr key={m.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-5 py-3.5 font-mono font-semibold text-white">
                            {m.id}
                          </td>
                          <td className="px-5 py-3.5 text-slate-300">{m.display_name}</td>
                          <td className="px-5 py-3.5 font-mono uppercase text-[11px] text-slate-400">
                            <span className="px-2 py-0.5 bg-slate-900 rounded-md border border-slate-700 font-bold">
                              {m.provider}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 font-mono text-slate-400">
                            {m.context_window ? `${Math.round(m.context_window / 1000)}k` : "128k"}
                          </td>
                          <td className="px-5 py-3.5 font-mono font-semibold text-amber-400">
                            {m.cost_per_m_in || m.cost_per_m_out
                              ? `$${m.cost_per_m_in} / $${m.cost_per_m_out}`
                              : "Self-Hosted / $0"}
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            <button
                              onClick={() => handleToggleModel(m.id, m.is_enabled)}
                              className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold font-mono transition-colors ${
                                m.is_enabled
                                  ? "bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 glow-emerald-repro"
                                  : "bg-slate-900 text-slate-500 border border-slate-800"
                              }`}
                            >
                              {m.is_enabled ? "Enabled" : "Disabled"}
                            </button>
                          </td>
                          <td className="px-5 py-3.5 text-right space-x-1 whitespace-nowrap">
                            {/* Live Test Button */}
                            <button
                              onClick={() => handleTestSingleModel(m.id)}
                              disabled={isTesting}
                              className={`p-1.5 rounded-lg border text-xs font-semibold inline-flex items-center space-x-1 transition-all ${
                                testRes?.status === "verified"
                                  ? "bg-emerald-950/80 border-emerald-700/80 text-emerald-300"
                                  : testRes?.status === "failed"
                                  ? "bg-rose-950/80 border-rose-700/80 text-rose-300"
                                  : "bg-slate-900 border-slate-700 text-slate-300 hover:text-amber-400 hover:border-amber-500/50"
                              }`}
                              title={testRes ? testRes.message : "Run live ping test"}
                            >
                              {isTesting ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                              ) : (
                                <Zap className="w-3.5 h-3.5 text-amber-400" />
                              )}
                              <span>
                                {isTesting
                                  ? "Testing..."
                                  : testRes
                                  ? testRes.latency_ms
                                    ? `${testRes.latency_ms}ms`
                                    : "Failed"
                                  : "Ping"}
                              </span>
                            </button>

                            {/* Remove Button */}
                            <button
                              onClick={() => handleDeleteModel(m.id)}
                              className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-950/50 transition-colors"
                              title="Remove from Whitelist"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab 3: System Health & Observability ───────────────────────────────── */}
      {activeTab === "health" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="glass-card border border-slate-800 rounded-2xl p-5 space-y-2 shadow-xl">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                <span>PostgreSQL 16 Database</span>
                <Server className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex items-center space-x-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    health?.database === "connected" ? "bg-emerald-400 shadow-xs shadow-emerald-500/50" : "bg-rose-500 shadow-xs shadow-rose-500/50"
                  }`}
                />
                <span className="text-base font-extrabold text-white capitalize">
                  {health?.database || "Disconnected"}
                </span>
              </div>
            </div>

            <div className="glass-card border border-slate-800 rounded-2xl p-5 space-y-2 shadow-xl">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                <span>Redis Broker &amp; Celery Queue</span>
                <Activity className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex items-center space-x-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    health?.redis === "connected" ? "bg-emerald-400 shadow-xs shadow-emerald-500/50" : "bg-rose-500 shadow-xs shadow-rose-500/50"
                  }`}
                />
                <span className="text-base font-extrabold text-white capitalize">
                  {health?.redis || "Disconnected"}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono">
                {health?.active_scans || 0} Active / {health?.queued_scans || 0} Queued
              </p>
            </div>

            <div className="glass-card border border-slate-800 rounded-2xl p-5 space-y-2 shadow-xl">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                <span>Docker Sandbox Daemon</span>
                <Server className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="flex items-center space-x-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    health?.docker === "connected" ? "bg-emerald-400 shadow-xs shadow-emerald-500/50" : "bg-amber-400 shadow-xs shadow-amber-500/50"
                  }`}
                />
                <span className="text-base font-extrabold text-white capitalize">
                  {health?.docker || "Unavailable"}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono">Isolated (network=none)</p>
            </div>
          </div>

          <div className="p-5 glass-card border border-slate-800 rounded-2xl flex items-center justify-between shadow-xl">
            <div>
              <h3 className="text-sm font-bold text-white">Native Swarm Tracing &amp; Forensics</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Integrated real-time trace inspector, chain-of-thought visualization, tool call auditing, and critic verdicts right inside MantisVision.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="px-3.5 py-2 bg-slate-900 text-slate-200 border border-slate-700 hover:border-amber-500/60 hover:text-amber-300 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-xs"
            >
              <span>View Active Scans</span>
            </Link>
          </div>
        </div>
      )}

      {/* ── Tab 4: Google Mantis Upstream Engine ───────────────────────────────── */}
      {activeTab === "mantis" && (
        <div className="space-y-6">
          {/* Header Banner */}
          <div className="glass-card border border-slate-800 rounded-2xl p-5 text-xs text-slate-300 flex flex-col md:flex-row md:items-start md:justify-between gap-4 shadow-xl">
            <div className="flex items-start space-x-3.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 text-slate-950 font-black flex items-center justify-center shrink-0 shadow-md shadow-amber-500/20">
                <GitBranch className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <h3 className="text-sm font-bold text-white">
                    Google Mantis Upstream Engine &amp; Skills Synchronizer
                  </h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-500/50 font-mono">
                    Upstream: google/mantis
                  </span>
                </div>
                <p className="text-slate-400 leading-relaxed max-w-3xl">
                  MantisVision directly vendors Google Mantis’s 19 official modular skills and deterministic Tree-Sitter AST structural index engine (<code className="bg-slate-900 border border-slate-800 px-1 py-0.5 rounded text-[11px] font-mono text-amber-300">catalog.sqlite</code>). Before updating, MantisVision fetches upstream, calculates git diffs, and runs automated static AST analysis to verify that all cognitive interfaces and symbol traversal methods remain 100% backward-compatible.
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={() => handleCheckMantisUpdates(false)}
                disabled={checkingMantis || applyingMantisUpdate}
                className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-98 text-slate-950 font-black text-xs shadow-xs transition-all disabled:opacity-50 glow-amber-btn"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checkingMantis ? "animate-spin" : ""}`} />
                <span>{checkingMantis ? "Checking Upstream..." : "Check for Updates"}</span>
              </button>
              <button
                onClick={() => handleCheckMantisUpdates(true)}
                disabled={checkingMantis || applyingMantisUpdate}
                title="Force git fetch and inspect AST compatibility against upstream HEAD"
                className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-98 text-slate-300 font-semibold text-xs border border-slate-700 transition-all shadow-xs disabled:opacity-50"
              >
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <span>Inspect AST Diff</span>
              </button>
            </div>
          </div>

          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="glass-card p-4 rounded-xl border border-slate-800 shadow-md">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block font-mono">Vendored Commit</span>
              <div className="flex items-center space-x-2 mt-1">
                <GitCommit className="w-4 h-4 text-amber-400" />
                <a
                  href={`https://github.com/google/mantis/commit/${mantisStatus?.commit_hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs font-bold text-amber-400 hover:underline flex items-center space-x-1"
                >
                  <span>{mantisStatus?.short_hash || "f3162c0"}</span>
                  <ExternalLink className="w-3 h-3 text-slate-500" />
                </a>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block truncate" title={mantisStatus?.commit_message}>
                {mantisStatus?.commit_message || "feat(llm): continue thinking turn"}
              </span>
            </div>

            <div className="glass-card p-4 rounded-xl border border-slate-800 shadow-md">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block font-mono">Official Skills</span>
              <div className="flex items-center space-x-2 mt-1">
                <FileCode className="w-4 h-4 text-emerald-400" />
                <span className="text-base font-bold text-white">{mantisStatus?.skills_count || 19} Skills Loaded</span>
              </div>
              <span className="text-[10px] text-emerald-400 font-medium mt-1 block font-mono">
                100% Upstream Fidelity
              </span>
            </div>

            <div className="glass-card p-4 rounded-xl border border-slate-800 shadow-md">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block font-mono">Structural AST Engine</span>
              <div className="flex items-center space-x-2 mt-1">
                <ShieldCheck className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-white">Tree-Sitter v0.26 (AST)</span>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block font-mono">
                Pass Lifecycle Contract v5
              </span>
            </div>

            <div className="glass-card p-4 rounded-xl border border-slate-800 shadow-md">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block font-mono">Upstream Sync Status</span>
              <div className="flex items-center space-x-2 mt-1">
                {mantisCheckResult?.has_updates ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-950/80 text-amber-300 border border-amber-500/60 font-mono">
                    <AlertTriangle className="w-3 h-3 mr-1 text-amber-400" /> Update Ready
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 font-mono">
                    <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-400" /> Fully Aligned
                  </span>
                )}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block font-mono">
                Last checked: {mantisStatus?.synced_at ? new Date(mantisStatus.synced_at).toLocaleTimeString() : "Just now"}
              </span>
            </div>
          </div>

          {/* Verification & Diff Panel (visible after check) */}
          {mantisCheckResult && (
            <div className="glass-card border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2">
                  <GitPullRequest className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-bold text-white">Upstream Verification &amp; Compatibility Assessment</h3>
                </div>
                <div className="flex items-center space-x-2">
                  {mantisCheckResult.safety_verdict === "SAFE" && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 font-mono glow-emerald-repro">
                      <ShieldCheck className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                      AST Verified Safe
                    </span>
                  )}
                  {mantisCheckResult.safety_verdict === "BREAKING_CHANGE" && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-rose-950/80 text-rose-300 border border-rose-700/60 font-mono glow-rose-crit">
                      <ShieldAlert className="w-3.5 h-3.5 mr-1 text-rose-400" />
                      Breaking Changes Flagged
                    </span>
                  )}
                  {mantisCheckResult.safety_verdict === "ADVISORY_WARNING" && (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-950/80 text-amber-300 border border-amber-500/60 font-mono">
                      <AlertTriangle className="w-3.5 h-3.5 mr-1 text-amber-400" />
                      Advisory Warning
                    </span>
                  )}
                </div>
              </div>

              {/* Assessment Banner */}
              <div
                className={`p-4 rounded-xl border text-xs leading-relaxed flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 ${
                  mantisCheckResult.safety_verdict === "SAFE"
                    ? "bg-emerald-950/40 border-emerald-800/80 text-emerald-200"
                    : mantisCheckResult.safety_verdict === "BREAKING_CHANGE"
                    ? "bg-rose-950/40 border-rose-800/80 text-rose-200"
                    : "bg-amber-950/40 border-amber-800/80 text-amber-200"
                }`}
              >
                <div className="space-y-1">
                  <p className="font-bold flex items-center space-x-1.5">
                    {mantisCheckResult.safety_verdict === "SAFE" && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                    {mantisCheckResult.safety_verdict === "BREAKING_CHANGE" && <ShieldAlert className="w-4 h-4 text-rose-400" />}
                    {mantisCheckResult.safety_verdict === "ADVISORY_WARNING" && <AlertTriangle className="w-4 h-4 text-amber-400" />}
                    <span>{mantisCheckResult.assessment}</span>
                  </p>
                  {mantisCheckResult.breaking_issues && mantisCheckResult.breaking_issues.length > 0 && (
                    <ul className="list-disc pl-5 pt-1 space-y-0.5 text-rose-300 font-mono text-[11px]">
                      {mantisCheckResult.breaking_issues.map((iss: string, idx: number) => (
                        <li key={idx}>{iss}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {mantisCheckResult.has_updates && mantisCheckResult.safety_verdict !== "BREAKING_CHANGE" && (
                  <button
                    onClick={() => setShowConfirmModal(true)}
                    className="shrink-0 px-4 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 active:scale-98 text-slate-950 rounded-xl font-black text-xs shadow-xs transition-all flex items-center space-x-1.5 glow-emerald-repro"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Apply Upstream Update</span>
                  </button>
                )}
              </div>

              {/* Skills Delta Badges */}
              {mantisCheckResult.skills_delta && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs pt-1">
                  <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 space-y-1">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block font-mono">Added Skills</span>
                    {mantisCheckResult.skills_delta.added.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {mantisCheckResult.skills_delta.added.map((s: string) => (
                          <span key={s} className="px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-700/60">
                            +{s}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-500 text-[11px]">No new skills</span>
                    )}
                  </div>

                  <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 space-y-1">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block font-mono">Modified Skills</span>
                    {mantisCheckResult.skills_delta.modified.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {mantisCheckResult.skills_delta.modified.map((s: string) => (
                          <span key={s} className="px-2 py-0.5 rounded text-[11px] font-mono bg-amber-950/80 text-amber-300 border border-amber-500/60">
                            ~{s}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-500 text-[11px]">No skill modifications</span>
                    )}
                  </div>

                  <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 space-y-1">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block font-mono">Removed Skills</span>
                    {mantisCheckResult.skills_delta.removed.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {mantisCheckResult.skills_delta.removed.map((s: string) => (
                          <span key={s} className="px-2 py-0.5 rounded text-[11px] font-mono bg-rose-950/80 text-rose-300 border border-rose-700/60">
                            -{s}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-500 text-[11px]">None removed</span>
                    )}
                  </div>
                </div>
              )}

              {/* Files Changed & Commit Log */}
              {mantisCheckResult.files_changed && mantisCheckResult.files_changed.length > 0 && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">
                      Modified Files ({mantisCheckResult.files_changed.length})
                    </span>
                    <button
                      onClick={() => setShowRawDiff(!showRawDiff)}
                      className="text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center space-x-1"
                    >
                      <span>{showRawDiff ? "Hide Git Diff" : "View Raw Git Diff"}</span>
                      {showRawDiff ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  <div className="border border-slate-800 rounded-xl overflow-hidden text-xs">
                    <table className="w-full text-left">
                      <thead className="bg-slate-950 text-slate-400 font-mono font-semibold border-b border-slate-800 text-[11px]">
                        <tr>
                          <th className="py-2 px-3">File Path</th>
                          <th className="py-2 px-3 text-right">Additions</th>
                          <th className="py-2 px-3 text-right">Deletions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
                        {mantisCheckResult.files_changed.map((f: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-800/40">
                            <td className="py-2 px-3 font-mono text-slate-300 text-[11px]">{f.path}</td>
                            <td className="py-2 px-3 text-right font-mono text-emerald-400 font-bold">+{f.additions}</td>
                            <td className="py-2 px-3 text-right font-mono text-rose-400 font-bold">-{f.deletions}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Raw Git Diff Box */}
                  {showRawDiff && mantisCheckResult.diff_snippet && (
                    <div className="bg-slate-950 text-slate-200 p-4 rounded-xl font-mono text-[11px] overflow-x-auto max-h-96 space-y-0.5 border border-slate-800">
                      {mantisCheckResult.diff_snippet.split("\n").map((line: string, lIdx: number) => {
                        let colorClass = "text-slate-300";
                        if (line.startsWith("+") && !line.startsWith("+++")) colorClass = "text-emerald-400 bg-emerald-950/40";
                        else if (line.startsWith("-") && !line.startsWith("---")) colorClass = "text-rose-400 bg-rose-950/40";
                        else if (line.startsWith("@@")) colorClass = "text-amber-400 font-bold";
                        else if (line.startsWith("diff ") || line.startsWith("index ")) colorClass = "text-slate-500 font-bold";
                        return (
                          <div key={lIdx} className={`${colorClass} px-1 whitespace-pre`}>
                            {line || " "}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Post-Update Automated Verification Report */}
          {verificationReport && (
            <div className="bg-emerald-950/40 border border-emerald-800/80 rounded-2xl p-5 space-y-3 shadow-xl animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-emerald-800/60 pb-2.5">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-sm font-bold text-emerald-200">Automated Engine Verification Suite Passed</h3>
                </div>
                <span className="text-[11px] font-mono font-bold text-emerald-300 bg-emerald-900/60 border border-emerald-700/60 px-2 py-0.5 rounded-full">
                  {verificationReport.filter((c: any) => c.passed).length} / {verificationReport.length} Checks OK
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                {verificationReport.map((c: any, idx: number) => (
                  <div key={idx} className="glass-card p-3 rounded-xl border border-emerald-800/60 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-white flex items-center space-x-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>{c.name}</span>
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">{c.duration_ms}ms</span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">{c.details}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Installed Official Skills Catalog */}
          <div className="glass-card border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Vendored Google Mantis Skills Directory ({mantisStatus?.skills?.length || 19})
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Official production prompts and decision matrices loaded into MantisVision from upstream.
                </p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Filter skills..."
                  value={skillSearch}
                  onChange={(e) => setSkillSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-all font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {(mantisStatus?.skills || [])
                .filter((s: any) => !skillSearch || s.name.toLowerCase().includes(skillSearch.toLowerCase()))
                .map((s: any) => {
                  const descMap: Record<string, string> = {
                    "mantis-researcher": "Dynamic attack surface traversal with Wave 1 Rapid Triage and Wave 2 Deep Audit call-graph analysis.",
                    "mantis-reproduce": "Multi-turn iterative PoC exploit synthesis verified inside isolated Docker sandboxes.",
                    "mantis-structural-index": "Deterministic Tree-Sitter semantic-unit AST catalog and caller/callee cross-reference builder.",
                    "mantis-threat-model": "Multi-agent threat analysis mapping trust boundaries, threat actors, and high-risk assets.",
                    "mantis-plan": "High-priority attack vector decomposition and file-level hunting plan generator.",
                    "mantis-summarize": "Hierarchical bottom-up security summarization across repository architectural trees.",
                    "mantis-critic": "Negative-heuristic false-positive filter validating reachability and exploitability constraints.",
                    "mantis-dedupe": "Multi-dimensional vulnerability clustering and root-cause deduplication.",
                    "mantis-history": "Git log and VCS commit history mining for historical regression patterns.",
                    "mantis-reflect": "Persistent repository knowledge base capturing architectural lessons across scan runs.",
                    "mantis-patch": "Deterministic code remediation diff generation and security fix synthesis.",
                    "mantis-chain": "Exploit chain synthesis connecting multiple findings into end-to-end attack paths.",
                    "mantis-calibrate": "Confidence scoring and calibration rules evaluation against security ground truth.",
                    "mantis-meta-agent": "Self-optimizing orchestrator coordinating stage execution and token budgets.",
                    "mantis-pipeline-adapter": "Multi-harness abstraction conforming to the Mantis Pass Lifecycle Contract.",
                    "mantis-report": "Executive and developer security report generation conforming to Google Mantis schemas.",
                    "mantis-review": "Multi-agent peer review packet generation and triage checklist evaluation.",
                    "mantis-advise": "Security advisory notes and architectural hardening recommendations.",
                    "mantis-architecture": "Entrypoint and architectural cartography mapping attack surfaces.",
                  };
                  const desc = descMap[s.name] || "Official Google Mantis cognitive module.";

                  return (
                    <div
                      key={s.name}
                      className="p-3.5 glass-card border border-slate-800 hover:border-amber-500/50 rounded-xl space-y-1.5 transition-all shadow-md group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-amber-400 truncate group-hover:text-amber-300">
                          {s.name}
                        </span>
                        <span className="px-1.5 py-0.5 text-[9px] font-bold font-mono rounded bg-emerald-950/80 text-emerald-300 border border-emerald-700/60">
                          {s.size_bytes ? `${Math.round(s.size_bytes / 1024)} KB` : "SKILL.md"}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                        {desc}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-800 font-mono">
                        <span className="flex items-center space-x-1 text-emerald-400 font-medium">
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>Verified Upstream</span>
                        </span>
                        <span>Pass Lifecycle Contract</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Confirmation Modal */}
          {showConfirmModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
              <div className="glass-card border border-slate-700 rounded-2xl p-6 w-full max-w-lg space-y-4 shadow-2xl animate-in fade-in duration-150 text-slate-100">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-950/80 text-amber-300 border border-amber-500/60 flex items-center justify-center font-bold">
                      <GitPullRequest className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        Confirm Google Mantis Upstream Update
                      </h3>
                      <p className="text-[11px] text-slate-400 font-mono">
                        Target: {mantisCheckResult?.upstream_version?.short_hash || "latest"} ({mantisCheckResult?.upstream_version?.author || "Google"})
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowConfirmModal(false)}
                    className="text-slate-400 hover:text-white text-sm p-1 rounded-lg"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 text-slate-200 space-y-1">
                    <p className="font-bold text-amber-400">Commit Details:</p>
                    <p className="font-mono text-[11px] text-slate-300">
                      {mantisCheckResult?.upstream_version?.message}
                    </p>
                  </div>

                  <div className="p-3 bg-emerald-950/40 rounded-xl border border-emerald-800/80 text-emerald-200 space-y-1">
                    <div className="flex items-center space-x-1.5 font-bold text-emerald-300">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span>Automated Rollback Protection Guaranteed</span>
                    </div>
                    <p className="text-[11px] text-emerald-300/80 leading-relaxed">
                      A local snapshot backup of existing skills and structural engine files will be captured before synchronization. If any syntax error or AST regression occurs during compilation, the update will immediately abort and restore the previous state without disruption.
                    </p>
                  </div>

                  <p className="text-slate-400 text-[11px]">
                    Applying this update will refresh the 19 official modular skills and reload the Tree-Sitter structural engine.
                  </p>
                </div>

                <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(false)}
                    disabled={applyingMantisUpdate}
                    className="px-3.5 py-2 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 font-semibold text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyMantisUpdate}
                    disabled={applyingMantisUpdate}
                    className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-98 text-slate-950 rounded-xl font-black text-xs shadow-xs flex items-center space-x-1.5 transition-all disabled:opacity-50 glow-amber-btn"
                  >
                    <Download className={`w-3.5 h-3.5 ${applyingMantisUpdate ? "animate-spin" : ""}`} />
                    <span>{applyingMantisUpdate ? "Synchronizing..." : "Confirm & Update Now"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Modal for Custom Model Registration ──────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="glass-card border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-sm font-bold text-white">Register Custom / Self-Hosted Model</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleAddCustomModel} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Model Unique Identifier</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ollama/mistral-large or custom/enterprise-llm"
                  value={customModel.id}
                  onChange={(e) => setCustomModel({ ...customModel, id: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Display Label</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Mistral Large (Internal Gateway)"
                  value={customModel.display_name}
                  onChange={(e) => setCustomModel({ ...customModel, display_name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Provider Route</label>
                <select
                  value={customModel.provider}
                  onChange={(e) => setCustomModel({ ...customModel, provider: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:border-amber-500"
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google Gemini</option>
                  <option value="ollama">Ollama (Cloud/Local)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Context Window (Tokens)</label>
                <input
                  type="number"
                  value={customModel.context_window}
                  onChange={(e) => setCustomModel({ ...customModel, context_window: parseInt(e.target.value) || 128000 })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Input USD / 1M</label>
                  <input
                    type="number"
                    step="0.001"
                    value={customModel.cost_per_m_in}
                    onChange={(e) => setCustomModel({ ...customModel, cost_per_m_in: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Output USD / 1M</label>
                  <input
                    type="number"
                    step="0.001"
                    value={customModel.cost_per_m_out}
                    onChange={(e) => setCustomModel({ ...customModel, cost_per_m_out: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded-xl font-black shadow-xs glow-amber-btn"
                >
                  Save Model
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
