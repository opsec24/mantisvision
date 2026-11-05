"use client";

import React, { useEffect, useState, useMemo } from "react";
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
  Zap,
  Square,
  Search,
  Layers,
  Sparkles,
  ArrowRight,
  Filter,
  X,
} from "lucide-react";
import { api } from "@/lib/api";

function formatTokens(n: number = 0): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return (n || 0).toLocaleString();
}

const SQUADS_DEF = [
  {
    num: "SQUAD 01",
    name: "Recon & Surface Mapping",
    desc: "AST structural indexing & historical delta tracking",
    agents: "3 Agents",
    nodes: ["History Miner", "AST Indexer", "Architect"],
    border: "border-amber-500/30 hover:border-amber-500/60",
    badge: "bg-amber-950/80 text-amber-300 border-amber-800/80",
  },
  {
    num: "SQUAD 02",
    name: "Threat & Strategy",
    desc: "STRIDE threat matrix & hunting campaign planner",
    agents: "2 Agents",
    nodes: ["Threat Modeler", "Campaign Planner"],
    border: "border-cyan-500/30 hover:border-cyan-500/60",
    badge: "bg-cyan-950/80 text-cyan-300 border-cyan-800/80",
  },
  {
    num: "SQUAD 03",
    name: "Vulnerability Audit",
    desc: "Deep taint flow analysis & exploit hypothesis generation",
    agents: "1 Agent + 1 Gate",
    nodes: ["Researcher", "Findings Gate"],
    border: "border-indigo-500/30 hover:border-indigo-500/60",
    badge: "bg-indigo-950/80 text-indigo-300 border-indigo-800/80",
  },
  {
    num: "SQUAD 04",
    name: "Adversarial Triage",
    desc: "Red-team stress-testing & false-positive elimination",
    agents: "3 Agents + 2 Gates",
    nodes: ["Deduplicator", "Reviewer", "Critic"],
    border: "border-amber-600/40 hover:border-amber-500/80",
    badge: "bg-amber-900/60 text-amber-400 border-amber-700/80",
  },
  {
    num: "SQUAD 05",
    name: "Exploit & Remediation",
    desc: "Sandboxed PoC reproduction & zero-regression patch synthesis",
    agents: "6 Agents + 1 Gate",
    nodes: ["Reproducer", "Patcher", "Reporter"],
    border: "border-emerald-500/30 hover:border-emerald-500/60",
    badge: "bg-emerald-950/80 text-emerald-300 border-emerald-800/80",
  },
];

