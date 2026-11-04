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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-700" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-3 border-b border-purple-100/90">
        <div>
          <div className="flex items-center space-x-2">
            <Link
              href="/dashboard"
              className="inline-flex items-center text-xs font-semibold text-slate-500 hover:text-purple-700 transition-colors mr-2"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              <span>Dashboard</span>
            </Link>
            <span className="w-2 h-2 rounded-full bg-purple-600"></span>
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
              Comparative Benchmark Matrix
            </span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 mt-1 flex items-center space-x-2">
            <GitCompare className="w-6 h-6 text-purple-700" />
            <span>Multi-Model Scan Comparison</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Evaluate agentic reasoning efficacy, exploit reproduction rates, false positive pruning, and cost efficiency across different LLM backends.
          </p>
        </div>

        {comparisonData?.same_repository && (
          <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold shadow-xs">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            <span>Controlled Benchmark: Same Repository</span>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center space-x-2 text-xs text-rose-800">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Interactive Scan Selection Shelf */}
      <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-5 shadow-xs backdrop-blur-md space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-purple-700" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Select Scans to Compare ({selectedScanIds.length} active)
            </span>
          </div>

          {/* Quick Repo Filter Dropdown */}
          {distinctRepos.length > 1 && (
            <div className="flex items-center space-x-1.5 text-xs">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-500 font-medium">Filter repo:</span>
              <select
                value={repoFilter}
                onChange={(e) => setRepoFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-700 outline-none focus:border-purple-600"
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
                    ? "bg-purple-700 text-white border-purple-800 ring-2 ring-purple-200"
                    : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-purple-50 hover:border-purple-200"
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                    isSelected ? "bg-white text-purple-700 font-bold" : "border border-slate-300"
                  }`}
                >
                  {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                </div>
                <div className="text-left">
                  <div className="truncate max-w-[200px] font-bold">{title}</div>
                  <div className={`text-[10px] font-mono ${isSelected ? "text-purple-200" : "text-slate-400"}`}>
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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-700" />
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
                  className="bg-white/95 border border-purple-100/90 rounded-2xl p-5 shadow-xs space-y-4 flex flex-col justify-between hover:border-purple-300 transition-all"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-purple-700 font-bold bg-purple-50 px-2 py-0.5 rounded border border-purple-200/80">
                        {s.id.slice(0, 8)}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold capitalize ${
                          s.status === "completed"
                            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                            : "bg-amber-50 text-amber-800 border border-amber-200"
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>

                    <div>
                      <h3 className="font-extrabold text-base text-slate-900 truncate" title={s.name}>
                        {s.name}
                      </h3>
                      <p className="text-xs font-mono text-slate-400 truncate mt-0.5" title={s.source_target}>
                        {s.source_target} {s.branch && `(${s.branch})`}
                      </p>
                    </div>

                    {/* Metric Cards Grid */}
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                      <div className="p-2.5 bg-slate-50/80 rounded-xl border border-slate-100">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          Verified Bugs
                        </span>
                        <span className="text-lg font-black text-slate-900 mt-0.5 block">
                          {s.findings_count}
                        </span>
                        <span className="text-[10px] font-semibold text-rose-600">
                          {s.critical_count} Critical, {s.high_count} High
                        </span>
                      </div>

                      <div className="p-2.5 bg-slate-50/80 rounded-xl border border-slate-100">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          Exploits Proven
                        </span>
                        <span className="text-lg font-black text-emerald-700 mt-0.5 block">
                          {s.reproduced_count}
                        </span>
                        <span className="text-[10px] font-semibold text-emerald-600">
                          {reproRate}% reproduction
                        </span>
                      </div>

                      <div className="p-2.5 bg-slate-50/80 rounded-xl border border-slate-100">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          LLM Cost
                        </span>
                        <span className="text-lg font-black text-amber-900 mt-0.5 block font-mono">
                          ${s.cost_spent_usd.toFixed(4)}
                        </span>
                        <span className="text-[10px] text-slate-400">Total API Spend</span>
                      </div>

                      <div className="p-2.5 bg-slate-50/80 rounded-xl border border-slate-100">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          Runtime
                        </span>
                        <span className="text-lg font-black text-slate-900 mt-0.5 block font-mono">
                          {formatDuration(s.duration_seconds)}
                        </span>
                        <span className="text-[10px] text-slate-400">Pipeline Latency</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-2 pt-3 border-t border-slate-100">
                    <Link
                      href={`/scans/${s.id}`}
                      className="flex-1 flex items-center justify-center space-x-1 px-3 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-bold transition-all border border-purple-200"
                    >
                      <span>Audit View</span>
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                    <Link
                      href={`/scans/${s.id}`}
                      className="flex items-center justify-center p-2 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-800 transition-all border border-purple-200"
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
          <div className="bg-white/95 border border-purple-100/90 rounded-2xl overflow-hidden shadow-xs">
            <div className="px-6 py-4 border-b border-purple-100/90 flex items-center justify-between bg-purple-50/20">
              <div className="flex items-center space-x-2">
                <Cpu className="w-4 h-4 text-purple-700" />
                <h2 className="text-sm font-bold text-slate-900">Per-Stage Model Routing Matrix</h2>
              </div>
              <span className="text-xs text-slate-500 font-mono">Autonomous Phase Assignments</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-bold border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3">Verification Phase</th>
                    {comparisonData.scans.map((s: any) => (
                      <th key={s.id} className="px-6 py-3">
                        <span className="font-bold text-slate-900 block truncate max-w-[180px]">
                          {s.name}
                        </span>
                        <span className="text-[10px] font-mono text-purple-700 font-semibold">
                          {s.id.slice(0, 8)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-xs">
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
                        className={`transition-colors ${isDivergent ? "bg-amber-50/30" : "hover:bg-slate-50/50"}`}
                      >
                        <td className="px-6 py-3.5 font-sans font-semibold text-slate-900">
                          <div className="flex items-center space-x-2">
                            <span>{phase.label}</span>
                            {isDivergent && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
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
                                    ? "bg-purple-50 text-purple-900 border-purple-200"
                                    : assignedModel.includes("gpt")
                                    ? "bg-emerald-50 text-emerald-900 border-emerald-200"
                                    : assignedModel.includes("gemini")
                                    ? "bg-sky-50 text-sky-900 border-sky-200"
                                    : "bg-slate-100 text-slate-800 border-slate-200"
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
          <div className="bg-white/95 border border-purple-100/90 rounded-2xl overflow-hidden shadow-xs space-y-4">
            <div className="px-6 py-4 border-b border-purple-100/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-purple-50/20">
              <div className="flex items-center space-x-2">
                <ShieldAlert className="w-5 h-5 text-rose-600" />
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Cross-Model Vulnerability Matrix &amp; Proof Concordance
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Compare which vulnerabilities were identified by each model and whether their exploits were verified.
                  </p>
                </div>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl text-xs font-bold border border-slate-200 overflow-x-auto">
                <button
                  onClick={() => setActiveFilterTab("all")}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    activeFilterTab === "all"
                      ? "bg-purple-700 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  All Unique ({comparisonData.all_findings.length})
                </button>
                <button
                  onClick={() => setActiveFilterTab("common")}
                  className={`px-3 py-1 rounded-lg transition-all ${
                    activeFilterTab === "common"
                      ? "bg-purple-700 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
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
                          ? "bg-purple-700 text-white shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Only in {s.name.slice(0, 10)} ({exclusiveCount})
                    </button>
                  );
                })}
              </div>
            </div>

            {displayedFindings.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-400 italic">
                No vulnerabilities in this filter category.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-bold border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3">Vulnerability Finding</th>
                      <th className="px-6 py-3">Location</th>
                      <th className="px-6 py-3">Severity</th>
                      <th className="px-6 py-3">Detected In</th>
                      <th className="px-6 py-3">Dynamic Exploit PoC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayedFindings.map((f: any) => (
                      <tr key={f.id} className="hover:bg-purple-50/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              {f.cwe && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-purple-50 text-purple-800 border border-purple-200/80">
                                  {f.cwe}
                                </span>
                              )}
                              <span className="font-bold text-slate-900 text-xs">{f.title}</span>
                            </div>
                            {f.description && (
                              <p className="text-[11px] text-slate-500 line-clamp-2 max-w-lg leading-relaxed">
                                {f.description}
                              </p>
                            )}
                          </div>
                        </td>

                        <td className="px-6 py-4 font-mono text-slate-600">
                          {f.file_path ? (
                            <span>
                              {f.file_path} {f.line_number && `:${f.line_number}`}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        <td className="px-6 py-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide ${
                              f.severity === "critical"
                                ? "bg-rose-50 text-rose-800 border border-rose-200"
                                : f.severity === "high"
                                ? "bg-amber-50 text-amber-800 border border-amber-200"
                                : "bg-purple-50 text-purple-800 border border-purple-200"
                            }`}
                          >
                            {f.severity}
                          </span>
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1.5">
                            {comparisonData.scans.map((s: any) => {
                              const wasDetected = f.detected_in_scan_ids.includes(s.id);
                              return (
                                <span
                                  key={s.id}
                                  className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center space-x-1 ${
                                    wasDetected
                                      ? "bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold"
                                      : "bg-slate-100 text-slate-400 border border-slate-200 line-through opacity-60"
                                  }`}
                                  title={wasDetected ? `Detected by ${s.name}` : `Not detected by ${s.name}`}
                                >
                                  <span>{s.name.slice(0, 12)}</span>
                                  {wasDetected ? (
                                    <Check className="w-2.5 h-2.5 text-emerald-600" />
                                  ) : (
                                    <XCircle className="w-2.5 h-2.5 text-slate-400" />
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1.5">
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
                                      ? "bg-purple-100 text-purple-900 border border-purple-300 font-bold"
                                      : hasPoC
                                      ? "bg-amber-50 text-amber-800 border border-amber-200"
                                      : "bg-slate-50 text-slate-500 border border-slate-200"
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
        <div className="p-12 text-center bg-white rounded-2xl border border-purple-100/90 space-y-3">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
          <h3 className="text-sm font-bold text-slate-900">Select at least 2 scans to compare</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Choose multiple audit runs above to evaluate model performance, cost, and finding overlap side-by-side.
          </p>
        </div>
      )}
    </div>
  );
}
