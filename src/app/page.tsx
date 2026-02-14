"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";

interface Point {
  x: number;
  y: number;
}

interface BezierSegment {
  p0: [number, number];
  c1: [number, number];
  c2: [number, number];
  p3: [number, number];
}

interface BezierData {
  strokes: BezierSegment[][];
}

interface NamedAnchor {
  name: string;
  stroke: string;
  index: number;
  x: number;
  y: number;
}

interface AnchorsData {
  anchors: NamedAnchor[];
}

type Tool = "select" | "pen" | "hand";

type ViewMode = "original" | "silhouette" | "mask" | "bezier";

const strokeColors: Record<string, string> = {
  bottom: "#ff6b6b",
  top: "#4dabf7",
  bridge: "#69db7c",
  left: "#ffd43b",
  right: "#9775fa",
};

const DEFAULT_ZOOM = 0.45;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;

export default function ShapeShaper() {
  const [tool, setTool] = useState<Tool>("select");
  const [viewMode, setViewMode] = useState<ViewMode>("bezier");
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  
  const [showOriginal, setShowOriginal] = useState(true);
  const [showSilhouette, setShowSilhouette] = useState(false);
  const [showMask, setShowMask] = useState(false);
  const [showPath, setShowPath] = useState(true);
  const [showHandles, setShowHandles] = useState(true);
  const [showAnchors, setShowAnchors] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showAngles, setShowAngles] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  
  const [bezierData, setBezierData] = useState<BezierData | null>(null);
  const [anchorsData, setAnchorsData] = useState<AnchorsData | null>(null);
  
  const canvasRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch("/talkie-bezier.json").then((r) => r.json()),
      fetch("/talkie-anchors.json").then((r) => r.json()),
    ]).then(([bezier, anchors]) => {
      setBezierData(bezier);
      setAnchorsData(anchors);
    });
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(DEFAULT_ZOOM);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => {
    setZoom((z) => Math.min(MAX_ZOOM, z * 1.2));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => Math.max(MIN_ZOOM, z / 1.2));
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (tool === "hand" || e.button === 1 || e.altKey) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault();
    }
  }, [tool, pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  }, [isPanning, panStart]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const strokesPath = useMemo(() => {
    if (!bezierData) return "";
    return bezierData.strokes.map((stroke) => {
      if (stroke.length === 0) return "";
      let d = `M ${stroke[0].p0[0]} ${stroke[0].p0[1]}`;
      for (const seg of stroke) {
        d += ` C ${seg.c1[0]} ${seg.c1[1]}, ${seg.c2[0]} ${seg.c2[1]}, ${seg.p3[0]} ${seg.p3[1]}`;
      }
      return d;
    }).join(" ");
  }, [bezierData]);

  const handleLines = useMemo(() => {
    if (!bezierData || !showHandles) return [];
    const lines: JSX.Element[] = [];
    bezierData.strokes.forEach((stroke, si) => {
      stroke.forEach((seg, ei) => {
        lines.push(
          <line key={`h1-${si}-${ei}`} x1={seg.p0[0]} y1={seg.p0[1]} x2={seg.c1[0]} y2={seg.c1[1]} className="stroke-blue-400" strokeWidth="1" opacity="0.6" />,
          <line key={`h2-${si}-${ei}`} x1={seg.p3[0]} y1={seg.p3[1]} x2={seg.c2[0]} y2={seg.c2[1]} className="stroke-blue-400" strokeWidth="1" opacity="0.6" />
        );
      });
    });
    return lines;
  }, [bezierData, showHandles]);

  const controlPoints = useMemo(() => {
    if (!bezierData || !showHandles) return [];
    const points: JSX.Element[] = [];
    bezierData.strokes.forEach((stroke, si) => {
      stroke.forEach((seg, ei) => {
        points.push(
          <circle key={`c1-${si}-${ei}`} cx={seg.c1[0]} cy={seg.c1[1]} r="4" className="fill-blue-400" />,
          <circle key={`c2-${si}-${ei}`} cx={seg.c2[0]} cy={seg.c2[1]} r="4" className="fill-blue-400" />
        );
      });
    });
    return points;
  }, [bezierData, showHandles]);

  const anchorPoints = useMemo(() => {
    if (!bezierData || !showAnchors) return [];
    const points: JSX.Element[] = [];
    bezierData.strokes.forEach((stroke, si) => {
      stroke.forEach((seg, ei) => {
        points.push(
          <circle key={`p0-${si}-${ei}`} cx={seg.p0[0]} cy={seg.p0[1]} r="5" className="fill-red-500" />,
          <circle key={`p3-${si}-${ei}`} cx={seg.p3[0]} cy={seg.p3[1]} r="5" className="fill-red-500" />
        );
      });
    });
    return points;
  }, [bezierData, showAnchors]);

  const anchorLabels = useMemo(() => {
    if (!anchorsData || !showLabels) return [];
    return anchorsData.anchors.map((anchor, i) => (
      <g key={i}>
        <rect
          x={anchor.x + 8}
          y={anchor.y - 10}
          width={anchor.name.length * 7 + 8}
          height="18"
          rx="3"
          className="fill-zinc-900"
          opacity="0.8"
        />
        <text
          x={anchor.x + 12}
          y={anchor.y + 2}
          className="fill-white text-[10px] font-mono"
        >
          {anchor.name}
        </text>
      </g>
    ));
  }, [anchorsData, showLabels]);

  const strokeGroups = useMemo(() => {
    if (!anchorsData) return [];
    const groups: Record<string, NamedAnchor[]> = {};
    anchorsData.anchors.forEach((anchor) => {
      if (!groups[anchor.stroke]) groups[anchor.stroke] = [];
      groups[anchor.stroke].push(anchor);
    });
    return Object.entries(groups);
  }, [anchorsData]);

  return (
    <div className="flex h-screen flex-col bg-zinc-900 text-zinc-300">
      {/* Top Bar */}
      <div className="flex h-10 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-bold text-white">shaper</span>
          <div className="h-4 w-px bg-zinc-700" />
          <div className="flex gap-1">
            {(["original", "silhouette", "mask", "bezier"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`rounded px-2 py-0.5 text-xs font-medium capitalize transition-colors ${
                  viewMode === mode
                    ? "bg-blue-600 text-white"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[
              { id: "select", icon: "↖", label: "Select" },
              { id: "pen", icon: "✒", label: "Pen" },
              { id: "hand", icon: "✋", label: "Hand" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTool(t.id as Tool)}
                title={t.label}
                className={`flex h-6 w-6 items-center justify-center rounded text-xs ${
                  tool === t.id
                    ? "bg-zinc-700 text-white"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t.icon}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Layers */}
        <div className="w-48 border-r border-zinc-800 bg-zinc-950">
          <div className="border-b border-zinc-800 p-2">
            <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Layers</h3>
            <div className="space-y-0.5">
              {[
                { id: "showPath", label: "Bezier Path", checked: showPath, setter: setShowPath },
                { id: "showAnchors", label: "Anchors", checked: showAnchors, setter: setShowAnchors },
                { id: "showHandles", label: "Handles", checked: showHandles, setter: setShowHandles },
                { id: "showLabels", label: "Labels", checked: showLabels, setter: setShowLabels },
                { id: "showOriginal", label: "Original", checked: showOriginal, setter: setShowOriginal },
                { id: "showSilhouette", label: "Silhouette", checked: showSilhouette, setter: setShowSilhouette },
                { id: "showGrid", label: "Grid", checked: showGrid, setter: setShowGrid },
              ].map((item) => (
                <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-zinc-900">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={(e) => item.setter(e.target.checked)}
                    className="rounded bg-zinc-800"
                  />
                  <span className="text-zinc-400">{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="p-2">
            <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Strokes</h3>
            <div className="space-y-0.5">
              {strokeGroups.map(([name, anchors]) => (
                <div key={name} className="flex items-center gap-2 rounded px-1 py-0.5 text-xs">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: strokeColors[name] || "#888" }} />
                  <span className="text-zinc-400">{name}</span>
                  <span className="text-zinc-600">({anchors.length})</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div
          ref={containerRef}
          className={`flex-1 overflow-hidden relative ${(tool === "hand" || isPanning) ? "cursor-grab" : ""} ${isPanning ? "cursor-grabbing" : ""}`}
          style={{ 
            background: showGrid 
              ? "radial-gradient(circle, #27272a 1px, transparent 1px)" 
              : "#18181b",
            backgroundSize: showGrid ? "20px 20px" : "auto"
          }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div
            ref={canvasRef}
            className="absolute"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
              left: "50%",
              top: "50%",
              marginLeft: "-512px",
              marginTop: "-512px",
              width: 1024,
              height: 1024,
            }}
          >
            {/* Original */}
            {showOriginal && (
              <img src="/talkie-original.png" alt="Original" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
            )}
            
            {/* Silhouette */}
            {showSilhouette && (
              <img src="/talkie-silhouette.png" alt="Silhouette" className="absolute inset-0 w-full h-full object-contain opacity-50 pointer-events-none" />
            )}
            
            {/* Bezier Path */}
            {showPath && strokesPath && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1024 1024" preserveAspectRatio="xMidYMid meet">
                <path d={strokesPath} fill="none" stroke="#ff4d4d" strokeWidth="3" />
                {handleLines}
                {controlPoints}
                {anchorPoints}
                {anchorLabels}
              </svg>
            )}
          </div>

          {/* Minimap - Bottom Left */}
          <div className="absolute bottom-3 left-3 w-32 h-32 bg-zinc-950 border border-zinc-800 rounded overflow-hidden opacity-80 hover:opacity-100 transition-opacity">
            <div className="relative w-full h-full">
              <img src="/talkie-silhouette.png" alt="" className="w-full h-full object-contain opacity-30" />
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1024 1024" preserveAspectRatio="xMidYMid meet">
                <path d={strokesPath} fill="none" stroke="#ff4d4d" strokeWidth="8" />
              </svg>
              {/* Viewport indicator */}
              <div 
                className="absolute border border-blue-500 bg-blue-500/10"
                style={{
                  left: `${50 - (512 - pan.x) / 1024 / zoom * 50}%`,
                  top: `${50 - (512 - pan.y) / 1024 / zoom * 50}%`,
                  width: `${100 / zoom}%`,
                  height: `${100 / zoom}%`,
                  transform: "translate(-50%, -50%)",
                  maxWidth: "100%",
                  maxHeight: "100%",
                }}
              />
            </div>
          </div>

          {/* Zoom Controls - Bottom Right */}
          <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
            <button
              onClick={zoomOut}
              className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-white"
            >
              −
            </button>
            <button
              onClick={resetZoom}
              className="flex h-6 min-w-12 items-center justify-center rounded px-1 text-xs font-mono text-zinc-300 hover:bg-zinc-800 hover:text-white"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={zoomIn}
              className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-white"
            >
              +
            </button>
          </div>
        </div>

        {/* Right Panel - Inspector */}
        <div className="w-56 border-l border-zinc-800 bg-zinc-950">
          <div className="border-b border-zinc-800 p-2">
            <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Anchors</h3>
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {anchorsData?.anchors.map((anchor, i) => (
                <div key={i} className="flex items-center justify-between rounded px-1 py-0.5 text-xs hover:bg-zinc-900">
                  <span className="font-mono text-zinc-400">{anchor.name}</span>
                  <span className="text-zinc-600">
                    {anchor.x.toFixed(0)}, {anchor.y.toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-2">
            <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Info</h3>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between rounded px-1 py-0.5">
                <span className="text-zinc-500">Canvas</span>
                <span className="text-zinc-400">1024 × 1024</span>
              </div>
              <div className="flex justify-between rounded px-1 py-0.5">
                <span className="text-zinc-500">Anchors</span>
                <span className="text-zinc-400">{anchorsData?.anchors.length || 0}</span>
              </div>
              <div className="flex justify-between rounded px-1 py-0.5">
                <span className="text-zinc-500">Strokes</span>
                <span className="text-zinc-400">{bezierData?.strokes.length || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
