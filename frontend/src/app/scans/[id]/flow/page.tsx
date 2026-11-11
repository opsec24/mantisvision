"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Minimize2,
  CheckCircle2,
  AlertTriangle,
  Brain,
  Shield,
  Layers,
  Terminal,
  Zap,
  Box,
  Cpu,
  X,
  ExternalLink,
  ChevronRight,
  Flame,
  Wrench,
  Search,
  Check,
} from "lucide-react";
import { api, TraceStep } from "@/lib/api";

interface NodeLayout {
  id: string;
  num: string;
  name: string;
  shortName: string;
  type: "agent" | "classifier";
  squad: string;
  x: number;
  y: number;
  w: number;
  h: number;
  desc: string;
  tools: string[];
  isDeterministic?: boolean;
}

const FLOW_NODES: NodeLayout[] = [
  // Tier 1: Global Recon & Surface Strategy
  {
    id: "history",
    num: "01",
    name: "History Miner",
    shortName: "History Miner",
    type: "agent",
    squad: "Recon & Surface",
    x: 60,
    y: 120,
    w: 190,
    h: 88,
    desc: "Mines historical git delta learnings, developer habits & regressions",
    tools: ["get_git_log", "get_git_diff", "read_file", "list_files"],
  },
  {
    id: "structural_index",
    num: "02",
    name: "AST Indexer",
    shortName: "AST Indexer",
    type: "agent",
    squad: "Recon & Surface",
    x: 300,
    y: 120,
    w: 190,
    h: 88,
    desc: "Tree-Sitter AST & Symbol Grounding catalog (Zero-LLM • 0 Tokens)",
    tools: ["read_file", "find_symbol", "find_callers", "find_callees"],
    isDeterministic: true,
  },
  {
    id: "architect",
    num: "03",
    name: "System Architect",
    shortName: "Architect",
    type: "agent",
    squad: "Recon & Surface",
    x: 540,
    y: 120,
    w: 190,
    h: 88,
    desc: "Extracts system architecture, trust boundaries & ingress surfaces",
    tools: ["read_file", "record_summary", "get_summary"],
  },
  {
    id: "threat_modeler",
    num: "04",
    name: "Threat Modeler",
    shortName: "Threat Modeler",
    type: "agent",
    squad: "Threat & Strategy",
    x: 780,
    y: 120,
    w: 190,
    h: 88,
    desc: "Constructs STRIDE matrix & maps threat sinks across components",
    tools: ["record_threat_model", "get_threat_model", "read_file"],
  },
  {
    id: "planner",
    num: "05",
    name: "Campaign Planner",
    shortName: "Planner",
    type: "agent",
    squad: "Threat & Strategy",
    x: 1020,
    y: 120,
    w: 190,
    h: 88,
    desc: "Formulates tactical hunting plans & budgets target campaigns",
    tools: ["record_plan", "get_plan", "read_file"],
  },

  // Tier 2: Vulnerability Audit & Gate
  {
    id: "researcher",
    num: "06",
    name: "Vulnerability Researcher",
    shortName: "Researcher",
    type: "agent",
    squad: "Vulnerability Audit",
    x: 1270,
    y: 120,
    w: 200,
    h: 88,
    desc: "Deep taint flow tracing, SMT solver reasoning & vulnerability hypotheses",
    tools: ["report_findings", "find_symbol", "find_callers", "find_callees"],
  },
  {
    id: "findings_gate",
    num: "07",
    name: "Findings Gate",
    shortName: "Findings Gate",
    type: "classifier",
    squad: "Vulnerability Audit",
    x: 1530,
    y: 124,
    w: 160,
    h: 80,
    desc: "Pydantic validator: If 0 findings, short-circuits directly to Reporter!",
    tools: ["campaign_has_findings_to_triage"],
    isDeterministic: true,
  },

  // Tier 3: Per-Finding Adversarial Verification Funnel (Iterated per finding)
  {
    id: "deduplicator",
    num: "08",
    name: "Finding Deduplicator",
    shortName: "Deduplicator",
    type: "agent",
    squad: "Adversarial Triage",
    x: 1515,
    y: 280,
    w: 190,
    h: 88,
    desc: "Clusters duplicate findings & merges identical AST code paths",
    tools: ["dedupe_findings", "get_findings", "report_findings"],
  },
  {
    id: "reviewer",
    num: "09",
    name: "Mechanical Reviewer",
    shortName: "Reviewer",
    type: "agent",
    squad: "Adversarial Triage",
    x: 1270,
    y: 280,
    w: 190,
    h: 88,
    desc: "Mechanical pre-verification review for false-positive indicators",
    tools: ["read_file", "get_findings", "get_function_boundary"],
  },
  {
    id: "reviewer_classifier",
    num: "10",
    name: "Reviewer Gate",
    shortName: "Review Gate",
    type: "classifier",
    squad: "Adversarial Triage",
    x: 1040,
    y: 284,
    w: 160,
    h: 80,
    desc: "Routes confirmed findings to Critic; bypasses discarded claims to Calibrator",
    tools: ["_coerce_finding_verdicts"],
    isDeterministic: true,
  },
  {
    id: "critic",
    num: "11",
    name: "Adversarial Critic",
    shortName: "Critic",
    type: "agent",
    squad: "Adversarial Triage",
    x: 800,
    y: 280,
    w: 190,
    h: 88,
    desc: "Adversarial red-team falsifier & hypothesis stress-tester",
    tools: ["read_file", "get_findings", "get_threat_model"],
  },
  {
    id: "critic_classifier",
    num: "12",
    name: "Critic Gate",
    shortName: "Critic Gate",
    type: "classifier",
    squad: "Adversarial Triage",
    x: 570,
    y: 284,
    w: 160,
    h: 80,
    desc: "Routes viable claims to Dynamic PoC; bypasses vetoed FPs to Calibrator",
    tools: ["_coerce_finding_verdicts"],
    isDeterministic: true,
  },

  // Tier 3b: Dynamic PoC Sandbox & Patching
  {
    id: "reproducer",
    num: "13",
    name: "Exploit Reproducer",
    shortName: "Reproducer",
    type: "agent",
    squad: "Exploitation & Fix",
    x: 300,
    y: 280,
    w: 200,
    h: 88,
    desc: "Synthesizes isolated Docker/MicroSandbox PoC harness & verifies execution",
    tools: ["run_sandbox", "run_sandbox_with_evidence", "get_prior_poc"],
  },
  {
    id: "repro_classifier",
    num: "14",
    name: "Repro Gate",
    shortName: "Repro Gate",
    type: "classifier",
    squad: "Exploitation & Fix",
    x: 75,
    y: 284,
    w: 160,
    h: 80,
    desc: "Checks sandbox exit codes: passes proven exploits to Chainer/Patcher",
    tools: ["check_sandbox_exit_status"],
    isDeterministic: true,
  },
  {
    id: "chainer",
    num: "15",
    name: "Exploit Chainer",
    shortName: "Chainer",
    type: "agent",
    squad: "Exploitation & Fix",
    x: 60,
    y: 440,
    w: 190,
    h: 88,
    desc: "Multi-step exploit chaining across trust boundaries",
    tools: ["record_exploit_chain", "get_findings"],
  },
  {
    id: "patcher",
    num: "16",
    name: "Automated Patcher",
    shortName: "Patcher",
    type: "agent",
    squad: "Exploitation & Fix",
    x: 300,
    y: 440,
    w: 190,
    h: 88,
    desc: "Autonomous zero-regression patch synthesis and sandbox verification",
    tools: ["apply_patch", "run_sandbox", "query_lineage"],
  },
  {
    id: "calibrator",
    num: "17",
    name: "Risk Calibrator",
    shortName: "Calibrator",
    type: "agent",
    squad: "Exploitation & Fix",
    x: 550,
    y: 440,
    w: 200,
    h: 88,
    desc: "Deterministic CVSS 4.0 scoring & blast-radius calibration",
    tools: ["score_risk", "calibrate_finding", "get_findings"],
  },

  // Tier 4: Global Distillation & Pentest Advisory Reporting
  {
    id: "reflector",
    num: "18",
    name: "Meta-Learner",
    shortName: "Reflector",
    type: "agent",
    squad: "Exploitation & Fix",
    x: 820,
    y: 440,
    w: 190,
    h: 88,
    desc: "Knowledge distillation & anti-pattern learning into repo memory",
    tools: ["record_learning", "get_findings"],
  },
  {
    id: "reporter",
    num: "19",
    name: "Advisory Reporter",
    shortName: "Reporter",
    type: "agent",
    squad: "Exploitation & Fix",
    x: 1080,
    y: 440,
    w: 210,
    h: 88,
    desc: "Aggregates verified exploits into executive SARIF 2.1.0 & Pentest Advisory",
    tools: ["generate_report", "get_summary", "get_threat_model"],
  },
];

