"use client";

import React, { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ShieldAlert,
  GitBranch,
  Terminal,
  FileCode,
  DollarSign,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  StopCircle,
  Clock,
  Download,
  Cpu,
  Layers,
  FileText,
  ShieldCheck,
  RotateCcw,
  Play,
  ArrowRight,
  Bug,
  Brain,
} from "lucide-react";
import { api } from "@/lib/api";
import ArchitectureGraph from "@/components/ArchitectureGraph";
import ThreatModelGraph from "@/components/ThreatModelGraph";
import SwarmTraceViewer from "@/components/SwarmTraceViewer";

const PHASES = [
  { id: "ingest", label: "01 Ingest", nodes: ["setup", "clone", "ready", "ingest"] },
  { id: "indexing", label: "02 Index & History", nodes: ["history", "structural_index", "indexing"] },
  { id: "threat_model", label: "03 Threat Model", nodes: ["architect", "threat_modeler", "threat_model"] },
  { id: "research", label: "04 Plan & Research", nodes: ["planner", "researcher", "research"] },
  { id: "critic", label: "05 Review & Critic", nodes: ["deduplicator", "reviewer", "critic", "findings_gate"] },
  { id: "reproduce", label: "06 Dynamic PoC", nodes: ["reproducer", "chainer", "reproduce"] },
  { id: "patch", label: "07 Patch & Calibrate", nodes: ["patcher", "calibrator", "reflector", "reporter", "patch", "completed"] },
];

function formatTokens(n: number = 0): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return (n || 0).toLocaleString();
}

