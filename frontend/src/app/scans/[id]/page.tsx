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
} from "lucide-react";
import { api } from "@/lib/api";

const PHASES = [
  { id: "ingest", label: "01 Ingest" },
  { id: "recon", label: "02 Recon" },
  { id: "threat_model", label: "03 Threat" },
  { id: "research", label: "04 Research" },
  { id: "critic", label: "05 Critic" },
  { id: "reproduce", label: "06 Reproduce" },
  { id: "patch", label: "07 Patch" },
];

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

  const langfuseUrl = process.env.NEXT_PUBLIC_LANGFUSE_URL || "http://langfuse.localhost";

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

    const eventSource = new EventSource(`/api/scans/${id}/stream`);

    const handleData = (rawText: string) => {
      try {
        const data = JSON.parse(rawText);
        if (data.done) {
          eventSource.close();
          return;
        }

        const time = data.timestamp
          ? new Date(data.timestamp * 1000).toLocaleTimeString()
          : new Date().toLocaleTimeString();
        const phase = (data.phase || "PIPELINE").toUpperCase();
        const msg = data.message || "";
        const logLine = `[${time}] [${phase}] ${msg}`;

        setStreamLogs((prev) => {
          if (prev.includes(logLine)) return prev;
          return [...prev, logLine];
        });

        // If status reaches a terminal state, refresh scan details and close stream
        if (
          data.status === "completed" ||
          data.status === "failed" ||
          data.status === "budget_exceeded" ||
          data.status === "cancelled"
        ) {
          fetchScan();
          eventSource.close();
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
    });

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [id, scan?.id]);

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

  const getPhaseIndex = (phase?: string) => {
    if (!phase) return -1;
    return PHASES.findIndex((p) => p.id === phase.toLowerCase());
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
              {scan.source_target}
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
          </div>
        </div>

        <div className="flex items-center space-x-3 w-full md:w-auto">
          {/* Deep link into Langfuse */}
          <a
            href={`http://langfuse.localhost/sso?redirect=/trace/${scan.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 md:flex-none flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100 transition-all shadow-xs"
          >
            <span>Inspect in Langfuse</span>
            <ExternalLink className="w-3.5 h-3.5 text-amber-700" />
          </a>

          {scan.status === "running" && (
            <button
              onClick={handleCancel}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100 transition-all shadow-xs"
            >
              <StopCircle className="w-3.5 h-3.5 text-rose-600" />
              <span>Abort Scan</span>
            </button>
          )}
        </div>
      </div>

      {/* Scan Error Banner */}
      {scan.status === "failed" && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start space-x-3 text-rose-900 shadow-xs">
          <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
          <div className="space-y-1 overflow-hidden">
            <h4 className="text-xs font-bold uppercase tracking-wide text-rose-800">
              Scan Execution Failed
            </h4>
            <p className="text-xs font-mono text-rose-700 whitespace-pre-wrap break-all">
              {scan.error_message || "The autonomous analysis pipeline encountered an error. Check the execution stream below for details."}
            </p>
          </div>
        </div>
      )}

      {/* Visual Funnel Stepper */}
      <div className="bg-white/95 border border-purple-100/90 rounded-2xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-purple-700" />
            <span className="text-xs font-bold uppercase text-purple-900 tracking-wider">
              Autonomous Verification Funnel
            </span>
          </div>
          <span className="text-xs font-mono text-slate-500">Mantis Skills Execution</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {PHASES.map((p, idx) => {
            const isDone = scan.status === "completed" || idx < currentPhaseIdx;
            const isCurrent = scan.status === "running" && idx === currentPhaseIdx;
            return (
              <div
                key={p.id}
                className={`p-3 rounded-xl border text-center transition-all ${
                  isCurrent
                    ? "bg-purple-50 border-purple-600 text-purple-900 ring-2 ring-purple-200 shadow-xs font-bold"
                    : isDone
                    ? "bg-emerald-50/80 border-emerald-200 text-emerald-800 font-semibold"
                    : "bg-slate-50 border-slate-200 text-slate-400"
                }`}
              >
                <div className="flex items-center justify-center space-x-1 mb-1">
                  {isDone ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  ) : isCurrent ? (
                    <div className="w-2 h-2 rounded-full bg-purple-600 animate-ping" />
                  ) : (
                    <span className="w-3 h-3 text-[10px] text-slate-400 font-mono">{idx + 1}</span>
                  )}
                </div>
                <span className="text-xs font-semibold block truncate">{p.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live SSE Execution Console */}
      {(streamLogs.length > 0 || scan.status === "running" || scan.status === "queued" || scan.status === "failed") && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center space-x-2 font-mono">
              <Terminal className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-slate-200 font-bold">Pipeline Execution Stream</span>
            </span>
            <span className="text-[11px] text-purple-300 font-mono">{streamLogs.length} events logged</span>
          </div>
          <div className="p-4 max-h-56 overflow-y-auto font-mono text-xs text-slate-300 space-y-1 bg-[#0b0f17]">
            {streamLogs.length === 0 ? (
              <div className="text-slate-500 italic py-2">
                {scan.status === "running" || scan.status === "queued"
                  ? "Waiting for pipeline events..."
                  : "No events logged for this scan."}
              </div>
            ) : (
              streamLogs.map((log, i) => (
                <div key={i} className="leading-relaxed hover:bg-slate-800/40">
                  {log}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Verified Vulnerability Findings */}
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

                  {/* PoC Script & Terminal Output Accordion */}
                  {f.poc_script && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/60">
                      <button
                        onClick={() => setExpandedPoc({ ...expandedPoc, [f.id]: !isPocOpen })}
                        className="w-full px-4 py-2.5 bg-slate-100 hover:bg-slate-200/70 flex items-center justify-between text-xs text-slate-700 transition-colors"
                      >
                        <span className="font-bold text-purple-900 flex items-center space-x-1.5">
                          <Terminal className="w-3.5 h-3.5 text-purple-700" />
                          <span>Dynamic Reproducer &amp; Crash Trace (Docker PoC)</span>
                        </span>
                        {isPocOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                      </button>

                      {isPocOpen && (
                        <div className="p-4 bg-slate-900 space-y-3 font-mono text-xs border-t border-slate-800 text-slate-200">
                          <div>
                            <span className="text-[10px] text-slate-400 uppercase font-semibold">reproducer.py</span>
                            <pre className="p-3 mt-1 bg-slate-950 rounded-lg border border-slate-800 text-slate-300 overflow-x-auto">
                              {f.poc_script}
                            </pre>
                          </div>
                          {f.poc_output && (
                            <div>
                              <span className="text-[10px] text-amber-400 uppercase font-semibold">Sandbox Execution Log</span>
                              <pre className="p-3 mt-1 bg-slate-950 rounded-lg border border-slate-800 text-amber-300 overflow-x-auto">
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
    </div>
  );
}