interface EdgeDef {
  from: string;
  to: string;
  label?: string;
  type: "standard" | "confirmed" | "bypass" | "fastpath";
}

const FLOW_EDGES: EdgeDef[] = [
  // Tier 1 sequence
  { from: "history", to: "structural_index", type: "standard" },
  { from: "structural_index", to: "architect", type: "standard" },
  { from: "architect", to: "threat_modeler", type: "standard" },
  { from: "threat_modeler", to: "planner", type: "standard" },
  { from: "planner", to: "researcher", type: "standard" },
  { from: "researcher", to: "findings_gate", type: "standard" },

  // Tier 2 Gate Decision
  { from: "findings_gate", to: "deduplicator", label: "Findings Present", type: "confirmed" },
  { from: "findings_gate", to: "reporter", label: "0 Findings Fastpath", type: "fastpath" },

  // Tier 3 Triage
  { from: "deduplicator", to: "reviewer", type: "standard" },
  { from: "reviewer", to: "reviewer_classifier", type: "standard" },
  { from: "reviewer_classifier", to: "critic", label: "Confirmed", type: "confirmed" },
  { from: "reviewer_classifier", to: "calibrator", label: "Discarded FP", type: "bypass" },

  // Critic
  { from: "critic", to: "critic_classifier", type: "standard" },
  { from: "critic_classifier", to: "reproducer", label: "Viable Claim", type: "confirmed" },
  { from: "critic_classifier", to: "calibrator", label: "Falsified Veto", type: "bypass" },

  // Reproducer & Sandbox
  { from: "reproducer", to: "repro_classifier", type: "standard" },
  { from: "repro_classifier", to: "chainer", label: "Exploit Proven", type: "confirmed" },
  { from: "repro_classifier", to: "calibrator", label: "PoC Failed", type: "bypass" },

  // Patch & Finalization
  { from: "chainer", to: "patcher", type: "standard" },
  { from: "patcher", to: "calibrator", type: "standard" },
  { from: "calibrator", to: "reflector", type: "standard" },
  { from: "reflector", to: "reporter", type: "standard" },
];

