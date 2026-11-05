"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  GitCompare,
  ShieldAlert,
  DollarSign,
  Clock,
  Cpu,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  Filter,
  Terminal,
  Layers,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";

export default function ScanComparisonPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [allScans, setAllScans] = useState<any[]>([]);
  const [selectedScanIds, setSelectedScanIds] = useState<string[]>([]);
  const [comparisonData, setComparisonData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Findings filter tab: "all" | "common" | scan_id
  const [activeFilterTab, setActiveFilterTab] = useState<string>("all");
  const [repoFilter, setRepoFilter] = useState<string>("all");

  // Initial load: parse IDs from query params and fetch all available scans
  useEffect(() => {
    const rawIds = searchParams.get("ids");
    const parsedIds = rawIds ? rawIds.split(",").map((s) => s.trim()).filter(Boolean) : [];

    api.listScans()
      .then((scans) => {
        setAllScans(scans);
        if (parsedIds.length >= 2) {
          setSelectedScanIds(parsedIds);
        } else if (scans.length >= 2) {
          // If no query params, pick the top 2 scans by default
          setSelectedScanIds([scans[0].id, scans[1].id]);
        }
      })
      .catch((err) => setError(err.message || "Failed to load scans list"))
      .finally(() => setLoading(false));
  }, [searchParams]);

  // When selectedScanIds change and has >= 2 items, fetch comparison data
  useEffect(() => {
    if (selectedScanIds.length < 2) {
      setComparisonData(null);
      return;
    }

    setComparing(true);
    setError(null);

    api.compareScans(selectedScanIds)
      .then((data) => {
        setComparisonData(data);
        setActiveFilterTab("all");
      })
      .catch((err) => {
        setError(err.message || "Failed to compare scans");
        setComparisonData(null);
      })
      .finally(() => setComparing(false));

    // Keep URL query in sync
    const newQuery = `?ids=${selectedScanIds.join(",")}`;
    window.history.replaceState(null, "", `/scans/compare${newQuery}`);
  }, [selectedScanIds]);

  const toggleScanSelection = (id: string) => {
    if (selectedScanIds.includes(id)) {
      if (selectedScanIds.length <= 2) {
        alert("You must select at least 2 scans to maintain a comparison.");
        return;
      }
      setSelectedScanIds(selectedScanIds.filter((item) => item !== id));
    } else {
      setSelectedScanIds([...selectedScanIds, id]);
    }
  };

  // Distinct repositories among available scans for quick filtering
  const distinctRepos = useMemo(() => {
    const set = new Set<string>();
    allScans.forEach((s) => {
      const clean = s.source_target.replace(/\.git$/, "");
      set.add(clean);
    });
    return Array.from(set);
  }, [allScans]);

  const filteredAvailableScans = useMemo(() => {
    if (repoFilter === "all") return allScans;
    return allScans.filter((s) => s.source_target.replace(/\.git$/, "") === repoFilter);
  }, [allScans, repoFilter]);

  const formatDuration = (seconds?: number) => {
    if (seconds === undefined || seconds === null) return "—";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  // Filtered findings based on active tab
  const displayedFindings = useMemo(() => {
    if (!comparisonData) return [];
    if (activeFilterTab === "all") return comparisonData.all_findings;
    if (activeFilterTab === "common") return comparisonData.common_findings;
    return comparisonData.exclusive_findings[activeFilterTab] || [];
  }, [comparisonData, activeFilterTab]);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-3 border-b border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <Link
              href="/dashboard"
              className="inline-flex items-center text-xs font-semibold text-slate-400 hover:text-amber-400 transition-colors mr-2"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              <span>Dashboard</span>
            </Link>
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
              Comparative Benchmark Matrix
            </span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white mt-1 flex items-center space-x-2">
            <GitCompare className="w-6 h-6 text-amber-400" />
            <span>Multi-Model Scan Comparison</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Evaluate agentic reasoning efficacy, exploit reproduction rates, false positive pruning, and cost efficiency across different LLM backends.
          </p>
        </div>

        {comparisonData?.same_repository && (
          <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 rounded-xl text-xs font-bold shadow-xs font-mono glow-emerald-repro">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>Controlled Benchmark: Same Repository</span>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-rose-950/60 border border-rose-800/80 rounded-xl flex items-center space-x-2 text-xs text-rose-300">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Interactive Scan Selection Shelf */}
      <div className="glass-card border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200 font-mono">
              Select Scans to Compare ({selectedScanIds.length} active)
            </span>
          </div>

          {/* Quick Repo Filter Dropdown */}
          {distinctRepos.length > 1 && (
            <div className="flex items-center space-x-1.5 text-xs font-mono">
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-slate-400 font-medium">Filter repo:</span>
              <select
                value={repoFilter}
                onChange={(e) => setRepoFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs font-semibold text-white outline-none focus:border-amber-500"
              >
                <option value="all">All Repositories ({distinctRepos.length})</option>
                {distinctRepos.map((r) => (
                  <option key={r} value={r}>
                    {r.split("/").pop()}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Scan Pills */}
        <div className="flex flex-wrap gap-2 pt-1">
          {filteredAvailableScans.map((s) => {
            const isSelected = selectedScanIds.includes(s.id);
            const title = s.name || s.source_target;
            return (
              <button
                key={s.id}
                onClick={() => toggleScanSelection(s.id)}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all border shadow-xs ${
                  isSelected
                    ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black border-amber-500 ring-2 ring-amber-500/40 glow-amber-btn"
                    : "bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700"
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                    isSelected ? "bg-slate-950 text-amber-400 font-bold" : "border border-slate-600"
                  }`}
                >
                  {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                </div>
                <div className="text-left">
                  <div className="truncate max-w-[200px] font-bold">{title}</div>
                  <div className={`text-[10px] font-mono ${isSelected ? "text-slate-900 font-extrabold" : "text-slate-400"}`}>
                    ${(s.cost_spent_usd || 0).toFixed(4)} &bull; {s.findings_count || 0} bugs
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {comparing ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
        </div>
      ) : comparisonData ? (
        <div className="space-y-6">
          {/* Section 1: Executive KPI Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {comparisonData.scans.map((s: any) => {
              const reproRate = s.findings_count > 0 ? Math.round((s.reproduced_count / s.findings_count) * 100) : 0;
              return (
                <div
                  key={s.id}
                  className="glass-card border border-slate-800 hover:border-amber-500/40 rounded-2xl p-5 shadow-xl space-y-4 flex flex-col justify-between transition-all"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-amber-400 font-bold bg-amber-950/80 px-2 py-0.5 rounded border border-amber-500/40">
                        {s.id.slice(0, 8)}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold capitalize font-mono ${
                          s.status === "completed"
                            ? "bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 glow-emerald-repro"
                            : "bg-amber-950/80 text-amber-300 border border-amber-500/60"
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>

                    <div>
                      <h3 className="font-extrabold text-base text-white truncate" title={s.name}>
                        {s.name}
                      </h3>
                      <p className="text-xs font-mono text-slate-400 truncate mt-0.5" title={s.source_target}>
                        {s.source_target} {s.branch && `(${s.branch})`}
                      </p>
                    </div>

                    {/* Metric Cards Grid */}
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                      <div className="p-2.5 bg-slate-950/80 rounded-xl border border-slate-800">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block font-mono">
                          Verified Bugs
                        </span>
                        <span className="text-lg font-black text-white mt-0.5 block">
                          {s.findings_count}
                        </span>
                        <span className="text-[10px] font-semibold text-rose-400 font-mono">
                          {s.critical_count} Critical, {s.high_count} High
                        </span>
                      </div>

                      <div className="p-2.5 bg-slate-950/80 rounded-xl border border-slate-800">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block font-mono">
                          Exploits Proven
                        </span>
                        <span className="text-lg font-black text-emerald-400 mt-0.5 block font-mono">
                          {s.reproduced_count}
                        </span>
                        <span className="text-[10px] font-semibold text-emerald-400 font-mono">
                          {reproRate}% reproduction
                        </span>
                      </div>

                      <div className="p-2.5 bg-slate-950/80 rounded-xl border border-slate-800">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block font-mono">
                          LLM Cost
                        </span>
                        <span className="text-lg font-black text-amber-400 mt-0.5 block font-mono">
                          ${s.cost_spent_usd.toFixed(4)}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">Total API Spend</span>
                      </div>

                      <div className="p-2.5 bg-slate-950/80 rounded-xl border border-slate-800">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block font-mono">
                          Runtime
                        </span>
                        <span className="text-lg font-black text-white mt-0.5 block font-mono">
                          {formatDuration(s.duration_seconds)}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">Pipeline Latency</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-2 pt-3 border-t border-slate-800">
                    <Link
                      href={`/scans/${s.id}`}
                      className="flex-1 flex items-center justify-center space-x-1 px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-black transition-all glow-amber-btn"
                    >
                      <span>Audit View</span>
                      <ExternalLink className="w-3 h-3 text-slate-950" />
                    </Link>
                    <Link
                      href={`/scans/${s.id}`}
                      className="flex items-center justify-center p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 transition-all border border-slate-800"
                      title="Inspect full trace in Swarm Trace Inspector"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Section 2: Model Configuration Matrix per Phase */}
          <div className="glass-card border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center space-x-2">
                <Cpu className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-bold text-white">Per-Stage Model Routing Matrix</h2>
              </div>
              <span className="text-xs text-slate-400 font-mono">Autonomous Phase Assignments</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-mono border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-3">Verification Phase</th>
                    {comparisonData.scans.map((s: any) => (
                      <th key={s.id} className="px-6 py-3">
                        <span className="font-bold text-white block truncate max-w-[180px]">
                          {s.name}
                        </span>
                        <span className="text-[10px] font-mono text-amber-400 font-semibold">
                          {s.id.slice(0, 8)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                  {[
                    { key: "recon", label: "02 Recon (Taint Flow & Sinks)" },
                    { key: "threat_model", label: "03 Threat (Callgraph Reachability)" },
                    { key: "research", label: "04 Research (SMT / Constraint Solving)" },
                    { key: "critic", label: "05 Critic (FP Pruning & Dedupe)" },
                    { key: "reproduce", label: "06 Reproduce (Dynamic Docker PoC)" },
                    { key: "patch", label: "07 Patch (Zero-Regression Fix)" },
                  ].map((phase) => {
                    const modelsForPhase = comparisonData.phase_models[phase.key] || {};
                    const distinctInRow = new Set(Object.values(modelsForPhase)).size;
                    const isDivergent = distinctInRow > 1;

                    return (
                      <tr
                        key={phase.key}
                        className={`transition-colors ${isDivergent ? "bg-amber-950/20" : "hover:bg-slate-800/30"}`}
                      >
                        <td className="px-6 py-3.5 font-sans font-semibold text-white">
                          <div className="flex items-center space-x-2">
                            <span>{phase.label}</span>
                            {isDivergent && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-950/80 text-amber-300 border border-amber-500/50">
                                Variant Model
                              </span>
                            )}
                          </div>
                        </td>
                        {comparisonData.scans.map((s: any) => {
                          const assignedModel = modelsForPhase[s.id] || "default";
                          return (
                            <td key={s.id} className="px-6 py-3.5">
                              <span
                                className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                                  assignedModel.includes("claude")
                                    ? "bg-amber-950/80 text-amber-300 border-amber-500/60"
                                    : assignedModel.includes("gpt")
                                    ? "bg-emerald-950/80 text-emerald-300 border-emerald-700/60"
                                    : assignedModel.includes("gemini")
                                    ? "bg-sky-950/80 text-sky-300 border-sky-700/60"
                                    : "bg-slate-900 text-slate-300 border-slate-800"
                                }`}
                              >
                                {assignedModel}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 3: Vulnerability Findings Differential Matrix */}
          <div className="glass-card border border-slate-800 rounded-2xl overflow-hidden shadow-xl space-y-4">
            <div className="px-6 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/60">
              <div className="flex items-center space-x-2">
                <ShieldAlert className="w-5 h-5 text-rose-400" />
                <div>
                  <h2 className="text-sm font-bold text-white">
                    Cross-Model Vulnerability Matrix &amp; Proof Concordance
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Compare which vulnerabilities were identified by each model and whether their exploits were verified.
                  </p>
                </div>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl text-xs font-bold border border-slate-800 overflow-x-auto font-mono">
                <button
                  onClick={() => setActiveFilterTab("all")}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    activeFilterTab === "all"
                      ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow-xs glow-amber-btn"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  All Unique ({comparisonData.all_findings.length})
                </button>
                <button
                  onClick={() => setActiveFilterTab("common")}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    activeFilterTab === "common"
                      ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow-xs glow-amber-btn"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Common to All ({comparisonData.common_findings.length})
                </button>
                {comparisonData.scans.map((s: any) => {
                  const exclusiveCount = (comparisonData.exclusive_findings[s.id] || []).length;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setActiveFilterTab(s.id)}
                      className={`px-3 py-1 rounded-lg transition-all ${
                        activeFilterTab === s.id
                          ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow-xs glow-amber-btn"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      Only in {s.name.slice(0, 10)} ({exclusiveCount})
                    </button>
                  );
                })}
              </div>
            </div>

            {displayedFindings.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500 italic">
                No vulnerabilities in this filter category.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-mono border-b border-slate-800">
                    <tr>
                      <th className="px-6 py-3">Vulnerability Finding</th>
                      <th className="px-6 py-3">Location</th>
                      <th className="px-6 py-3">Severity</th>
                      <th className="px-6 py-3">Detected In</th>
                      <th className="px-6 py-3">Dynamic Exploit PoC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {displayedFindings.map((f: any) => (
                      <tr key={f.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              {f.cwe && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-500/40">
                                  {f.cwe}
                                </span>
                              )}
                              <span className="font-bold text-white text-xs">{f.title}</span>
                            </div>
                            {f.description && (
                              <p className="text-[11px] text-slate-400 line-clamp-2 max-w-lg leading-relaxed">
                                {f.description}
                              </p>
                            )}
                          </div>
                        </td>

                        <td className="px-6 py-4 font-mono text-slate-400">
                          {f.file_path ? (
                            <span>
                              {f.file_path} {f.line_number && `:${f.line_number}`}
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>

                        <td className="px-6 py-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide font-mono ${
                              f.severity === "critical"
                                ? "bg-rose-950/90 text-rose-300 border border-rose-600/80 glow-rose-crit"
                                : f.severity === "high"
                                ? "bg-amber-950/90 text-amber-300 border border-amber-500/80 glow-amber-btn"
                                : "bg-slate-900 text-slate-300 border border-slate-700"
                            }`}
                          >
                            {f.severity}
                          </span>
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1.5 font-mono">
                            {comparisonData.scans.map((s: any) => {
                              const wasDetected = f.detected_in_scan_ids.includes(s.id);
                              return (
                                <span
                                  key={s.id}
                                  className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center space-x-1 ${
                                    wasDetected
                                      ? "bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 font-bold glow-emerald-repro"
                                      : "bg-slate-900 text-slate-500 border border-slate-800 line-through opacity-50"
                                  }`}
                                  title={wasDetected ? `Detected by ${s.name}` : `Not detected by ${s.name}`}
                                >
                                  <span>{s.name.slice(0, 12)}</span>
                                  {wasDetected ? (
                                    <Check className="w-2.5 h-2.5 text-emerald-400" />
                                  ) : (
                                    <XCircle className="w-2.5 h-2.5 text-slate-500" />
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1.5 font-mono">
                            {comparisonData.scans.map((s: any) => {
                              const hasPoC = Boolean(f.has_poc?.[s.id]);
                              const isRepro = f.scan_statuses?.[s.id] === "reproduced";
                              if (!f.detected_in_scan_ids.includes(s.id)) {
                                return null;
                              }
                              return (
                                <span
                                  key={s.id}
                                  className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center space-x-1 ${
                                    isRepro
                                      ? "bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 font-bold glow-emerald-repro"
                                      : hasPoC
                                      ? "bg-amber-950/80 text-amber-300 border border-amber-500/60"
                                      : "bg-slate-900 text-slate-500 border border-slate-800"
                                  }`}
                                  title={`${s.name}: ${isRepro ? "Exploit Proven" : hasPoC ? "PoC Generated" : "Static Only"}`}
                                >
                                  <span>{s.name.slice(0, 10)}:</span>
                                  <span className="font-bold">{isRepro ? "Exploit Proven" : hasPoC ? "PoC Script" : "Static"}</span>
                                </span>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="p-12 text-center glass-card rounded-2xl border border-slate-800 space-y-3">
          <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
          <h3 className="text-sm font-bold text-white">Select at least 2 scans to compare</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Choose multiple audit runs above to evaluate model performance, cost, and finding overlap side-by-side.
          </p>
        </div>
      )}
    </div>
  );
}