export default function ScanDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();

  const [scan, setScan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // SSE streaming logs
  const [streamLogs, setStreamLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Expanded cards
  const [expandedPoc, setExpandedPoc] = useState<Record<string, boolean>>({});
  const [expandedPatch, setExpandedPatch] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<"findings" | "threat_model" | "review_packet" | "logs" | "trace">("findings");
  const [tracePhaseFilter, setTracePhaseFilter] = useState<string>("all");
  const [traceQueryFilter, setTraceQueryFilter] = useState<string>("");

  const fetchScan = async () => {
    try {
      const data = await api.getScan(id);
      setScan(data);
    } catch (err: any) {
      setError(err.message || "Failed to load scan details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScan();
  }, [id]);

  // Connect to SSE stream for real-time and historical logs
  useEffect(() => {
    if (!scan) return;

    const token = typeof window !== "undefined" ? localStorage.getItem("sast_auth_token") : null;
    const streamUrl = token
      ? `/api/scans/${id}/stream?token=${encodeURIComponent(token)}`
      : `/api/scans/${id}/stream`;

    const eventSource = new EventSource(streamUrl);

    const parseTimestamp = (ts: any) => {
      if (!ts) return new Date().toLocaleTimeString();
      if (typeof ts === "string") {
        const d = new Date(ts);
        return isNaN(d.getTime()) ? new Date().toLocaleTimeString() : d.toLocaleTimeString();
      }
      if (typeof ts === "number") {
        return new Date(ts > 1e11 ? ts : ts * 1000).toLocaleTimeString();
      }
      return new Date().toLocaleTimeString();
    };

    const handleData = (rawText: string) => {
      try {
        const data = JSON.parse(rawText);
        if (data.done) {
          eventSource.close();
          fetchScan();
          return;
        }

        const time = parseTimestamp(data.timestamp);
        const phase = (data.phase || "PIPELINE").toUpperCase();
        const msg = data.message || "";
        const logLine = `[${time}] [${phase}] ${msg}`;

        setStreamLogs((prev) => {
          if (prev.includes(logLine)) return prev;
          return [...prev, logLine];
        });

        // Live state sync so status, phase, cost and token counters update without page refresh
        if (
          data.phase ||
          data.status ||
          data.cost !== undefined ||
          data.total_tokens !== undefined
        ) {
          setScan((prev: any) => {
            if (!prev) return prev;
            // Automatically refetch scan details when phase transitions to load newly generated architecture/threat artifacts
            if (data.phase && data.phase !== prev.current_phase) {
              setTimeout(fetchScan, 500);
            }
            return {
              ...prev,
              current_phase: data.phase || prev.current_phase,
              status: data.status || prev.status,
              cost_spent_usd: data.cost !== undefined ? data.cost : prev.cost_spent_usd,
              total_tokens: data.total_tokens !== undefined ? data.total_tokens : prev.total_tokens,
              prompt_tokens: data.prompt_tokens !== undefined ? data.prompt_tokens : prev.prompt_tokens,
              completion_tokens: data.completion_tokens !== undefined ? data.completion_tokens : prev.completion_tokens,
            };
          });
        }

        // If status reaches a terminal state, refresh scan details
        if (
          data.status === "completed" ||
          data.status === "failed" ||
          data.status === "budget_exceeded" ||
          data.status === "cancelled"
        ) {
          fetchScan();
        }
      } catch {
        setStreamLogs((prev) => (prev.includes(rawText) ? prev : [...prev, rawText]));
      }
    };

    eventSource.onmessage = (event) => {
      handleData(event.data);
    };

    eventSource.addEventListener("progress", (event: any) => {
      handleData(event.data);
    });

    eventSource.addEventListener("done", (event: any) => {
      try {
        const data = JSON.parse(event.data);
        if (data.status) fetchScan();
      } catch {}
      eventSource.close();
      fetchScan();
    });

    eventSource.onerror = () => {
      // Allow browser to reconnect automatically if stream drops
    };

    return () => {
      eventSource.close();
    };
  }, [id, scan?.id]);

  // Periodic poll while scan is in active state (queued / running)
  useEffect(() => {
    if (!scan || (scan.status !== "running" && scan.status !== "queued")) return;
    const interval = setInterval(() => {
      fetchScan();
    }, 3000);
    return () => clearInterval(interval);
  }, [scan?.status, id]);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamLogs]);

  const handleCancel = async () => {
    if (!confirm("Are you sure you want to abort this security audit?")) return;
    try {
      await api.cancelScan(id);
      fetchScan();
    } catch (err: any) {
      alert(err.message || "Failed to cancel scan.");
    }
  };

  const [actionLoading, setActionLoading] = useState(false);

  const handleRetry = async () => {
    if (!confirm("Are you sure you want to restart this scan completely from scratch? All intermediate checkpoints will be reset.")) return;
    try {
      setActionLoading(true);
      await api.retryScan(id);
      setScan((prev: any) => prev ? { ...prev, status: "queued", current_phase: "ingest", error_message: null } : prev);
      setStreamLogs((prev) => [...prev, "[SYSTEM] Scan re-queued for execution from scratch..."]);
      setTimeout(() => {
        fetchScan();
        setActionLoading(false);
      }, 600);
    } catch (err: any) {
      alert(err.message || "Failed to restart scan.");
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    try {
      setActionLoading(true);
      await api.resumeScan(id);
      setScan((prev: any) => prev ? { ...prev, status: "queued", error_message: null } : prev);
      setStreamLogs((prev) => [...prev, "[SYSTEM] Resuming scan from verified checkpoints..."]);
      setTimeout(() => {
        fetchScan();
        setActionLoading(false);
      }, 600);
    } catch (err: any) {
      alert(err.message || "Failed to resume scan.");
      setActionLoading(false);
    }
  };

  const getPhaseIndex = (phase?: string) => {
    if (!phase) return 0;
    const clean = phase.toLowerCase();
    if (clean === "running") return 0;
    const idx = PHASES.findIndex((p) => p.id === clean || p.nodes.includes(clean));
    return idx >= 0 ? idx : 0;
  };

  const currentPhaseIdx = getPhaseIndex(scan?.current_phase);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-700" />
      </div>
    );
  }

  if (error || !scan) {
    return (
      <div className="p-8 text-center bg-rose-50 border border-rose-200 rounded-2xl space-y-3">
        <AlertTriangle className="w-8 h-8 text-rose-600 mx-auto" />
        <h3 className="text-sm font-bold text-slate-900">Scan Not Found or Error</h3>
        <p className="text-xs text-slate-500">{error || "Unable to retrieve scan record."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-6 shadow-xs backdrop-blur-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center space-x-2.5">
            <h1 className="text-xl font-extrabold text-slate-900 max-w-xl truncate">
              {scan.name || scan.source_target}
            </h1>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-bold capitalize ${
                scan.status === "completed"
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  : scan.status === "running"
                  ? "bg-purple-50 text-purple-800 border border-purple-200 animate-pulse"
                  : scan.status === "failed" || scan.status === "budget_exceeded"
                  ? "bg-rose-50 text-rose-800 border border-rose-200"
                  : "bg-amber-50 text-amber-800 border border-amber-200"
              }`}
            >
              {scan.status.replace("_", " ")}
            </span>
          </div>
          {scan.name && scan.name !== scan.source_target && (
            <p className="text-xs font-mono text-slate-500 truncate max-w-xl">
              {scan.source_target}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
            {scan.branch && (
              <span className="flex items-center space-x-1 font-mono text-purple-800 bg-purple-50 px-2 py-0.5 rounded border border-purple-200/80">
                <GitBranch className="w-3.5 h-3.5 text-purple-600" />
                <span>{scan.branch}</span>
              </span>
            )}
            <span className="flex items-center space-x-1">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>{new Date(scan.created_at).toLocaleString()}</span>
            </span>
            <span className="flex items-center space-x-1 text-amber-800 font-mono font-bold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
              <DollarSign className="w-3.5 h-3.5 text-amber-600" />
              <span>
                ${(scan.cost_spent_usd || 0).toFixed(4)}
                {scan.budget_limit_usd && ` / $${scan.budget_limit_usd.toFixed(2)}`}
              </span>
            </span>
            <span
              className="flex items-center space-x-1.5 text-indigo-800 font-mono font-bold bg-indigo-50 px-2.5 py-0.5 rounded border border-indigo-200"
              title={`Prompt Tokens: ${(scan.prompt_tokens || 0).toLocaleString()} | Completion Tokens: ${(scan.completion_tokens || 0).toLocaleString()}`}
            >
              <Cpu className="w-3.5 h-3.5 text-indigo-600" />
              <span>
                {formatTokens(scan.total_tokens || 0)} Tokens
                <span className="text-[10px] text-indigo-600 font-normal ml-1">
                  ({formatTokens(scan.prompt_tokens || 0)} in / {formatTokens(scan.completion_tokens || 0)} out)
                </span>
              </span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Download Unified Patch */}
          <a
            href={`/api/scans/${id}/export/patch?token=${encodeURIComponent(typeof window !== "undefined" ? localStorage.getItem("sast_auth_token") || "" : "")}`}
            download
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 transition-all shadow-xs"
            title="Download unified git patch (.diff)"
          >
            <FileCode className="w-3.5 h-3.5 text-emerald-700" />
            <span>Download .patch</span>
          </a>

          {/* Export Bundle */}
          <a
            href={`/api/scans/${id}/export/bundle?token=${encodeURIComponent(typeof window !== "undefined" ? localStorage.getItem("sast_auth_token") || "" : "")}`}
            download
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-purple-50 hover:text-purple-900 transition-all shadow-xs"
            title="Download complete audit ZIP bundle (findings, patch, review packet, logs)"
          >
            <Download className="w-3.5 h-3.5 text-purple-600" />
            <span>Export Bundle</span>
          </a>

          {/* Deep link into Swarm Trace Inspector */}
          <button
            onClick={() => setActiveTab("trace")}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-purple-50 text-purple-900 border border-purple-200 hover:bg-purple-100 transition-all shadow-xs cursor-pointer"
          >
            <Brain className="w-3.5 h-3.5 text-purple-700" />
            <span>Inspect Swarm Traces</span>
          </button>

          {/* Resume and Restart Buttons (for failed, cancelled, or error scans) */}
          {(scan.status === "failed" || scan.status === "cancelled" || scan.status === "error" || scan.status === "budget_exceeded") && (
            <div className="flex items-center space-x-2">
              <button
                onClick={handleResume}
                disabled={actionLoading}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-800 hover:to-indigo-800 text-white transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                title="Resume scan from last completed checkpoint without re-cloning or re-auditing finished modules"
              >
                <Play className={`w-3.5 h-3.5 fill-current ${actionLoading ? "animate-spin" : ""}`} />
                <span>Resume Scan</span>
              </button>
              <button
                onClick={handleRetry}
                disabled={actionLoading}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                title="Wipe previous checkpoints and restart this scan from scratch"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${actionLoading ? "animate-spin" : ""}`} />
                <span>Restart Clean</span>
              </button>
            </div>
          )}

          {scan.status === "running" && (
            <button
              onClick={handleCancel}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100 transition-all shadow-xs"
            >
              <StopCircle className="w-3.5 h-3.5 text-rose-600" />
              <span>Abort Scan</span>
            </button>
          )}
        </div>
      </div>

      {/* Scan Error Banner */}
      {(scan.status === "failed" || scan.status === "budget_exceeded" || scan.status === "error") && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-rose-900 shadow-xs">
          <div className="flex items-start space-x-3 overflow-hidden">
            <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
            <div className="space-y-1 overflow-hidden">
              <h4 className="text-xs font-bold uppercase tracking-wide text-rose-800">
                Scan Execution Paused or Failed
              </h4>
              <p className="text-xs font-mono text-rose-700 whitespace-pre-wrap break-all">
                {scan.error_message || "The autonomous analysis pipeline encountered an interruption. You can resume from the last completed stage or restart from scratch."}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 shrink-0 self-start sm:self-auto">
            <button
              onClick={handleResume}
              disabled={actionLoading}
              className="px-3.5 py-2 bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs rounded-xl flex items-center space-x-1.5 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
              title="Resume from last completed checkpoint"
            >
              <Play className={`w-3.5 h-3.5 fill-current ${actionLoading ? "animate-spin" : ""}`} />
              <span>Resume Scan</span>
            </button>
            <button
              onClick={handleRetry}
              disabled={actionLoading}
              className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold text-xs rounded-xl flex items-center space-x-1.5 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
              title="Restart from scratch"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${actionLoading ? "animate-spin" : ""}`} />
              <span>Restart Clean</span>
            </button>
          </div>
        </div>
      )}

      {/* Visual Funnel Stepper */}
      <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-3">
          <div className="flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-purple-700" />
            <span className="text-xs font-bold uppercase text-purple-900 tracking-wider">
              Autonomous Verification Funnel
            </span>
          </div>
          <span className="text-xs font-mono text-slate-500 flex items-center space-x-1.5">
            <span>Click any stage box to filter Swarm Traces, reasoning &amp; tool calls</span>
            <Brain className="w-3 h-3 text-purple-600" />
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {PHASES.map((p, idx) => {
            const isDone = scan.status === "completed" || idx < currentPhaseIdx;
            const isCurrent = scan.status === "running" && idx === currentPhaseIdx;
            const obsCount = scan.stage_observation_counts?.[p.id];

            return (
              <button
                key={p.id}
                onClick={() => {
                  setTracePhaseFilter(p.id);
                  setActiveTab("trace");
                }}
                title={
                  obsCount
                    ? `Inspect ${p.label} Swarm traces, model thinking & tool calls (${obsCount} step${obsCount > 1 ? "s" : ""})`
                    : `Inspect ${p.label} in Swarm Trace Inspector`
                }
                className={`group relative p-3 rounded-xl border text-center transition-all duration-150 cursor-pointer hover:shadow-md hover:-translate-y-0.5 block w-full ${
                  isCurrent
                    ? "bg-purple-50 border-purple-600 text-purple-900 ring-2 ring-purple-200 shadow-xs font-bold hover:bg-purple-100/80"
                    : isDone
                    ? "bg-emerald-50/80 border-emerald-200 text-emerald-800 font-semibold hover:border-purple-400 hover:bg-purple-50/60"
                    : "bg-slate-50 border-slate-200 text-slate-400 hover:border-slate-300 hover:bg-slate-100"
                }`}
              >
                <div className="flex items-center justify-between mb-1 px-0.5">
                  <div className="flex items-center space-x-1">
                    {isDone ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    ) : isCurrent ? (
                      <div className="w-2.5 h-2.5 rounded-full bg-purple-600 animate-ping" />
                    ) : (
                      <span className="w-3 h-3 text-[10px] text-slate-400 font-mono">{idx + 1}</span>
                    )}
                  </div>
                  <Brain className="w-3 h-3 text-slate-400 group-hover:text-purple-700 opacity-60 group-hover:opacity-100 transition-all" />
                </div>
                <span className="text-xs font-semibold block truncate group-hover:text-purple-900 transition-colors">
                  {p.label}
                </span>
                <div className="mt-1 flex items-center justify-center">
                  {obsCount ? (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-purple-100/90 text-purple-800 font-medium group-hover:bg-purple-200 transition-colors">
                      {obsCount} step{obsCount > 1 ? "s" : ""}
                    </span>
                  ) : p.id === "ingest" ? (
                    <span className="text-[10px] font-mono text-slate-400 group-hover:text-slate-600">
                      git clone
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-slate-400 group-hover:text-purple-600">
                      view trace
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Live SSE Execution Console Preview (hidden when user is on the full Logs tab) */}
      {activeTab !== "logs" && (scan.status === "running" || scan.status === "queued" || scan.status === "failed") && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center space-x-2 font-mono">
              <Terminal className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-slate-200 font-bold">Live Execution Stream</span>
            </span>
            <button
              onClick={() => setActiveTab("logs")}
              className="text-[11px] text-purple-300 font-mono hover:underline"
            >
              Open Full Console &rarr;
            </button>
          </div>
          <div className="p-3 max-h-36 overflow-y-auto font-mono text-xs text-slate-300 space-y-1 bg-[#0b0f17]">
            {streamLogs.length === 0 ? (
              <div className="text-slate-500 italic py-1">Waiting for pipeline events...</div>
            ) : (
              streamLogs.slice(-8).map((log, i) => (
                <div key={i} className="leading-relaxed hover:bg-slate-800/40">
                  {log}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex flex-wrap items-center gap-2 border-b border-purple-100/90 pb-2">
        <button
          onClick={() => { setActiveTab("findings"); fetchScan(); }}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === "findings"
              ? "bg-purple-700 text-white shadow-xs"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-purple-50 hover:text-purple-900"
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          <span>Verified Vulnerabilities ({scan.findings?.length || 0})</span>
        </button>

        <button
          onClick={() => { setActiveTab("trace"); }}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === "trace"
              ? "bg-purple-700 text-white shadow-xs"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-purple-50 hover:text-purple-900"
          }`}
        >
          <Brain className="w-4 h-4" />
          <span>Swarm Trace &amp; Forensics</span>
        </button>

        <button
          onClick={() => { setActiveTab("threat_model"); fetchScan(); }}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === "threat_model"
              ? "bg-purple-700 text-white shadow-xs"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-purple-50 hover:text-purple-900"
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Architecture &amp; Threat Model</span>
        </button>

        <button
          onClick={() => { setActiveTab("review_packet"); fetchScan(); }}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === "review_packet"
              ? "bg-purple-700 text-white shadow-xs"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-purple-50 hover:text-purple-900"
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Executive Review Packet</span>
        </button>

        <button
          onClick={() => { setActiveTab("logs"); }}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === "logs"
              ? "bg-purple-700 text-white shadow-xs"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-purple-50 hover:text-purple-900"
          }`}
        >
          <Terminal className="w-4 h-4" />
          <span>Execution Console ({streamLogs.length})</span>
        </button>
      </div>

      {/* Tab Panel: Swarm Trace & Forensic Inspector */}
      {activeTab === "trace" && (
        <SwarmTraceViewer
          scanId={scan.id}
          isScanning={scan.status === "running"}
          filterPhase={tracePhaseFilter}
          initialQuery={traceQueryFilter}
          onClearPhaseFilter={() => setTracePhaseFilter("all")}
        />
      )}

      {/* Tab Panel: Architecture & Threat Model */}
      {activeTab === "threat_model" && (
        <div className="space-y-6">
          {/* Interactive System Architecture & Data Flow Graph */}
          <ArchitectureGraph
            markdown={scan.architecture_summary || ""}
            scanName={scan.name || scan.source_target}
          />

          {/* Full Architecture Review Specification Report */}
          {scan.architecture_summary ? (
            <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-6 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center space-x-2">
                  <Layers className="w-5 h-5 text-purple-700" />
                  <h3 className="text-base font-bold text-slate-900">
                    System Architecture Review &amp; Trust Boundaries Report (mantis-architecture)
                  </h3>
                </div>
                <span className="text-xs font-mono text-slate-500">architecture.md</span>
              </div>
              <div className="font-mono text-xs text-slate-700 bg-slate-50/70 p-5 rounded-xl border border-slate-200/80 whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-y-auto">
                {scan.architecture_summary}
              </div>
            </div>
          ) : (
            <div className="bg-purple-50/60 border border-purple-200/70 rounded-2xl p-6 text-center text-xs text-purple-900">
              Architecture review document is generating during the Recon phase. It will appear automatically once Recon completes.
            </div>
          )}

          {/* Interactive Threat Model & Attack Surface Flow Matrix */}
          <ThreatModelGraph
            markdown={scan.threat_model || ""}
            scanName={scan.name || scan.source_target}
          />

          {/* Full Threat Model Specification Report */}
          {scan.threat_model && (
            <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-6 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center space-x-2">
                  <ShieldAlert className="w-5 h-5 text-rose-600" />
                  <h3 className="text-base font-bold text-slate-900">
                    STRIDE Threat Model &amp; Attack Surface Matrix (mantis-threat-model)
                  </h3>
                </div>
                <span className="text-xs font-mono text-slate-500">threat_model.md</span>
              </div>
              <div className="font-mono text-xs text-slate-700 bg-slate-50/70 p-5 rounded-xl border border-slate-200/80 whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-y-auto">
                {scan.threat_model}
              </div>
            </div>
          )}

          {/* Actionable Hunting Plan */}
          {scan.hunting_plan && (
            <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-6 shadow-xs space-y-3">
              <div className="flex items-center space-x-2 border-b border-slate-100 pb-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-900">Actionable Hunting Plan (mantis-plan)</h3>
              </div>
              <div className="font-mono text-xs text-slate-700 bg-slate-50/70 p-4 rounded-xl border border-slate-200/80 whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-y-auto">
                {scan.hunting_plan}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab Panel: Executive Review Packet */}
      {activeTab === "review_packet" && (
        <div className="space-y-6">
          <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-6 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-purple-700" />
                <h3 className="text-base font-bold text-slate-900">Executive Security Review Packet (mantis-report)</h3>
              </div>
              <span className="text-xs font-mono text-slate-500">review_packet.md</span>
            </div>
            {scan.review_packet ? (
              <div className="font-mono text-xs text-slate-700 bg-slate-50/70 p-5 rounded-xl border border-slate-200/80 whitespace-pre-wrap leading-relaxed max-h-[600px] overflow-y-auto">
                {scan.review_packet}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic py-6 text-center">
                Executive report generation is finalized upon completion of the audit pipeline.
              </p>
            )}
          </div>

          {scan.exploit_chains && (
            <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-6 shadow-xs space-y-3">
              <div className="flex items-center space-x-2 border-b border-slate-100 pb-3">
                <ShieldCheck className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-bold text-slate-900">Multi-Step Exploit Chains (mantis-chain)</h3>
              </div>
              <div className="font-mono text-xs text-slate-700 bg-slate-50/70 p-4 rounded-xl border border-slate-200/80 whitespace-pre-wrap leading-relaxed">
                {typeof scan.exploit_chains === "string" ? scan.exploit_chains : scan.exploit_chains.raw || JSON.stringify(scan.exploit_chains, null, 2)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab Panel: Execution Console */}
      {activeTab === "logs" && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm space-y-0">
          <div className="px-5 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center space-x-2 font-mono">
              <Terminal className="w-4 h-4 text-purple-400" />
              <span className="text-slate-200 font-bold">Comprehensive Pipeline Execution Stream</span>
            </span>
            <div className="flex items-center space-x-3">
              <span className="text-[11px] text-purple-300 font-mono">{streamLogs.length} events recorded</span>
              <a
                href={`/api/scans/${id}/export/log?token=${encodeURIComponent(typeof window !== "undefined" ? localStorage.getItem("sast_auth_token") || "" : "")}`}
                download
                className="flex items-center space-x-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[11px] border border-slate-700 transition-colors"
                title="Download full pipeline.log"
              >
                <Download className="w-3 h-3 text-purple-400" />
                <span>Download pipeline.log</span>
              </a>
            </div>
          </div>
          <div className="p-4 max-h-[600px] overflow-y-auto font-mono text-xs text-slate-300 space-y-1.5 bg-[#0b0f17]">
            {streamLogs.length === 0 ? (
              <div className="text-slate-500 italic py-6 text-center">
                No events logged for this scan.
              </div>
            ) : (
              streamLogs.map((log, i) => (
                <div key={i} className="leading-relaxed hover:bg-slate-800/40 px-2 py-0.5 rounded">
                  {log}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Tab Panel: Verified Vulnerability Findings */}
      {activeTab === "findings" && (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <ShieldAlert className="w-5 h-5 text-rose-600" />
            <span>Verified Vulnerabilities ({scan.findings?.length || 0})</span>
          </h2>
        </div>

        {scan.findings && scan.findings.length > 0 ? (
          <div className="space-y-4">
            {scan.findings.map((f: any) => {
              const isPocOpen = expandedPoc[f.id];
              const isPatchOpen = expandedPatch[f.id];

              return (
                <div
                  key={f.id}
                  className="bg-white/95 border border-purple-100/90 rounded-2xl p-6 space-y-4 shadow-xs hover:border-purple-200 transition-all"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wide ${
                            f.severity === "critical"
                              ? "bg-rose-50 text-rose-800 border border-rose-200"
                              : f.severity === "high"
                              ? "bg-amber-50 text-amber-800 border border-amber-200"
                              : "bg-purple-50 text-purple-800 border border-purple-200"
                          }`}
                        >
                          {f.severity}
                        </span>
                        {f.cwe && (
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-purple-50 text-purple-800 border border-purple-200/60 font-semibold">
                            {f.cwe}
                          </span>
                        )}
                        <h3 className="text-sm font-bold text-slate-900">{f.title}</h3>
                      </div>
                      {f.file_path && (
                        <p className="text-xs font-mono text-slate-500">
                          {f.file_path} {f.line_number && `(line ${f.line_number})`}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => {
                          setTraceQueryFilter(f.title || f.file_path || "");
                          setTracePhaseFilter("all");
                          setActiveTab("trace");
                        }}
                        className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 transition-colors shadow-2xs"
                        title="Jump to Forensic Trace, Thinking & Tool Calls for this finding"
                      >
                        <Brain className="w-3 h-3 text-purple-600" />
                        <span>Trace &amp; Reasoning</span>
                      </button>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-bold capitalize ${
                          f.status === "reproduced"
                            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {f.status === "reproduced" ? "Exploit Proven" : f.status}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                    {f.description}
                  </p>

                  {/* Enterprise Source-to-Sink Data Flow Trace */}
                  {f.source_sink_trace && (
                    <div className="bg-slate-50/90 rounded-xl p-3.5 border border-slate-200/90 space-y-2">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex items-center space-x-1.5">
                        <ArrowRight className="w-3 h-3 text-purple-600" />
                        <span>Source-to-Sink Data Flow Trace</span>
                      </span>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                        {/* Source */}
                        <div className="bg-blue-50/80 border border-blue-200/80 rounded-lg p-2.5 space-y-1">
                          <span className="text-[10px] font-bold text-blue-800 uppercase flex items-center space-x-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                            <span>Source ({f.source_sink_trace.source?.type || "External Input"})</span>
                          </span>
                          <p className="font-mono text-[11px] text-blue-950 font-semibold break-all">
                            {f.source_sink_trace.source?.parameter || "Input parameter"}
                          </p>
                          <p className="text-[10px] text-blue-700 font-mono">
                            {f.source_sink_trace.source?.file}:{f.source_sink_trace.source?.line}
                          </p>
                        </div>

                        {/* Propagation */}
                        <div className="bg-amber-50/80 border border-amber-200/80 rounded-lg p-2.5 space-y-1">
                          <span className="text-[10px] font-bold text-amber-800 uppercase flex items-center space-x-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-600"></span>
                            <span>Taint Propagation</span>
                          </span>
                          <p className="text-[11px] text-amber-950 leading-tight">
                            {f.source_sink_trace.taint_path?.[0]?.statement || "Unvalidated flow into dangerous execution context"}
                          </p>
                          <p className="text-[10px] text-amber-700 font-mono">
                            No sanitization or validation barrier
                          </p>
                        </div>

                        {/* Dangerous Sink */}
                        <div className="bg-rose-50/80 border border-rose-200/80 rounded-lg p-2.5 space-y-1">
                          <span className="text-[10px] font-bold text-rose-800 uppercase flex items-center space-x-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-600"></span>
                            <span>Dangerous Sink ({f.source_sink_trace.sink?.sink_type || "Sink"})</span>
                          </span>
                          <p className="font-mono text-[11px] text-rose-950 font-semibold break-all">
                            {f.source_sink_trace.sink?.expression || f.file_path}
                          </p>
                          <p className="text-[10px] text-rose-700 font-mono">
                            {f.source_sink_trace.sink?.file}:{f.source_sink_trace.sink?.line}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Step-by-Step Reproduction Instructions */}
                  {f.exploit_steps && (
                    <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-3.5 space-y-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center space-x-1.5">
                        <Bug className="w-3.5 h-3.5 text-rose-500" />
                        <span>Step-by-Step Exploitation &amp; Reproduction</span>
                      </span>
                      <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed font-mono text-[11px] bg-white p-2.5 rounded-lg border border-slate-200/60">
                        {f.exploit_steps}
                      </div>
                    </div>
                  )}

                  {/* Remediation & Mitigation Guidance */}
                  {f.mitigation && (
                    <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-xl p-3.5 space-y-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 flex items-center space-x-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Remediation Guidance</span>
                      </span>
                      <p className="text-xs text-emerald-950 whitespace-pre-wrap leading-relaxed">
                        {f.mitigation}
                      </p>
                    </div>
                  )}

                  {/* Evidence & Dynamic/Static Reproducer Accordion */}
                  {(f.poc_script || f.poc_output) && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/60">
                      <button
                        onClick={() => setExpandedPoc({ ...expandedPoc, [f.id]: !isPocOpen })}
                        className="w-full px-4 py-2.5 bg-slate-100 hover:bg-slate-200/70 flex items-center justify-between text-xs text-slate-700 transition-colors"
                      >
                        <span className="font-bold text-purple-900 flex items-center space-x-1.5">
                          <Terminal className="w-3.5 h-3.5 text-purple-700" />
                          <span>Verification Evidence &amp; Execution Output</span>
                        </span>
                        {isPocOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                      </button>

                      {isPocOpen && (
                        <div className="p-4 bg-slate-900 space-y-3 font-mono text-xs border-t border-slate-800 text-slate-200">
                          {f.poc_script && (
                            <div>
                              <span className="text-[10px] text-slate-400 uppercase font-semibold">reproducer.py</span>
                              <pre className="p-3 mt-1 bg-slate-950 rounded-lg border border-slate-800 text-slate-300 overflow-x-auto">
                                {f.poc_script}
                              </pre>
                            </div>
                          )}
                          {f.poc_output && (
                            <div>
                              <span className="text-[10px] text-amber-400 uppercase font-semibold">Verification Evidence / Sandbox Log</span>
                              <pre className="p-3 mt-1 bg-slate-950 rounded-lg border border-slate-800 text-amber-300 overflow-x-auto whitespace-pre-wrap">
                                {f.poc_output}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Patch Diff Accordion */}
                  {f.patch_diff && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/60">
                      <button
                        onClick={() => setExpandedPatch({ ...expandedPatch, [f.id]: !isPatchOpen })}
                        className="w-full px-4 py-2.5 bg-slate-100 hover:bg-slate-200/70 flex items-center justify-between text-xs text-slate-700 transition-colors"
                      >
                        <span className="font-bold text-emerald-800 flex items-center space-x-1.5">
                          <FileCode className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Remediation Patch (Unified Git Diff)</span>
                        </span>
                        {isPatchOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                      </button>

                      {isPatchOpen && (
                        <div className="p-4 bg-slate-900 font-mono text-xs border-t border-slate-800 overflow-x-auto">
                          <pre className="text-slate-300 whitespace-pre">
                            {f.patch_diff.split("\n").map((line: string, i: number) => {
                              if (line.startsWith("+") && !line.startsWith("+++")) {
                                return (
                                  <div key={i} className="text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded">
                                    {line}
                                  </div>
                                );
                              }
                              if (line.startsWith("-") && !line.startsWith("---")) {
                                return (
                                  <div key={i} className="text-rose-400 bg-rose-950/40 px-2 py-0.5 rounded">
                                    {line}
                                  </div>
                                );
                              }
                              return <div key={i} className="px-2 py-0.5">{line}</div>;
                            })}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-8 text-center bg-white/95 border border-purple-100/90 rounded-2xl space-y-2 shadow-xs">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
            <h3 className="text-sm font-bold text-slate-900">No Vulnerabilities Confirmed</h3>
            <p className="text-xs text-slate-500">
              {scan.status === "completed"
                ? "The codebase successfully cleared threat modeling, researcher sweeps, and adversarial critic filters."
                : "Auditing in progress..."}
            </p>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
