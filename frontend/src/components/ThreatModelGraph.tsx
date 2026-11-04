"use client";

import React, { useState, useRef, useMemo } from "react";
import {
  Download,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ShieldAlert,
  Flame,
  Maximize2,
  Minimize2,
  Move,
  LayoutGrid,
} from "lucide-react";
import { parseThreatModelGraph } from "@/lib/graphParsers";
import { exportSvgToFile } from "@/lib/svgExport";

interface ThreatModelGraphProps {
  markdown: string;
  scanName?: string;
}

export default function ThreatModelGraph({ markdown, scanName = "scan" }: ThreatModelGraphProps) {
  const [zoom, setZoom] = useState(0.75);
  const [pan, setPan] = useState({ x: 30, y: 30 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const threatData = useMemo(() => parseThreatModelGraph(markdown), [markdown]);

  // Generous, spacious default coordinates across a 2400px wide canvas (Visio / draw.io style)
  const defaultCoords = useMemo(() => {
    const colX = {
      actors: 80,
      boundaries: 680,
      sinks: 1300,
      assets: 1880,
    };

    const map: Record<string, { x: number; y: number; w: number; h: number }> = {};

    threatData.actors.forEach((act, i) => {
      map[act.id] = { x: colX.actors, y: 160 + i * 150, w: 320, h: 110 };
    });

    threatData.boundaries.forEach((b, i) => {
      map[b.id] = { x: colX.boundaries, y: 140 + i * 165, w: 340, h: 120 };
    });

    threatData.vulnSinks.forEach((s, i) => {
      map[s.id] = { x: colX.sinks, y: 120 + i * 95, w: 310, h: 75 };
    });

    threatData.assets.forEach((a, i) => {
      map[a.id] = { x: colX.assets, y: 140 + i * 140, w: 310, h: 105 };
    });

    return map;
  }, [threatData]);

  // Draggable Node Positions
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    const init: Record<string, { x: number; y: number }> = {};
    for (const [id, c] of Object.entries(defaultCoords)) {
      init[id] = { x: c.x, y: c.y };
    }
    return init;
  });

  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [selectedItem, setSelectedItem] = useState<{ title: string; subtitle?: string; details: string } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState<"graph" | "raw">("graph");

  const svgRef = useRef<SVGSVGElement | null>(null);

  const canvasWidth = 2400;
  const canvasHeight = 900;

  const handleSvgMouseDown = (e: React.MouseEvent) => {
    if (e.target === svgRef.current || (e.target as SVGElement).id === "threatBg") {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleNodeMouseDown = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const svgRect = svgRef.current?.getBoundingClientRect();
    if (!svgRect) return;

    const mouseX = (e.clientX - svgRect.left - pan.x) / zoom;
    const mouseY = (e.clientY - svgRect.top - pan.y) / zoom;
    const current = positions[nodeId] || defaultCoords[nodeId] || { x: 100, y: 100 };

    setDraggingNode(nodeId);
    setDragOffset({ x: mouseX - current.x, y: mouseY - current.y });
  };

  const handleSvgMouseMove = (e: React.MouseEvent) => {
    if (draggingNode) {
      const svgRect = svgRef.current?.getBoundingClientRect();
      if (!svgRect) return;

      const mouseX = (e.clientX - svgRect.left - pan.x) / zoom;
      const mouseY = (e.clientY - svgRect.top - pan.y) / zoom;

      setPositions((prev) => ({
        ...prev,
        [draggingNode]: {
          x: Math.round(mouseX - dragOffset.x),
          y: Math.round(mouseY - dragOffset.y),
        },
      }));
    } else if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  };

  const handleSvgMouseUp = () => {
    setDraggingNode(null);
    setIsPanning(false);
  };

  const resetLayout = () => {
    const init: Record<string, { x: number; y: number }> = {};
    for (const [id, c] of Object.entries(defaultCoords)) {
      init[id] = { x: c.x, y: c.y };
    }
    setPositions(init);
    setZoom(0.75);
    setPan({ x: 30, y: 30 });
    setSelectedItem(null);
  };

  const handleExportSvg = () => {
    const filename = `${scanName.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}-threat-model-matrix.svg`;
    exportSvgToFile(svgRef.current, filename, { backgroundColor: "#080c18" });
  };

  return (
    <div
      className={`bg-white/95 border border-purple-100/90 rounded-2xl shadow-xs overflow-hidden flex flex-col transition-all duration-300 ${
        isFullscreen ? "fixed inset-4 z-50 shadow-2xl bg-slate-950" : ""
      }`}
    >
      {/* Top Toolbar */}
      <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4 bg-slate-50/70">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shadow-xs">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              Threat Model &amp; Attack Surface Flow Matrix
              <span className="text-[11px] font-semibold text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200 flex items-center gap-1">
                <Move className="w-3 h-3 text-amber-700" />
                Drag &amp; Arrange Visio Canvas
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              Drag any threat actor, boundary, or sink card to organize attack paths. Zoom &amp; pan freely.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* View Mode Toggle */}
          <div className="bg-slate-200/60 p-1 rounded-xl flex items-center text-xs font-semibold">
            <button
              onClick={() => setViewMode("graph")}
              className={`px-3 py-1 rounded-lg transition-all ${
                viewMode === "graph" ? "bg-white text-amber-700 shadow-xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Attack Surface Canvas
            </button>
            <button
              onClick={() => setViewMode("raw")}
              className={`px-3 py-1 rounded-lg transition-all ${
                viewMode === "raw" ? "bg-white text-amber-700 shadow-xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Raw Threat Matrix
            </button>
          </div>

          {viewMode === "graph" && (
            <>
              {/* Zoom & Auto-Align Controls */}
              <div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <button
                  onClick={() => setZoom((z) => Math.min(z + 0.15, 2.0))}
                  className="p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  title="Zoom In"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <span className="px-2 text-[11px] font-mono text-slate-500">{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => setZoom((z) => Math.max(z - 0.15, 0.4))}
                  className="p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={resetLayout}
                  className="px-2.5 py-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-900 border-l border-slate-200 text-xs font-semibold flex items-center gap-1"
                  title="Auto-arrange and reset all elements to default positions"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Auto-Align</span>
                </button>
              </div>

              {/* Fullscreen Toggle */}
              <button
                onClick={() => setIsFullscreen((f) => !f)}
                className="p-2 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl shadow-2xs"
                title={isFullscreen ? "Exit Fullscreen" : "Expand Fullscreen"}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>

              {/* Lossless SVG Export */}
              <button
                onClick={handleExportSvg}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-600 to-rose-600 text-white rounded-xl text-xs font-semibold shadow-xs hover:from-amber-700 hover:to-rose-700 transition-all cursor-pointer"
                title="Download this exact arrangement as an ultra-high resolution SVG vector file"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export SVG</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === "raw" ? (
        <div className="p-6">
          <div className="font-mono text-xs text-slate-700 bg-slate-50/70 p-4 rounded-xl border border-slate-200/80 whitespace-pre-wrap leading-relaxed max-h-[600px] overflow-y-auto">
            {markdown || "No threat model matrix available."}
          </div>
        </div>
      ) : (
        <div
          className={`relative w-full ${
            isFullscreen ? "h-[calc(100vh-100px)]" : "h-[650px]"
          } bg-[#080c18] overflow-hidden select-none cursor-grab active:cursor-grabbing`}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
            className="w-full h-full"
            onMouseDown={handleSvgMouseDown}
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleSvgMouseUp}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: isPanning || draggingNode ? "none" : "transform 0.1s ease-out",
            }}
          >
            <defs>
              <pattern id="threatDotGrid" width="32" height="32" patternUnits="userSpaceOnUse">
                <circle cx="16" cy="16" r="1.2" fill="#334155" opacity="0.45" />
              </pattern>

              <marker id="tArrowRed" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#f43f5e" />
              </marker>

              <marker id="tArrowAmber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#f59e0b" />
              </marker>

              <filter id="threatShadow" x="-10%" y="-10%" width="130%" height="130%">
                <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000000" floodOpacity="0.5" />
              </filter>
            </defs>

            {/* Clickable Background Rect */}
            <rect id="threatBg" width="100%" height="100%" fill="url(#threatDotGrid)" />

            {/* Title Header */}
            <g transform="translate(80, 60)">
              <text fill="#f8fafc" fontSize="24" fontWeight="800" fontFamily="sans-serif">
                STRIDE Threat Model &amp; Attack Surface Matrix
              </text>
              <text y="26" fill="#94a3b8" fontSize="13" fontFamily="sans-serif">
                Target: {scanName} • Visio &amp; Draw.io Interactive Flow
              </text>
            </g>

            {/* Tier Column Headers */}
            <g transform="translate(0, 110)">
              <text x="80" fill="#818cf8" fontSize="13" fontWeight="800" fontFamily="sans-serif" letterSpacing="0.8">
                TIER 1 • THREAT ACTORS
              </text>
              <text x="680" fill="#c084fc" fontSize="13" fontWeight="800" fontFamily="sans-serif" letterSpacing="0.8">
                TIER 2 • TRUST BOUNDARIES
              </text>
              <text x="1300" fill="#f43f5e" fontSize="13" fontWeight="800" fontFamily="sans-serif" letterSpacing="0.8">
                TIER 3 • VULNERABILITY SINKS
              </text>
              <text x="1880" fill="#fbbf24" fontSize="13" fontWeight="800" fontFamily="sans-serif" letterSpacing="0.8">
                TIER 4 • COMPROMISED ASSETS
              </text>
            </g>

            {/* ── Dynamic Attack Path Cables ─────────────────────────── */}
            {threatData.edges.map((edge) => {
              const srcDef = defaultCoords[edge.source];
              const tgtDef = defaultCoords[edge.target];
              const srcPos = positions[edge.source] || srcDef || { x: 100, y: 100 };
              const tgtPos = positions[edge.target] || tgtDef || { x: 500, y: 500 };

              const srcW = srcDef?.w || 300;
              const srcH = srcDef?.h || 100;
              const tgtH = tgtDef?.h || 100;

              const x1 = srcPos.x + srcW;
              const y1 = srcPos.y + srcH / 2;
              const x2 = tgtPos.x;
              const y2 = tgtPos.y + tgtH / 2;

              const dx = Math.max(60, Math.abs(x2 - x1) * 0.45);
              const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
              const isCrit = edge.severity === "critical";

              return (
                <path
                  key={edge.id}
                  d={pathD}
                  fill="none"
                  stroke={isCrit ? "#f43f5e" : "#f59e0b"}
                  strokeWidth={isCrit ? "2.4" : "1.8"}
                  strokeOpacity={isCrit ? "0.85" : "0.6"}
                  strokeDasharray={isCrit ? "6 4" : undefined}
                  markerEnd={isCrit ? "url(#tArrowRed)" : "url(#tArrowAmber)"}
                />
              );
            })}

            {/* ── Draggable Node Cards ───────────────────────────────── */}
            {/* 1. Threat Actors */}
            {threatData.actors.map((actor) => {
              const def = defaultCoords[actor.id] || { w: 320, h: 110 };
              const pos = positions[actor.id] || { x: 80, y: 160 };
              const isDragging = draggingNode === actor.id;

              return (
                <g
                  key={actor.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onMouseDown={(e) => handleNodeMouseDown(actor.id, e)}
                  onClick={() =>
                    setSelectedItem({
                      title: actor.title,
                      subtitle: "Threat Actor Profile",
                      details: `${actor.profile}\n\nCapabilities: ${actor.capabilities}`,
                    })
                  }
                  className="cursor-move group"
                >
                  <rect
                    width={def.w}
                    height={def.h}
                    rx="14"
                    fill="#11182e"
                    stroke={isDragging ? "#818cf8" : "#312e81"}
                    strokeWidth={isDragging ? "2.5" : "1.5"}
                    filter="url(#threatShadow)"
                  />
                  <rect x="0" y="0" width="5" height={def.h} rx="2.5" fill="#6366f1" />
                  <text x="18" y="32" fill="#f8fafc" fontSize="13.5" fontWeight="700" fontFamily="sans-serif">
                    {actor.title}
                  </text>
                  <text x="18" y="54" fill="#94a3b8" fontSize="11" fontFamily="sans-serif">
                    {actor.profile.length > 44 ? `${actor.profile.substring(0, 42)}...` : actor.profile}
                  </text>
                  <text x="18" y="76" fill="#64748b" fontSize="10.5" fontFamily="sans-serif">
                    Cap: {actor.capabilities.length > 42 ? `${actor.capabilities.substring(0, 40)}...` : actor.capabilities}
                  </text>
                  <circle cx={def.w} cy={def.h / 2} r="5" fill="#11182e" stroke="#6366f1" strokeWidth="2" />
                  <circle cx={def.w} cy={def.h / 2} r="2" fill="#ffffff" />
                </g>
              );
            })}

            {/* 2. Trust Boundaries */}
            {threatData.boundaries.map((tb) => {
              const def = defaultCoords[tb.id] || { w: 340, h: 120 };
              const pos = positions[tb.id] || { x: 680, y: 140 };
              const isDragging = draggingNode === tb.id;

              return (
                <g
                  key={tb.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onMouseDown={(e) => handleNodeMouseDown(tb.id, e)}
                  onClick={() =>
                    setSelectedItem({
                      title: tb.title,
                      subtitle: "Trust Boundary",
                      details: `Untrusted Side: ${tb.untrustedSide}\nTrusted Side: ${tb.trustedSide}\nRisk: ${tb.risk}\nSinks: ${tb.sinks.join(", ")}`,
                    })
                  }
                  className="cursor-move group"
                >
                  <rect
                    width={def.w}
                    height={def.h}
                    rx="14"
                    fill="#1e1035"
                    stroke={isDragging ? "#c084fc" : "#581c87"}
                    strokeWidth={isDragging ? "2.5" : "1.5"}
                    filter="url(#threatShadow)"
                  />
                  <rect x="0" y="0" width="5" height={def.h} rx="2.5" fill="#a855f7" />
                  <text x="18" y="30" fill="#f8fafc" fontSize="13" fontWeight="700" fontFamily="sans-serif">
                    {tb.title}
                  </text>
                  <text x="18" y="52" fill="#cbd5e1" fontSize="10.5" fontFamily="sans-serif">
                    From: {tb.untrustedSide}
                  </text>
                  <text x="18" y="70" fill="#cbd5e1" fontSize="10.5" fontFamily="sans-serif">
                    To: {tb.trustedSide}
                  </text>
                  <text x="18" y="90" fill="#f43f5e" fontSize="10.5" fontWeight="600" fontFamily="sans-serif">
                    Risk: {tb.risk}
                  </text>
                  <circle cx="0" cy={def.h / 2} r="5" fill="#1e1035" stroke="#a855f7" strokeWidth="2" />
                  <circle cx="0" cy={def.h / 2} r="2" fill="#ffffff" />
                  <circle cx={def.w} cy={def.h / 2} r="5" fill="#1e1035" stroke="#a855f7" strokeWidth="2" />
                  <circle cx={def.w} cy={def.h / 2} r="2" fill="#ffffff" />
                </g>
              );
            })}

            {/* 3. Vulnerability Sinks */}
            {threatData.vulnSinks.map((sink) => {
              const def = defaultCoords[sink.id] || { w: 310, h: 75 };
              const pos = positions[sink.id] || { x: 1300, y: 120 };
              const isDragging = draggingNode === sink.id;
              const isCrit = sink.severity === "critical";

              return (
                <g
                  key={sink.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onMouseDown={(e) => handleNodeMouseDown(sink.id, e)}
                  onClick={() =>
                    setSelectedItem({
                      title: sink.label,
                      subtitle: `Vulnerability Mechanism (${sink.cwe})`,
                      details: `Severity: ${sink.severity.toUpperCase()}\nCWE: ${sink.cwe}\nAttackers exploiting this sink bypass defenses to compromise high-value assets.`,
                    })
                  }
                  className="cursor-move group"
                >
                  <rect
                    width={def.w}
                    height={def.h}
                    rx="12"
                    fill="#2a0d18"
                    stroke={isDragging ? "#fb7185" : isCrit ? "#be123c" : "#b45309"}
                    strokeWidth={isDragging ? "2.5" : "1.5"}
                    filter="url(#threatShadow)"
                  />
                  <rect x="0" y="0" width="5" height={def.h} rx="2.5" fill={isCrit ? "#f43f5e" : "#f59e0b"} />
                  <text x="16" y="28" fill="#f8fafc" fontSize="12" fontWeight="700" fontFamily="sans-serif">
                    {sink.label.length > 38 ? `${sink.label.substring(0, 36)}...` : sink.label}
                  </text>
                  <g transform="translate(16, 42)">
                    <rect width="70" height="20" rx="5" fill="#881337" stroke="#f43f5e" strokeWidth="0.8" />
                    <text x="35" y="14" textAnchor="middle" fill="#fecdd3" fontSize="10" fontWeight="700" fontFamily="sans-serif">
                      {sink.cwe}
                    </text>
                  </g>
                  <circle cx="0" cy={def.h / 2} r="5" fill="#2a0d18" stroke="#f43f5e" strokeWidth="2" />
                  <circle cx="0" cy={def.h / 2} r="2" fill="#ffffff" />
                  <circle cx={def.w} cy={def.h / 2} r="5" fill="#2a0d18" stroke="#f43f5e" strokeWidth="2" />
                  <circle cx={def.w} cy={def.h / 2} r="2" fill="#ffffff" />
                </g>
              );
            })}

            {/* 4. Target Assets */}
            {threatData.assets.map((asset) => {
              const def = defaultCoords[asset.id] || { w: 310, h: 105 };
              const pos = positions[asset.id] || { x: 1880, y: 140 };
              const isDragging = draggingNode === asset.id;
              const isCrit = asset.sensitivity === "critical";

              return (
                <g
                  key={asset.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onMouseDown={(e) => handleNodeMouseDown(asset.id, e)}
                  onClick={() =>
                    setSelectedItem({
                      title: asset.title,
                      subtitle: "Target Business Asset",
                      details: `Impact Assessment: ${asset.impact}\nSensitivity: ${asset.sensitivity.toUpperCase()}`,
                    })
                  }
                  className="cursor-move group"
                >
                  <rect
                    width={def.w}
                    height={def.h}
                    rx="14"
                    fill="#28170c"
                    stroke={isDragging ? "#fde047" : isCrit ? "#c2410c" : "#a16207"}
                    strokeWidth={isDragging ? "2.5" : "1.5"}
                    filter="url(#threatShadow)"
                  />
                  <rect x="0" y="0" width="5" height={def.h} rx="2.5" fill={isCrit ? "#f97316" : "#eab308"} />
                  <text x="16" y="30" fill="#f8fafc" fontSize="13" fontWeight="700" fontFamily="sans-serif">
                    {asset.title}
                  </text>
                  <text x="16" y="52" fill="#fde68a" fontSize="10.5" fontFamily="sans-serif">
                    Impact: {asset.impact.length > 40 ? `${asset.impact.substring(0, 38)}...` : asset.impact}
                  </text>
                  <text x="16" y="74" fill="#cbd5e1" fontSize="10" fontWeight="600" fontFamily="sans-serif">
                    Sensitivity: {asset.sensitivity.toUpperCase()}
                  </text>
                  <circle cx="0" cy={def.h / 2} r="5" fill="#28170c" stroke="#eab308" strokeWidth="2" />
                  <circle cx="0" cy={def.h / 2} r="2" fill="#ffffff" />
                </g>
              );
            })}
          </svg>

          {/* Drawer Details */}
          {selectedItem && (
            <div className="absolute right-4 top-4 bottom-4 w-96 bg-slate-900/95 border border-amber-500/50 rounded-2xl shadow-2xl p-5 text-slate-200 backdrop-blur-md overflow-y-auto animate-in slide-in-from-right duration-200">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center space-x-2">
                  <Flame className="w-5 h-5 text-amber-400" />
                  <span className="text-xs font-mono uppercase tracking-wider text-amber-400 font-bold">
                    {selectedItem.subtitle || "Threat Node"}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="text-slate-400 hover:text-white text-xs px-2 py-1 bg-slate-800 rounded-lg"
                >
                  ✕ Close
                </button>
              </div>

              <div className="space-y-4 mt-4 text-xs">
                <h4 className="text-sm font-bold text-white">{selectedItem.title}</h4>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 whitespace-pre-wrap leading-relaxed text-slate-300">
                  {selectedItem.details}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