export default function DashboardPage() {
  const router = useRouter();
  const [scans, setScans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "completed" | "failed">("all");

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchScans = async () => {
    try {
      setError(null);
      const data = await api.listScans();
      setScans(Array.isArray(data) ? data : []);
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
    if (selectedIds.length === filteredScans.length && filteredScans.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredScans.map((s) => s.id));
    }
  };

  const toggleSelectOne = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleDeleteOne = async (scan: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const scanTitle = scan.name || scan.source_target;
    if (
      !window.confirm(
        `Are you sure you want to delete scan "${scanTitle}"? This will permanently remove all findings and artifacts.`
      )
    ) {
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

  const handleCancelOne = async (scan: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const scanTitle = scan.name || scan.source_target;
    if (!window.confirm(`Stop running audit "${scanTitle}"?`)) {
      return;
    }

    try {
      setActionLoading(true);
      await api.cancelScan(scan.id);
      await fetchScans();
    } catch (err: any) {
      alert(err.message || "Failed to cancel scan.");
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
    if (
      !window.confirm(
        `Are you sure you want to permanently delete the ${selectedIds.length} selected scan(s)? All findings and test harnesses will be erased.`
      )
    ) {
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

  // Filtered scans
  const filteredScans = useMemo(() => {
    return scans.filter((s) => {
      // Status filter
      if (statusFilter === "running" && s.status !== "running" && s.status !== "queued") return false;
      if (statusFilter === "completed" && s.status !== "completed") return false;
      if (
        statusFilter === "failed" &&
        s.status !== "failed" &&
        s.status !== "error" &&
        s.status !== "budget_exceeded" &&
        s.status !== "cancelled"
      ) {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const nameMatch = (s.name || "").toLowerCase().includes(q);
        const targetMatch = (s.source_target || "").toLowerCase().includes(q);
        const branchMatch = (s.branch || "").toLowerCase().includes(q);
        const modelMatch = (s.model || "").toLowerCase().includes(q);
        if (!nameMatch && !targetMatch && !branchMatch && !modelMatch) return false;
      }

      return true;
    });
  }, [scans, statusFilter, searchQuery]);

  // Compute metrics
  const activeScans = scans.filter((s) => s.status === "running" || s.status === "queued").length;
  const completedScans = scans.filter((s) => s.status === "completed").length;
  const failedScans = scans.filter(
    (s) => s.status === "failed" || s.status === "error" || s.status === "budget_exceeded" || s.status === "cancelled"
  ).length;
  const totalSpend = scans.reduce((acc, s) => acc + (s.cost_spent_usd || 0), 0);
  const totalTokens = scans.reduce((acc, s) => acc + (s.total_tokens || 0), 0);
  const totalFindings = scans.reduce((acc, s) => acc + (s.findings_count || 0), 0);

  const latestScan = scans.length > 0 ? scans[0] : null;

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
      case "cancelled":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold font-mono bg-slate-900 text-slate-400 border border-slate-700">
            <Square className="w-3 h-3 mr-1 text-slate-400 fill-slate-400/20" />
            Cancelled
          </span>
        );
      case "failed":
      case "error":
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
            className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold rounded-xl text-xs transition-all shadow-md shadow-amber-500/20 glow-amber-btn hover:-translate-y-0.5 cursor-pointer"
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
            <p className="text-[11px] text-rose-400 font-medium font-mono">Discovered across all targets</p>
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
            <p className="text-[11px] text-cyan-400 font-medium font-mono">
              {formatTokens(totalTokens)} tokens consumed
            </p>
          </div>
        </div>
      </div>

      {/* Autonomous Swarm Pipeline Overview: 5 Security Squads & Dynamic Flow */}
      <div className="glass-card rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-300 font-mono">
                  Autonomous Swarm Pipeline
                </span>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  5 SECURITY SQUADS &bull; 19 NODES
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                15 specialized cognitive agents &amp; 4 deterministic validation gates organized into 5 collaborative squads
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {latestScan ? (
              <Link
                href={`/scans/${latestScan.id}/flow`}
                className="flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500 hover:text-slate-950 transition-all glow-amber-btn cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Live Dynamic Graph (DAG Flow) &rarr;</span>
              </Link>
            ) : (
              <Link
                href="/scans/new"
                className="flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500 hover:text-slate-950 transition-all glow-amber-btn cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Launch Swarm Audit &rarr;</span>
              </Link>
            )}
          </div>
        </div>

        {/* 5 Security Squads Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {SQUADS_DEF.map((squad, idx) => (
            <div
              key={squad.num}
              className={`p-3.5 rounded-xl border bg-slate-900/60 transition-all ${squad.border} flex flex-col justify-between`}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-mono text-amber-400 font-bold uppercase">{squad.num}</span>
                  <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${squad.badge}`}>
                    {squad.agents}
                  </span>
                </div>
                <div className="text-xs font-bold text-white mb-1">{squad.name}</div>
                <p className="text-[11px] text-slate-400 leading-snug">{squad.desc}</p>
              </div>

              <div className="pt-2.5 mt-2.5 border-t border-slate-800/80 flex flex-wrap gap-1">
                {squad.nodes.map((node) => (
                  <span
                    key={node}
                    className="text-[10px] font-mono text-slate-300 bg-slate-950/80 px-1.5 py-0.5 rounded border border-slate-800"
                  >
                    {node}
                  </span>
                ))}
              </div>
            </div>
          ))}
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

      {/* Scans Table with Search & Status Filters */}
      <div className="glass-card rounded-2xl overflow-hidden shadow-xl space-y-0">
        {/* Table Header Controls */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/60 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-bold text-white flex items-center space-x-2">
              <span>Security Scans &amp; Audits</span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/60">
                {scans.length} Total
              </span>
            </h2>

            {/* Status Filter Tabs */}
            <div className="flex items-center rounded-xl bg-slate-950 p-1 border border-slate-800 text-xs font-mono">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  statusFilter === "all"
                    ? "bg-amber-500 text-slate-950 shadow-xs"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                All ({scans.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("running")}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  statusFilter === "running"
                    ? "bg-amber-500 text-slate-950 shadow-xs"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Active ({activeScans})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("completed")}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  statusFilter === "completed"
                    ? "bg-amber-500 text-slate-950 shadow-xs"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Completed ({completedScans})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("failed")}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  statusFilter === "failed"
                    ? "bg-amber-500 text-slate-950 shadow-xs"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Failed ({failedScans})
              </button>
            </div>
          </div>

          {/* Search Box & Compare Link */}
          <div className="flex items-center space-x-2.5">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search scans, repos, branches..."
                className="w-full pl-8 pr-7 py-1.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/20"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {scans.length >= 2 && (
              <Link
                href={
                  selectedIds.length >= 2
                    ? `/scans/compare?ids=${selectedIds.join(",")}`
                    : `/scans/compare`
                }
                className="text-xs font-bold text-amber-300 hover:text-white flex items-center space-x-1.5 bg-amber-950/60 hover:bg-amber-900/80 px-3 py-1.5 rounded-xl border border-amber-800/80 transition-all font-mono shrink-0 cursor-pointer"
                title={selectedIds.length >= 2 ? `Compare ${selectedIds.length} selected scans` : "Open scan comparison lab"}
              >
                <GitCompare className="w-3.5 h-3.5 text-amber-400" />
                <span>Compare {selectedIds.length >= 2 ? `(${selectedIds.length})` : ""}</span>
              </Link>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <div className="w-8 h-8 border-2 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
            <p className="text-xs font-mono text-slate-400">Loading audit telemetry...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center space-y-3">
            <div className="p-2.5 bg-rose-950/60 text-rose-400 rounded-xl w-fit mx-auto border border-rose-800/60">
              <AlertTriangle className="w-5 h-5 text-rose-400" />
            </div>
            <p className="text-sm text-rose-300 font-medium">{error}</p>
            <button
              onClick={fetchScans}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-xs font-mono text-slate-300 rounded-lg border border-slate-700 transition-colors cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        ) : filteredScans.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="p-3 bg-amber-950/60 text-amber-400 rounded-full w-fit mx-auto border border-amber-800/60">
              <AlertTriangle className="w-7 h-7 text-amber-400" />
            </div>
            {scans.length === 0 ? (
              <>
                <h3 className="text-sm font-bold text-white">No security scans yet</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Launch your first agentic scan on any Git repository or local source directory to start automated vulnerability verification.
                </p>
                <Link
                  href="/scans/new"
                  className="inline-flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold rounded-xl text-xs transition-all shadow-md shadow-amber-500/20 glow-amber-btn cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Launch First Scan</span>
                </Link>
              </>
            ) : (
              <>
                <h3 className="text-sm font-bold text-white">No scans match your criteria</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto font-mono">
                  No scan matches query &ldquo;{searchQuery}&rdquo; with status filter &ldquo;{statusFilter}&rdquo;.
                </p>
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                  }}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-amber-300 rounded-xl text-xs font-mono border border-slate-800 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Reset All Filters</span>
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950 text-slate-400 text-xs uppercase tracking-wider border-b border-slate-800 font-mono">
                <tr>
                  <th className="w-10 px-4 py-3.5 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === filteredScans.length && filteredScans.length > 0}
                      onChange={toggleSelectAll}
                      title="Select all displayed scans"
                      className="w-4 h-4 rounded text-amber-500 accent-amber-500 cursor-pointer"
                    />
                  </th>
                  <th className="px-6 py-3.5 font-bold">Scan Name &amp; Target</th>
                  <th className="px-6 py-3.5 font-bold">Status &amp; Phase</th>
                  <th className="px-6 py-3.5 font-bold">Verified Bugs</th>
                  <th className="px-6 py-3.5 font-bold">LLM Spend &amp; Tokens</th>
                  <th className="px-6 py-3.5 font-bold">Created</th>
                  <th className="px-6 py-3.5 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredScans.map((scan) => {
                  const isSelected = selectedIds.includes(scan.id);
                  const isMultiModel = scan.phase_models && Object.keys(scan.phase_models).length > 1;
                  const activeModel = isMultiModel
                    ? "Swarm: Multi-Model"
                    : scan.model || scan.scan_config?.model || "gemini-3.5-flash-lite";

                  return (
                    <tr
                      key={scan.id}
                      onClick={() => router.push(`/scans/${scan.id}`)}
                      className={`transition-colors cursor-pointer ${
                        isSelected ? "bg-amber-950/20" : "hover:bg-slate-800/40"
                      }`}
                    >
                      <td className="w-10 px-4 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => toggleSelectOne(scan.id, e as any)}
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
                            <span className="font-bold text-white text-sm max-w-md truncate hover:text-amber-300 block">
                              {scan.name || scan.source_target}
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
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
                              <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-1.5 py-0.2 rounded border border-slate-800 truncate max-w-[160px]" title={activeModel}>
                                {activeModel}
                              </span>
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
                        <span className="text-amber-300 font-semibold block">
                          ${(scan.cost_spent_usd || 0).toFixed(4)}
                        </span>
                        <span className="text-slate-400 text-[10px] block">
                          {formatTokens(scan.total_tokens || 0)} tokens
                        </span>
                      </td>

                      <td className="px-6 py-4 text-xs text-slate-400 whitespace-nowrap font-mono">
                        <div className="flex items-center space-x-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          <span>
                            {mounted && scan.created_at
                              ? new Date(scan.created_at).toLocaleString()
                              : scan.created_at?.split("T")[0] || "N/A"}
                          </span>
                        </div>
                      </td>

                      <td className="px-6 py-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end space-x-1.5">
                          {/* Live Dynamic DAG Flow */}
                          <Link
                            href={`/scans/${scan.id}/flow`}
                            className="p-1.5 text-amber-400 hover:text-white hover:bg-amber-950/60 rounded-lg transition-colors border border-transparent hover:border-amber-800/60 cursor-pointer"
                            title="View Live Dynamic Swarm Graph"
                          >
                            <Zap className="w-4 h-4 text-amber-400" />
                          </Link>

                          {/* View Audit Detail */}
                          <Link
                            href={`/scans/${scan.id}`}
                            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-300 hover:text-white border border-slate-700 text-xs font-bold transition-all shadow-xs cursor-pointer"
                            title="View Full Audit"
                          >
                            <span>Audit</span>
                            <ExternalLink className="w-3 h-3 text-amber-400" />
                          </Link>

                          {/* Cancel if running */}
                          {(scan.status === "running" || scan.status === "queued") && (
                            <button
                              onClick={(e) => handleCancelOne(scan, e)}
                              disabled={actionLoading}
                              title="Stop / Cancel Scan"
                              className="p-1.5 text-rose-400 hover:text-rose-200 hover:bg-rose-950/60 rounded-lg transition-colors border border-transparent hover:border-rose-800/60 cursor-pointer"
                            >
                              <Square className="w-4 h-4 fill-rose-500/30" />
                            </button>
                          )}

                          {/* Retry if failed */}
                          {(scan.status === "failed" ||
                            scan.status === "error" ||
                            scan.status === "cancelled" ||
                            scan.status === "budget_exceeded") && (
                            <button
                              onClick={(e) => handleRetryOne(scan, e)}
                              disabled={actionLoading}
                              title="Retry this scan"
                              className="p-1.5 text-amber-400 hover:text-amber-300 hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-700 cursor-pointer"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}

                          {/* Delete Scan */}
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
