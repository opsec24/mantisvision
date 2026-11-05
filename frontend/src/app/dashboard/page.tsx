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
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold font-mono bg-amber-950/80 text-amber-300 border border-amber-500/80 glow-amber-btn animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping mr-1.5" />
            Running
          </span>
        );
      case "queued":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold font-mono bg-slate-900 text-slate-300 border border-slate-700">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mr-1.5" />
            Queued
          </span>
        );
      case "completed":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 glow-emerald-repro">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-400" />
            Completed
          </span>
        );
      case "failed":
      case "budget_exceeded":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold font-mono bg-rose-950/80 text-rose-300 border border-rose-700/60 glow-rose-crit">
            <XCircle className="w-3.5 h-3.5 mr-1 text-rose-400" />
            {status === "budget_exceeded" ? "Budget Cap" : "Failed"}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold font-mono bg-slate-900 text-slate-400 border border-slate-800">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
              Executive Telemetry &bull; Obsidian Amber Aurora
            </span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white mt-1">
            Security Scans Overview
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 font-mono">
            Agentic vulnerability discovery, symbolic execution verification, and zero-regression automated patch PRs.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={fetchScans}
            className="p-2 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-800 shadow-xs transition-all cursor-pointer"
            title="Refresh Scans"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <Link
            href="/scans/new"
            className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold rounded-xl text-xs transition-all shadow-md shadow-amber-500/20 glow-amber-btn hover:-translate-y-0.5"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Launch New Scan</span>
          </Link>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div className="glass-card rounded-2xl p-5 shadow-xl flex items-center space-x-4">
          <div className="p-3 bg-amber-950/80 text-amber-300 rounded-xl border border-amber-800/80 shadow-xs glow-amber-btn">
            <Activity className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">Active Pipeline Runs</p>
            <h3 className="text-2xl font-extrabold text-white mt-0.5">{activeScans}</h3>
            <p className="text-[11px] text-amber-400 font-medium font-mono">Autonomous agents engaged</p>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="glass-card rounded-2xl p-5 shadow-xl flex items-center space-x-4">
          <div className="p-3 bg-emerald-950/80 text-emerald-300 rounded-xl border border-emerald-800/80 shadow-xs glow-emerald-repro">
            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">Completed Audits</p>
            <h3 className="text-2xl font-extrabold text-white mt-0.5">{completedScans}</h3>
            <p className="text-[11px] text-emerald-400 font-medium font-mono">Formal proofs sealed</p>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="glass-card rounded-2xl p-5 shadow-xl flex items-center space-x-4">
          <div className="p-3 bg-rose-950/80 text-rose-300 rounded-xl border border-rose-800/80 shadow-xs glow-rose-crit">
            <ShieldAlert className="w-6 h-6 text-rose-400" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">Verified Exploits</p>
            <h3 className="text-2xl font-extrabold text-white mt-0.5">{totalFindings}</h3>
            <p className="text-[11px] text-rose-400 font-medium font-mono">Reproduced via PoC harness</p>
          </div>
        </div>

        {/* Metric 4 */}
        <div className="glass-card rounded-2xl p-5 shadow-xl flex items-center space-x-4">
          <div className="p-3 bg-cyan-950/80 text-cyan-300 rounded-xl border border-cyan-800/80 shadow-xs">
            <DollarSign className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">Total LLM Spend</p>
            <h3 className="text-2xl font-extrabold text-white mt-0.5">
              ${totalSpend.toFixed(3)}
            </h3>
            <p className="text-[11px] text-cyan-400 font-medium font-mono">Native Swarm Traces &amp; Forensics</p>
          </div>
        </div>
      </div>

      {/* Swarm Pipeline Overview */}
      <div className="glass-card rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-amber-300 font-mono">Autonomous Swarm Pipeline</span>
            <span className="text-xs text-slate-500 font-mono">&bull; Event-Driven Graph</span>
          </div>
          <span className="text-xs text-slate-400 font-mono">19-Stage Multi-Agent Topology</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
          <div className="p-2.5 rounded-xl border border-slate-800 bg-slate-900/60 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-amber-400">01 &bull; Ingest</div>
            <div className="text-xs font-semibold text-slate-200 mt-0.5">Repo Staging</div>
            <div className="text-[10px] text-slate-400 font-medium mt-1">Inode Guard</div>
          </div>
          <div className="p-2.5 rounded-xl border border-slate-800 bg-slate-900/60 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-amber-400">02 &bull; Index</div>
            <div className="text-xs font-semibold text-slate-200 mt-0.5">AST &amp; Call Graph</div>
            <div className="text-[10px] text-emerald-400 font-bold mt-1">&check; Tree-sitter</div>
          </div>
          <div className="p-2.5 rounded-xl border border-slate-800 bg-slate-900/60 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-amber-400">03 &bull; Threat</div>
            <div className="text-xs font-semibold text-slate-200 mt-0.5">Threat Model</div>
            <div className="text-[10px] text-cyan-400 font-medium mt-1">KB Synthesis</div>
          </div>
          <div className="p-2.5 rounded-xl border border-slate-800 bg-slate-900/60 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-amber-400">04 &bull; Research</div>
            <div className="text-xs font-semibold text-slate-200 mt-0.5">Taint Walk</div>
            <div className="text-[10px] text-indigo-400 font-medium mt-1">Catalog Tools</div>
          </div>
          <div className="p-2.5 rounded-xl border border-amber-800/80 bg-amber-950/40 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-amber-300">05 &bull; Critic</div>
            <div className="text-xs font-semibold text-slate-200 mt-0.5">Triage &amp; Dedupe</div>
            <div className="text-[10px] text-amber-400 font-bold mt-1">Anti-Hallucination</div>
          </div>
          <div className="p-2.5 rounded-xl border border-amber-500/80 bg-amber-950/60 text-center shadow-xs glow-amber-btn">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-amber-300">06 &bull; Reproduce</div>
            <div className="text-xs font-bold text-amber-100 mt-0.5">Dynamic PoC</div>
            <div className="text-[10px] text-amber-300 font-bold mt-1">Sandbox Exec</div>
          </div>
          <div className="p-2.5 rounded-xl border border-slate-800 bg-slate-900/60 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">07 &bull; Patch</div>
            <div className="text-xs font-medium text-slate-200 mt-0.5">Patch &amp; Calibrate</div>
            <div className="text-[10px] text-emerald-400 font-medium mt-1">SARIF Report</div>
          </div>
        </div>
      </div>

      {/* Bulk Action Floating Toolbar */}
      {selectedIds.length > 0 && (
        <div className="bg-[#0f1422] text-white px-5 py-3 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xl border border-slate-800 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center space-x-3">
            <span className="font-extrabold text-xs bg-amber-500 text-slate-950 px-3 py-1 rounded-full shadow-xs">
              {selectedIds.length} Selected
            </span>
            <span className="text-xs text-slate-300 font-medium font-mono">
              Perform bulk operations across selected scans
            </span>
          </div>
          <div className="flex items-center space-x-2.5 w-full sm:w-auto">
            <Link
              href={`/scans/compare?ids=${selectedIds.join(",")}`}
              className={`flex-1 sm:flex-none flex items-center justify-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs ${
                selectedIds.length >= 2
                  ? "bg-amber-500 hover:bg-amber-400 text-slate-950 hover:shadow-md cursor-pointer glow-amber-btn"
                  : "bg-slate-900 text-slate-600 cursor-not-allowed pointer-events-none border border-slate-800"
              }`}
              title={selectedIds.length < 2 ? "Select at least 2 scans to compare" : "Compare selected scans"}
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span>Compare Scans {selectedIds.length < 2 ? "(Select ≥ 2)" : `(${selectedIds.length})`}</span>
            </Link>
            <button
              onClick={handleBulkDelete}
              disabled={actionLoading}
              className="flex-1 sm:flex-none flex items-center justify-center space-x-1.5 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete ({selectedIds.length})</span>
            </button>
            <button
              onClick={() => setSelectedIds([])}
              className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Scans Table */}
      <div className="glass-card rounded-2xl overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-bold text-white">Security Scans &amp; Audits</h2>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/60">
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
              className="text-xs font-bold text-amber-300 hover:text-white flex items-center space-x-1 bg-amber-950/60 hover:bg-amber-900/80 px-3 py-1.5 rounded-xl border border-amber-800/80 transition-all font-mono"
            >
              <GitCompare className="w-3.5 h-3.5 text-amber-400" />
              <span>Compare Scans</span>
            </Link>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
          </div>
        ) : error ? (
          <div className="p-6 text-center text-sm text-rose-400 font-medium">{error}</div>
        ) : scans.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="p-3 bg-amber-950/60 text-amber-400 rounded-full w-fit mx-auto border border-amber-800/60">
              <AlertTriangle className="w-8 h-8 text-amber-400" />
            </div>
            <h3 className="text-sm font-bold text-white">No security scans yet</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Launch your first agentic scan on any Git repository or local source directory to start automated vulnerability verification.
            </p>
            <Link
              href="/scans/new"
              className="inline-flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold rounded-xl text-xs transition-all shadow-md shadow-amber-500/20 glow-amber-btn"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Launch First Scan</span>
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950 text-slate-400 text-xs uppercase tracking-wider border-b border-slate-800 font-mono">
                <tr>
                  <th className="w-10 px-4 py-3.5 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === scans.length && scans.length > 0}
                      onChange={toggleSelectAll}
                      title="Select all scans"
                      className="w-4 h-4 rounded text-amber-500 accent-amber-500 cursor-pointer"
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
              <tbody className="divide-y divide-slate-800/60">
                {scans.map((scan) => {
                  const isSelected = selectedIds.includes(scan.id);
                  return (
                    <tr
                      key={scan.id}
                      className={`transition-colors ${
                        isSelected ? "bg-amber-950/20" : "hover:bg-slate-800/40"
                      }`}
                    >
                      <td className="w-10 px-4 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOne(scan.id)}
                          className="w-4 h-4 rounded text-amber-500 accent-amber-500 cursor-pointer"
                        />
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="p-2 bg-slate-900 rounded-xl border border-slate-800 text-amber-400 shrink-0">
                            {scan.source_type === "git" ? (
                              <GitBranch className="w-4 h-4 text-amber-400" />
                            ) : (
                              <Folder className="w-4 h-4 text-amber-400" />
                            )}
                          </div>
                          <div>
                            <Link
                              href={`/scans/${scan.id}`}
                              className="font-bold text-white text-sm max-w-md truncate hover:text-amber-300 hover:underline block"
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
                                <span className="text-[10px] text-amber-300 font-mono bg-amber-950/60 px-1.5 py-0.2 rounded border border-amber-800/60 inline-block">
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
                            <div className="text-[11px] text-amber-400 font-mono capitalize">
                              Phase: {scan.current_phase.replace("_", " ")}
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        {scan.findings_count && scan.findings_count > 0 ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-rose-950/80 text-rose-300 border border-rose-700/80 glow-rose-crit">
                            {scan.findings_count} Exploits
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500 font-mono font-medium">0</span>
                        )}
                      </td>

                      <td className="px-6 py-4 font-mono text-xs">
                        <span className="text-amber-300 font-semibold">
                          ${(scan.cost_spent_usd || 0).toFixed(4)}
                        </span>
                        {scan.budget_limit_usd && (
                          <span className="text-slate-500 text-[10px] block">
                            cap: ${scan.budget_limit_usd.toFixed(2)}
                          </span>
                        )}
                      </td>

                      <td className="px-6 py-4 text-xs text-slate-400 whitespace-nowrap font-mono">
                        <div className="flex items-center space-x-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          <span>{new Date(scan.created_at).toLocaleString()}</span>
                        </div>
                      </td>

                      <td className="px-6 py-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end space-x-2">
                          <Link
                            href={`/scans/${scan.id}`}
                            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-300 hover:text-white border border-slate-700 text-xs font-bold transition-all shadow-xs"
                          >
                            <span>View Audit</span>
                            <ExternalLink className="w-3 h-3 text-amber-400" />
                          </Link>
                          {(scan.status === "failed" || scan.status === "error" || scan.status === "cancelled" || scan.status === "budget_exceeded") && (
                            <button
                              onClick={(e) => handleRetryOne(scan, e)}
                              disabled={actionLoading}
                              title="Retry this scan"
                              className="p-1.5 text-amber-400 hover:text-amber-300 hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-700 cursor-pointer"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={(e) => handleDeleteOne(scan, e)}
                            disabled={actionLoading}
                            title="Delete this scan"
                            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition-colors border border-transparent hover:border-rose-800/60 cursor-pointer"
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
