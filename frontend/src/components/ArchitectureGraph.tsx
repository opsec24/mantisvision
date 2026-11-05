"use client";

import React, { useState, useRef, useMemo, useEffect } from "react";
import {
  Download,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Layers,
  FileCode,
  Server,
  Maximize2,
  Minimize2,
  Move,
  LayoutGrid,
  Info,
  CheckCircle2,
} from "lucide-react";
import { ArchNode, parseArchitectureGraph } from "@/lib/graphParsers";
import { exportSvgToFile } from "@/lib/svgExport";

interface ArchitectureGraphProps {
  markdown: string;
  scanName?: string;
}

// Generous default layout coordinates with ample breathing room (Visio / Draw.io style)
const DEFAULT_NODE_COORDS: Record<string, { x: number; y: number; w: number; h: number }> = {
  "client-spa": { x: 80, y: 240, w: 260, h: 120 },
  "api-server": { x: 480, y: 140, w: 280, h: 135 },
  "auth-engine": { x: 480, y: 340, w: 280, h: 130 },
  "file-system": { x: 480, y: 530, w: 280, h: 125 },
  "database-orm": { x: 900, y: 200, w: 270, h: 130 },
  "nosql-db": { x: 900, y: 430, w: 270, h: 125 },
  "web3-rpc": { x: 1300, y: 160, w: 260, h: 135 },
  "chatbot-llm": { x: 1300, y: 410, w: 260, h: 130 },
};

