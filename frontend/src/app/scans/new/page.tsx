"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
} from "lucide-react";
import { api } from "@/lib/api";

export default function NewScanPage() {
  const router = useRouter();

  // Source configuration
  const [sourceType, setSourceType] = useState<"git" | "local">("git");
  const [sourceTarget, setSourceTarget] = useState("");
  const [branch, setBranch] = useState("main");
  const [gitToken, setGitToken] = useState("");

  // Budget
  const [budgetLimit, setBudgetLimit] = useState(5.0);

  // Model Presets & Custom Selection
  const [preset, setPreset] = useState<"fast" | "local" | "frontier" | "custom">("fast");
  const [availableModels, setAvailableModels] = useState<any[]>([]);

  // Per-phase model assignments
  const [phaseModels, setPhaseModels] = useState<Record<string, string>>({
    recon: "gemini/gemini-1.5-flash",
    threat_model: "gemini/gemini-1.5-flash",
    research: "anthropic/claude-3-5-sonnet",
    critic: "anthropic/claude-3-5-sonnet",
    reproduce: "openai/gpt-4o",
    patch: "anthropic/claude-3-5-sonnet",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch whitelisted models from backend
    api.getModels()
      .then((models) => {
        const enabled = models.filter((m) => m.is_enabled);
        if (enabled.length > 0) {
          setAvailableModels(enabled);
          const firstId = enabled[0].id;
          setPhaseModels({
            recon: firstId,
            threat_model: firstId,
            research: firstId,
            critic: firstId,
            reproduce: firstId,
            patch: firstId,
          });
        }
      })
      .catch(() => {});
  }, []);

  const handlePresetChange = (selectedPreset: "fast" | "local" | "frontier" | "custom") => {
    setPreset(selectedPreset);
    if (availableModels.length === 0) return;

    const findModel = (predicate: (m: any) => boolean, fallback: string) => {
      const found = availableModels.find(predicate);
      return found ? found.id : (availableModels[0]?.id || fallback);
    };

    if (selectedPreset === "fast") {
      const fastModel = findModel((m) => m.id.includes("flash") || m.id.includes("mini") || m.id.includes("haiku"), availableModels[0].id);
      setPhaseModels({
        recon: fastModel,
        threat_model: fastModel,
        research: fastModel,
        critic: fastModel,
        reproduce: fastModel,
        patch: fastModel,
      });
    } else if (selectedPreset === "local") {
      const localModel = findModel((m) => m.provider === "ollama", availableModels[0].id);
      setPhaseModels({
        recon: localModel,
        threat_model: localModel,
        research: localModel,
        critic: localModel,
        reproduce: localModel,
        patch: localModel,
      });
    } else if (selectedPreset === "frontier") {
      const smartModel = findModel((m) => m.id.includes("sonnet") || m.id.includes("gpt-4o") || m.id.includes("pro"), availableModels[0].id);
      const fastModel = findModel((m) => m.id.includes("flash") || m.id.includes("mini"), smartModel);
      setPhaseModels({
        recon: fastModel,
        threat_model: smartModel,
        research: smartModel,
        critic: smartModel,
        reproduce: smartModel,
        patch: smartModel,
      });
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
        source_type: sourceType,
        source_target: sourceTarget.trim(),
        branch: sourceType === "git" ? branch.trim() : undefined,
        git_token: gitToken.trim() ? gitToken.trim() : undefined,
        budget_limit_usd: budgetLimit,
        phase_models: phaseModels,
      });

      router.push(`/scans/${res.id}`);
    } catch (err: any) {
      setError(err.message || "Failed to initialize scan.");
      setLoading(false);
    }
  };

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
          <span className="font-medium">{error}</span>
        </div>
      )}

      <form onSubmit={handleLaunch} className="space-y-6">
        {/* Section 1: Repository Source */}
        <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-6 space-y-5 shadow-xs backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <Shield className="w-4 h-4 text-purple-700" />
              <span>Target Source Ingestion</span>
            </h2>
            <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200">
              <button
                type="button"
                onClick={() => setSourceType("git")}
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  sourceType === "git" ? "bg-purple-700 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>Remote Git URL</span>
              </button>
              <button
                type="button"
                onClick={() => setSourceType("local")}
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  sourceType === "local" ? "bg-purple-700 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Folder className="w-3.5 h-3.5" />
                <span>Local Server Path</span>
              </button>
            </div>
          </div>

          {sourceType === "git" ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Git Clone URL (GitHub, GitLab, Bitbucket, Gitea)
                </label>
                <input
                  type="text"
                  required
                  value={sourceTarget}
                  onChange={(e) => setSourceTarget(e.target.value)}
                  placeholder="https://github.com/org/repository.git"
                  className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 font-mono transition-all"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Branch
                  </label>
                  <input
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main"
                    className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 font-mono transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                    <span>Personal Access Token (Private Repos)</span>
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
              <p className="text-[11px] text-slate-500 mt-1.5">
                Target directory path on your host machine (e.g., <code>/Users/surya/Downloads/sBank-main</code>).
              </p>
            </div>
          )}
        </div>

        {/* Section 2: Model Routing Strategy */}
        <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-6 space-y-5 shadow-xs backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <Cpu className="w-4 h-4 text-purple-700" />
              <span>Model Routing Strategy</span>
            </h2>
            <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200 text-xs">
              {(["fast", "local", "frontier", "custom"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handlePresetChange(p)}
                  className={`px-3 py-1 rounded-lg capitalize font-bold transition-all ${
                    preset === p ? "bg-purple-700 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {preset === "custom" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { phase: "recon", label: "Phase 1: Recon & Summarize" },
                { phase: "threat_model", label: "Phase 2: Threat Modeling" },
                { phase: "research", label: "Phase 3: Code Researcher" },
                { phase: "critic", label: "Phase 4: Adversarial Critic" },
                { phase: "reproduce", label: "Phase 5: Exploit Reproducer" },
                { phase: "patch", label: "Phase 6: Remediation & Patch" },
              ].map(({ phase, label }) => (
                <div key={phase}>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">{label}</label>
                  <select
                    value={phaseModels[phase] || ""}
                    onChange={(e) => setPhaseModels({ ...phaseModels, [phase]: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm text-slate-900 focus:outline-none focus:border-purple-600 focus:bg-white focus:ring-2 focus:ring-purple-200/50 font-mono transition-all"
                  >
                    {availableModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name} ({m.provider})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 bg-purple-50/50 rounded-xl border border-purple-200/80 text-xs space-y-1.5">
              <p className="text-purple-900 font-bold uppercase tracking-wider flex items-center space-x-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-600"></span>
                <span>{preset} Routing Matrix Configured:</span>
              </p>
              <ul className="text-slate-600 text-[11px] list-disc list-inside space-y-0.5 ml-1">
                <li>Recon &amp; Threat Model: <code className="text-purple-800 font-bold">{phaseModels.recon}</code></li>
                <li>Research &amp; Critic: <code className="text-purple-800 font-bold">{phaseModels.critic}</code></li>
                <li>PoC Reproducer &amp; Patch: <code className="text-purple-800 font-bold">{phaseModels.reproduce}</code></li>
              </ul>
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

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 px-4 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white font-bold text-sm rounded-xl flex items-center justify-center space-x-2 transition-all shadow-xs hover:-translate-y-0.5"
        >
          <Play className="w-4 h-4 fill-white" />
          <span>{loading ? "Initializing Scan Pipeline..." : "Start Autonomous Audit"}</span>
        </button>
      </form>
    </div>
  );
}
