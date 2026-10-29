"use client";

import React, { useEffect, useState, useMemo } from "react";
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
  const [activeTab, setActiveTab] = useState<"keys" | "models" | "health">("keys");

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
      <div className="border-b border-purple-100/90 pb-3 flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-purple-600"></span>
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
              Platform Configuration
            </span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 mt-1">System Settings</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure dynamic LLM provider discovery, test live model access, and inspect platform telemetry.
          </p>
        </div>

        <button
          onClick={loadData}
          className="p-2 text-slate-500 hover:text-purple-900 bg-white hover:bg-purple-50 rounded-xl border border-slate-200 shadow-xs transition-all flex items-center space-x-1.5 text-xs font-semibold"
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
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : banner.type === "info"
              ? "bg-purple-50 border-purple-200 text-purple-900"
              : "bg-rose-50 border-rose-200 text-rose-900"
          }`}
        >
          {banner.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          ) : banner.type === "info" ? (
            <Sparkles className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          )}
          <span className="font-medium leading-relaxed">{banner.text}</span>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200 w-fit space-x-1 text-xs font-bold">
        <button
          onClick={() => setActiveTab("keys")}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
            activeTab === "keys" ? "bg-purple-700 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Key className="w-3.5 h-3.5" />
          <span>Providers &amp; Dynamic Discovery</span>
        </button>
        <button
          onClick={() => setActiveTab("models")}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
            activeTab === "models" ? "bg-purple-700 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>Model Whitelist ({models.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("health")}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg transition-all ${
            activeTab === "health" ? "bg-purple-700 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Observability &amp; Health</span>
        </button>
      </div>

      {/* ── Tab 1: Provider Credentials & Dynamic Discovery ─────────────────────── */}
      {activeTab === "keys" && (
        <div className="space-y-6">
          <div className="bg-purple-50/60 border border-purple-200/80 rounded-2xl p-4 text-xs text-purple-950 flex items-start space-x-3">
            <Sparkles className="w-4 h-4 text-purple-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-purple-900">Dynamic Model Discovery &amp; Live Key Verification</p>
              <p className="text-purple-800/90 mt-0.5">
                Enter your provider credentials below and click <strong>&quot;Discover Models&quot;</strong>.
                NewGenSAST queries the official provider API live, fetches all available models,
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
                  className={`bg-white/95 border rounded-2xl p-5 space-y-4 shadow-xs backdrop-blur-md flex flex-col justify-between transition-all ${
                    cardError
                      ? "border-rose-300 ring-2 ring-rose-200/50 bg-rose-50/15"
                      : st === "verified"
                      ? "border-emerald-300 ring-1 ring-emerald-200/50"
                      : "border-purple-100/90"
                  }`}
                >
                  <div className="space-y-4">
                    {/* Provider Card Header */}
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-bold text-slate-900 font-mono">
                          {provDisplayName}
                        </span>
                      </div>

                      {/* Dynamic Contextual Status Badge */}
                      {cardError || st === "error" ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase bg-rose-50 text-rose-800 border border-rose-200 flex items-center space-x-1.5 shadow-2xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse"></span>
                          <span>Connection Error</span>
                        </span>
                      ) : st === "verified" ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center space-x-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                          <span>Verified &amp; Active</span>
                        </span>
                      ) : st === "connected" ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase bg-purple-50 text-purple-900 border border-purple-200 flex items-center space-x-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-600"></span>
                          <span>Connected ({discovered.length} Models)</span>
                        </span>
                      ) : hasConfig ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase bg-slate-100 text-slate-700 border border-slate-200 flex items-center space-x-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                          <span>Saved (Click Discover)</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase bg-slate-100 text-slate-400 border border-slate-200">
                          Not Configured
                        </span>
                      )}
                    </div>

                    {/* Inputs */}
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          API Key / Auth Token {provConfig?.api_key_masked && `(${provConfig.api_key_masked})`}
                          {provKey === "ollama" && (
                            <span className="text-slate-400 text-[10px] ml-1 font-normal">
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
                          className="w-full px-3 py-2 bg-slate-50/70 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 font-mono transition-all"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-semibold text-slate-700">
                            API Base Endpoint URL
                          </label>
                          <span className="text-[10px] text-slate-400 font-mono">
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
                          className="w-full px-3 py-2 bg-slate-50/70 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 font-mono transition-all"
                        />
                        <p className="text-[10px] text-slate-400 mt-1">{helpText}</p>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        onClick={() => handleDiscoverModels(provKey)}
                        disabled={isDiscovering || isTesting}
                        className="py-2 px-3 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center space-x-1.5 transition-all shadow-xs"
                      >
                        {isDiscovering ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Discovering...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                            <span>Discover Models</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => handleSaveKey(provKey)}
                        disabled={isSaving || isDiscovering}
                        className="py-2 px-3 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-bold text-xs rounded-xl flex items-center justify-center space-x-1.5 transition-all"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{isSaving ? "Saving..." : "Save Only"}</span>
                      </button>
                    </div>

                    {/* Localized Error Box - Rendered directly inside this provider card */}
                    {cardError && (
                      <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start space-x-2.5 text-xs text-rose-900 shadow-2xs">
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-rose-950">Connection Error</p>
                          <p className="text-rose-800 mt-0.5 text-[11px] leading-relaxed break-words font-mono">
                            {cardError}
                          </p>
                          {provKey === "ollama" && (
                            <p className="text-[10px] text-rose-700 mt-1.5">
                              Tip: For Ollama Cloud, use <code>https://ollama.com</code> with your Bearer API token. For local Ollama, ensure Ollama is running and accessible.
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => {
                            setProviderErrors((prev) => ({ ...prev, [provKey]: null }));
                            setProviderStatus((prev) => ({ ...prev, [provKey]: "idle" }));
                          }}
                          className="text-rose-400 hover:text-rose-700 text-xs font-bold shrink-0 ml-1"
                          title="Dismiss Error"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    {/* Localized Success Box - Rendered directly inside this provider card */}
                    {cardSuccess && !cardError && (
                      <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center space-x-2 text-xs text-emerald-900 shadow-2xs">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="flex-1 text-[11px] font-semibold">{cardSuccess}</span>
                      </div>
                    )}

                    {/* Dynamic Discovery Drawer */}
                    {discovered.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-slate-200/80 space-y-3 bg-purple-50/20 -mx-5 -mb-5 p-5 rounded-b-2xl">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-1.5">
                            <Cpu className="w-3.5 h-3.5 text-purple-700" />
                            <span className="text-xs font-bold text-slate-900">
                              Discovered Models ({discovered.length})
                            </span>
                          </div>
                          <div className="flex items-center space-x-2 text-[11px]">
                            <button
                              onClick={() => handleToggleSelectAll(provKey, true)}
                              className="text-purple-700 hover:underline font-semibold"
                            >
                              Select All
                            </button>
                            <span className="text-slate-300">|</span>
                            <button
                              onClick={() => handleToggleSelectAll(provKey, false)}
                              className="text-slate-500 hover:underline"
                            >
                              Deselect All
                            </button>
                          </div>
                        </div>

                        {/* Search Filter */}
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                          <input
                            type="text"
                            value={modelFilter[provKey] || ""}
                            onChange={(e) =>
                              setModelFilter({ ...modelFilter, [provKey]: e.target.value })
                            }
                            placeholder="Filter discovered models..."
                            className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-purple-600"
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
                                    ? "bg-white border-purple-300 shadow-2xs"
                                    : "bg-slate-50/60 border-slate-200 opacity-60 hover:opacity-100"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {}} // handled by parent onClick
                                  className="mt-0.5 rounded text-purple-600 focus:ring-purple-500 cursor-pointer"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between">
                                    <span className="font-mono text-[11px] font-bold text-slate-900 truncate">
                                      {m.id}
                                    </span>
                                    <span className="text-[10px] font-mono text-slate-400 shrink-0 ml-1">
                                      {m.context_window ? `${Math.round(m.context_window / 1000)}k ctx` : "128k"}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between mt-0.5">
                                    <span className="text-[11px] text-slate-500 truncate">
                                      {m.display_name}
                                    </span>
                                    <span className="text-[10px] font-mono font-semibold text-amber-700 shrink-0 ml-1">
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
                                          ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                          : "bg-rose-50 text-rose-800 border border-rose-200"
                                      }`}
                                    >
                                      {tRes.status === "verified" ? (
                                        <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                                      ) : (
                                        <XCircle className="w-3 h-3 text-rose-600 shrink-0" />
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
                          className="w-full py-2 px-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center space-x-1.5 transition-all shadow-xs"
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
              <p className="text-xs text-slate-500">
                These models have been verified and whitelisted for multi-agent SAST scans.
              </p>
            </div>

            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={whitelistFilter}
                  onChange={(e) => setWhitelistFilter(e.target.value)}
                  placeholder="Filter whitelisted models..."
                  className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-purple-600 shadow-2xs"
                />
              </div>

              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Custom Model</span>
              </button>

              {models.length > 0 && (
                <button
                  onClick={handleClearAllModels}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded-xl text-xs font-bold transition-all shadow-xs shrink-0"
                  title="Remove all whitelisted models"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                  <span>Clear All</span>
                </button>
              )}
            </div>
          </div>

          <div className="bg-white/95 border border-purple-100/90 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-700">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
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
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredWhitelistedModels.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                        No models found. Switch to the <strong>&quot;Providers &amp; Dynamic Discovery&quot;</strong> tab to discover and whitelist models.
                      </td>
                    </tr>
                  ) : (
                    filteredWhitelistedModels.map((m) => {
                      const isTesting = testingSingle[m.id];
                      const testRes = singleTestResult[m.id];

                      return (
                        <tr key={m.id} className="hover:bg-purple-50/30 transition-colors">
                          <td className="px-5 py-3.5 font-mono font-semibold text-slate-900">
                            {m.id}
                          </td>
                          <td className="px-5 py-3.5 text-slate-700">{m.display_name}</td>
                          <td className="px-5 py-3.5 font-mono uppercase text-[11px] text-slate-500">
                            <span className="px-2 py-0.5 bg-slate-100 rounded-md border border-slate-200 font-bold">
                              {m.provider}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 font-mono text-slate-500">
                            {m.context_window ? `${Math.round(m.context_window / 1000)}k` : "128k"}
                          </td>
                          <td className="px-5 py-3.5 font-mono font-semibold text-amber-800">
                            {m.cost_per_m_in || m.cost_per_m_out
                              ? `$${m.cost_per_m_in} / $${m.cost_per_m_out}`
                              : "Self-Hosted / $0"}
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            <button
                              onClick={() => handleToggleModel(m.id, m.is_enabled)}
                              className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold transition-colors ${
                                m.is_enabled
                                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                  : "bg-slate-100 text-slate-500 border border-slate-200"
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
                                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                                  : testRes?.status === "failed"
                                  ? "bg-rose-50 border-rose-200 text-rose-800"
                                  : "bg-white border-slate-200 text-slate-600 hover:text-purple-700 hover:border-purple-300"
                              }`}
                              title={testRes ? testRes.message : "Run live ping test"}
                            >
                              {isTesting ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-700" />
                              ) : (
                                <Zap className="w-3.5 h-3.5 text-amber-600" />
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
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
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
            <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-5 space-y-2 shadow-xs">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                <span>PostgreSQL 16 Database</span>
                <Server className="w-4 h-4 text-purple-700" />
              </div>
              <div className="flex items-center space-x-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    health?.database === "connected" ? "bg-emerald-500" : "bg-rose-500"
                  }`}
                />
                <span className="text-base font-extrabold text-slate-900 capitalize">
                  {health?.database || "Disconnected"}
                </span>
              </div>
            </div>

            <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-5 space-y-2 shadow-xs">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                <span>Redis Broker &amp; Celery Queue</span>
                <Activity className="w-4 h-4 text-purple-700" />
              </div>
              <div className="flex items-center space-x-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    health?.redis === "connected" ? "bg-emerald-500" : "bg-rose-500"
                  }`}
                />
                <span className="text-base font-extrabold text-slate-900 capitalize">
                  {health?.redis || "Disconnected"}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                {health?.active_scans || 0} Active / {health?.queued_scans || 0} Queued
              </p>
            </div>

            <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-5 space-y-2 shadow-xs">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                <span>Docker Sandbox Daemon</span>
                <Server className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="flex items-center space-x-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    health?.docker === "connected" ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
                <span className="text-base font-extrabold text-slate-900 capitalize">
                  {health?.docker || "Unavailable"}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">Isolated (network=none)</p>
            </div>
          </div>

          <div className="p-5 bg-white/95 border border-purple-100/90 rounded-2xl flex items-center justify-between shadow-xs">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Langfuse LLM Observability &amp; Tracing</h3>
              <p className="text-xs text-slate-500">
                Direct single sign-on access to the integrated Langfuse telemetry portal. Inspect traces, generation waterfalls, and exact token costs.
              </p>
            </div>
            <a
              href="http://langfuse.localhost/sso"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-xs"
            >
              <span>Launch Langfuse SSO</span>
              <ExternalLink className="w-3.5 h-3.5 text-amber-700" />
            </a>
          </div>
        </div>
      )}

      {/* ── Modal for Custom Model Registration ──────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white border border-purple-100 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900">Register Custom / Self-Hosted Model</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleAddCustomModel} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Model Unique Identifier</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ollama/mistral-large or custom/enterprise-llm"
                  value={customModel.id}
                  onChange={(e) => setCustomModel({ ...customModel, id: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-mono focus:border-purple-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Display Label</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Mistral Large (Internal Gateway)"
                  value={customModel.display_name}
                  onChange={(e) => setCustomModel({ ...customModel, display_name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:border-purple-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Provider Route</label>
                <select
                  value={customModel.provider}
                  onChange={(e) => setCustomModel({ ...customModel, provider: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:border-purple-600 focus:bg-white"
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google Gemini</option>
                  <option value="ollama">Ollama (Cloud/Local)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Context Window (Tokens)</label>
                <input
                  type="number"
                  value={customModel.context_window}
                  onChange={(e) => setCustomModel({ ...customModel, context_window: parseInt(e.target.value) || 128000 })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-mono focus:border-purple-600 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Input USD / 1M</label>
                  <input
                    type="number"
                    step="0.001"
                    value={customModel.cost_per_m_in}
                    onChange={(e) => setCustomModel({ ...customModel, cost_per_m_in: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-mono focus:border-purple-600 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Output USD / 1M</label>
                  <input
                    type="number"
                    step="0.001"
                    value={customModel.cost_per_m_out}
                    onChange={(e) => setCustomModel({ ...customModel, cost_per_m_out: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-mono focus:border-purple-600 focus:bg-white"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 bg-purple-700 hover:bg-purple-800 text-white rounded-xl font-bold shadow-xs"
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