export default function ArchitectureGraph({ markdown, scanName = "scan" }: ArchitectureGraphProps) {
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 20, y: 20 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Draw.io style draggable nodes
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    const init: Record<string, { x: number; y: number }> = {};
    for (const [id, c] of Object.entries(DEFAULT_NODE_COORDS)) {
      init[id] = { x: c.x, y: c.y };
    }
    return init;
  });

  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<ArchNode | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState<"graph" | "raw">("graph");

  const svgRef = useRef<SVGSVGElement | null>(null);
  const graphData = useMemo(() => parseArchitectureGraph(markdown), [markdown]);

  const canvasWidth = 1750;
  const canvasHeight = 850;

  // Handle canvas mouse events for panning and node dragging
  const handleSvgMouseDown = (e: React.MouseEvent) => {
    if (e.target === svgRef.current || (e.target as SVGElement).id === "bgRect") {
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
    const current = positions[nodeId] || DEFAULT_NODE_COORDS[nodeId] || { x: 100, y: 100 };

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

  // Reset to default spacious arrangement
  const resetLayout = () => {
    const init: Record<string, { x: number; y: number }> = {};
    for (const [id, c] of Object.entries(DEFAULT_NODE_COORDS)) {
      init[id] = { x: c.x, y: c.y };
    }
    setPositions(init);
    setZoom(0.85);
    setPan({ x: 20, y: 20 });
    setSelectedNode(null);
  };

  const handleExportSvg = () => {
    const filename = `${scanName.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}-architecture-graph.svg`;
    exportSvgToFile(svgRef.current, filename, { backgroundColor: "#090d16" });
  };

  return (
    <div
      className={`glass-card border border-slate-800 rounded-2xl shadow-xl overflow-hidden flex flex-col transition-all duration-300 ${
        isFullscreen ? "fixed inset-4 z-50 shadow-2xl bg-slate-950" : ""
      }`}
    >
      {/* Draw.io / Visio Style Top Toolbar */}
      <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 bg-slate-950/80">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shadow-xs">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              System Architecture &amp; Trust Boundaries Map
              <span className="text-[11px] font-semibold text-amber-300 bg-amber-950/80 px-2.5 py-0.5 rounded-full border border-amber-500/50 flex items-center gap-1 font-mono">
                <Move className="w-3 h-3 text-amber-400" />
                Interactive Drag &amp; Arrange Canvas
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Drag elements anywhere to rearrange, scroll to zoom, click empty canvas to pan
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* View Mode Toggle */}
          <div className="bg-slate-900 border border-slate-800 p-1 rounded-xl flex items-center text-xs font-semibold font-mono">
            <button
              onClick={() => setViewMode("graph")}
              className={`px-3 py-1 rounded-lg transition-all ${
                viewMode === "graph" ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow-xs glow-amber-btn" : "text-slate-400 hover:text-white"
              }`}
            >
              Visual Canvas
            </button>
            <button
              onClick={() => setViewMode("raw")}
              className={`px-3 py-1 rounded-lg transition-all ${
                viewMode === "raw" ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow-xs glow-amber-btn" : "text-slate-400 hover:text-white"
              }`}
            >
              Raw Markdown
            </button>
          </div>

          {viewMode === "graph" && (
            <>
              {/* Visio Zoom & Auto-Arrange Toolbar */}
              <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xs font-mono">
                <button
                  onClick={() => setZoom((z) => Math.min(z + 0.15, 2.0))}
                  className="p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                  title="Zoom In"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <span className="px-2 text-[11px] font-mono text-slate-400">{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => setZoom((z) => Math.max(z - 0.15, 0.4))}
                  className="p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={resetLayout}
                  className="px-2.5 py-1.5 text-slate-400 hover:bg-slate-800 hover:text-white border-l border-slate-800 text-xs font-semibold flex items-center gap-1 font-sans"
                  title="Auto-arrange and reset all elements to default positions"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Auto-Align</span>
                </button>
              </div>

              {/* Fullscreen Toggle */}
              <button
                onClick={() => setIsFullscreen((f) => !f)}
                className="p-2 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl shadow-2xs"
                title={isFullscreen ? "Exit Fullscreen" : "Expand Fullscreen"}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>

              {/* Lossless SVG Export */}
              <button
                onClick={handleExportSvg}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded-xl text-xs font-black shadow-xs transition-all cursor-pointer glow-amber-btn"
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
            {markdown || "No architecture data available."}
          </div>
        </div>
      ) : (
        <div
          className={`relative w-full ${
            isFullscreen ? "h-[calc(100vh-100px)]" : "h-[650px]"
          } bg-[#080d1a] overflow-hidden select-none cursor-grab active:cursor-grabbing`}
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
              {/* Visio / Draw.io Blueprint Dot Grid */}
              <pattern id="archDotGrid" width="32" height="32" patternUnits="userSpaceOnUse">
                <circle cx="16" cy="16" r="1.2" fill="#334155" opacity="0.45" />
              </pattern>

              <marker id="archArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#818cf8" />
              </marker>

              <marker id="archArrowDanger" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#f43f5e" />
              </marker>

              <filter id="archCardShadow" x="-10%" y="-10%" width="130%" height="130%">
                <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000000" floodOpacity="0.5" />
              </filter>
            </defs>

            {/* Clickable Background Rect for Canvas Pan */}
            <rect id="bgRect" width="100%" height="100%" fill="url(#archDotGrid)" />

            {/* Title Banner for Standalone SVG Export */}
            <g transform="translate(60, 60)">
              <text fill="#f8fafc" fontSize="24" fontWeight="800" fontFamily="sans-serif">
                System Topology &amp; Trust Boundaries Architecture
              </text>
              <text y="26" fill="#94a3b8" fontSize="13" fontFamily="sans-serif">
                Target: {scanName} • Visio &amp; Draw.io Architecture Flow
              </text>
            </g>

            {/* ── Dynamic Cable Connections (Follows Draggable Nodes!) ──── */}
            {graphData.edges.map((edge) => {
              const srcNode = DEFAULT_NODE_COORDS[edge.source];
              const tgtNode = DEFAULT_NODE_COORDS[edge.target];
              const srcPos = positions[edge.source] || srcNode || { x: 100, y: 100 };
              const tgtPos = positions[edge.target] || tgtNode || { x: 500, y: 500 };

              const srcW = srcNode?.w || 260;
              const srcH = srcNode?.h || 120;
              const tgtH = tgtNode?.h || 120;

              const x1 = srcPos.x + srcW;
              const y1 = srcPos.y + srcH / 2;
              const x2 = tgtPos.x;
              const y2 = tgtPos.y + tgtH / 2;

              const dx = Math.max(60, Math.abs(x2 - x1) * 0.45);
              const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
              const isDanger = edge.risk === "critical" || edge.risk === "high";

              return (
                <g key={edge.id} className="transition-opacity hover:opacity-100">
                  <path
                    d={pathD}
                    fill="none"
                    stroke={isDanger ? "#f43f5e" : "#6366f1"}
                    strokeWidth={isDanger ? "2.4" : "1.8"}
                    strokeOpacity={isDanger ? "0.85" : "0.55"}
                    strokeDasharray={isDanger ? "6 4" : undefined}
                    markerEnd={isDanger ? "url(#archArrowDanger)" : "url(#archArrow)"}
                  />

                  {/* Flow Label Tag */}
                  <g transform={`translate(${(x1 + x2) / 2}, ${(y1 + y2) / 2})`}>
                    <rect
                      x="-70"
                      y="-12"
                      width="140"
                      height="24"
                      rx="6"
                      fill="#0b0f1a"
                      stroke={isDanger ? "#f43f5e" : "#475569"}
                      strokeWidth="1"
                    />
                    <text
                      y="4"
                      textAnchor="middle"
                      fill={isDanger ? "#fecdd3" : "#cbd5e1"}
                      fontSize="10"
                      fontFamily="sans-serif"
                      fontWeight="600"
                    >
                      {edge.label}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* ── Draw.io Draggable Component Cards ─────────────────── */}
            {graphData.nodes.map((node) => {
              const def = DEFAULT_NODE_COORDS[node.id] || { w: 260, h: 125 };
              const pos = positions[node.id] || { x: 100, y: 100 };
              const isDragging = draggingNode === node.id;
              const isSelected = selectedNode?.id === node.id;
              const hasCritical = node.vulns?.some(
                (v) => v.toLowerCase().includes("cwe-89") || v.toLowerCase().includes("cwe-94")
              );

              return (
                <g
                  key={node.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onMouseDown={(e) => handleNodeMouseDown(node.id, e)}
                  onClick={() => setSelectedNode(node)}
                  className="cursor-move group"
                >
                  {/* Card Body */}
                  <rect
                    width={def.w}
                    height={def.h}
                    rx="14"
                    fill="#0f1629"
                    stroke={isSelected ? "#c084fc" : isDragging ? "#a855f7" : hasCritical ? "#f43f5e" : "#24324f"}
                    strokeWidth={isSelected || isDragging ? "2.5" : hasCritical ? "1.8" : "1.2"}
                    filter="url(#archCardShadow)"
                  />

                  {/* Accent Top Line */}
                  <rect
                    x="0"
                    y="0"
                    width={def.w}
                    height="4"
                    rx="2"
                    fill={hasCritical ? "#f43f5e" : isSelected ? "#c084fc" : "#6366f1"}
                  />

                  {/* Move Grip Hint Indicator */}
                  <g transform={`translate(${def.w - 24}, 12)`} opacity="0.4" className="group-hover:opacity-100">
                    <circle cx="0" cy="0" r="1.5" fill="#94a3b8" />
                    <circle cx="6" cy="0" r="1.5" fill="#94a3b8" />
                    <circle cx="0" cy="6" r="1.5" fill="#94a3b8" />
                    <circle cx="6" cy="6" r="1.5" fill="#94a3b8" />
                  </g>

                  {/* Component Title */}
                  <text x="16" y="32" fill="#f8fafc" fontSize="13.5" fontWeight="700" fontFamily="sans-serif">
                    {node.label}
                  </text>

                  {/* Trust Role */}
                  <text x="16" y="52" fill="#94a3b8" fontSize="11" fontFamily="sans-serif">
                    Role: {node.trustRole || "Service Component"}
                  </text>

                  {/* Vulnerability Badges */}
                  {node.vulns && node.vulns.length > 0 && (
                    <g transform="translate(16, 72)">
                      {node.vulns.slice(0, 2).map((vuln, i) => (
                        <g key={i} transform={`translate(${i * 115}, 0)`}>
                          <rect width="108" height="22" rx="6" fill="#450a0a" stroke="#f43f5e" strokeWidth="0.8" />
                          <text
                            x="54"
                            y="14.5"
                            textAnchor="middle"
                            fill="#fecdd3"
                            fontSize="9.5"
                            fontWeight="700"
                            fontFamily="sans-serif"
                          >
                            {vuln}
                          </text>
                        </g>
                      ))}
                    </g>
                  )}

                  {/* Left & Right Connection Ports */}
                  <circle cx="0" cy={def.h / 2} r="5" fill="#0f1629" stroke="#6366f1" strokeWidth="2" />
                  <circle cx="0" cy={def.h / 2} r="2" fill="#ffffff" />
                  <circle cx={def.w} cy={def.h / 2} r="5" fill="#0f1629" stroke="#6366f1" strokeWidth="2" />
                  <circle cx={def.w} cy={def.h / 2} r="2" fill="#ffffff" />
                </g>
              );
            })}
          </svg>

          {/* Node Inspector Drawer */}
          {selectedNode && (
            <div className="absolute right-4 top-4 bottom-4 w-96 glass-card border border-amber-500/50 rounded-2xl shadow-2xl p-5 text-slate-200 backdrop-blur-md overflow-y-auto animate-in slide-in-from-right duration-200">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center space-x-2">
                  <Server className="w-5 h-5 text-amber-400" />
                  <span className="text-xs font-mono uppercase tracking-wider text-amber-400 font-bold">
                    Component Inspector
                  </span>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-slate-400 hover:text-white text-xs px-2 py-1 bg-slate-800 rounded-lg"
                >
                  ✕ Close
                </button>
              </div>

              <div className="space-y-4 mt-4 text-xs">
                <div>
                  <h4 className="text-sm font-bold text-white">{selectedNode.label}</h4>
                  <p className="text-slate-400 mt-1">{selectedNode.trustRole}</p>
                </div>

                {selectedNode.files && selectedNode.files.length > 0 && (
                  <div>
                    <span className="font-semibold text-slate-300 block mb-1">Key Files &amp; Boundaries:</span>
                    <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 font-mono text-[11px] space-y-1 text-slate-300">
                      {selectedNode.files.map((f, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <FileCode className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span>{f}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedNode.vulns && selectedNode.vulns.length > 0 && (
                  <div>
                    <span className="font-semibold text-slate-300 block mb-1">Linked Vulnerability Classes:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedNode.vulns.map((v, i) => (
                        <span
                          key={i}
                          className="px-2.5 py-1 bg-red-950/80 border border-red-700 text-red-200 rounded-md font-mono text-[10.5px] font-semibold"
                        >
                          {v}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedNode.sanitizers && (
                  <div>
                    <span className="font-semibold text-slate-300 block mb-1">Sanitizers &amp; Defenses:</span>
                    <p className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-slate-300">
                      {selectedNode.sanitizers}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