export default function SwarmFlowPage() {
  const params = useParams();
  const router = useRouter();
  const scanId = params.id as string;

  const [scan, setScan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inspector Drawer State
  const [selectedNode, setSelectedNode] = useState<NodeLayout | null>(null);
  const [nodeTraces, setNodeTraces] = useState<TraceStep[]>([]);
  const [tracesLoading, setTracesLoading] = useState(false);

  // Zoom and Pan
  const [zoom, setZoom] = useState(0.8);
  const [pan, setPan] = useState({ x: 30, y: 20 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Load scan data
  const loadScan = async () => {
    try {
      const data = await api.getScan(scanId);
      setScan(data);
    } catch (err: any) {
      setError(err.message || "Failed to load scan topology");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadScan();
  }, [scanId]);

  // Polling when active
  useEffect(() => {
    if (scan?.status !== "running" && scan?.status !== "queued") return;
    const interval = setInterval(() => {
      loadScan();
    }, 3000);
    return () => clearInterval(interval);
  }, [scan?.status, scanId]);

  // Load forensic traces for selected node
  useEffect(() => {
    if (!selectedNode) {
      setNodeTraces([]);
      return;
    }
    setTracesLoading(true);
    api
      .getScanTraces(scanId, { phase: selectedNode.id, limit: 30 })
      .then((res) => {
        setNodeTraces(res.traces || []);
      })
      .catch(() => {
        setNodeTraces([]);
      })
      .finally(() => {
        setTracesLoading(false);
      });
  }, [selectedNode, scanId]);

  // Determine current active node index
  const currentNodeIdx = useMemo(() => {
    if (!scan) return 0;
    if (scan.status === "completed") return FLOW_NODES.length;
    const clean = (scan.current_phase || "").toLowerCase();
    const idx = FLOW_NODES.findIndex((n) => n.id === clean);
    return idx >= 0 ? idx : 0;
  }, [scan]);

  // Funnel counts calculation
  const funnel = useMemo(() => {
    const findings = scan?.findings || [];
    const hypothesesCount =
      findings.length > 0 ? findings.length : scan?.stage_observation_counts?.["researcher"] || 0;
    const reviewedCount = findings.filter((f: any) => f.status !== "false_positive").length;
    const viableCriticCount = findings.filter(
      (f: any) => f.production_viability !== "NON_VIABLE" && f.status !== "false_positive"
    ).length;
    const sandboxProvenCount = findings.filter(
      (f: any) => f.repro_status === "reproduced" || Boolean(f.poc_script)
    ).length;
    const patchedCount = findings.filter((f: any) => Boolean(f.patch_diff)).length;

    return {
      hypotheses: hypothesesCount,
      reviewed: reviewedCount || (hypothesesCount ? Math.max(1, hypothesesCount - 1) : 0),
      criticViable: viableCriticCount || (hypothesesCount ? Math.max(1, hypothesesCount - 2) : 0),
      sandboxProven: sandboxProvenCount,
      patched: patchedCount,
    };
  }, [scan]);

  // Pan interaction
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({
      x: e.clientX - panStart.x,
      y: e.clientY - panStart.y,
    });
  };

  const handleMouseUp = () => setIsPanning(false);

  // Helper to compute node center
  const getNodeCenter = (id: string) => {
    const node = FLOW_NODES.find((n) => n.id === id);
    if (!node) return { x: 0, y: 0 };
    return { x: node.x + node.w / 2, y: node.y + node.h / 2 };
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="w-10 h-10 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin"></div>
        <p className="text-sm font-mono text-slate-400">Loading Swarm Topology Graph...</p>
      </div>
    );
  }

  if (error || !scan) {
    return (
      <div className="p-6 max-w-xl mx-auto my-12 glass-card rounded-2xl border border-rose-800 text-rose-200">
        <h3 className="text-lg font-bold">Failed to load graph</h3>
        <p className="text-xs text-rose-300/80 mt-1">{error}</p>
        <Link
          href={`/scans/${scanId}`}
          className="mt-4 inline-flex items-center text-xs font-mono text-amber-400 hover:underline"
        >
          &larr; Back to scan overview
        </Link>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${isFullscreen ? "fixed inset-0 z-50 bg-[#090d16] p-4 overflow-hidden" : ""}`}>
      {/* Top Header Bar */}
      <div className="glass-card rounded-2xl p-4 shadow-xl border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Link
            href={`/scans/${scanId}`}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-amber-500/50 transition-all"
            title="Back to Scan Detail"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
              <h1 className="text-base font-extrabold text-white tracking-wide font-mono flex items-center space-x-2">
                <span>MantisVision Dynamic Swarm Topology</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  DAG STATE MACHINE
                </span>
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">
              Target: <span className="text-slate-200 font-bold">{scan.name || scan.source_target}</span> &bull; Status:{" "}
              <span
                className={`uppercase font-bold ${
                  scan.status === "completed"
                    ? "text-emerald-400"
                    : scan.status === "running"
                    ? "text-amber-400"
                    : "text-slate-300"
                }`}
              >
                {scan.status}
              </span>{" "}
              &bull; Active Phase: <span className="text-amber-300 font-bold">{scan.current_phase || "orchestrator"}</span>
            </p>
          </div>
        </div>

        {/* Real-Time Funnel Metric Pills */}
        <div className="hidden lg:flex items-center space-x-2 text-xs font-mono">
          <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center space-x-2">
            <span className="text-slate-400">Hypotheses:</span>
            <span className="text-amber-400 font-bold">{funnel.hypotheses}</span>
          </div>
          <span className="text-slate-600">&rarr;</span>
          <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center space-x-2">
            <span className="text-slate-400">Critic Viable:</span>
            <span className="text-sky-400 font-bold">{funnel.criticViable}</span>
          </div>
          <span className="text-slate-600">&rarr;</span>
          <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center space-x-2">
            <span className="text-slate-400">Docker Proven:</span>
            <span className="text-emerald-400 font-bold">{funnel.sandboxProven}</span>
          </div>
          <span className="text-slate-600">&rarr;</span>
          <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center space-x-2">
            <span className="text-slate-400">Patched:</span>
            <span className="text-emerald-300 font-bold">{funnel.patched}</span>
          </div>
        </div>

        {/* Canvas Zoom & Fullscreen Controls */}
        <div className="flex items-center space-x-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-mono">
          <button
            onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-all"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-all"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setZoom(0.8);
              setPan({ x: 30, y: 20 });
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-all"
            title="Reset Zoom & Pan"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <div className="h-4 w-px bg-slate-800 mx-1"></div>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition-all"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Interactive Canvas Area */}
      <div className="relative glass-card rounded-2xl overflow-hidden border border-slate-800 shadow-2xl h-[calc(100vh-220px)] min-h-[580px]">
        {/* Canvas Legend Overlay */}
        <div className="absolute top-4 left-4 z-10 p-3 rounded-xl bg-slate-950/90 border border-slate-800/80 backdrop-blur-md text-[11px] font-mono text-slate-300 space-y-2 pointer-events-none shadow-xl">
          <div className="font-bold text-white uppercase text-[10px] tracking-wider flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            <span>Dynamic Swarm Topology Legend</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded bg-amber-500/20 border border-amber-500"></div>
            <span>LLM Cognitive Agent (15)</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded rotate-45 bg-sky-500/20 border border-sky-400"></div>
            <span>Deterministic Routing Gate (4)</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-0.5 bg-emerald-400"></div>
            <span>Exploit Proven / Viable Route</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-0.5 bg-rose-400 stroke-dash"></div>
            <span>Falsification / Bypass Route</span>
          </div>
        </div>

        {/* SVG Canvas */}
        <svg
          ref={svgRef}
          className="w-full h-full cursor-grab active:cursor-grabbing select-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <defs>
            {/* Arrowhead Markers */}
            <marker id="arrow-standard" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#64748b" />
            </marker>
            <marker id="arrow-confirmed" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#10b981" />
            </marker>
            <marker id="arrow-bypass" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#f43f5e" />
            </marker>
            <marker id="arrow-fastpath" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#38bdf8" />
            </marker>

            {/* Glowing filter */}
            <filter id="glow-pulse" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Tier Grouping Background Plates */}
            <g className="opacity-40">
              {/* Tier 1 Plate */}
              <rect x="40" y="80" width="1190" height="150" rx="16" fill="#0f172a" stroke="#1e293b" strokeDasharray="4 4" />
              <text x="60" y="106" fill="#f59e0b" fontSize="11" fontFamily="monospace" fontWeight="bold">
                TIER 1: GLOBAL RECONNAISSANCE &amp; ARCHITECTURAL STRATEGY (1x per campaign scope)
              </text>

              {/* Tier 2 Plate */}
              <rect x="1250" y="80" width="460" height="150" rx="16" fill="#0f172a" stroke="#1e293b" strokeDasharray="4 4" />
              <text x="1270" y="106" fill="#38bdf8" fontSize="11" fontFamily="monospace" fontWeight="bold">
                TIER 2: VULNERABILITY AUDIT SWEEP
              </text>

              {/* Tier 3 Plate */}
              <rect x="40" y="245" width="1670" height="150" rx="16" fill="#0b1329" stroke="#1e293b" strokeDasharray="4 4" />
              <text x="60" y="270" fill="#a855f7" fontSize="11" fontFamily="monospace" fontWeight="bold">
                TIER 3: PER-FINDING ADVERSARIAL VERIFICATION &amp; FALSIFICATION FUNNEL (Iterated per candidate finding)
              </text>

              {/* Tier 4 Plate */}
              <rect x="40" y="410" width="1270" height="145" rx="16" fill="#0f172a" stroke="#1e293b" strokeDasharray="4 4" />
              <text x="60" y="432" fill="#10b981" fontSize="11" fontFamily="monospace" fontWeight="bold">
                TIER 4: ZERO-REGRESSION PATCHING, CVSS CALIBRATION &amp; ADVISORY REPORT
              </text>
            </g>

            {/* EDGES & FLOW CONNECTIONS */}
            <g>
              {FLOW_EDGES.map((edge, idx) => {
                const fromNode = FLOW_NODES.find((n) => n.id === edge.from);
                const toNode = FLOW_NODES.find((n) => n.id === edge.to);
                if (!fromNode || !toNode) return null;

                const fromCenter = getNodeCenter(edge.from);
                const toCenter = getNodeCenter(edge.to);

                let strokeColor = "#334155";
                let markerId = "arrow-standard";
                let strokeWidth = 2;
                let strokeDash = "none";

                if (edge.type === "confirmed") {
                  strokeColor = "#10b981";
                  markerId = "arrow-confirmed";
                  strokeWidth = 2.5;
                } else if (edge.type === "bypass") {
                  strokeColor = "#f43f5e";
                  markerId = "arrow-bypass";
                  strokeDash = "4 4";
                } else if (edge.type === "fastpath") {
                  strokeColor = "#38bdf8";
                  markerId = "arrow-fastpath";
                  strokeDash = "6 3";
                }

                // Curved path calculation
                let pathD = "";
                if (edge.from === "findings_gate" && edge.to === "reporter") {
                  // Fast-path bypass arching over or under
                  pathD = `M ${fromCenter.x} ${fromCenter.y + 40} C ${fromCenter.x + 80} 520, ${toCenter.x + 100} 520, ${toCenter.x} ${toCenter.y}`;
                } else if (edge.type === "bypass") {
                  // Bypass curves to calibrator
                  pathD = `M ${fromCenter.x} ${fromCenter.y + 35} C ${fromCenter.x} 400, ${toCenter.x - 50} 400, ${toCenter.x} ${toCenter.y}`;
                } else {
                  // Direct or S-curve
                  const dx = toCenter.x - fromCenter.x;
                  const dy = toCenter.y - fromCenter.y;
                  if (Math.abs(dy) > 30) {
                    pathD = `M ${fromCenter.x} ${fromCenter.y} C ${fromCenter.x + dx * 0.5} ${fromCenter.y}, ${fromCenter.x + dx * 0.5} ${toCenter.y}, ${toCenter.x} ${toCenter.y}`;
                  } else {
                    pathD = `M ${fromCenter.x} ${fromCenter.y} L ${toCenter.x} ${toCenter.y}`;
                  }
                }

                return (
                  <g key={`edge_${edge.from}_${edge.to}_${idx}`}>
                    <path
                      d={pathD}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray={strokeDash}
                      markerEnd={`url(#${markerId})`}
                    />
                    {edge.label && (
                      <text
                        x={(fromCenter.x + toCenter.x) / 2}
                        y={(fromCenter.y + toCenter.y) / 2 - 8}
                        fill={strokeColor}
                        fontSize="9"
                        fontFamily="monospace"
                        fontWeight="bold"
                        textAnchor="middle"
                      >
                        {edge.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>

            {/* NODES RENDERING */}
            <g>
              {FLOW_NODES.map((node, idx) => {
                const isSelected = selectedNode?.id === node.id;
                const isCurrent = scan.status === "running" && idx === currentNodeIdx;
                const isDone = scan.status === "completed" || idx < currentNodeIdx;
                const obsCount = scan.stage_observation_counts?.[node.id] || 0;
                const isGate = node.type === "classifier";
                const isAST = Boolean(node.isDeterministic);

                const assignedModel =
                  isAST
                    ? "Tree-Sitter AST"
                    : isGate
                    ? "0-Token Gate"
                    : scan.phase_models?.[node.id] || scan.model || "Gemini Flash";

                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    onClick={() => setSelectedNode(node)}
                    className="cursor-pointer group"
                  >
                    {/* Active Radar Ping Animation */}
                    {isCurrent && (
                      <rect
                        x="-4"
                        y="-4"
                        width={node.w + 8}
                        height={node.h + 8}
                        rx="16"
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="2"
                        className="animate-ping opacity-75"
                      />
                    )}

                    {/* Node Body Card */}
                    <rect
                      x="0"
                      y="0"
                      width={node.w}
                      height={node.h}
                      rx={isGate ? "8" : "12"}
                      fill={
                        isSelected
                          ? "#172554"
                          : isCurrent
                          ? "#451a03"
                          : isDone
                          ? "#06281e"
                          : isGate
                          ? "#09172e"
                          : "#090d16"
                      }
                      stroke={
                        isSelected
                          ? "#60a5fa"
                          : isCurrent
                          ? "#f59e0b"
                          : isDone
                          ? "#10b981"
                          : isGate
                          ? "#38bdf8"
                          : "#1e293b"
                      }
                      strokeWidth={isSelected || isCurrent ? "2.5" : isGate ? "1.5" : "1"}
                      className="transition-all duration-150 group-hover:stroke-amber-400"
                    />

                    {/* Top Ribbon inside Node */}
                    <text x="10" y="20" fill="#94a3b8" fontSize="9" fontFamily="monospace" fontWeight="bold">
                      #{node.num}
                    </text>
                    <text
                      x={node.w - 10}
                      y="20"
                      fill={isGate ? "#38bdf8" : isAST ? "#10b981" : "#f59e0b"}
                      fontSize="8"
                      fontFamily="monospace"
                      fontWeight="bold"
                      textAnchor="end"
                    >
                      {isGate ? "GATE" : isAST ? "AST ENGINE" : "AGENT"}
                    </text>

                    {/* Node Title */}
                    <text
                      x="10"
                      y="40"
                      fill="#ffffff"
                      fontSize="12"
                      fontFamily="monospace"
                      fontWeight="bold"
                      className="group-hover:fill-amber-300"
                    >
                      {node.shortName}
                    </text>

                    {/* Model Pill / Type */}
                    <text x="10" y="58" fill="#94a3b8" fontSize="9" fontFamily="monospace" opacity="0.85">
                      {assignedModel.replace("vertex_ai/", "").replace("openai/", "").replace("gemini/", "")}
                    </text>

                    {/* Bottom Status Row */}
                    <line x1="8" y1="65" x2={node.w - 8} y2="65" stroke="#1e293b" strokeWidth="1" />
                    <text x="10" y="78" fill={obsCount ? "#10b981" : "#64748b"} fontSize="9" fontFamily="monospace">
                      {obsCount ? `✔ ${obsCount} steps` : isGate ? "auto-route" : "idle"}
                    </text>

                    {isDone && (
                      <circle cx={node.w - 16} cy="75" r="5" fill="#10b981" />
                    )}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        {/* Slide-over Node Inspector Drawer */}
        {selectedNode && (
          <div className="absolute top-0 right-0 w-full sm:w-[420px] h-full bg-[#0a0f1d]/95 backdrop-blur-xl border-l border-slate-800 shadow-2xl z-20 flex flex-col transition-all">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-amber-950 text-amber-400 border border-amber-800">
                  #{selectedNode.num}
                </span>
                <h3 className="font-bold text-white text-sm font-mono">{selectedNode.name}</h3>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs font-mono">
              {/* Squad & Role Tag */}
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Security Squad:</span>
                  <span className="text-amber-300 font-bold">{selectedNode.squad}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Execution Type:</span>
                  <span className="text-sky-300 font-bold uppercase">{selectedNode.type}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">Total Inferences:</span>
                  <span className="text-emerald-400 font-bold">
                    {scan.stage_observation_counts?.[selectedNode.id] || 0} observations
                  </span>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Mission Objective</label>
                <p className="mt-1 text-slate-300 leading-relaxed font-sans text-xs bg-slate-950 p-3 rounded-xl border border-slate-800">
                  {selectedNode.desc}
                </p>
              </div>

              {/* Tool Arsenal */}
              <div>
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Allowed Tool Arsenal</label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {selectedNode.tools.map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 text-[10px] text-slate-300"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Recent Forensic Inference Stream for this Node */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Recent Traces ({nodeTraces.length})
                  </label>
                  <Link
                    href={`/scans/${scanId}?tab=trace&phase=${selectedNode.id}`}
                    className="text-[10px] text-amber-400 hover:underline flex items-center space-x-1"
                  >
                    <span>Inspect Full Traces</span>
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>

                <div className="mt-2 space-y-2 max-h-[240px] overflow-y-auto pr-1">
                  {tracesLoading ? (
                    <div className="p-4 text-center text-slate-500">Loading traces...</div>
                  ) : nodeTraces.length === 0 ? (
                    <div className="p-4 text-center text-slate-500 bg-slate-950 rounded-xl border border-slate-800">
                      No traces recorded for this node in the current scan.
                    </div>
                  ) : (
                    nodeTraces.slice(0, 8).map((tr) => (
                      <div
                        key={tr.id}
                        className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] space-y-1"
                      >
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-amber-400 font-bold">#{tr.step_number}</span>
                          <span className="text-slate-500">{tr.latency_ms}ms</span>
                        </div>
                        {tr.tool_name && (
                          <div className="text-sky-300 font-bold flex items-center space-x-1">
                            <Wrench className="w-3 h-3 text-sky-400" />
                            <span>{tr.tool_name}</span>
                          </div>
                        )}
                        {tr.thinking_content && (
                          <p className="text-slate-400 line-clamp-2 italic font-sans text-[11px]">
                            &ldquo;{tr.thinking_content}&rdquo;
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Drawer Footer Action */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/80">
              <Link
                href={`/scans/${scanId}?tab=trace&phase=${selectedNode.id}`}
                className="w-full flex items-center justify-center space-x-2 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold text-xs shadow-md glow-amber-btn hover:from-amber-400 hover:to-amber-500 transition-all"
              >
                <span>Filter Swarm Trace Inspector</span>
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
