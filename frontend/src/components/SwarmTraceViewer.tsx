"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Brain,
  Wrench,
  ShieldCheck,
  ShieldAlert,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Coins,
  Cpu,
  ChevronRight,
  X,
  Copy,
  Check,
  RefreshCw,
  Terminal,
  FileCode,
  AlertTriangle,
  Flame,
  ArrowRight,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { api, TraceStep } from "@/lib/api";

interface SwarmTraceViewerProps {
  scanId: string;
  isScanning?: boolean;
  filterPhase?: string;
  initialQuery?: string;
  onClearPhaseFilter?: () => void;
}

export default function SwarmTraceViewer({
  scanId,
  isScanning = false,
  filterPhase,
  initialQuery = "",
  onClearPhaseFilter,
}: SwarmTraceViewerProps) {
  const [traces, setTraces] = useState<TraceStep[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedTrace, setSelectedTrace] = useState<TraceStep | null>(null);
  const [activeTab, setActiveTab] = useState<"thinking" | "tool" | "decision" | "raw">("thinking");

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>(initialQuery);
  const [filterType, setFilterType] = useState<"all" | "thinking" | "tools" | "verified" | "rejected">("all");
  const [selectedPhase, setSelectedPhase] = useState<string>(filterPhase || "all");
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const listEndRef = useRef<HTMLDivElement>(null);

  // Sync prop changes
  useEffect(() => {
    if (filterPhase) setSelectedPhase(filterPhase);
  }, [filterPhase]);

  useEffect(() => {
    if (initialQuery) setSearchQuery(initialQuery);
  }, [initialQuery]);

  // Fetch traces from backend API
  const fetchTraces = async () => {
    try {
      const res = await api.getScanTraces(scanId, {
        phase: selectedPhase !== "all" ? selectedPhase : undefined,
        q: searchQuery.trim() || undefined,
        status:
          filterType === "verified"
            ? "VERIFIED"
            : filterType === "rejected"
            ? "REJECTED_BY_CRITIC"
            : undefined,
        limit: 500,
      });
      setTraces(res.traces || []);
    } catch (err) {
      console.error("Failed to fetch traces:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async () => {
    try {
      const s = await api.getScanTracesSummary(scanId);
      setSummary(s);
    } catch (err) {
      console.error("Failed to fetch trace summary:", err);
    }
  };

  useEffect(() => {
    fetchTraces();
    fetchSummary();
  }, [scanId, selectedPhase, searchQuery, filterType]);

  // Auto-poll when scan is running
  useEffect(() => {
    if (!isScanning) return;
    const interval = setInterval(() => {
      fetchTraces();
      fetchSummary();
    }, 3000);
    return () => clearInterval(interval);
  }, [isScanning, scanId, selectedPhase, searchQuery, filterType]);

  // Auto scroll to bottom if enabled and scanning
  useEffect(() => {
    if (autoScroll && isScanning && listEndRef.current) {
      listEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [traces.length, autoScroll, isScanning]);

  // Filter client-side for immediate responsive interactions
  const displayedTraces = useMemo(() => {
    return traces.filter((t) => {
      if (filterType === "thinking" && !t.has_thinking) return false;
      if (filterType === "tools" && !t.tool_name) return false;
      if (filterType === "verified" && t.decision_status !== "VERIFIED") return false;
      if (
        filterType === "rejected" &&
        t.decision_status !== "REJECTED_BY_CRITIC" &&
        t.decision_status !== "DISCARDED"
      )
        return false;
      return true;
    });
  }, [traces, filterType]);

  const copyToClipboard = (text: string, fieldId: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const formatTokens = (num: number) => {
    if (!num) return "0";
    if (num > 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num > 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toLocaleString();
  };

  return (
    <div className="space-y-4">
      {/* Top Forensic & Summary Ribbon */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-slate-200 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-sm tracking-wide text-white">
                  Swarm Intelligence &amp; Forensic Trace Inspector
                </h3>
                {isScanning && (
                  <span className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>LIVE INFERENCE STREAM</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Low-level chronological execution log, model chain-of-thought, tool calls, and critic decisions
              </p>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="flex items-center space-x-4 text-xs font-mono">
            <div className="px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60">
              <span className="text-slate-400">Total Steps: </span>
              <span className="text-purple-300 font-bold">{summary?.total_steps ?? traces.length}</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60">
              <span className="text-slate-400">Reasoning Tokens: </span>
              <span className="text-purple-300 font-bold">
                {formatTokens(summary?.total_reasoning_tokens || 0)}
              </span>
            </div>
            {summary?.candidates_breakdown && (
              <div className="flex items-center space-x-2">
                {summary.candidates_breakdown.VERIFIED > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
                    🛡️ {summary.candidates_breakdown.VERIFIED} Verified
                  </span>
                )}
                {(summary.candidates_breakdown.REJECTED_BY_CRITIC || summary.candidates_breakdown.DISCARDED) && (
                  <span className="px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 font-semibold border border-rose-500/30">
                    ⚠️ {(summary.candidates_breakdown.REJECTED_BY_CRITIC || 0) + (summary.candidates_breakdown.DISCARDED || 0)} Vetoed
                  </span>
                )}
              </div>
            )}
            <button
              onClick={() => {
                fetchTraces();
                fetchSummary();
              }}
              title="Refresh Traces"
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter & Forensic Search Bar */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1 min-w-[280px] relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Forensic search: type file (e.g. login.js), tool, sink, or thinking keyword..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-8 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all font-mono"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Filters */}
          <div className="flex items-center space-x-1.5 text-xs">
            <button
              onClick={() => setFilterType("all")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                filterType === "all"
                  ? "bg-purple-600 text-white shadow-xs"
                  : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
              }`}
            >
              All ({traces.length})
            </button>
            <button
              onClick={() => setFilterType("thinking")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center space-x-1 ${
                filterType === "thinking"
                  ? "bg-purple-600 text-white shadow-xs"
                  : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
              }`}
            >
              <Brain className="w-3.5 h-3.5" />
              <span>Thinking Only</span>
            </button>
            <button
              onClick={() => setFilterType("tools")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center space-x-1 ${
                filterType === "tools"
                  ? "bg-purple-600 text-white shadow-xs"
                  : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
              }`}
            >
              <Wrench className="w-3.5 h-3.5" />
              <span>Tool Calls</span>
            </button>
            <button
              onClick={() => setFilterType("rejected")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center space-x-1 ${
                filterType === "rejected"
                  ? "bg-rose-600 text-white shadow-xs"
                  : "bg-slate-800/80 text-rose-300 hover:bg-slate-700"
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Vetoed / Discarded</span>
            </button>
            <button
              onClick={() => setFilterType("verified")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center space-x-1 ${
                filterType === "verified"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-slate-800/80 text-emerald-300 hover:bg-slate-700"
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Verified Only</span>
            </button>
          </div>

          {/* Phase Filter Tag */}
          {selectedPhase !== "all" && (
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-purple-900/40 border border-purple-700/50 text-purple-200 text-xs font-mono">
              <span>Phase: {selectedPhase.toUpperCase()}</span>
              <button
                onClick={() => {
                  setSelectedPhase("all");
                  if (onClearPhaseFilter) onClearPhaseFilter();
                }}
                className="hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area: Step Timeline + Slide-over Inspector */}
      <div className="relative flex gap-4 min-h-[550px]">
        {/* Step Flow List (Left Column) */}
        <div
          className={`flex-1 space-y-2.5 overflow-y-auto max-h-[700px] pr-1.5 transition-all ${
            selectedTrace ? "w-1/2" : "w-full"
          }`}
        >
          {loading ? (
            <div className="p-12 text-center text-slate-400 bg-white border border-slate-200 rounded-2xl">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-purple-600" />
              <p className="text-xs">Loading forensic inference traces...</p>
            </div>
          ) : displayedTraces.length === 0 ? (
            <div className="p-12 text-center text-slate-500 bg-white border border-slate-200 rounded-2xl">
              <Brain className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-semibold text-slate-700">No traces matching your filter.</p>
              <p className="text-xs mt-1 text-slate-400">
                {searchQuery
                  ? `No events touched '${searchQuery}'. Clear the search bar to see all steps.`
                  : "Start a scan to observe real-time agent inferences, tool executions, and critic decisions."}
              </p>
            </div>
          ) : (
            displayedTraces.map((trace) => {
              const isSelected = selectedTrace?.id === trace.id;
              const isTool = !!trace.tool_name;
              const isThinking = !!trace.has_thinking;
              const isVerified = trace.decision_status === "VERIFIED";
              const isRejected =
                trace.decision_status === "REJECTED_BY_CRITIC" || trace.decision_status === "DISCARDED";

              return (
                <div
                  key={trace.id}
                  onClick={() => {
                    setSelectedTrace(trace);
                    if (trace.has_thinking) setActiveTab("thinking");
                    else if (trace.tool_name) setActiveTab("tool");
                    else if (trace.decision_status !== "PROGRESS") setActiveTab("decision");
                    else setActiveTab("raw");
                  }}
                  className={`group relative p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? "bg-purple-50/90 border-purple-500 ring-2 ring-purple-200 shadow-md -translate-y-0.5"
                      : isVerified
                      ? "bg-emerald-50/40 border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50/80"
                      : isRejected
                      ? "bg-rose-50/40 border-rose-200 hover:border-rose-400 hover:bg-rose-50/80"
                      : isTool
                      ? "bg-blue-50/30 border-blue-200 hover:border-blue-400 hover:bg-blue-50/70"
                      : "bg-white border-slate-200 hover:border-purple-300 hover:shadow-xs"
                  }`}
                >
                  {/* Step Header */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                        #{trace.step_number}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md uppercase font-semibold bg-slate-800 text-purple-200">
                        {trace.phase}
                      </span>
                      <span className="text-xs font-semibold text-slate-800">{trace.agent_name}</span>
                    </div>

                    <div className="flex items-center space-x-2 text-[11px] font-mono text-slate-500">
                      {trace.latency_ms > 0 && <span>{trace.latency_ms}ms</span>}
                      {trace.total_tokens > 0 && <span>{formatTokens(trace.total_tokens)} tok</span>}
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-purple-600 transition-colors" />
                    </div>
                  </div>

                  {/* Node Payload Preview */}
                  <div className="mt-2 text-xs">
                    {/* Tool Call Card */}
                    {isTool && (
                      <div className="flex items-center space-x-2 p-2 rounded-lg bg-blue-100/60 border border-blue-200 text-blue-900 font-mono text-[11px]">
                        <Wrench className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span className="font-bold">{trace.tool_name}</span>
                        <span className="truncate text-blue-700">
                          {trace.tool_input
                            ? JSON.stringify(trace.tool_input).slice(0, 80)
                            : "(arguments)"}
                        </span>
                      </div>
                    )}

                    {/* Thinking Preview */}
                    {isThinking && (
                      <div className="mt-1 flex items-start space-x-2 p-2 rounded-lg bg-purple-50/80 border border-purple-100 text-purple-950 font-sans">
                        <Brain className="w-3.5 h-3.5 text-purple-600 shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <span className="font-bold text-[11px] text-purple-900 block font-mono">
                            Model Chain-of-Thought
                          </span>
                          <p className="text-[11px] text-purple-800 line-clamp-2 leading-relaxed">
                            {trace.thinking_preview || trace.thinking_content}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Candidate Decision Badge */}
                    {trace.candidate_vuln_title && (
                      <div
                        className={`mt-1.5 p-2 rounded-lg border text-[11px] flex items-start space-x-2 ${
                          isVerified
                            ? "bg-emerald-100/80 border-emerald-300 text-emerald-950"
                            : "bg-rose-100/80 border-rose-300 text-rose-950"
                        }`}
                      >
                        {isVerified ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <span className="font-bold block truncate">{trace.candidate_vuln_title}</span>
                          <span className="text-[10px] opacity-80 block">{trace.decision_reason}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={listEndRef} />
        </div>

        {/* Slide-Over Forensic Inspector (Right Column) */}
        {selectedTrace && (
          <div className="w-1/2 bg-slate-950 border border-slate-800 rounded-2xl p-4 text-slate-100 shadow-xl flex flex-col h-[700px] sticky top-4">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2.5">
                <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-md bg-purple-600 text-white">
                  Step #{selectedTrace.step_number}
                </span>
                <div>
                  <h4 className="text-xs font-bold text-white tracking-wide">{selectedTrace.agent_name}</h4>
                  <div className="flex items-center space-x-2 text-[10px] font-mono text-slate-400">
                    <span>Phase: {selectedTrace.phase.toUpperCase()}</span>
                    {selectedTrace.model && <span>• {selectedTrace.model}</span>}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedTrace(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Inspector Navigation Tabs */}
            <div className="flex items-center space-x-1.5 border-b border-slate-800 py-2.5 text-xs font-mono">
              {selectedTrace.has_thinking && (
                <button
                  onClick={() => setActiveTab("thinking")}
                  className={`px-3 py-1 rounded-lg transition-all flex items-center space-x-1.5 ${
                    activeTab === "thinking"
                      ? "bg-purple-600 text-white font-bold"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Brain className="w-3.5 h-3.5" />
                  <span>Thinking</span>
                </button>
              )}
              {selectedTrace.tool_name && (
                <button
                  onClick={() => setActiveTab("tool")}
                  className={`px-3 py-1 rounded-lg transition-all flex items-center space-x-1.5 ${
                    activeTab === "tool"
                      ? "bg-blue-600 text-white font-bold"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Wrench className="w-3.5 h-3.5" />
                  <span>Tool Output</span>
                </button>
              )}
              {selectedTrace.candidate_vuln_title && (
                <button
                  onClick={() => setActiveTab("decision")}
                  className={`px-3 py-1 rounded-lg transition-all flex items-center space-x-1.5 ${
                    activeTab === "decision"
                      ? "bg-emerald-600 text-white font-bold"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Decision</span>
                </button>
              )}
              <button
                onClick={() => setActiveTab("raw")}
                className={`px-3 py-1 rounded-lg transition-all flex items-center space-x-1.5 ${
                  activeTab === "raw"
                    ? "bg-slate-700 text-white font-bold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Raw I/O</span>
              </button>
            </div>

            {/* Inspector Body */}
            <div className="flex-1 overflow-y-auto py-3 space-y-3 font-mono text-xs">
              {/* Tab 1: Model Thinking */}
              {activeTab === "thinking" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="flex items-center space-x-1 text-purple-300 font-bold">
                      <Brain className="w-3.5 h-3.5" />
                      <span>Model Chain-of-Thought (&lt;think&gt;)</span>
                    </span>
                    <button
                      onClick={() => copyToClipboard(selectedTrace.thinking_content || "", "thinking")}
                      className="flex items-center space-x-1 text-slate-400 hover:text-white text-[10px]"
                    >
                      {copiedField === "thinking" ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedField === "thinking" ? "Copied" : "Copy Thinking"}</span>
                    </button>
                  </div>
                  <div className="p-3 bg-slate-900 border border-purple-900/40 rounded-xl text-purple-200 text-xs font-sans leading-relaxed whitespace-pre-wrap max-h-[500px] overflow-y-auto">
                    {selectedTrace.thinking_content || "No reasoning tokens captured for this step."}
                  </div>
                </div>
              )}

              {/* Tab 2: Tool Execution */}
              {activeTab === "tool" && (
                <div className="space-y-3">
                  <div>
                    <span className="text-slate-400 text-[11px] block mb-1">Tool Invocations &amp; Arguments:</span>
                    <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-blue-300 font-mono text-[11px] overflow-x-auto">
                      <div className="font-bold text-white mb-1">Tool: {selectedTrace.tool_name}</div>
                      <pre>{JSON.stringify(selectedTrace.tool_input || {}, null, 2)}</pre>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-slate-400 text-[11px]">Tool Return Output / Sandbox Logs:</span>
                      <button
                        onClick={() => copyToClipboard(selectedTrace.tool_output || "", "output")}
                        className="flex items-center space-x-1 text-slate-400 hover:text-white text-[10px]"
                      >
                        {copiedField === "output" ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>{copiedField === "output" ? "Copied" : "Copy Output"}</span>
                      </button>
                    </div>
                    <pre className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-slate-300 font-mono text-[11px] whitespace-pre-wrap max-h-[380px] overflow-y-auto">
                      {selectedTrace.tool_output || "(Empty output)"}
                    </pre>
                  </div>
                </div>
              )}

              {/* Tab 3: Decision & Verdict */}
              {activeTab === "decision" && (
                <div className="space-y-3">
                  <div
                    className={`p-3 rounded-xl border ${
                      selectedTrace.decision_status === "VERIFIED"
                        ? "bg-emerald-950/40 border-emerald-700 text-emerald-200"
                        : "bg-rose-950/40 border-rose-700 text-rose-200"
                    }`}
                  >
                    <div className="flex items-center space-x-2 font-bold text-xs mb-1">
                      {selectedTrace.decision_status === "VERIFIED" ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400" />
                      )}
                      <span>Status: {selectedTrace.decision_status}</span>
                    </div>
                    <div className="text-sm font-semibold text-white mt-1">
                      {selectedTrace.candidate_vuln_title}
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-400 text-[11px] block mb-1">Justification &amp; Critic Rationale:</span>
                    <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-slate-300 text-xs font-sans leading-relaxed whitespace-pre-wrap">
                      {selectedTrace.decision_reason || "No explicit reason specified."}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 4: Raw I/O */}
              {activeTab === "raw" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                    <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block">Prompt Tokens</span>
                      <span className="font-bold text-white">{selectedTrace.prompt_tokens}</span>
                    </div>
                    <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block">Completion</span>
                      <span className="font-bold text-white">{selectedTrace.completion_tokens}</span>
                    </div>
                    <div className="p-2 bg-slate-900 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block">Cost (USD)</span>
                      <span className="font-bold text-emerald-400">${selectedTrace.cost_usd.toFixed(6)}</span>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-slate-400 text-[11px]">Raw LLM Response:</span>
                      <button
                        onClick={() => copyToClipboard(selectedTrace.response_raw || "", "raw")}
                        className="flex items-center space-x-1 text-slate-400 hover:text-white text-[10px]"
                      >
                        {copiedField === "raw" ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>{copiedField === "raw" ? "Copied" : "Copy Raw"}</span>
                      </button>
                    </div>
                    <pre className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-slate-300 text-[11px] whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                      {selectedTrace.response_raw || "(Empty)"}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
