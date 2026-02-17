"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { traceFromImage } from "@/lib/bezier-fit";
import {
  Frame, NavigationBar, SidePanel, StatusBar, CommandDock, ZoomControls,
  TerminalDrawer, CommandPalette,
  pop, slideIn, slideOut, click as clickSound, confirm as confirmSound,
} from "@/frame";
import type { CommandOption } from "@/frame";

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

interface ProjectImage {
  url: string;       // object URL or /public path
  name: string;      // filename
  width: number;
  height: number;
}

interface ImageWarning {
  message: string;
  type: "info" | "warn";
}

interface RecentImage {
  name: string;
  thumbnail: string;  // data URL (small)
  blobUrl: string;     // object URL (full size, only valid this session)
  width: number;
  height: number;
  timestamp: number;
}

const MAX_RECENT = 8;

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
  const [penStrokeIndex, setPenStrokeIndex] = useState<number | null>(null); // active pen stroke
  const [penLastPoint, setPenLastPoint] = useState<[number, number] | null>(null); // last placed point for preview
  const [penPreviewPos, setPenPreviewPos] = useState<[number, number] | null>(null); // cursor position for preview line
  
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
  const [devTab, setDevTab] = useState<"path" | "log" | "info">("path");
  const [devLogs, setDevLogs] = useState<string[]>([]);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [isCmdPaletteOpen, setIsCmdPaletteOpen] = useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [isTerminalMaximized, setIsTerminalMaximized] = useState(false);
  const [minimapCollapsed, setMinimapCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Accordion state for sidebar sections (all open by default)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    visibility: true, strokes: true, minimap: true,
    selected: true, anchors: true, appearance: true, trace: true, info: true,
  });
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const [mousePos, setMousePos] = useState<{ screen: { x: number; y: number }; canvas: { x: number; y: number } } | null>(null);
  const toggleSection = useCallback((id: string) => {
    setOpenSections(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Project / drop zone state
  const [projectImage, setProjectImage] = useState<ProjectImage | null>(null);
  const [showDropZone, setShowDropZone] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropTraceError, setDropTraceError] = useState(5);
  const [imageWarnings, setImageWarnings] = useState<ImageWarning[]>([]);
  const [recentImages, setRecentImages] = useState<RecentImage[]>([]);
  
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const isUndoRedoRef = useRef(false);
  
  const canvasRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Validate and process a dropped/selected image file
  const processImageFile = useCallback(async (file: File) => {
    const warnings: ImageWarning[] = [];

    // Validate file type
    const validTypes = ["image/png", "image/svg+xml", "image/jpeg", "image/webp"];
    if (!validTypes.includes(file.type)) {
      setImageWarnings([{ message: `Unsupported format: ${file.type}. Use PNG, SVG, JPEG, or WebP.`, type: "warn" }]);
      return;
    }

    try {
      // Create object URL and load to check dimensions
      const url = URL.createObjectURL(file);

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = url;
      });

      const { naturalWidth: w, naturalHeight: h } = img;

      // Check specs
      if (w !== h) {
        warnings.push({ message: `Image is ${w}x${h} — not square. It will be stretched to fit the canvas.`, type: "warn" });
      }
      if (w < 256 || h < 256) {
        warnings.push({ message: `Image is small (${w}x${h}). Results may be rough. 512x512 or larger recommended.`, type: "warn" });
      }
      if (w > 4096 || h > 4096) {
        warnings.push({ message: `Image is large (${w}x${h}). It will be downscaled for tracing.`, type: "info" });
      }

      if (file.type === "image/jpeg") {
        warnings.push({ message: "JPEG has no alpha channel — shapes will be detected by luminance (Otsu threshold).", type: "info" });
      }

      setImageWarnings(warnings);
      setProjectImage({ url, name: file.name, width: w, height: h });

      // Generate thumbnail and add to recents
      const thumbSize = 80;
      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = thumbSize;
      thumbCanvas.height = thumbSize;
      const thumbCtx = thumbCanvas.getContext("2d")!;
      thumbCtx.drawImage(img, 0, 0, thumbSize, thumbSize);
      const thumbnail = thumbCanvas.toDataURL("image/jpeg", 0.6);

      setRecentImages((prev) => {
        // Dedupe by name
        const filtered = prev.filter((r) => r.name !== file.name);
        return [
          { name: file.name, thumbnail, blobUrl: url, width: w, height: h, timestamp: Date.now() },
          ...filtered,
        ].slice(0, MAX_RECENT);
      });
    } catch (err) {
      console.error("Failed to process image:", err);
      setImageWarnings([{ message: `Failed to load image: ${err}`, type: "warn" }]);
    }
  }, []);

  // Select a recent image to re-use
  const selectRecentImage = useCallback((recent: RecentImage) => {
    setImageWarnings([]);
    setProjectImage({
      url: recent.blobUrl,
      name: recent.name,
      width: recent.width,
      height: recent.height,
    });
  }, []);

  // Start a new project from the dropped image: run trace and enter editor
  const startProjectFromImage = useCallback(async (image: ProjectImage, tolerance: number) => {
    setIsTracing(true);
    try {
      const result = await traceFromImage(image.url, tolerance);
      if (result.length > 0 && result[0].length > 0) {
        setBezierData({ strokes: result });
        setSmoothStates({});
        setAnchorsData({ anchors: [] });
        historyRef.current = [JSON.stringify({ strokes: result })];
        historyIndexRef.current = 0;
        // Reset view for new project
        setZoom(DEFAULT_ZOOM);
        setPan({ x: 0, y: 0 });
        setSelectedPoint(null);
        setShowDropZone(false);
      } else {
        setImageWarnings((prev) => [...prev, { message: "Trace produced no curves. Try adjusting error tolerance or use a higher-contrast image.", type: "warn" }]);
      }
    } catch (err) {
      console.error("Trace error:", err);
      setImageWarnings((prev) => [...prev, { message: `Trace failed: ${err}`, type: "warn" }]);
    } finally {
      setIsTracing(false);
    }
  }, []);

  // New project — clear everything and show drop zone
  const newProject = useCallback(() => {
    if (projectImage?.url.startsWith("blob:")) {
      URL.revokeObjectURL(projectImage.url);
    }
    setProjectImage(null);
    setBezierData(null);
    setAnchorsData(null);
    setSmoothStates({});
    setSelectedPoint(null);
    setImageWarnings([]);
    setShowDropZone(true);
    historyRef.current = [];
    historyIndexRef.current = -1;
  }, [projectImage]);

  // Drop zone handlers
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only count as leaving if we actually left the drop zone (not a child element)
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processImageFile(file);
  }, [processImageFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImageFile(file);
  }, [processImageFile]);

  // Load existing talkie project if no image has been dropped
  useEffect(() => {
    // Only auto-load the demo project if nothing else is active
    if (projectImage) return;
    Promise.all([
      fetch("/talkie-bezier.json").then((r) => r.json()),
      fetch("/talkie-anchors.json").then((r) => r.json()),
    ]).then(([bezier, anchors]) => {
      setBezierData(bezier);
      setAnchorsData(anchors);
      historyRef.current = [JSON.stringify(bezier)];
      historyIndexRef.current = 0;
    }).catch(() => {
      // No existing project — show drop zone
      setShowDropZone(true);
    }).finally(() => {
      setIsInitialLoad(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Finish the current pen stroke (deactivate it, clean up empty strokes)
  const finishPenStroke = useCallback(() => {
    setPenStrokeIndex(null);
    setPenLastPoint(null);
    setPenPreviewPos(null);
    // Remove any empty strokes left behind
    setBezierData((prev) => {
      if (!prev) return prev;
      const filtered = prev.strokes.filter((s) => s.length > 0);
      if (filtered.length === prev.strokes.length) return prev;
      return { strokes: filtered };
    });
  }, []);

  // Wrap setTool to finish pen stroke when switching away from pen
  const switchTool = useCallback((t: Tool) => {
    if (tool === "pen" && t !== "pen") {
      finishPenStroke();
    }
    setTool(t);
  }, [tool, finishPenStroke]);

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

  // Nudge the selected point with arrow keys
  // Modes:
  //   plain arrow   → move just this point (handle or anchor alone), 1px
  //   shift+arrow   → 10px coarse nudge
  //   alt+arrow     → anchor + both handles shift together (flat/parallel)
  //   alt+shift     → anchor moves, handles follow proportionally (preserve offsets)
  // For handles:
  //   alt+arrow     → mirror opposite handle symmetrically
  const nudgeSelectedPoint = useCallback((dx: number, dy: number, alt: boolean, shift: boolean) => {
    if (!selectedPoint || !bezierData) return;
    const step = (!alt && shift) ? 10 : 1;
    const ndx = dx * step;
    const ndy = dy * step;

    setBezierData((prev) => {
      if (!prev) return prev;
      const newData: BezierData = JSON.parse(JSON.stringify(prev));
      const { strokeIndex, segmentIndex, pointType } = selectedPoint;
      const seg = newData.strokes[strokeIndex]?.[segmentIndex];
      if (!seg) return prev;

      if (pointType === "c1" || pointType === "c2") {
        // --- Handle selected ---
        seg[pointType][0] += ndx;
        seg[pointType][1] += ndy;

        if (alt) {
          // Alt: mirror the opposite handle symmetrically around the anchor
          const anchor = pointType === "c1" ? seg.p0 : seg.p3;
          const moved = seg[pointType];
          const angle = Math.atan2(moved[1] - anchor[1], moved[0] - anchor[0]);
          const dist = Math.hypot(moved[0] - anchor[0], moved[1] - anchor[1]);
          const opposite = pointType === "c1" ? "c2" : "c1";
          seg[opposite][0] = anchor[0] + Math.cos(angle + Math.PI) * dist;
          seg[opposite][1] = anchor[1] + Math.sin(angle + Math.PI) * dist;
        }
      } else {
        // --- Anchor selected (p0 or p3) ---

        // Helper to apply the same logic to connected anchor points
        const applyToAnchor = (s: typeof seg, pt: "p0" | "p3") => {
          if (alt && shift) {
            // Alt+Shift: handles keep their offset from anchor (move in tandem proportionally)
            const c1Off: [number, number] = [s.c1[0] - s[pt][0], s.c1[1] - s[pt][1]];
            const c2Off: [number, number] = [s.c2[0] - s[pt][0], s.c2[1] - s[pt][1]];
            s[pt][0] += ndx;
            s[pt][1] += ndy;
            s.c1[0] = s[pt][0] + c1Off[0];
            s.c1[1] = s[pt][1] + c1Off[1];
            s.c2[0] = s[pt][0] + c2Off[0];
            s.c2[1] = s[pt][1] + c2Off[1];
          } else if (alt) {
            // Alt: flat shift — anchor + both handles all move by same delta
            s[pt][0] += ndx;
            s[pt][1] += ndy;
            s.c1[0] += ndx;
            s.c1[1] += ndy;
            s.c2[0] += ndx;
            s.c2[1] += ndy;
          } else {
            // Plain: move just the anchor
            s[pt][0] += ndx;
            s[pt][1] += ndy;
          }
        };

        applyToAnchor(seg, pointType);

        // Move connected points
        const myKey = `${strokeIndex}-${segmentIndex}-${pointType}`;
        const linked = connectionMap.get(myKey) || [];
        for (const lk of linked) {
          const [lsi, lei, lpt] = lk.split("-");
          const linkedSeg = newData.strokes[Number(lsi)]?.[Number(lei)];
          if (linkedSeg) {
            applyToAnchor(linkedSeg, lpt as "p0" | "p3");
          }
        }
      }

      return newData;
    });
  }, [selectedPoint, bezierData, connectionMap]);

  // Keyboard shortcuts (placed after nudgeSelectedPoint / connectionMap to avoid forward refs)
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
      if (isMod && e.key === "k") {
        e.preventDefault();
        pop();
        setIsCmdPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") {
        finishPenStroke();
        return;
      }
      if (isMod && e.key === "\\") {
        e.preventDefault();
        setShowGuides(prev => !prev);
      }
      if (e.key === "v" || e.key === "V") switchTool("select");
      if (e.key === "p" || e.key === "P") switchTool("pen");
      if (e.key === "h" || e.key === "H") switchTool("hand");
      if ((e.key === "Backspace" || e.key === "Delete") && !isMod) {
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
        e.preventDefault();
        deleteSelectedPoint();
      }
      if (e.key === " ") {
        e.preventDefault();
        switchTool("hand");
      }
      // Arrow key nudge for selected points
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && selectedPoint) {
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
        e.preventDefault();
        const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        const dy = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
        nudgeSelectedPoint(dx, dy, e.altKey, e.shiftKey);
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.key === " ") switchTool("select");
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", keyup);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", keyup);
    };
  }, [undo, redo, quickSave, deleteSelectedPoint, switchTool, finishPenStroke, nudgeSelectedPoint, selectedPoint, setIsCmdPaletteOpen]);

  // Determine which image to use for tracing: dropped image or default silhouette
  const traceImageSrc = projectImage?.url || "/talkie-silhouette.png";
  const displayImageSrc = projectImage?.url || "/talkie-original.png";

  const handleRetrace = useCallback(async () => {
    setIsTracing(true);
    try {
      const result = await traceFromImage(traceImageSrc, traceError);
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
  }, [traceError, traceImageSrc]);

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
      const clickPoint: [number, number] = [coords.x, coords.y];

      // Check if clicking near an existing endpoint (to start drawing from it)
      const nearPoint = findNearestPoint(coords.x, coords.y, 12);
      const isEndpoint = nearPoint && (nearPoint.pointType === "p0" || nearPoint.pointType === "p3");

      setBezierData((prev) => {
        // If no data yet, create a fresh structure
        const data = prev ? JSON.parse(JSON.stringify(prev)) : { strokes: [] };

        if (penStrokeIndex !== null && penLastPoint) {
          // We have an active stroke — add a segment from the last point to the click
          const stroke = data.strokes[penStrokeIndex];
          if (stroke) {
            const prevEnd = penLastPoint;
            const dx = clickPoint[0] - prevEnd[0];
            const dy = clickPoint[1] - prevEnd[1];
            stroke.push({
              p0: [...prevEnd] as [number, number],
              c1: [prevEnd[0] + dx / 3, prevEnd[1] + dy / 3] as [number, number],
              c2: [clickPoint[0] - dx / 3, clickPoint[1] - dy / 3] as [number, number],
              p3: [...clickPoint] as [number, number],
            });
            setPenLastPoint(clickPoint);
            return data;
          }
        }

        // No active stroke — check if we clicked an endpoint to continue from it
        if (isEndpoint && prev) {
          const { strokeIndex, segmentIndex, pointType } = nearPoint;
          const seg = prev.strokes[strokeIndex]?.[segmentIndex];
          if (seg) {
            const anchor: [number, number] = pointType === "p3"
              ? [seg.p3[0], seg.p3[1]]
              : [seg.p0[0], seg.p0[1]];
            setPenStrokeIndex(strokeIndex);
            setPenLastPoint(anchor);
            // Don't add a segment yet — just activate from this point
            return data;
          }
        }

        // Clicking empty space — start a brand new stroke
        const newStrokeIdx = data.strokes.length;
        data.strokes.push([]);
        setPenStrokeIndex(newStrokeIdx);
        setPenLastPoint(clickPoint);
        // The first click just sets the starting point; next click will create the segment
        return data;
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
  }, [tool, getCanvasCoords, findNearestPoint, pan, penStrokeIndex, penLastPoint]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    // Track mouse position for crosshair guides
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const coords = getCanvasCoords(e);
      setMousePos({ screen: { x: screenX, y: screenY }, canvas: { x: coords.x, y: coords.y } });
    }

    // Update pen preview position
    if (tool === "pen") {
      const coords = getCanvasCoords(e);
      setPenPreviewPos([coords.x, coords.y]);
    }

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
  }, [isPanning, isDraggingPoint, selectedPoint, dragStart, getCanvasCoords, panStart, smoothStates, connectionMap, tool, penLastPoint]);

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

  // Global drop handler — allows dropping images anywhere (even on the editor)
  const handleGlobalDragOver = useCallback((e: React.DragEvent) => {
    // Only respond to file drags
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handleGlobalDrop = useCallback((e: React.DragEvent) => {
    // Only handle if it has files and wasn't already handled by the drop zone
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      // Switch to drop zone mode and process the file
      setShowDropZone(true);
      setBezierData(null);
      processImageFile(file);
    }
  }, [processImageFile]);

  // Minimap click-to-navigate: click anywhere in minimap to center canvas on that point
  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // Map click position to 0..1024 canvas coordinates
    // The minimap shows the full 1024x1024 canvas via object-contain in the container
    const mapW = rect.width;
    const mapH = rect.height;
    // object-contain: fit 1024x1024 into mapW x mapH
    const scale = Math.min(mapW / 1024, mapH / 1024);
    const renderedW = 1024 * scale;
    const renderedH = 1024 * scale;
    const offsetX = (mapW - renderedW) / 2;
    const offsetY = (mapH - renderedH) / 2;
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const canvasX = (clickX - offsetX) / scale;
    const canvasY = (clickY - offsetY) / scale;
    // Clamp to canvas bounds
    const cx = Math.max(0, Math.min(1024, canvasX));
    const cy = Math.max(0, Math.min(1024, canvasY));
    // Center the viewport on this canvas coordinate
    const viewRect = containerRef.current.getBoundingClientRect();
    setPan({
      x: viewRect.width / 2 - cx * zoom,
      y: viewRect.height / 2 - cy * zoom,
    });
  }, [zoom]);

  // Commands for CommandPalette
  const commands = useMemo<CommandOption[]>(() => [
    { id: "select-tool", label: "Tool: Select", action: () => switchTool("select"), shortcut: "V" },
    { id: "pen-tool", label: "Tool: Pen", action: () => switchTool("pen"), shortcut: "P" },
    { id: "hand-tool", label: "Tool: Hand", action: () => switchTool("hand"), shortcut: "H" },
    { id: "undo", label: "Undo", action: undo, shortcut: "Cmd+Z" },
    { id: "redo", label: "Redo", action: redo, shortcut: "Cmd+Shift+Z" },
    { id: "save", label: "Save", action: () => { quickSave(); confirmSound(); }, shortcut: "Cmd+S" },
    { id: "export", label: "Export JSON", action: downloadJson },
    { id: "retrace", label: "Re-trace from silhouette", action: handleRetrace },
    { id: "new-project", label: "New Project", action: newProject },
    { id: "reset-zoom", label: "Reset Zoom", action: resetZoom, shortcut: "0" },
    { id: "zoom-in", label: "Zoom In", action: zoomIn, shortcut: "+" },
    { id: "zoom-out", label: "Zoom Out", action: zoomOut, shortcut: "-" },
    { id: "toggle-path", label: `${showPath ? "Hide" : "Show"} Bezier Path`, action: () => setShowPath(v => !v) },
    { id: "toggle-anchors", label: `${showAnchors ? "Hide" : "Show"} Anchors`, action: () => setShowAnchors(v => !v) },
    { id: "toggle-handles", label: `${showHandles ? "Hide" : "Show"} Handles`, action: () => setShowHandles(v => !v) },
    { id: "toggle-labels", label: `${showLabels ? "Hide" : "Show"} Labels`, action: () => setShowLabels(v => !v) },
    { id: "toggle-original", label: `${showOriginal ? "Hide" : "Show"} Original Image`, action: () => setShowOriginal(v => !v) },
    { id: "toggle-silhouette", label: `${showSilhouette ? "Hide" : "Show"} Silhouette`, action: () => setShowSilhouette(v => !v) },
    { id: "toggle-grid", label: `${showGrid ? "Hide" : "Show"} Grid`, action: () => setShowGrid(v => !v) },
    { id: "toggle-guides", label: `${showGuides ? "Hide" : "Show"} Crosshair Guides`, action: () => setShowGuides(v => !v), shortcut: "Cmd+\\" },
    { id: "toggle-terminal", label: `${isTerminalOpen ? "Close" : "Open"} Terminal`, action: () => { setIsTerminalOpen(v => !v); isTerminalOpen ? slideOut() : slideIn(); } },
    { id: "toggle-left-panel", label: `${leftCollapsed ? "Show" : "Hide"} Layers Panel`, action: () => setLeftCollapsed(v => !v) },
    { id: "toggle-right-panel", label: `${rightCollapsed ? "Show" : "Hide"} Inspector Panel`, action: () => setRightCollapsed(v => !v) },
    ...(selectedPoint ? [
      { id: "delete-point", label: "Delete Selected Point", action: deleteSelectedPoint, shortcut: "Backspace" },
      { id: "focus-point", label: "Focus on Selected Point", action: focusOnSelected },
    ] : []),
  ], [switchTool, undo, redo, quickSave, downloadJson, handleRetrace, newProject, resetZoom, zoomIn, zoomOut, showPath, showAnchors, showHandles, showLabels, showOriginal, showSilhouette, showGrid, showGuides, isTerminalOpen, leftCollapsed, rightCollapsed, selectedPoint, deleteSelectedPoint, focusOnSelected]);

  const showEditor = !isInitialLoad && !showDropZone && (bezierData || projectImage);
  const showDropScreen = !isInitialLoad && (showDropZone || (!bezierData && !projectImage));

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-300"
      onDragOver={handleGlobalDragOver}
      onDrop={handleGlobalDrop}
    >
      {/* Hidden file input for click-to-browse */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/svg+xml,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* ═══════════════════════════════════════════════
          LAYER 0: Full-viewport Canvas
          ═══════════════════════════════════════════════ */}
      {showEditor && (
        <div
          ref={containerRef}
          className={`absolute inset-0 ${tool === "pen" ? "cursor-crosshair" : ""} ${(tool === "hand" || isPanning) ? "cursor-grab" : ""} ${isPanning ? "!cursor-grabbing" : ""}`}
          style={{
            backgroundColor: "#0a0a0a",
            backgroundImage: `radial-gradient(circle, ${showGrid ? '#333' : '#1a1a1a'} 1px, transparent 1px)`,
            backgroundSize: "20px 20px",
          }}
          onWheel={handleWheel}
          onMouseDown={handlePointMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={() => { handleCanvasMouseUp(); setMousePos(null); }}
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
              <img src={displayImageSrc} alt="Original" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
            )}

            {/* Silhouette */}
            {showSilhouette && (
              <img src={projectImage ? displayImageSrc : "/talkie-silhouette.png"} alt="Silhouette" className="absolute inset-0 w-full h-full object-contain opacity-50 pointer-events-none" />
            )}

            {/* Bezier Path */}
            <svg className="absolute pointer-events-none" style={{ left: -512, top: -512, width: 2048, height: 2048 }} viewBox="-512 -512 2048 2048" preserveAspectRatio="xMidYMid meet">
              {showPath && strokesPath && (
                <path d={strokesPath} fill="none" stroke={pathColor} strokeWidth="3" />
              )}
              {showPath && handleLines}
              {showPath && controlPoints}
              {showPath && anchorPoints}
              {showPath && anchorLabels}

              {/* Pen tool: preview line from last placed point to cursor */}
              {tool === "pen" && penLastPoint && penPreviewPos && (
                <>
                  <line
                    x1={penLastPoint[0]} y1={penLastPoint[1]}
                    x2={penPreviewPos[0]} y2={penPreviewPos[1]}
                    stroke="#60a5fa" strokeWidth="1.5" strokeDasharray="6 4" opacity="0.7"
                  />
                  <circle cx={penLastPoint[0]} cy={penLastPoint[1]} r="6" fill="#3b82f6" opacity="0.8" />
                  <circle cx={penLastPoint[0]} cy={penLastPoint[1]} r="3" fill="white" opacity="0.9" />
                </>
              )}

              {/* Pen tool: show cursor dot */}
              {tool === "pen" && penPreviewPos && !penLastPoint && (
                <circle cx={penPreviewPos[0]} cy={penPreviewPos[1]} r="4" fill="#3b82f6" opacity="0.5" />
              )}
            </svg>
          </div>

          {/* Floating Tool Palette + Undo/Redo — positioned to clear NavigationBar */}
          <div className="absolute top-16 right-4 z-[35] flex items-center gap-1 rounded-lg border border-neutral-800 bg-black/90 p-1 backdrop-blur-xl shadow-lg pointer-events-auto">
            {[
              { id: "select" as Tool, icon: "\u2196", label: "Select (V)" },
              { id: "pen" as Tool, icon: "\u2712", label: "Pen (P)" },
              { id: "hand" as Tool, icon: "\u270B", label: "Hand (H)" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => { switchTool(t.id); clickSound(); }}
                title={t.label}
                className={`flex h-7 w-7 items-center justify-center rounded text-sm transition-colors ${
                  tool === t.id ? "bg-blue-600 text-white" : "text-neutral-400 hover:bg-white/10 hover:text-white"
                }`}
              >
                {t.icon}
              </button>
            ))}
            <div className="w-px h-5 bg-neutral-700 mx-0.5" />
            <button onClick={undo} title="Undo (Cmd+Z)" className="flex h-7 w-7 items-center justify-center rounded text-sm text-neutral-400 hover:bg-white/10 hover:text-white transition-colors">{"\u21A9"}</button>
            <button onClick={redo} title="Redo (Cmd+Shift+Z)" className="flex h-7 w-7 items-center justify-center rounded text-sm text-neutral-400 hover:bg-white/10 hover:text-white transition-colors">{"\u21AA"}</button>
          </div>

          {/* Crosshair guides + XY coordinates */}
          {showGuides && mousePos && (
            <>
              <div
                className="absolute top-0 bottom-0 w-px pointer-events-none bg-emerald-500/10"
                style={{ left: mousePos.screen.x }}
              />
              <div
                className="absolute left-0 right-0 h-px pointer-events-none bg-emerald-500/10"
                style={{ top: mousePos.screen.y }}
              />
              <div
                className="absolute text-[9px] font-mono text-emerald-500/50 pl-2 pt-1 whitespace-nowrap pointer-events-none"
                style={{ left: mousePos.screen.x, top: mousePos.screen.y }}
              >
                {mousePos.canvas.x.toFixed(0)}<span className="mx-0.5 opacity-30">,</span>{mousePos.canvas.y.toFixed(0)}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════
          DROP ZONE — full screen when no project
          ═══════════════════════════════════════════════ */}
      {showDropScreen && (
        <div
          ref={dropZoneRef}
          className="absolute inset-0 flex items-center justify-center z-[5]"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnter={handleDragOver}
        >
          {!projectImage ? (
            <div className="flex flex-col items-center gap-6 max-w-lg">
              <div
                className={`flex flex-col items-center justify-center w-96 h-64 rounded-2xl border-2 border-dashed transition-all cursor-pointer ${
                  isDragOver
                    ? "border-blue-400 bg-blue-500/10 scale-[1.02]"
                    : "border-neutral-700 bg-neutral-900/50 hover:border-neutral-500 hover:bg-neutral-900"
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className={`text-4xl mb-3 transition-transform ${isDragOver ? "scale-110" : ""}`}>
                  {isDragOver ? "+" : ""}
                </div>
                <p className="text-sm text-neutral-300 mb-1">
                  {isDragOver ? "Drop image here" : "Drop a logo image here"}
                </p>
                <p className="text-xs text-neutral-500">or click to browse</p>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {["PNG", "SVG", "JPEG", "WebP"].map((fmt) => (
                    <span key={fmt} className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">{fmt}</span>
                  ))}
                </div>
              </div>
              <div className="text-center space-y-1">
                <p className="text-[11px] text-neutral-500">Square images work best. 512x512 or larger recommended.</p>
                <p className="text-[11px] text-neutral-600">Image type is detected automatically.</p>
              </div>

              {recentImages.length > 0 && (
                <div className="w-full max-w-md">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600 mb-2">Recent</p>
                  <div className="flex gap-2 flex-wrap justify-center">
                    {recentImages.map((recent) => (
                      <button
                        key={recent.name + recent.timestamp}
                        onClick={() => selectRecentImage(recent)}
                        className="group relative w-14 h-14 rounded-lg border border-neutral-800 bg-neutral-950 overflow-hidden hover:border-neutral-600 transition-colors"
                        title={recent.name}
                      >
                        <img src={recent.thumbnail} alt={recent.name} className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-6 max-w-2xl">
              <div className="flex gap-8 items-start">
                <div className="flex flex-col items-center gap-2">
                  <div className="relative w-64 h-64 rounded-lg border border-neutral-700 bg-neutral-950 overflow-hidden">
                    <img src={projectImage.url} alt={projectImage.name} className="w-full h-full object-contain" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-neutral-400 font-mono">{projectImage.name}</p>
                    <p className="text-[10px] text-neutral-600">{projectImage.width} x {projectImage.height}</p>
                  </div>
                </div>

                <div className="flex flex-col gap-4 min-w-[200px]">
                  <div>
                    <h3 className="text-xs font-semibold text-neutral-300 mb-3">Extract shapes</h3>
                    <p className="text-[11px] text-neutral-500 mb-4">
                      Trace the image contour and fit bezier curves to create editable vector paths.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-neutral-500">Error tolerance</span>
                      <span className="font-mono text-xs text-neutral-400">{dropTraceError}</span>
                    </div>
                    <input type="range" min={1} max={20} step={0.5} value={dropTraceError} onChange={(e) => setDropTraceError(Number(e.target.value))} className="w-full" />
                    <p className="text-[10px] text-neutral-600">Lower = more detail, more points. Higher = smoother, fewer points.</p>
                  </div>
                  {imageWarnings.length > 0 && (
                    <div className="space-y-1">
                      {imageWarnings.map((w, i) => (
                        <p key={i} className={`text-[11px] ${w.type === "warn" ? "text-amber-400" : "text-neutral-500"}`}>{w.message}</p>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => startProjectFromImage(projectImage, dropTraceError)}
                      disabled={isTracing}
                      className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                        isTracing ? "bg-purple-600/20 text-purple-400 cursor-wait" : "bg-blue-600 text-white hover:bg-blue-500"
                      }`}
                    >
                      {isTracing ? "Extracting..." : "Extract Shapes"}
                    </button>
                    <button
                      onClick={() => {
                        if (projectImage.url.startsWith("blob:")) URL.revokeObjectURL(projectImage.url);
                        setProjectImage(null);
                        setImageWarnings([]);
                      }}
                      className="rounded-lg px-3 py-2 text-sm text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
                    >
                      Back
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════
          CHROME: Fixed-position overlays (Frame shell)
          ═══════════════════════════════════════════════ */}

      {/* NavigationBar */}
      <NavigationBar
        title="SHAPER"
        subtitle={
          <>
            <span>{projectImage ? projectImage.name : "talkie-bezier.json"}</span>
            <span className={`ml-2 text-[10px] transition-colors ${
              saveStatus === "saved" ? "text-green-400" : saveStatus === "saving" ? "text-blue-400" : saveStatus === "error" ? "text-red-400" : "text-neutral-600"
            }`}>
              {saveStatus === "saved" ? "saved" : saveStatus === "saving" ? "saving..." : saveStatus === "error" ? "save error" : ""}
            </span>
          </>
        }
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: "Search anchors...",
        }}
      />

      {/* Left SidePanel — Layers */}
      {showEditor && (
        <SidePanel
          side="left"
          title="Layers"
          isCollapsed={leftCollapsed}
          onToggleCollapse={() => setLeftCollapsed((v) => !v)}
          headerActions={
            <div className="relative">
              <button
                onClick={() => setShowActionsMenu(v => !v)}
                className="p-1 hover:bg-white/10 rounded transition-colors text-neutral-500 hover:text-white"
                title="Actions"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
              </button>
              {showActionsMenu && (
                <>
                  <div className="fixed inset-0 z-50" onClick={() => setShowActionsMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 w-44 bg-black/95 backdrop-blur-xl border border-neutral-800 rounded-lg shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-100">
                    <div className="py-1">
                      <button onClick={() => { newProject(); setShowActionsMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-neutral-400 hover:bg-white/5 hover:text-white transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                        New Project
                      </button>
                      <button onClick={() => { quickSave(); confirmSound(); setShowActionsMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-neutral-400 hover:bg-white/5 hover:text-white transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg>
                        Save
                        <span className="ml-auto text-[9px] text-neutral-600 font-mono">Cmd+S</span>
                      </button>
                      <div className="h-px bg-neutral-800 my-1" />
                      <button onClick={() => { handleRetrace(); setShowActionsMenu(false); }} disabled={isTracing} className={`w-full flex items-center gap-2.5 px-3 py-2 text-[11px] transition-colors ${isTracing ? 'text-purple-400' : 'text-neutral-400 hover:bg-white/5 hover:text-white'}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                        {isTracing ? "Tracing..." : "Re-trace"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          }
          footer={
            <div className="border-t border-neutral-800/50">
              <div className="relative bg-neutral-950/50 cursor-crosshair" style={{ height: 120 }} onClick={handleMinimapClick}>
                <div className="absolute inset-0 opacity-15 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#444 1px, transparent 1px)', backgroundSize: '8px 8px' }} />
                <img src={projectImage ? displayImageSrc : "/talkie-silhouette.png"} alt="" className="absolute inset-0 w-full h-full object-contain opacity-30 pointer-events-none" />
                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1024 1024" preserveAspectRatio="xMidYMid meet">
                  <path d={strokesPath} fill="none" stroke={pathColor} strokeWidth="8" />

                </svg>
                {/* Viewport rect as overlay div — using correct math */}
                {containerRef.current && (() => {
                  const vw = containerRef.current!.clientWidth;
                  const vh = containerRef.current!.clientHeight;
                  // The visible canvas area in canvas coords (0-1024)
                  const visX = -pan.x / zoom + 512 - vw / 2 / zoom;
                  const visY = -pan.y / zoom + 512 - vh / 2 / zoom;
                  const visW = vw / zoom;
                  const visH = vh / zoom;
                  // Convert to percentage of 1024
                  const pctX = (visX / 1024) * 100;
                  const pctY = (visY / 1024) * 100;
                  const pctW = (visW / 1024) * 100;
                  const pctH = (visH / 1024) * 100;
                  return (
                    <div
                      className="absolute border border-white/30 bg-white/5 pointer-events-none"
                      style={{
                        left: `${Math.max(0, pctX)}%`,
                        top: `${Math.max(0, pctY)}%`,
                        width: `${Math.min(100, pctW)}%`,
                        height: `${Math.min(100, pctH)}%`,
                        maxWidth: '100%',
                        maxHeight: '100%',
                      }}
                    />
                  );
                })()}
              </div>
              <div className="flex items-center justify-between px-3 py-1.5 text-[10px] text-neutral-600 font-mono bg-neutral-900/30">
                <span>{bezierData ? `${bezierData.strokes.reduce((s, st) => s + st.length, 0)} segments` : "0 segments"}</span>
                <button onClick={resetZoom} className="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-white/10 hover:text-white transition-colors" title="Fit to view">
                  <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>
                  <span className="text-[9px]">FIT</span>
                </button>
              </div>
            </div>
          }
        >
          {/* Visibility */}
          <div className="border-b border-neutral-800/50">
            <button onClick={() => toggleSection("visibility")} className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 bg-neutral-900/30 hover:bg-neutral-900/50 transition-colors border-b border-transparent">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-600 shrink-0"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
              <span className="flex-1 text-left">Visibility</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-600 transition-transform ${openSections.visibility ? 'rotate-0' : '-rotate-90'}`}><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {openSections.visibility && (
              <div className="px-3 pb-3 space-y-0.5">
                {[
                  { id: "showPath", label: "Bezier Path", checked: showPath, setter: setShowPath, icon: <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/></svg> },
                  { id: "showAnchors", label: "Anchors", checked: showAnchors, setter: setShowAnchors, icon: <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="3"/><line x1="12" x2="12" y1="22" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/></svg> },
                  { id: "showHandles", label: "Handles", checked: showHandles, setter: setShowHandles, icon: <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg> },
                  { id: "showLabels", label: "Labels", checked: showLabels, setter: setShowLabels, icon: <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg> },
                  { id: "showOriginal", label: "Original", checked: showOriginal, setter: setShowOriginal, icon: <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg> },
                  { id: "showSilhouette", label: "Silhouette", checked: showSilhouette, setter: setShowSilhouette, icon: <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/></svg> },
                  { id: "showGrid", label: "Grid", checked: showGrid, setter: setShowGrid, icon: <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg> },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => item.setter(!item.checked)}
                    className="w-full flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-white/5 transition-colors ml-2"
                  >
                    <span className={item.checked ? "text-neutral-500" : "text-neutral-700"}>{item.icon}</span>
                    <span className={`flex-1 text-left ${item.checked ? "text-neutral-400" : "text-neutral-600"}`}>{item.label}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-colors ${item.checked ? "text-neutral-400" : "text-neutral-700"}`}>
                      {item.checked ? (
                        <><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></>
                      ) : (
                        <><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></>
                      )}
                    </svg>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Strokes */}
          <div className="border-b border-neutral-800/50">
            <button onClick={() => toggleSection("strokes")} className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 bg-neutral-900/30 hover:bg-neutral-900/50 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-600 shrink-0"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/></svg>
              <span className="flex-1 text-left">Strokes</span>
              <span className="text-[9px] text-neutral-600 font-normal">{strokeGroups.length}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-600 transition-transform ${openSections.strokes ? 'rotate-0' : '-rotate-90'}`}><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {openSections.strokes && (
              <div className="px-3 pb-3 space-y-0.5">
                {strokeGroups.map(([name, anchors]) => (
                  <div key={name} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-white/5 transition-colors ml-2">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: strokeColors[name] || "#888" }} />
                    <span className="text-neutral-400 flex-1">{name}</span>
                    <span className="text-neutral-600 text-[10px]">{anchors.length}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          
        </SidePanel>
      )}

      {/* Right SidePanel — Inspector */}
      {showEditor && (
        <SidePanel
          side="right"
          title="Inspector"
          isCollapsed={rightCollapsed}
          onToggleCollapse={() => setRightCollapsed((v) => !v)}
        >
          {/* Selected Point */}
          {selectedPointData && (
            <div className="border-b border-neutral-800/50">
              <button onClick={() => toggleSection("selected")} className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 bg-neutral-900/30 hover:bg-neutral-900/50 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 shrink-0"><circle cx="12" cy="12" r="3"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="m16.24 7.76 2.83-2.83"/></svg>
                <span className="flex-1 text-left">Selected Point</span>
                <div className="flex items-center gap-1">
                  <button onClick={(e) => { e.stopPropagation(); focusOnSelected(); }} title="Focus" className="text-[9px] text-blue-400 hover:text-blue-300 px-1">Focus</button>
                  <button onClick={(e) => { e.stopPropagation(); deleteSelectedPoint(); }} title="Delete" className="text-[9px] text-red-400 hover:text-red-300 px-1">Del</button>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-600 transition-transform ${openSections.selected ? 'rotate-0' : '-rotate-90'}`}><path d="m6 9 6 6 6-6"/></svg>
              </button>
              {openSections.selected && (
                <div className="px-3 pb-3 space-y-1.5 ml-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-block h-2 w-2 rounded-full ${
                      selectedPointData.pointType === "p0" || selectedPointData.pointType === "p3" ? "bg-red-500" : "bg-blue-400"
                    }`} />
                    <span className="text-xs text-neutral-400 font-mono">
                      s{selectedPointData.strokeIndex}:e{selectedPointData.segmentIndex}.{selectedPointData.pointType}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <label className="flex-1">
                      <span className="text-[10px] text-neutral-600">X</span>
                      <input type="number" step="0.1" value={Math.round(selectedPointData.x * 100) / 100} onChange={(e) => updatePointCoord("x", Number(e.target.value))} className="w-full rounded bg-neutral-900 border border-neutral-700 px-1.5 py-0.5 text-xs font-mono text-neutral-300 focus:border-blue-500 focus:outline-none" />
                    </label>
                    <label className="flex-1">
                      <span className="text-[10px] text-neutral-600">Y</span>
                      <input type="number" step="0.1" value={Math.round(selectedPointData.y * 100) / 100} onChange={(e) => updatePointCoord("y", Number(e.target.value))} className="w-full rounded bg-neutral-900 border border-neutral-700 px-1.5 py-0.5 text-xs font-mono text-neutral-300 focus:border-blue-500 focus:outline-none" />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Anchors */}
          <div className="border-b border-neutral-800/50">
            <button onClick={() => toggleSection("anchors")} className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 bg-neutral-900/30 hover:bg-neutral-900/50 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-600 shrink-0"><circle cx="12" cy="5" r="3"/><line x1="12" x2="12" y1="22" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/></svg>
              <span className="flex-1 text-left">Anchors</span>
              <span className="text-[9px] text-neutral-600 font-normal">{anchorsData?.anchors.length ?? 0}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-600 transition-transform ${openSections.anchors ? 'rotate-0' : '-rotate-90'}`}><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {openSections.anchors && (
              <div className="px-3 pb-3 max-h-48 overflow-y-auto space-y-0.5 frame-scrollbar">
                {anchorsData?.anchors.map((anchor, i) => {
                  const isNearSelected = selectedPointData && Math.hypot(selectedPointData.x - anchor.x, selectedPointData.y - anchor.y) < 10;
                  return (
                    <div key={i} className="flex items-center gap-1 ml-2">
                      <button
                        onClick={() => selectAnchorByName(anchor)}
                        className={`flex flex-1 items-center justify-between rounded px-1.5 py-1 text-xs text-left transition-colors ${
                          isNearSelected ? "bg-blue-600/20 text-blue-300" : "hover:bg-white/5 text-neutral-400"
                        }`}
                      >
                        <span className="font-mono">{anchor.name}</span>
                        <span className={isNearSelected ? "text-blue-400/60" : "text-neutral-600"}>
                          {anchor.x.toFixed(0)}, {anchor.y.toFixed(0)}
                        </span>
                      </button>
                      <button onClick={() => selectAndFocusAnchor(anchor)} title="Focus" className="flex h-5 w-5 items-center justify-center rounded text-[10px] text-neutral-600 hover:text-blue-400 hover:bg-white/5">{"\u25CE"}</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Appearance */}
          <div className="border-b border-neutral-800/50">
            <button onClick={() => toggleSection("appearance")} className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 bg-neutral-900/30 hover:bg-neutral-900/50 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-600 shrink-0"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
              <span className="flex-1 text-left">Appearance</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-600 transition-transform ${openSections.appearance ? 'rotate-0' : '-rotate-90'}`}><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {openSections.appearance && (
              <div className="px-3 pb-3 space-y-2 ml-2">
                <div className="flex items-center gap-2">
                  <input type="color" value={pathColor} onChange={(e) => setPathColor(e.target.value)} className="h-6 w-6 cursor-pointer rounded border border-neutral-700 bg-transparent p-0" />
                  <span className="font-mono text-xs text-neutral-400">{pathColor}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {["#ff4d4d", "#4dabf7", "#69db7c", "#ffd43b", "#9775fa", "#ff922b", "#f06595", "#ffffff"].map((c) => (
                    <button key={c} onClick={() => setPathColor(c)} className={`h-5 w-5 rounded-sm border transition-colors ${pathColor === c ? "border-white" : "border-neutral-700 hover:border-neutral-500"}`} style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Trace Settings */}
          <div className="border-b border-neutral-800/50">
            <button onClick={() => toggleSection("trace")} className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 bg-neutral-900/30 hover:bg-neutral-900/50 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-600 shrink-0"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
              <span className="flex-1 text-left">Trace Settings</span>
              <span className="text-[9px] text-neutral-600 font-normal tabular-nums">{traceError}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-600 transition-transform ${openSections.trace ? 'rotate-0' : '-rotate-90'}`}><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {openSections.trace && (
              <div className="px-3 pb-3 space-y-1.5 ml-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-neutral-500">Error tolerance</span>
                  <span className="font-mono text-xs text-neutral-400 tabular-nums">{traceError}</span>
                </div>
                <input type="range" min={1} max={20} step={0.5} value={traceError} onChange={(e) => setTraceError(Number(e.target.value))} className="w-full" />
              </div>
            )}
          </div>

          {/* Info */}
          <div>
            <button onClick={() => toggleSection("info")} className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 bg-neutral-900/30 hover:bg-neutral-900/50 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-600 shrink-0"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
              <span className="flex-1 text-left">Info</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-600 transition-transform ${openSections.info ? 'rotate-0' : '-rotate-90'}`}><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {openSections.info && (
              <div className="px-3 pb-3 space-y-1 text-xs ml-2">
                <div className="flex justify-between rounded px-1.5 py-0.5"><span className="text-neutral-500">Canvas</span><span className="text-neutral-400 tabular-nums">1024 x 1024</span></div>
                <div className="flex justify-between rounded px-1.5 py-0.5"><span className="text-neutral-500">Segments</span><span className="text-neutral-400 tabular-nums">{bezierData?.strokes.reduce((sum, s) => sum + s.length, 0) || 0}</span></div>
                <div className="flex justify-between rounded px-1.5 py-0.5"><span className="text-neutral-500">Strokes</span><span className="text-neutral-400 tabular-nums">{bezierData?.strokes.length || 0}</span></div>
              </div>
            )}
          </div>
        </SidePanel>
      )}

      {/* Collapsed panel toggle buttons */}
      {showEditor && leftCollapsed && (
        <button
          onClick={() => setLeftCollapsed(false)}
          className="fixed top-[56px] left-2 z-40 p-2 bg-black/90 backdrop-blur-xl border border-neutral-800 rounded-lg hover:bg-white/10 transition-colors pointer-events-auto"
          title="Expand layers panel"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>
        </button>
      )}
      {showEditor && rightCollapsed && (
        <button
          onClick={() => setRightCollapsed(false)}
          className="fixed top-[56px] right-2 z-40 p-2 bg-black/90 backdrop-blur-xl border border-neutral-800 rounded-lg hover:bg-white/10 transition-colors pointer-events-auto"
          title="Expand inspector panel"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/></svg>
        </button>
      )}

      {/* ZoomControls — vertical +/%/- on right side */}
      {showEditor && (
        <ZoomControls
          scale={zoom}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onReset={resetZoom}
          className={`fixed bottom-16 z-30 pointer-events-auto flex flex-col items-center gap-0.5 bg-neutral-900/70 backdrop-blur-md border border-neutral-700/50 rounded-md shadow-lg shadow-black/30 ${
            rightCollapsed ? 'right-4' : 'right-[296px]'
          }`}
        />
      )}

      {/* CommandDock — bottom-right */}
      {showEditor && (
        <CommandDock
          onOpenCommandPalette={() => { setIsCmdPaletteOpen(true); pop(); }}
          extraControls={
            <button
              onClick={downloadJson}
              className="flex items-center gap-1.5 text-neutral-500 hover:text-white transition-colors"
              title="Export JSON"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
              <span className="text-[9px]">Export</span>
            </button>
          }
        />
      )}

      {/* TerminalDrawer */}
      <TerminalDrawer
        isOpen={isTerminalOpen}
        onClose={() => { setIsTerminalOpen(false); slideOut(); }}
        onToggleMaximize={() => setIsTerminalMaximized(v => !v)}
        isMaximized={isTerminalMaximized}
        title={
          <div className="flex items-center gap-0.5">
            {(["path", "log", "info"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setDevTab(tab)}
                className={`px-2 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors ${
                  devTab === tab
                    ? "text-neutral-200 border-b border-blue-500"
                    : "text-neutral-600 hover:text-neutral-400"
                }`}
              >
                {tab === "path" ? "SVG Path" : tab === "log" ? "Log" : "Info"}
              </button>
            ))}
          </div>
        }
      >
        <div className="flex-1 overflow-auto">
          {/* Tab action bar */}
          <div className="flex justify-end px-3 py-1 border-b border-neutral-800/50">
            {devTab === "path" && (
              <button onClick={() => navigator.clipboard.writeText(strokesPath)} className="text-[10px] text-neutral-600 hover:text-neutral-300">Copy</button>
            )}
            {devTab === "log" && devLogs.length > 0 && (
              <button onClick={() => setDevLogs([])} className="text-[10px] text-neutral-600 hover:text-neutral-300">Clear</button>
            )}
          </div>
          {devTab === "path" && (
            <pre className="p-3 text-xs font-mono text-neutral-400 leading-relaxed select-all whitespace-pre-wrap break-all">
              {strokesPath || "No path data"}
            </pre>
          )}
          {devTab === "log" && (
            <pre className="p-3 text-xs font-mono text-neutral-500 leading-relaxed whitespace-pre-wrap">
              {devLogs.length > 0 ? devLogs.join("\n") : "No log output yet"}
            </pre>
          )}
          {devTab === "info" && (
            <div className="p-3 text-xs font-mono text-neutral-500 space-y-1">
              <div>Strokes: {bezierData?.strokes.length ?? 0}</div>
              <div>Segments: {bezierData?.strokes.reduce((s, st) => s + st.length, 0) ?? 0}</div>
              <div>Canvas: 1024 x 1024</div>
              <div>Zoom: {Math.round(zoom * 100)}%</div>
              <div>Pan: {Math.round(pan.x)}, {Math.round(pan.y)}</div>
              {projectImage && <div>Image: {projectImage.name} ({projectImage.width}x{projectImage.height})</div>}
              {selectedPointData && (
                <div>Selected: s{selectedPointData.strokeIndex}:e{selectedPointData.segmentIndex}.{selectedPointData.pointType} ({selectedPointData.x.toFixed(1)}, {selectedPointData.y.toFixed(1)})</div>
              )}
            </div>
          )}
        </div>
      </TerminalDrawer>

      {/* StatusBar */}
      <StatusBar
        status={
          saveStatus === "error" ? { label: "ERROR", color: "red" }
          : saveStatus === "saving" ? { label: "SAVING", color: "amber" }
          : isTracing ? { label: "TRACING", color: "amber" }
          : { label: "READY", color: "emerald" }
        }
        left={
          <>
            <span>{bezierData ? `${bezierData.strokes.length} strokes, ${bezierData.strokes.reduce((s, st) => s + st.length, 0)} segments` : "No data"}</span>
            {selectedPointData && (
              <span className="text-neutral-600">
                s{selectedPointData.strokeIndex}:e{selectedPointData.segmentIndex}.{selectedPointData.pointType}
                {" "}({selectedPointData.x.toFixed(1)}, {selectedPointData.y.toFixed(1)})
              </span>
            )}
          </>
        }
        viewport={{
          pan,
          zoom,
          canvasSize: { w: 1024, h: 1024 },
        }}
        isMinimapCollapsed={minimapCollapsed}
        onExpandMinimap={() => setMinimapCollapsed(false)}
        onToggleTerminal={() => { setIsTerminalOpen(v => !v); isTerminalOpen ? slideOut() : slideIn(); }}
        isTerminalOpen={isTerminalOpen}
      />

      {/* CommandPalette */}
      <CommandPalette
        isOpen={isCmdPaletteOpen}
        onClose={() => setIsCmdPaletteOpen(false)}
        commands={commands}
      />
    </div>
  );
}
