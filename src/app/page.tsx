"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { traceFromImage } from "@/lib/bezier-fit";

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

interface SharedPoint {
  a: string;
  b: string;
  x: number;
  y: number;
}

interface AnchorsData {
  anchors: NamedAnchor[];
  shared?: SharedPoint[];
}

type PointType = "p0" | "p3" | "c1" | "c2";

interface SelectedPoint {
  strokeIndex: number;
  segmentIndex: number;
  pointType: PointType;
}

type Tool = "select" | "pen" | "hand";

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
const MAX_HISTORY = 100;

export default function ShapeShaper() {
  const [tool, setTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint | null>(null);
  const [isDraggingPoint, setIsDraggingPoint] = useState(false);
  const [pathColor, setPathColor] = useState("#ff4d4d");
  
  const [showOriginal, setShowOriginal] = useState(true);
  const [showSilhouette, setShowSilhouette] = useState(false);
  const [showPath, setShowPath] = useState(true);
  const [showHandles, setShowHandles] = useState(true);
  const [showAnchors, setShowAnchors] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  
  const [bezierData, setBezierData] = useState<BezierData | null>(null);
  const [anchorsData, setAnchorsData] = useState<AnchorsData | null>(null);
  const [smoothStates, setSmoothStates] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [traceError, setTraceError] = useState(5);
  const [isTracing, setIsTracing] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const isUndoRedoRef = useRef(false);
  
  const canvasRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch("/talkie-bezier.json").then((r) => r.json()),
      fetch("/talkie-anchors.json").then((r) => r.json()),
    ]).then(([bezier, anchors]) => {
      setBezierData(bezier);
      setAnchorsData(anchors);
      historyRef.current = [JSON.stringify(bezier)];
      historyIndexRef.current = 0;
    });
  }, []);

  // Push to undo history on bezier data change (skip if caused by undo/redo)
  const pushHistoryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!bezierData || isUndoRedoRef.current) {
      isUndoRedoRef.current = false;
      return;
    }
    if (pushHistoryRef.current) clearTimeout(pushHistoryRef.current);
    pushHistoryRef.current = setTimeout(() => {
      const json = JSON.stringify(bezierData);
      const current = historyRef.current[historyIndexRef.current];
      if (json === current) return;
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      historyRef.current.push(json);
      if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
      historyIndexRef.current = historyRef.current.length - 1;
    }, 300);
  }, [bezierData]);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current--;
    isUndoRedoRef.current = true;
    setBezierData(JSON.parse(historyRef.current[historyIndexRef.current]));
  }, []);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current++;
    isUndoRedoRef.current = true;
    setBezierData(JSON.parse(historyRef.current[historyIndexRef.current]));
  }, []);

  const saveToDisk = useCallback(async (data: BezierData, smooth: Record<string, boolean>) => {
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bezier: data, smooth }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, []);

  const quickSave = useCallback(() => {
    if (!bezierData) return;
    saveToDisk(bezierData, smoothStates);
  }, [bezierData, smoothStates, saveToDisk]);

  // Auto-save to disk with 2s debounce
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadRef = useRef(true);
  useEffect(() => {
    if (!bezierData) return;
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => {
      saveToDisk(bezierData, smoothStates);
    }, 2000);
    return () => {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    };
  }, [bezierData, smoothStates, saveToDisk]);

  const downloadJson = useCallback(() => {
    if (!bezierData) return;
    const blob = new Blob([JSON.stringify(bezierData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "shaper-bezier.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [bezierData]);

  // Delete the selected point/segment
  const deleteSelectedPoint = useCallback(() => {
    if (!selectedPoint || !bezierData) return;
    const { strokeIndex, segmentIndex, pointType } = selectedPoint;

    setBezierData((prev) => {
      if (!prev) return prev;
      const newData = JSON.parse(JSON.stringify(prev));
      const stroke = newData.strokes[strokeIndex];
      if (!stroke) return prev;

      // If it's a control handle, reset it to midpoint between its anchor and the other end
      if (pointType === "c1") {
        const seg = stroke[segmentIndex];
        seg.c1[0] = (seg.p0[0] * 2 + seg.p3[0]) / 3;
        seg.c1[1] = (seg.p0[1] * 2 + seg.p3[1]) / 3;
        return newData;
      }
      if (pointType === "c2") {
        const seg = stroke[segmentIndex];
        seg.c2[0] = (seg.p0[0] + seg.p3[0] * 2) / 3;
        seg.c2[1] = (seg.p0[1] + seg.p3[1] * 2) / 3;
        return newData;
      }

      // For anchor points: remove the segment and reconnect
      if (stroke.length === 1) {
        // Last segment in stroke — remove entire stroke
        newData.strokes.splice(strokeIndex, 1);
      } else if (segmentIndex === 0 && pointType === "p0") {
        // First point of first segment — just remove first segment
        stroke.splice(0, 1);
      } else if (segmentIndex === stroke.length - 1 && pointType === "p3") {
        // Last point of last segment — just remove last segment
        stroke.splice(stroke.length - 1, 1);
      } else {
        // Middle point — merge two adjacent segments into one
        // The point being deleted is shared between seg[i].p3 and seg[i+1].p0
        // or seg[i].p0 and seg[i-1].p3
        if (pointType === "p3" && segmentIndex < stroke.length - 1) {
          // Merge current seg and next seg: keep current.p0/c1, next.c2/p3
          const curr = stroke[segmentIndex];
          const next = stroke[segmentIndex + 1];
          const merged = {
            p0: curr.p0,
            c1: curr.c1,
            c2: next.c2,
            p3: next.p3,
          };
          stroke.splice(segmentIndex, 2, merged);
        } else if (pointType === "p0" && segmentIndex > 0) {
          // Merge prev seg and current seg: keep prev.p0/c1, current.c2/p3
          const prev = stroke[segmentIndex - 1];
          const curr = stroke[segmentIndex];
          const merged = {
            p0: prev.p0,
            c1: prev.c1,
            c2: curr.c2,
            p3: curr.p3,
          };
          stroke.splice(segmentIndex - 1, 2, merged);
        } else {
          // Fallback: just remove the segment
          stroke.splice(segmentIndex, 1);
        }
      }

      // Clean up empty strokes
      newData.strokes = newData.strokes.filter((s: unknown[]) => s.length > 0);

      return newData;
    });

    setSelectedPoint(null);
  }, [selectedPoint, bezierData]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if (isMod && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      }
      if (isMod && e.key === "y") {
        e.preventDefault();
        redo();
      }
      if (isMod && e.key === "s") {
        e.preventDefault();
        quickSave();
      }
      if (e.key === "v" || e.key === "V") setTool("select");
      if (e.key === "p" || e.key === "P") setTool("pen");
      if (e.key === "h" || e.key === "H") setTool("hand");
      if ((e.key === "Backspace" || e.key === "Delete") && !isMod) {
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
        e.preventDefault();
        deleteSelectedPoint();
      }
      if (e.key === " ") {
        e.preventDefault();
        setTool("hand");
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.key === " ") setTool("select");
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", keyup);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", keyup);
    };
  }, [undo, redo, quickSave, deleteSelectedPoint]);

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

  const getCanvasCoords = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || !canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    return { x, y };
  }, [zoom]);

  const findNearestPoint = useCallback((x: number, y: number, threshold = 15): SelectedPoint | null => {
    if (!bezierData) return null;
    const scaledThreshold = threshold / zoom;
    
    for (let si = 0; si < bezierData.strokes.length; si++) {
      const stroke = bezierData.strokes[si];
      for (let ei = 0; ei < stroke.length; ei++) {
        const seg = stroke[ei];
        
        if (Math.hypot(seg.p0[0] - x, seg.p0[1] - y) < scaledThreshold) {
          return { strokeIndex: si, segmentIndex: ei, pointType: "p0" };
        }
        if (Math.hypot(seg.p3[0] - x, seg.p3[1] - y) < scaledThreshold) {
          return { strokeIndex: si, segmentIndex: ei, pointType: "p3" };
        }
        if (showHandles) {
          if (Math.hypot(seg.c1[0] - x, seg.c1[1] - y) < scaledThreshold) {
            return { strokeIndex: si, segmentIndex: ei, pointType: "c1" };
          }
          if (Math.hypot(seg.c2[0] - x, seg.c2[1] - y) < scaledThreshold) {
            return { strokeIndex: si, segmentIndex: ei, pointType: "c2" };
          }
        }
      }
    }
    return null;
  }, [bezierData, showHandles, zoom]);

  // Build a map of connected points across all strokes
  // Key: "si-ei-pt" -> list of linked point keys
  const connectionMap = useMemo(() => {
    if (!bezierData) return new Map<string, string[]>();

    // Collect all anchor points with their coordinates
    const allPoints: { key: string; x: number; y: number }[] = [];
    bezierData.strokes.forEach((stroke, si) => {
      stroke.forEach((seg, ei) => {
        allPoints.push({ key: `${si}-${ei}-p0`, x: seg.p0[0], y: seg.p0[1] });
        allPoints.push({ key: `${si}-${ei}-p3`, x: seg.p3[0], y: seg.p3[1] });
      });
    });

    // Find pairs within 2px of each other
    const links = new Map<string, Set<string>>();
    for (const pt of allPoints) {
      if (!links.has(pt.key)) links.set(pt.key, new Set());
    }

    for (let i = 0; i < allPoints.length; i++) {
      for (let j = i + 1; j < allPoints.length; j++) {
        const a = allPoints[i];
        const b = allPoints[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < 2) {
          links.get(a.key)!.add(b.key);
          links.get(b.key)!.add(a.key);
        }
      }
    }

    // Transitive closure via BFS
    const result = new Map<string, string[]>();
    const visited = new Set<string>();
    for (const pt of allPoints) {
      if (visited.has(pt.key)) continue;
      const group: string[] = [];
      const queue = [pt.key];
      while (queue.length > 0) {
        const curr = queue.pop()!;
        if (visited.has(curr)) continue;
        visited.add(curr);
        group.push(curr);
        for (const neighbor of links.get(curr) || []) {
          if (!visited.has(neighbor)) queue.push(neighbor);
        }
      }
      if (group.length > 1) {
        for (const k of group) {
          result.set(k, group.filter((g) => g !== k));
        }
      }
    }
    return result;
  }, [bezierData]);

  const handleRetrace = useCallback(async () => {
    setIsTracing(true);
    try {
      const result = await traceFromImage("/talkie-silhouette.png", traceError);
      console.log("Re-trace result:", result.length, "strokes,", result.reduce((s, r) => s + r.length, 0), "segments");
      if (result.length > 0 && result[0].length > 0) {
        setBezierData({ strokes: result });
        setSmoothStates({});
      } else {
        console.error("Re-trace produced empty result");
      }
    } catch (err) {
      console.error("Re-trace error:", err);
    } finally {
      setIsTracing(false);
    }
  }, [traceError]);

  const handlePointMouseDown = useCallback((e: React.MouseEvent) => {
    if (tool === "hand" || e.button === 1 || (tool !== "pen" && e.button === 0 && e.altKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault();
      return;
    }
    
    if (tool === "pen") {
      e.stopPropagation();
      const coords = getCanvasCoords(e);
      setBezierData((prev) => {
        if (!prev) return prev;
        const newData = JSON.parse(JSON.stringify(prev));
        const newPoint: [number, number] = [coords.x, coords.y];
        const lastStroke = newData.strokes[newData.strokes.length - 1];
        if (lastStroke && lastStroke.length > 0) {
          const lastSeg = lastStroke[lastStroke.length - 1];
          const prevEnd: [number, number] = lastSeg.p3;
          const midX = (prevEnd[0] + newPoint[0]) / 2;
          const midY = (prevEnd[1] + newPoint[1]) / 2;
          lastStroke.push({
            p0: prevEnd,
            c1: [prevEnd[0] + (midX - prevEnd[0]) * 0.5, prevEnd[1] + (midY - prevEnd[1]) * 0.5] as [number, number],
            c2: [newPoint[0] - (newPoint[0] - midX) * 0.5, newPoint[1] - (newPoint[1] - midY) * 0.5] as [number, number],
            p3: newPoint,
          });
        } else {
          newData.strokes.push([{
            p0: newPoint,
            c1: [newPoint[0] + 30, newPoint[1]] as [number, number],
            c2: [newPoint[0] + 60, newPoint[1]] as [number, number],
            p3: [newPoint[0] + 90, newPoint[1]] as [number, number],
          }]);
        }
        return newData;
      });
      return;
    }
    
    if (tool !== "select") return;
    e.stopPropagation();
    
    const coords = getCanvasCoords(e);
    const point = findNearestPoint(coords.x, coords.y);
    
    if (point) {
      if (e.altKey && (point.pointType === "p0" || point.pointType === "p3")) {
        const anchorKey = `${point.strokeIndex}-${point.segmentIndex}-${point.pointType}`;
        setSmoothStates((prev) => ({ ...prev, [anchorKey]: !prev[anchorKey] }));
        return;
      }
      
      setSelectedPoint(point);
      setIsDraggingPoint(true);
      setDragStart(coords);
    } else {
      setSelectedPoint(null);
    }
  }, [tool, getCanvasCoords, findNearestPoint, pan]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }
    
    if (isDraggingPoint && selectedPoint && dragStart) {
      const coords = getCanvasCoords(e);
      const dx = coords.x - dragStart.x;
      const dy = coords.y - dragStart.y;
      const isAltHeld = e.altKey;
      const isShiftHeld = e.shiftKey;
      
      setBezierData((prev) => {
        if (!prev) return prev;
        const newData = JSON.parse(JSON.stringify(prev));
        const { strokeIndex, segmentIndex, pointType } = selectedPoint;
        const seg = newData.strokes[strokeIndex][segmentIndex];
        const anchorKey = `${strokeIndex}-${segmentIndex}-${pointType === "c1" ? "p0" : pointType === "c2" ? "p3" : pointType}`;
        
        if (pointType === "c1" || pointType === "c2") {
          seg[pointType][0] += dx;
          seg[pointType][1] += dy;
          
          const isSmooth = smoothStates[anchorKey] && !isAltHeld;
          
          if (isSmooth) {
            const anchor = pointType === "c1" ? seg.p0 : seg.p3;
            const movedHandle = seg[pointType];
            const angle = Math.atan2(movedHandle[1] - anchor[1], movedHandle[0] - anchor[0]);
            const dist = Math.hypot(movedHandle[0] - anchor[0], movedHandle[1] - anchor[1]);
            const oppositeAngle = angle + Math.PI;
            
            if (pointType === "c1") {
              seg.c2[0] = anchor[0] + Math.cos(oppositeAngle) * dist;
              seg.c2[1] = anchor[1] + Math.sin(oppositeAngle) * dist;
            } else {
              seg.c1[0] = anchor[0] + Math.cos(oppositeAngle) * dist;
              seg.c1[1] = anchor[1] + Math.sin(oppositeAngle) * dist;
            }
          }
        } else if (pointType === "p0" || pointType === "p3") {
          // Helper: move a point + its associated handle by dx/dy
          const moveAnchor = (s: typeof seg, pt: "p0" | "p3", moveHandles: boolean) => {
            s[pt][0] += dx;
            s[pt][1] += dy;
            if (moveHandles) {
              const handle = pt === "p0" ? "c1" : "c2";
              s[handle][0] += dx;
              s[handle][1] += dy;
            }
          };

          // Default: move handles with anchor. Shift = leave handles behind.
          const moveHandles = !isShiftHeld;
          moveAnchor(seg, pointType, moveHandles);

          // Move all connected points via connectionMap
          const myKey = `${strokeIndex}-${segmentIndex}-${pointType}`;
          const linked = connectionMap.get(myKey) || [];
          for (const lk of linked) {
            const [lsi, lei, lpt] = lk.split("-");
            const linkedSeg = newData.strokes[Number(lsi)]?.[Number(lei)];
            if (linkedSeg) {
              moveAnchor(linkedSeg, lpt as "p0" | "p3", moveHandles);
            }
          }
        }
        
        return newData;
      });
      
      setDragStart(coords);
    }
  }, [isPanning, isDraggingPoint, selectedPoint, dragStart, getCanvasCoords, panStart, smoothStates, connectionMap]);

  const handleCanvasMouseUp = useCallback(() => {
    setIsPanning(false);
    setIsDraggingPoint(false);
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
    const lines: React.ReactElement[] = [];
    bezierData.strokes.forEach((stroke, si) => {
      stroke.forEach((seg, ei) => {
        const isC1Selected = selectedPoint?.strokeIndex === si && selectedPoint?.segmentIndex === ei && selectedPoint?.pointType === "c1";
        const isC2Selected = selectedPoint?.strokeIndex === si && selectedPoint?.segmentIndex === ei && selectedPoint?.pointType === "c2";
        lines.push(
          <line key={`h1-${si}-${ei}`} x1={seg.p0[0]} y1={seg.p0[1]} x2={seg.c1[0]} y2={seg.c1[1]} className={isC1Selected ? "stroke-yellow-400" : "stroke-blue-400"} strokeWidth={isC1Selected ? 2 : 1} opacity={isC1Selected ? 1 : 0.6} />,
          <line key={`h2-${si}-${ei}`} x1={seg.p3[0]} y1={seg.p3[1]} x2={seg.c2[0]} y2={seg.c2[1]} className={isC2Selected ? "stroke-yellow-400" : "stroke-blue-400"} strokeWidth={isC2Selected ? 2 : 1} opacity={isC2Selected ? 1 : 0.6} />
        );
      });
    });
    return lines;
  }, [bezierData, showHandles, selectedPoint]);

  const controlPoints = useMemo(() => {
    if (!bezierData || !showHandles) return [];
    const points: React.ReactElement[] = [];
    bezierData.strokes.forEach((stroke, si) => {
      stroke.forEach((seg, ei) => {
        const isC1Selected = selectedPoint?.strokeIndex === si && selectedPoint?.segmentIndex === ei && selectedPoint?.pointType === "c1";
        const isC2Selected = selectedPoint?.strokeIndex === si && selectedPoint?.segmentIndex === ei && selectedPoint?.pointType === "c2";
        points.push(
          <circle key={`c1-${si}-${ei}`} cx={seg.c1[0]} cy={seg.c1[1]} r={isC1Selected ? 7 : 4} className={isC1Selected ? "fill-yellow-400" : "fill-blue-400"} />,
          <circle key={`c2-${si}-${ei}`} cx={seg.c2[0]} cy={seg.c2[1]} r={isC2Selected ? 7 : 4} className={isC2Selected ? "fill-yellow-400" : "fill-blue-400"} />
        );
      });
    });
    return points;
  }, [bezierData, showHandles, selectedPoint]);

  const anchorPoints = useMemo(() => {
    if (!bezierData || !showAnchors) return [];
    const points: React.ReactElement[] = [];
    bezierData.strokes.forEach((stroke, si) => {
      stroke.forEach((seg, ei) => {
        const isP0Selected = selectedPoint?.strokeIndex === si && selectedPoint?.segmentIndex === ei && selectedPoint?.pointType === "p0";
        const isP3Selected = selectedPoint?.strokeIndex === si && selectedPoint?.segmentIndex === ei && selectedPoint?.pointType === "p3";
        const isP0Smooth = smoothStates[`${si}-${ei}-p0`];
        const isP3Smooth = smoothStates[`${si}-${ei}-p3`];
        
        if (isP0Smooth) {
          points.push(
            <circle key={`p0-ring-${si}-${ei}`} cx={seg.p0[0]} cy={seg.p0[1]} r="9" fill="none" stroke="#22c55e" strokeWidth="2" opacity="0.8" />
          );
        }
        if (isP3Smooth) {
          points.push(
            <circle key={`p3-ring-${si}-${ei}`} cx={seg.p3[0]} cy={seg.p3[1]} r="9" fill="none" stroke="#22c55e" strokeWidth="2" opacity="0.8" />
          );
        }
        
        points.push(
          <circle key={`p0-${si}-${ei}`} cx={seg.p0[0]} cy={seg.p0[1]} r={isP0Selected ? 8 : 5} className={isP0Selected ? "fill-yellow-400" : isP0Smooth ? "fill-green-500" : "fill-red-500"} />,
          <circle key={`p3-${si}-${ei}`} cx={seg.p3[0]} cy={seg.p3[1]} r={isP3Selected ? 8 : 5} className={isP3Selected ? "fill-yellow-400" : isP3Smooth ? "fill-green-500" : "fill-red-500"} />
        );
      });
    });
    return points;
  }, [bezierData, showAnchors, selectedPoint, smoothStates]);

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

  // Get selected point coordinates for inspector
  const selectedPointData = useMemo(() => {
    if (!selectedPoint || !bezierData) return null;
    const seg = bezierData.strokes[selectedPoint.strokeIndex]?.[selectedPoint.segmentIndex];
    if (!seg) return null;
    const pt = seg[selectedPoint.pointType];
    return { x: pt[0], y: pt[1], ...selectedPoint };
  }, [selectedPoint, bezierData]);

  // Update a point's coordinate from text input
  const updatePointCoord = useCallback((axis: "x" | "y", value: number) => {
    if (!selectedPoint) return;
    setBezierData((prev) => {
      if (!prev) return prev;
      const newData = JSON.parse(JSON.stringify(prev));
      const seg = newData.strokes[selectedPoint.strokeIndex][selectedPoint.segmentIndex];
      const idx = axis === "x" ? 0 : 1;
      seg[selectedPoint.pointType][idx] = value;
      return newData;
    });
  }, [selectedPoint]);

  // Select a point by clicking anchor in the panel
  const selectAnchorByName = useCallback((anchor: NamedAnchor) => {
    if (!bezierData) return;
    const threshold = 10;
    for (let si = 0; si < bezierData.strokes.length; si++) {
      const stroke = bezierData.strokes[si];
      for (let ei = 0; ei < stroke.length; ei++) {
        const seg = stroke[ei];
        if (Math.hypot(seg.p0[0] - anchor.x, seg.p0[1] - anchor.y) < threshold) {
          setSelectedPoint({ strokeIndex: si, segmentIndex: ei, pointType: "p0" });
          return;
        }
        if (Math.hypot(seg.p3[0] - anchor.x, seg.p3[1] - anchor.y) < threshold) {
          setSelectedPoint({ strokeIndex: si, segmentIndex: ei, pointType: "p3" });
          return;
        }
      }
    }
  }, [bezierData]);

  // Focus/zoom to center on a specific point
  const focusOnPoint = useCallback((x: number, y: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const targetZoom = Math.max(0.8, zoom);
    setZoom(targetZoom);
    setPan({
      x: rect.width / 2 - x * targetZoom,
      y: rect.height / 2 - y * targetZoom,
    });
  }, [zoom]);

  // Select anchor and focus on it
  const selectAndFocusAnchor = useCallback((anchor: NamedAnchor) => {
    selectAnchorByName(anchor);
    focusOnPoint(anchor.x, anchor.y);
  }, [selectAnchorByName, focusOnPoint]);

  // Focus on currently selected point
  const focusOnSelected = useCallback(() => {
    if (!selectedPointData) return;
    focusOnPoint(selectedPointData.x, selectedPointData.y);
  }, [selectedPointData, focusOnPoint]);

  return (
    <div className="flex h-screen flex-col bg-zinc-900 text-zinc-300">
      {/* Top Bar */}
      <div className="flex h-10 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-bold text-white">shaper</span>
          <div className="h-4 w-px bg-zinc-700" />
          <span className="font-mono text-xs text-zinc-500">public/talkie-bezier.json</span>
          <span className={`text-[10px] transition-colors ${
            saveStatus === "saved" ? "text-green-400" : saveStatus === "saving" ? "text-blue-400" : saveStatus === "error" ? "text-red-400" : "text-zinc-600"
          }`}>
            {saveStatus === "saved" ? "saved" : saveStatus === "saving" ? "saving..." : saveStatus === "error" ? "save error" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <button onClick={undo} title="Undo (Cmd+Z)" className="flex h-6 w-6 items-center justify-center rounded text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800">↩</button>
            <button onClick={redo} title="Redo (Cmd+Shift+Z)" className="flex h-6 w-6 items-center justify-center rounded text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800">↪</button>
          </div>
          <div className="h-4 w-px bg-zinc-700" />
          <button onClick={quickSave} title="Save (Cmd+S)" className="flex h-6 items-center rounded px-2 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800">Save</button>
          <button onClick={downloadJson} title="Export JSON" className="flex h-6 items-center rounded px-2 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800">Export</button>
          <button onClick={handleRetrace} disabled={isTracing} title="Re-trace from silhouette" className={`flex h-6 items-center rounded px-2 text-xs transition-colors ${isTracing ? "bg-purple-600/20 text-purple-400" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"}`}>
            {isTracing ? "Tracing..." : "Re-trace"}
          </button>
          <div className="h-4 w-px bg-zinc-700" />
          <button onClick={() => setShowConsole((v) => !v)} title="Toggle path console" className={`flex h-6 w-6 items-center justify-center rounded text-xs ${showConsole ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}>
            &gt;_
          </button>
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
          className={`flex-1 overflow-hidden relative ${tool === "pen" ? "cursor-crosshair" : ""} ${(tool === "hand" || isPanning) ? "cursor-grab" : ""} ${isPanning ? "!cursor-grabbing" : ""}`}
          style={{ 
            background: showGrid 
              ? "radial-gradient(circle, #27272a 1px, transparent 1px)" 
              : "#18181b",
            backgroundSize: showGrid ? "20px 20px" : "auto"
          }}
          onWheel={handleWheel}
          onMouseDown={handlePointMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
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
              overflow: "visible",
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
              <svg className="absolute pointer-events-none" style={{ left: -512, top: -512, width: 2048, height: 2048 }} viewBox="-512 -512 2048 2048" preserveAspectRatio="xMidYMid meet">
                <path d={strokesPath} fill="none" stroke={pathColor} strokeWidth="3" />
                {handleLines}
                {controlPoints}
                {anchorPoints}
                {anchorLabels}
              </svg>
            )}
          </div>

          {/* Floating Tool Palette - Top Right */}
          <div className="absolute top-3 right-3 flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950/90 p-1 backdrop-blur-sm">
            {[
              { id: "select" as Tool, icon: "↖", label: "Select (V)" },
              { id: "pen" as Tool, icon: "✒", label: "Pen (P)" },
              { id: "hand" as Tool, icon: "✋", label: "Hand (H)" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTool(t.id)}
                title={t.label}
                className={`flex h-7 w-7 items-center justify-center rounded text-sm ${
                  tool === t.id ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
                }`}
              >
                {t.icon}
              </button>
            ))}
          </div>

          {/* Minimap - Bottom Left */}
          <div className="absolute bottom-3 left-3 w-32 h-32 bg-zinc-950 border border-zinc-800 rounded overflow-hidden opacity-80 hover:opacity-100 transition-opacity">
            <div className="relative w-full h-full">
              <img src="/talkie-silhouette.png" alt="" className="w-full h-full object-contain opacity-30" />
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1024 1024" preserveAspectRatio="xMidYMid meet">
                <path d={strokesPath} fill="none" stroke={pathColor} strokeWidth="8" />
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
        <div className="w-56 border-l border-zinc-800 bg-zinc-950 flex flex-col">
          {/* Selected Point Inspector */}
          {selectedPointData && (
            <div className="border-b border-zinc-800 p-2">
              <div className="flex items-center justify-between mb-2 px-1">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Selected Point</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={focusOnSelected}
                    title="Focus on selected point"
                    className="text-[10px] text-blue-400 hover:text-blue-300"
                  >
                    Focus
                  </button>
                  <button
                    onClick={deleteSelectedPoint}
                    title="Delete point (Backspace)"
                    className="text-[10px] text-red-400 hover:text-red-300"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="space-y-1.5 px-1">
                <div className="flex items-center gap-1.5">
                  <span className={`inline-block h-2 w-2 rounded-full ${
                    selectedPointData.pointType === "p0" || selectedPointData.pointType === "p3" ? "bg-red-500" : "bg-blue-400"
                  }`} />
                  <span className="text-xs text-zinc-400 font-mono">
                    s{selectedPointData.strokeIndex}:e{selectedPointData.segmentIndex}.{selectedPointData.pointType}
                  </span>
                </div>
                <div className="flex gap-2">
                  <label className="flex-1">
                    <span className="text-[10px] text-zinc-600">X</span>
                    <input
                      type="number"
                      step="0.1"
                      value={Math.round(selectedPointData.x * 100) / 100}
                      onChange={(e) => updatePointCoord("x", Number(e.target.value))}
                      className="w-full rounded bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 text-xs font-mono text-zinc-300 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                  <label className="flex-1">
                    <span className="text-[10px] text-zinc-600">Y</span>
                    <input
                      type="number"
                      step="0.1"
                      value={Math.round(selectedPointData.y * 100) / 100}
                      onChange={(e) => updatePointCoord("y", Number(e.target.value))}
                      className="w-full rounded bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 text-xs font-mono text-zinc-300 focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Anchors List */}
          <div className="border-b border-zinc-800 p-2">
            <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Anchors</h3>
            <div className="max-h-48 space-y-0.5 overflow-y-auto">
              {anchorsData?.anchors.map((anchor, i) => {
                const isNearSelected = selectedPointData && Math.hypot(selectedPointData.x - anchor.x, selectedPointData.y - anchor.y) < 10;
                return (
                  <div key={i} className="flex items-center gap-1">
                    <button
                      onClick={() => selectAnchorByName(anchor)}
                      className={`flex flex-1 items-center justify-between rounded px-1 py-0.5 text-xs text-left transition-colors ${
                        isNearSelected ? "bg-blue-600/20 text-blue-300" : "hover:bg-zinc-900 text-zinc-400"
                      }`}
                    >
                      <span className="font-mono">{anchor.name}</span>
                      <span className={isNearSelected ? "text-blue-400/60" : "text-zinc-600"}>
                        {anchor.x.toFixed(0)}, {anchor.y.toFixed(0)}
                      </span>
                    </button>
                    <button
                      onClick={() => selectAndFocusAnchor(anchor)}
                      title="Focus"
                      className="flex h-5 w-5 items-center justify-center rounded text-[10px] text-zinc-600 hover:text-blue-400 hover:bg-zinc-800"
                    >
                      ◎
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Path Color */}
          <div className="border-b border-zinc-800 p-2">
            <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Path Color</h3>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 px-1">
                <input
                  type="color"
                  value={pathColor}
                  onChange={(e) => setPathColor(e.target.value)}
                  className="h-6 w-6 cursor-pointer rounded border border-zinc-700 bg-transparent p-0"
                />
                <span className="font-mono text-xs text-zinc-400">{pathColor}</span>
              </div>
              <div className="flex flex-wrap gap-1 px-1">
                {["#ff4d4d", "#4dabf7", "#69db7c", "#ffd43b", "#9775fa", "#ff922b", "#f06595", "#ffffff"].map((c) => (
                  <button
                    key={c}
                    onClick={() => setPathColor(c)}
                    className={`h-5 w-5 rounded-sm border ${pathColor === c ? "border-white" : "border-zinc-700"}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Trace Settings */}
          <div className="border-b border-zinc-800 p-2">
            <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Trace Settings</h3>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs text-zinc-500">Error tolerance</span>
                <span className="font-mono text-xs text-zinc-400">{traceError}</span>
              </div>
              <input
                type="range"
                min={1}
                max={20}
                step={0.5}
                value={traceError}
                onChange={(e) => setTraceError(Number(e.target.value))}
                className="w-full px-1"
              />
            </div>
          </div>

          {/* Info */}
          <div className="p-2">
            <h3 className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Info</h3>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between rounded px-1 py-0.5">
                <span className="text-zinc-500">Canvas</span>
                <span className="text-zinc-400">1024 × 1024</span>
              </div>
              <div className="flex justify-between rounded px-1 py-0.5">
                <span className="text-zinc-500">Segments</span>
                <span className="text-zinc-400">{bezierData?.strokes.reduce((sum, s) => sum + s.length, 0) || 0}</span>
              </div>
              <div className="flex justify-between rounded px-1 py-0.5">
                <span className="text-zinc-500">Strokes</span>
                <span className="text-zinc-400">{bezierData?.strokes.length || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Console / Path Inspector */}
      {showConsole && (
        <div className="h-48 border-t border-zinc-800 bg-zinc-950 flex flex-col">
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">SVG Path</span>
            <button
              onClick={() => { navigator.clipboard.writeText(strokesPath); }}
              className="text-[10px] text-zinc-500 hover:text-zinc-300"
            >
              Copy
            </button>
          </div>
          <pre className="flex-1 overflow-auto p-3 text-xs font-mono text-zinc-400 leading-relaxed select-all whitespace-pre-wrap break-all">
            {strokesPath || "No path data"}
          </pre>
        </div>
      )}
    </div>
  );
}
