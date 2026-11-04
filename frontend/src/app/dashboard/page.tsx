"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShieldAlert,
  Activity,
  PlusCircle,
  GitBranch,
  Folder,
  DollarSign,
  Clock,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Cpu,
  Trash2,
  GitCompare,
  RotateCcw,
} from "lucide-react";
import { api } from "@/lib/api";

export default function DashboardPage() {
  const router = useRouter();
  const [scans, setScans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchScans = async () => {
    try {
      const data = await api.listScans();
      setScans(data);
    } catch (err: any) {
      setError(err.message || "Failed to load scans.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScans();
    const interval = setInterval(fetchScans, 10000);
    return () => clearInterval(interval);
  }, []);

  const toggleSelectAll = () => {
    if (selectedIds.length === scans.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(scans.map((s) => s.id));
    }
  };

  const toggleSelectOne = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleDeleteOne = async (scan: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const scanTitle = scan.name || scan.source_target;
    if (!window.confirm(`Are you sure you want to delete scan "${scanTitle}"? This will permanently remove all findings and artifacts.`)) {
      return;
    }

    try {
      setActionLoading(true);
      await api.deleteScan(scan.id);
      setSelectedIds((prev) => prev.filter((id) => id !== scan.id));
      await fetchScans();
    } catch (err: any) {
      alert(err.message || "Failed to delete scan.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRetryOne = async (scan: any, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setActionLoading(true);
      await api.retryScan(scan.id);
      await fetchScans();
    } catch (err: any) {
      alert(err.message || "Failed to retry scan.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to permanently delete the ${selectedIds.length} selected scan(s)? All findings and test harnesses will be erased.`)) {
      return;
    }

    try {
      setActionLoading(true);
      await api.bulkDeleteScans(selectedIds);
      setSelectedIds([]);
      await fetchScans();
    } catch (err: any) {
      alert(err.message || "Failed to delete selected scans.");
    } finally {
      setActionLoading(false);
    }
  };

  // Compute metrics
  const activeScans = scans.filter((s) => s.status === "running" || s.status === "queued").length;
  const completedScans = scans.filter((s) => s.status === "completed").length;
  const totalSpend = scans.reduce((acc, s) => acc + (s.cost_spent_usd || 0), 0);
  const totalFindings = scans.reduce((acc, s) => acc + (s.findings_count || 0), 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-200">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-600 animate-ping mr-1.5" />
            Running
          </span>
        );
      case "queued":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5" />
            Queued
          </span>
        );
      case "completed":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" />
            Completed
          </span>
        );
      case "failed":
      case "budget_exceeded":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200">
            <XCircle className="w-3.5 h-3.5 mr-1 text-rose-600" />
            {status === "budget_exceeded" ? "Budget Cap" : "Failed"}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-purple-100/90">
        <div>
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-purple-600"></span>
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
              Executive Telemetry &bull; Imperial Studio
            </span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 mt-1">
            Security Scans Overview
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Agentic vulnerability discovery, symbolic execution verification, and zero-regression automated patch PRs.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={fetchScans}
            className="p-2 text-slate-500 hover:text-purple-900 bg-white hover:bg-purple-50 rounded-xl border border-slate-200 shadow-xs transition-all"
            title="Refresh Scans"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <Link
            href="/scans/new"
            className="flex items-center space-x-2 px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold transition-all shadow-sm hover:-translate-y-0.5"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Launch New Scan</span>
          </Link>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-5 shadow-xs backdrop-blur-md flex items-center space-x-4">
          <div className="p-3 bg-purple-50 text-purple-700 rounded-xl border border-purple-200/80 shadow-xs">
            <Activity className="w-6 h-6 text-purple-700" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Active Pipeline Runs</p>
            <h3 className="text-2xl font-extrabold text-slate-900 mt-0.5">{activeScans}</h3>
            <p className="text-[11px] text-purple-700 font-medium">Autonomous agents engaged</p>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-5 shadow-xs backdrop-blur-md flex items-center space-x-4">
          <div className="p-3 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-200/80 shadow-xs">
            <CheckCircle2 className="w-6 h-6 text-emerald-700" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Completed Audits</p>
            <h3 className="text-2xl font-extrabold text-slate-900 mt-0.5">{completedScans}</h3>
            <p className="text-[11px] text-emerald-700 font-medium">Formal proofs sealed</p>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-5 shadow-xs backdrop-blur-md flex items-center space-x-4">
          <div className="p-3 bg-rose-50 text-rose-700 rounded-xl border border-rose-200/80 shadow-xs">
            <ShieldAlert className="w-6 h-6 text-rose-700" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Verified Exploits</p>
            <h3 className="text-2xl font-extrabold text-slate-900 mt-0.5">{totalFindings}</h3>
            <p className="text-[11px] text-rose-700 font-medium">Reproduced via PoC harness</p>
          </div>
        </div>

        {/* Metric 4 */}
        <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-5 shadow-xs backdrop-blur-md flex items-center space-x-4">
          <div className="p-3 bg-amber-50 text-amber-700 rounded-xl border border-amber-200/80 shadow-xs">
            <DollarSign className="w-6 h-6 text-amber-700" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Total LLM Spend</p>
            <h3 className="text-2xl font-extrabold text-slate-900 mt-0.5">
              ${totalSpend.toFixed(3)}
            </h3>
            <p className="text-[11px] text-purple-700 font-medium">Native Swarm Traces &amp; Forensics</p>
          </div>
        </div>
      </div>

      {/* Mantis ADK Pipeline Overview */}
      <div className="bg-white/90 border border-purple-100/90 rounded-2xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-purple-700" />
            <span className="text-xs font-bold uppercase tracking-wider text-purple-900">Google Mantis ADK Pipeline</span>
            <span className="text-xs text-slate-400">&bull; Event-Driven Graph</span>
          </div>
          <span className="text-xs text-slate-500 font-mono">ADK Graph: 15 Nodes</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
          <div className="p-2.5 rounded-xl border border-purple-200/80 bg-purple-50/40 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-purple-700">01 &bull; Ingest</div>
            <div className="text-xs font-semibold text-slate-800 mt-0.5">Repo Staging</div>
            <div className="text-[10px] text-purple-600 font-medium mt-1">Inode Guard</div>
          </div>
          <div className="p-2.5 rounded-xl border border-purple-200/80 bg-purple-50/40 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-purple-700">02 &bull; Index</div>
            <div className="text-xs font-semibold text-slate-800 mt-0.5">AST &amp; Call Graph</div>
            <div className="text-[10px] text-emerald-600 font-bold mt-1">&check; Tree-sitter</div>
          </div>
          <div className="p-2.5 rounded-xl border border-purple-200/80 bg-purple-50/40 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-purple-700">03 &bull; Threat</div>
            <div className="text-xs font-semibold text-slate-800 mt-0.5">Threat Model</div>
            <div className="text-[10px] text-purple-600 font-medium mt-1">KB Synthesis</div>
          </div>
          <div className="p-2.5 rounded-xl border border-purple-200/80 bg-purple-50/40 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-purple-700">04 &bull; Research</div>
            <div className="text-xs font-semibold text-slate-800 mt-0.5">Taint Walk</div>
            <div className="text-[10px] text-purple-600 font-medium mt-1">Catalog Tools</div>
          </div>
          <div className="p-2.5 rounded-xl border border-amber-200 bg-amber-50/50 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-amber-800">05 &bull; Critic</div>
            <div className="text-xs font-semibold text-slate-800 mt-0.5">Triage &amp; Dedupe</div>
            <div className="text-[10px] text-amber-700 font-bold mt-1">Anti-Hallucination</div>
          </div>
          <div className="p-2.5 rounded-xl border border-purple-200 bg-purple-50 text-center shadow-xs">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-purple-800">06 &bull; Reproduce</div>
            <div className="text-xs font-bold text-purple-950 mt-0.5">Dynamic PoC</div>
            <div className="text-[10px] text-purple-700 font-bold mt-1">Sandbox Exec</div>
          </div>
          <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">07 &bull; Patch</div>
            <div className="text-xs font-medium text-slate-700 mt-0.5">Patch &amp; Calibrate</div>
            <div className="text-[10px] text-emerald-600 font-medium mt-1">SARIF Report</div>
          </div>
        </div>
      </div>

      {/* Bulk Action Floating Toolbar */}
      {selectedIds.length > 0 && (
        <div className="bg-slate-900 text-white px-5 py-3 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg border border-slate-800 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center space-x-3">
            <span className="font-extrabold text-xs bg-purple-600 text-white px-3 py-1 rounded-full shadow-xs">
              {selectedIds.length} Selected
            </span>
            <span className="text-xs text-slate-300 font-medium">
              Perform bulk operations across selected scans
            </span>
          </div>
          <div className="flex items-center space-x-2.5 w-full sm:w-auto">
            <Link
              href={`/scans/compare?ids=${selectedIds.join(",")}`}
              className={`flex-1 sm:flex-none flex items-center justify-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs ${
                selectedIds.length >= 2
                  ? "bg-amber-500 hover:bg-amber-400 text-slate-950 hover:shadow-md cursor-pointer"
                  : "bg-slate-800 text-slate-500 cursor-not-allowed pointer-events-none border border-slate-700"
              }`}
              title={selectedIds.length < 2 ? "Select at least 2 scans to compare" : "Compare selected scans"}
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span>Compare Scans {selectedIds.length < 2 ? "(Select ≥ 2)" : `(${selectedIds.length})`}</span>
            </Link>
            <button
              onClick={handleBulkDelete}
              disabled={actionLoading}
              className="flex-1 sm:flex-none flex items-center justify-center space-x-1.5 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete ({selectedIds.length})</span>
            </button>
            <button
              onClick={() => setSelectedIds([])}
              className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Scans Table */}
      <div className="bg-white/95 border border-purple-100/90 rounded-2xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-purple-100/90 flex items-center justify-between bg-purple-50/20">
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-bold text-slate-900">Security Scans &amp; Audits</h2>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-100 text-purple-800">
              {scans.length} Total Runs
            </span>
          </div>
          {scans.length >= 2 && (
            <Link
              href={
                selectedIds.length >= 2
                  ? `/scans/compare?ids=${selectedIds.join(",")}`
                  : `/scans/compare?ids=${scans.slice(0, 2).map((s) => s.id).join(",")}`
              }
              className="text-xs font-bold text-purple-700 hover:text-purple-900 flex items-center space-x-1 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-xl border border-purple-200 transition-all"
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span>Compare Scans</span>
            </Link>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-700" />
          </div>
        ) : error ? (
          <div className="p-6 text-center text-sm text-rose-600 font-medium">{error}</div>
        ) : scans.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="p-3 bg-purple-50 text-purple-700 rounded-full w-fit mx-auto border border-purple-200">
              <AlertTriangle className="w-8 h-8 text-purple-600" />
            </div>
            <h3 className="text-sm font-bold text-slate-900">No security scans yet</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Launch your first agentic scan on any Git repository or local source directory to start automated vulnerability verification.
            </p>
            <Link
              href="/scans/new"
              className="inline-flex items-center space-x-2 px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Launch First Scan</span>
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="w-10 px-4 py-3.5 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === scans.length && scans.length > 0}
                      onChange={toggleSelectAll}
                      title="Select all scans"
                      className="w-4 h-4 rounded text-purple-600 accent-purple-600 cursor-pointer"
                    />
                  </th>
                  <th className="px-6 py-3.5 font-bold">Scan Name &amp; Target</th>
                  <th className="px-6 py-3.5 font-bold">Status &amp; Phase</th>
                  <th className="px-6 py-3.5 font-bold">Verified Bugs</th>
                  <th className="px-6 py-3.5 font-bold">LLM Cost</th>
                  <th className="px-6 py-3.5 font-bold">Created</th>
                  <th className="px-6 py-3.5 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {scans.map((scan) => {
                  const isSelected = selectedIds.includes(scan.id);
                  return (
                    <tr
                      key={scan.id}
                      className={`transition-colors ${
                        isSelected ? "bg-purple-50/60" : "hover:bg-slate-50/60"
                      }`}
                    >
                      <td className="w-10 px-4 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOne(scan.id)}
                          className="w-4 h-4 rounded text-purple-600 accent-purple-600 cursor-pointer"
                        />
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="p-2 bg-purple-50 rounded-xl border border-purple-200 text-purple-700 shrink-0">
                            {scan.source_type === "git" ? (
                              <GitBranch className="w-4 h-4 text-purple-700" />
                            ) : (
                              <Folder className="w-4 h-4 text-amber-600" />
                            )}
                          </div>
                          <div>
                            <Link
                              href={`/scans/${scan.id}`}
                              className="font-bold text-slate-900 text-sm max-w-md truncate hover:text-purple-700 hover:underline block"
                            >
                              {scan.name || scan.source_target}
                            </Link>
                            <div className="flex flex-wrap items-center gap-2 mt-0.5">
                              {scan.name && scan.name !== scan.source_target && (
                                <span className="text-[11px] font-mono text-slate-400 max-w-sm truncate">
                                  {scan.source_target}
                                </span>
                              )}
                              {scan.branch && (
                                <span className="text-[10px] text-purple-800 font-mono bg-purple-50 px-1.5 py-0.2 rounded border border-purple-200/80 inline-block">
                                  {scan.branch}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <div>{getStatusBadge(scan.status)}</div>
                          {scan.current_phase && scan.status === "running" && (
                            <div className="text-[11px] text-purple-700 font-mono capitalize">
                              Phase: {scan.current_phase.replace("_", " ")}
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        {scan.findings_count && scan.findings_count > 0 ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-800 border border-rose-200">
                            {scan.findings_count} Exploits
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 font-medium">0</span>
                        )}
                      </td>

                      <td className="px-6 py-4 font-mono text-xs">
                        <span className="text-amber-800 font-semibold">
                          ${(scan.cost_spent_usd || 0).toFixed(4)}
                        </span>
                        {scan.budget_limit_usd && (
                          <span className="text-slate-400 text-[10px] block">
                            cap: ${scan.budget_limit_usd.toFixed(2)}
                          </span>
                        )}
                      </td>

                      <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">
                        <div className="flex items-center space-x-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>{new Date(scan.created_at).toLocaleString()}</span>
                        </div>
                      </td>

                      <td className="px-6 py-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end space-x-2">
                          <Link
                            href={`/scans/${scan.id}`}
                            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-700 text-purple-700 hover:text-white border border-purple-200 text-xs font-bold transition-all shadow-xs"
                          >
                            <span>View Audit</span>
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                          {(scan.status === "failed" || scan.status === "error" || scan.status === "cancelled" || scan.status === "budget_exceeded") && (
                            <button
                              onClick={(e) => handleRetryOne(scan, e)}
                              disabled={actionLoading}
                              title="Retry this scan"
                              className="p-1.5 text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded-lg transition-colors border border-transparent hover:border-purple-200"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={(e) => handleDeleteOne(scan, e)}
                            disabled={actionLoading}
                            title="Delete this scan"
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-200"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
