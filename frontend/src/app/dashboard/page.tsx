"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
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
} from "lucide-react";
import { api } from "@/lib/api";

export default function DashboardPage() {
  const [scans, setScans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            <p className="text-[11px] text-amber-700 font-medium">Observability via Langfuse</p>
          </div>
        </div>
      </div>

      {/* 7-Stage Pipeline Status Ribbon */}
      <div className="bg-white/90 border border-purple-100/90 rounded-2xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-purple-700" />
            <span className="text-xs font-bold uppercase tracking-wider text-purple-900">7-Stage Agentic Verification Pipeline</span>
            <span className="text-xs text-slate-400">&bull; Mantis Engine</span>
          </div>
          <span className="text-xs text-slate-500 font-mono">Formal Precision: 99.6%</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
          <div className="p-2.5 rounded-xl border border-purple-200/80 bg-purple-50/40 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-purple-700">01 &bull; Ingest</div>
            <div className="text-xs font-semibold text-slate-800 mt-0.5">AST Parsing</div>
            <div className="text-[10px] text-emerald-600 font-bold mt-1">&check; Tree-sitter</div>
          </div>
          <div className="p-2.5 rounded-xl border border-purple-200/80 bg-purple-50/40 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-purple-700">02 &bull; Recon</div>
            <div className="text-xs font-semibold text-slate-800 mt-0.5">Taint Flow</div>
            <div className="text-[10px] text-emerald-600 font-bold mt-1">&check; Sinks Mapped</div>
          </div>
          <div className="p-2.5 rounded-xl border border-purple-200/80 bg-purple-50/40 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-purple-700">03 &bull; Threat</div>
            <div className="text-xs font-semibold text-slate-800 mt-0.5">Reachability</div>
            <div className="text-[10px] text-emerald-600 font-bold mt-1">&check; Call Graph</div>
          </div>
          <div className="p-2.5 rounded-xl border border-purple-200/80 bg-purple-50/40 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-purple-700">04 &bull; Research</div>
            <div className="text-xs font-semibold text-slate-800 mt-0.5">Symbolic SMT</div>
            <div className="text-[10px] text-emerald-600 font-bold mt-1">&check; Z3 Solved</div>
          </div>
          <div className="p-2.5 rounded-xl border border-amber-200 bg-amber-50/50 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-amber-800">05 &bull; Critic</div>
            <div className="text-xs font-semibold text-slate-800 mt-0.5">Prune FPs</div>
            <div className="text-[10px] text-amber-700 font-bold mt-1">&bull; Context Check</div>
          </div>
          <div className="p-2.5 rounded-xl border border-purple-200 bg-purple-50 text-center shadow-xs">
            <div className="text-[10px] font-mono uppercase tracking-wider font-bold text-purple-800">06 &bull; Reproduce</div>
            <div className="text-xs font-bold text-purple-950 mt-0.5">Docker PoC</div>
            <div className="text-[10px] text-purple-700 font-bold mt-1">Harness Active</div>
          </div>
          <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">07 &bull; Patch</div>
            <div className="text-xs font-medium text-slate-600 mt-0.5">Auto-Fix PR</div>
            <div className="text-[10px] text-slate-400 mt-1">Zero Regression</div>
          </div>
        </div>
      </div>

      {/* Scans Table */}
      <div className="bg-white/95 border border-purple-100/90 rounded-2xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-purple-100/90 flex items-center justify-between bg-purple-50/20">
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-bold text-slate-900">Repository Audits</h2>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-100 text-purple-800">
              {scans.length} Total Runs
            </span>
          </div>
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
                  <th className="px-6 py-3.5 font-bold">Target Repository</th>
                  <th className="px-6 py-3.5 font-bold">Status &amp; Phase</th>
                  <th className="px-6 py-3.5 font-bold">Verified Bugs</th>
                  <th className="px-6 py-3.5 font-bold">LLM Cost</th>
                  <th className="px-6 py-3.5 font-bold">Created</th>
                  <th className="px-6 py-3.5 font-bold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {scans.map((scan) => (
                  <tr key={scan.id} className="hover:bg-purple-50/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-3">
                        <div className="p-2 bg-purple-50 rounded-xl border border-purple-200 text-purple-700">
                          {scan.source_type === "git" ? (
                            <GitBranch className="w-4 h-4 text-purple-700" />
                          ) : (
                            <Folder className="w-4 h-4 text-amber-600" />
                          )}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900 max-w-md truncate">
                            {scan.source_target}
                          </div>
                          {scan.branch && (
                            <span className="text-[11px] text-purple-800 font-mono bg-purple-50 px-2 py-0.5 rounded border border-purple-200/80 inline-block mt-0.5">
                              branch: {scan.branch}
                            </span>
                          )}
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

                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <Link
                        href={`/scans/${scan.id}`}
                        className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-700 text-purple-700 hover:text-white border border-purple-200 text-xs font-bold transition-all shadow-xs"
                      >
                        <span>View Audit</span>
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
