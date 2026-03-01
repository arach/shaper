"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { traceFromImage, fitCurve, bezierQ } from "@/lib/bezier-fit";
import { rdp } from "@/lib/contour";
import { DEFAULT_TRACE_OPTIONS, type TraceOptions, type TraceInfo } from "@/hudson/types";
import { MousePointer2, Pen, Hand, Eraser, Undo2, Redo2, Square, Play } from 'lucide-react';
import {
  Frame, NavigationBar, SidePanel, StatusBar, CommandDock, ZoomControls,
  TerminalDrawer, CommandPalette,
  pop, slideIn, slideOut, click as clickSound, confirm as confirmSound,
} from "@/frame";
import type { CommandOption } from "@/frame";
import AnimationTimeline from "@/frame/components/chrome/AnimationTimeline";

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

type Tool = "select" | "pen" | "hand" | "eraser";

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
const MAX_ZOOM = 50;
const MAX_HISTORY = 100;

export default function ShapeShaper() {
  const [tool, setTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [eraserRect, setEraserRect] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
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
  // Fill system
  const [fillEnabled, setFillEnabled] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [traceOptions, setTraceOptions] = useState<TraceOptions>(DEFAULT_TRACE_OPTIONS);
  const [traceInfo, setTraceInfo] = useState<TraceInfo | null>(null);
  const [isTracing, setIsTracing] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [devTab, setDevTab] = useState<"path" | "log" | "info">("log");
  const [devLogs, setDevLogs] = useState<string[]>([]);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [isCmdPaletteOpen, setIsCmdPaletteOpen] = useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [isTerminalMaximized, setIsTerminalMaximized] = useState(false);
  const [minimapCollapsed, setMinimapCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [anchorListHeight, setAnchorListHeight] = useState(192); // Default 192px (max-h-48 = 12rem = 192px)
  const [isResizingAnchors, setIsResizingAnchors] = useState(false);
  // Sidebar width resizing
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(280);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(280);
  const [isResizingLeftSidebar, setIsResizingLeftSidebar] = useState(false);
  const [isResizingRightSidebar, setIsResizingRightSidebar] = useState(false);
  // Animation state
  const [animationModeEnabled, setAnimationModeEnabled] = useState(false); // Controls timeline visibility
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationProgress, setAnimationProgress] = useState(0); // 0-1
  const [animationSpeed, setAnimationSpeed] = useState(2); // Default 2x speed, 0.25x to 4x
  const [showAnimationHandles, setShowAnimationHandles] = useState(false);
  const [animationEasing, setAnimationEasing] = useState(true); // Ease in/out at points
  const [showAnimationAngles, setShowAnimationAngles] = useState(false); // Show angle measurements
  // Handle & angle customization
  const [handleOpacity, setHandleOpacity] = useState(0.35); // 0-1
  const [angleArcRadius, setAngleArcRadius] = useState(20); // px
  const [showAngleReference, setShowAngleReference] = useState(true); // Show reference lines
  // Accordion state for sidebar sections (all open by default)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    visibility: true, strokes: true, minimap: true,
    selected: true, anchors: true, segments: false, fill: true, animation: true, appearance: true, trace: true, info: true,
  });
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const [mousePos, setMousePos] = useState<{ screen: { x: number; y: number }; canvas: { x: number; y: number } } | null>(null);

  // Context menu state (Feature 3)
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number;
    strokeIndex: number;
    segmentIndex: number;
    pointType: PointType;
  } | null>(null);

  // Save As state (Feature 4)
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [showSaveAsModal, setShowSaveAsModal] = useState(false);

  // Per-stroke fill state (Feature 5)
  const [strokeFills, setStrokeFills] = useState<Record<number, { enabled: boolean; color: string; opacity: number }>>({});

  // Segment inspector state (Feature 6)
  const [selectedSegment, setSelectedSegment] = useState<{ strokeIndex: number; segmentIndex: number } | null>(null);
  const [expandedStrokes, setExpandedStrokes] = useState<Record<number, boolean>>({});

  // Simplify tool state (Feature 7)
  const [simplifyMode, setSimplifyMode] = useState(false);
  const [simplifyStrokeIndex, setSimplifyStrokeIndex] = useState<number | null>(null);
  const [simplifyTolerance, setSimplifyTolerance] = useState(5);
  const [simplifyPreview, setSimplifyPreview] = useState<BezierSegment[] | null>(null);

  // Rectangle selection + area simplify
  const [selectionRect, setSelectionRect] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  const [selectedSegments, setSelectedSegments] = useState<Set<string>>(new Set());
  const [areaSimplifyTolerance, setAreaSimplifyTolerance] = useState(5);
  const [areaSimplifyPreview, setAreaSimplifyPreview] = useState<Map<string, BezierSegment[]> | null>(null);
  const [showAreaSimplify, setShowAreaSimplify] = useState(false);
  const [selectionBounds, setSelectionBounds] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [selectionContextMenu, setSelectionContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Log to both browser console AND in-app terminal Log tab
  const log = useCallback((msg: string) => {
    console.log(msg);
    setDevLogs(prev => [...prev, msg]);
  }, []);

  const toggleSection = useCallback((id: string) => {
    setOpenSections(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Project / drop zone state
  const [projectImage, setProjectImage] = useState<ProjectImage | null>(null);
  const [showDropZone, setShowDropZone] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
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
  const startProjectFromImage = useCallback(async (image: ProjectImage) => {
    setIsTracing(true);
    try {
      const traceResult = await traceFromImage(image.url, traceOptions);
      if (traceResult.strokes.length > 0 && traceResult.strokes[0].length > 0) {
        setBezierData({ strokes: traceResult.strokes });
        setSmoothStates({});
        setAnchorsData({ anchors: [] });
        historyRef.current = [JSON.stringify({ strokes: traceResult.strokes })];
        historyIndexRef.current = 0;
        // Persist image as data URL so it survives refresh
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = image.url;
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = Math.min(img.naturalWidth, 1024);
          c.height = Math.min(img.naturalHeight, 1024);
          c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
          persistSession(image, c.toDataURL('image/png'));
        };
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
  }, [traceOptions]);

  // Persist active project session to localStorage
  const persistSession = useCallback((image: ProjectImage, dataUrl: string) => {
    try {
      localStorage.setItem('shaper-session', JSON.stringify({
        image: { name: image.name, width: image.width, height: image.height },
        dataUrl,
      }));
    } catch { /* quota exceeded — ignore */ }
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem('shaper-session');
  }, []);

  // New project — clear everything and show drop zone
  const newProject = useCallback(() => {
    if (projectImage?.url.startsWith("blob:")) {
      URL.revokeObjectURL(projectImage.url);
    }
    clearSession();
    setProjectImage(null);
    setBezierData(null);
    setAnchorsData(null);
    setSmoothStates({});
    setSelectedPoint(null);
    setImageWarnings([]);
    setShowDropZone(true);
    setProjectId(null);
    setProjectName(null);
    setStrokeFills({});
    setSelectedSegment(null);
    setSimplifyMode(false);
    setSimplifyPreview(null);
    historyRef.current = [];
    historyIndexRef.current = -1;
  }, [projectImage, clearSession]);

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

  // Persist active project session to localStorage
  // Load: restore session or fall back to talkie demo
  useEffect(() => {
    if (projectImage) return;
    // Check for a persisted session first
    try {
      const raw = localStorage.getItem('shaper-session');
      if (raw) {
        const session = JSON.parse(raw);
        if (session.dataUrl && session.image) {
          setProjectImage({ url: session.dataUrl, ...session.image });
          // Bezier data was auto-saved to talkie-bezier.json — load it
          fetch("/talkie-bezier.json").then((r) => r.json()).then((bezier) => {
            setBezierData(bezier);
            historyRef.current = [JSON.stringify(bezier)];
            historyIndexRef.current = 0;
          }).catch(() => {
            setShowDropZone(true);
          }).finally(() => setIsInitialLoad(false));
          return;
        }
      }
    } catch { /* corrupted — fall through */ }

    // Default: load talkie demo
    Promise.all([
      fetch("/talkie-bezier.json").then((r) => r.json()),
      fetch("/talkie-anchors.json").then((r) => r.json()),
    ]).then(([bezier, anchors]) => {
      setBezierData(bezier);
      setAnchorsData(anchors);
      historyRef.current = [JSON.stringify(bezier)];
      historyIndexRef.current = 0;
    }).catch(() => {
      setShowDropZone(true);
    }).finally(() => {
      setIsInitialLoad(false);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Startup log
  useEffect(() => { log("[shaper] ready"); }, [log]);

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

  const saveToDisk = useCallback(async (data: BezierData, smooth: Record<string, boolean>, pid?: string | null) => {
    setSaveStatus("saving");
    const strokeCount = data.strokes.length;
    const segmentCount = data.strokes.reduce((sum, s) => sum + s.length, 0);
    try {
      const body: Record<string, unknown> = { bezier: data, smooth };
      if (pid) body.projectId = pid;
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaveStatus("saved");
      setDevLogs(prev => [...prev, `[save] ${strokeCount} strokes, ${segmentCount} segments${pid ? ` → project:${pid}` : ''} → ok`]);
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (err) {
      setSaveStatus("error");
      setDevLogs(prev => [...prev, `[save] failed: ${err instanceof Error ? err.message : String(err)}`]);
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, []);

  const quickSave = useCallback(() => {
    if (!bezierData) return;
    saveToDisk(bezierData, smoothStates, projectId);
  }, [bezierData, smoothStates, saveToDisk, projectId]);

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
      saveToDisk(bezierData, smoothStates, projectId);
    }, 2000);
    return () => {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    };
  }, [bezierData, smoothStates, saveToDisk, projectId]);

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

  // Eraser: compute which segments intersect a rectangle (for preview highlight)
  const eraserHits = useMemo(() => {
    if (!eraserRect || !bezierData) return new Set<string>();
    const hits = new Set<string>();
    const minX = Math.min(eraserRect.start.x, eraserRect.end.x);
    const maxX = Math.max(eraserRect.start.x, eraserRect.end.x);
    const minY = Math.min(eraserRect.start.y, eraserRect.end.y);
    const maxY = Math.max(eraserRect.start.y, eraserRect.end.y);
    for (let si = 0; si < bezierData.strokes.length; si++) {
      const stroke = bezierData.strokes[si];
      for (let ei = 0; ei < stroke.length; ei++) {
        const seg = stroke[ei];
        for (let t = 0; t <= 1; t += 0.05) {
          const u = 1 - t;
          const px = u*u*u*seg.p0[0] + 3*u*u*t*seg.c1[0] + 3*u*t*t*seg.c2[0] + t*t*t*seg.p3[0];
          const py = u*u*u*seg.p0[1] + 3*u*u*t*seg.c1[1] + 3*u*t*t*seg.c2[1] + t*t*t*seg.p3[1];
          if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
            hits.add(`${si}-${ei}`);
            break;
          }
        }
      }
    }
    return hits;
  }, [eraserRect, bezierData]);

  // Selection: compute which segments intersect the selection rectangle (preview highlight)
  const selectionHits = useMemo(() => {
    if (!selectionRect || !bezierData) return new Set<string>();
    const hits = new Set<string>();
    const minX = Math.min(selectionRect.start.x, selectionRect.end.x);
    const maxX = Math.max(selectionRect.start.x, selectionRect.end.x);
    const minY = Math.min(selectionRect.start.y, selectionRect.end.y);
    const maxY = Math.max(selectionRect.start.y, selectionRect.end.y);
    for (let si = 0; si < bezierData.strokes.length; si++) {
      const stroke = bezierData.strokes[si];
      for (let ei = 0; ei < stroke.length; ei++) {
        const seg = stroke[ei];
        for (let t = 0; t <= 1; t += 0.05) {
          const u = 1 - t;
          const px = u*u*u*seg.p0[0] + 3*u*u*t*seg.c1[0] + 3*u*t*t*seg.c2[0] + t*t*t*seg.p3[0];
          const py = u*u*u*seg.p0[1] + 3*u*u*t*seg.c1[1] + 3*u*t*t*seg.c2[1] + t*t*t*seg.p3[1];
          if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
            hits.add(`${si}-${ei}`);
            break;
          }
        }
      }
    }
    return hits;
  }, [selectionRect, bezierData]);

  // Eraser: delete all segments that intersect the given rectangle
  const eraseInRect = useCallback(() => {
    if (!bezierData || eraserHits.size === 0) return;
    setBezierData((prev) => {
      if (!prev) return prev;
      const newData: BezierData = { strokes: [] };
      for (let si = 0; si < prev.strokes.length; si++) {
        const filtered = prev.strokes[si].filter((_, ei) => !eraserHits.has(`${si}-${ei}`));
        if (filtered.length > 0) newData.strokes.push(filtered);
      }
      // Clean up smoothStates for deleted segments
      const newSmooth: Record<string, boolean> = {};
      for (const [key, val] of Object.entries(smoothStates)) {
        const [sStr, eStr] = key.split("-");
        if (!eraserHits.has(`${sStr}-${eStr}`)) {
          newSmooth[key] = val;
        }
      }
      setSmoothStates(newSmooth);
      return newData;
    });
    setSelectedPoint(null);
  }, [bezierData, eraserHits, smoothStates]);

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
    // Clear area selection when switching tools
    setSelectedSegments(new Set());
    setSelectionBounds(null);
    setShowAreaSimplify(false);
    setAreaSimplifyPreview(null);
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

  // Anchor list resize handlers
  const handleAnchorResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingAnchors(true);
  }, []);

  const handleAnchorResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizingAnchors) return;
    // Calculate new height based on mouse movement
    setAnchorListHeight(prev => Math.max(100, Math.min(600, prev + e.movementY)));
  }, [isResizingAnchors]);

  const handleAnchorResizeEnd = useCallback(() => {
    setIsResizingAnchors(false);
  }, []);

  // Left sidebar resize handlers
  const handleLeftSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingLeftSidebar(true);
  }, []);

  const handleLeftSidebarResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizingLeftSidebar) return;
    setLeftSidebarWidth(prev => Math.max(240, Math.min(480, prev + e.movementX)));
  }, [isResizingLeftSidebar]);

  const handleLeftSidebarResizeEnd = useCallback(() => {
    setIsResizingLeftSidebar(false);
  }, []);

  // Right sidebar resize handlers
  const handleRightSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingRightSidebar(true);
  }, []);

  const handleRightSidebarResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizingRightSidebar) return;
    setRightSidebarWidth(prev => Math.max(240, Math.min(480, prev - e.movementX)));
  }, [isResizingRightSidebar]);

  const handleRightSidebarResizeEnd = useCallback(() => {
    setIsResizingRightSidebar(false);
  }, []);

  // Add global listeners for anchor resize
  useEffect(() => {
    if (isResizingAnchors) {
      window.addEventListener('mousemove', handleAnchorResizeMove);
      window.addEventListener('mouseup', handleAnchorResizeEnd);
      return () => {
        window.removeEventListener('mousemove', handleAnchorResizeMove);
        window.removeEventListener('mouseup', handleAnchorResizeEnd);
      };
    }
  }, [isResizingAnchors, handleAnchorResizeMove, handleAnchorResizeEnd]);

  // Add global listeners for left sidebar resize
  useEffect(() => {
    if (isResizingLeftSidebar) {
      window.addEventListener('mousemove', handleLeftSidebarResizeMove);
      window.addEventListener('mouseup', handleLeftSidebarResizeEnd);
      return () => {
        window.removeEventListener('mousemove', handleLeftSidebarResizeMove);
        window.removeEventListener('mouseup', handleLeftSidebarResizeEnd);
      };
    }
  }, [isResizingLeftSidebar, handleLeftSidebarResizeMove, handleLeftSidebarResizeEnd]);

  // Add global listeners for right sidebar resize
  useEffect(() => {
    if (isResizingRightSidebar) {
      window.addEventListener('mousemove', handleRightSidebarResizeMove);
      window.addEventListener('mouseup', handleRightSidebarResizeEnd);
      return () => {
        window.removeEventListener('mousemove', handleRightSidebarResizeMove);
        window.removeEventListener('mouseup', handleRightSidebarResizeEnd);
      };
    }
  }, [isResizingRightSidebar, handleRightSidebarResizeMove, handleRightSidebarResizeEnd]);

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
      if (isMod && e.key === "s" && !e.shiftKey) {
        e.preventDefault();
        quickSave();
      }
      if (isMod && e.key === "s" && e.shiftKey) {
        e.preventDefault();
        setShowSaveAsModal(true);
      }
      if (isMod && e.key === "k") {
        e.preventDefault();
        pop();
        setIsCmdPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") {
        if (selectionContextMenu) { setSelectionContextMenu(null); return; }
        if (contextMenu) { setContextMenu(null); return; }
        if (showSaveAsModal) { setShowSaveAsModal(false); return; }
        if (selectionBounds || selectedSegments.size > 0) {
          setSelectedSegments(new Set());
          setSelectionBounds(null);
          setShowAreaSimplify(false);
          setAreaSimplifyPreview(null);
          return;
        }
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
      if (e.key === "e" || e.key === "E") switchTool("eraser");
      if (e.key === "t" || e.key === "T") {
        setAnimationModeEnabled(prev => !prev);
        clickSound();
      }
      // Animation timeline shortcuts (when mode is enabled)
      if (animationModeEnabled) {
        if (e.key === " ") {
          // Override space bar behavior to play/pause animation instead of hand tool
          e.preventDefault();
          setIsAnimating(prev => !prev);
          return; // Exit early to prevent hand tool activation
        }
        if (e.key === "r" || e.key === "R") {
          e.preventDefault();
          setIsAnimating(false);
          setAnimationProgress(0);
          clickSound();
          return;
        }
      }
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
      // Don't switch back to select tool when space is released if animation mode is enabled
      if (e.key === " " && !animationModeEnabled) switchTool("select");
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", keyup);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", keyup);
    };
  }, [undo, redo, quickSave, deleteSelectedPoint, switchTool, finishPenStroke, nudgeSelectedPoint, selectedPoint, setIsCmdPaletteOpen, setAnimationModeEnabled, clickSound, animationModeEnabled, setIsAnimating, setAnimationProgress, contextMenu, selectionContextMenu, showSaveAsModal]);

  // Animation loop - smooth 60fps
  useEffect(() => {
    if (!isAnimating) return;

    let lastTime = performance.now();
    let animId: number;

    const animate = (currentTime: number) => {
      const deltaTime = (currentTime - lastTime) / 1000; // Convert to seconds
      lastTime = currentTime;

      setAnimationProgress(prev => {
        // Base duration: 2.5 seconds at 1x speed
        const increment = deltaTime * animationSpeed * 0.4;
        const newProgress = prev + increment;

        if (newProgress >= 1) {
          setIsAnimating(false);
          return 1;
        }
        return newProgress;
      });

      animId = requestAnimationFrame(animate);
    };

    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [isAnimating, animationSpeed]);

  // Determine which image to use for tracing: dropped image or default silhouette
  const traceImageSrc = projectImage?.url || "/talkie-silhouette.png";
  const displayImageSrc = projectImage?.url || "/talkie-original.png";

  const handleRetrace = useCallback(async () => {
    setIsTracing(true);
    try {
      const traceResult = await traceFromImage(traceImageSrc, traceOptions);
      console.log("Re-trace result:", traceResult.strokes.length, "strokes,", traceResult.strokes.reduce((s, r) => s + r.length, 0), "segments");
      if (traceResult.strokes.length > 0 && traceResult.strokes[0].length > 0) {
        setBezierData({ strokes: traceResult.strokes });
        setSmoothStates({});
        setTraceInfo(traceResult.info);
      } else {
        console.error("Re-trace produced empty result");
      }
    } catch (err) {
      console.error("Re-trace error:", err);
    } finally {
      setIsTracing(false);
    }
  }, [traceOptions, traceImageSrc]);

  // Re-trace just the selected area: crop source image to selection bounds,
  // run trace pipeline, delete selected segments, insert fresh strokes.
  const handleRetraceArea = useCallback(async () => {
    log(`[trace-area] called: bounds=${!!selectionBounds}, src=${traceImageSrc?.substring(0, 40)}`);
    if (!selectionBounds) return;
    const src = traceImageSrc;
    setIsTracing(true);
    setSelectionContextMenu(null);
    try {
      // 1. Load image
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load source image"));
        img.src = src;
      });

      // 2. Map selection from canvas space (0-1024) to image pixel space
      const scaleX = img.naturalWidth / 1024;
      const scaleY = img.naturalHeight / 1024;
      const cropX = Math.round(selectionBounds.x * scaleX);
      const cropY = Math.round(selectionBounds.y * scaleY);
      const cropW = Math.round(selectionBounds.w * scaleX);
      const cropH = Math.round(selectionBounds.h * scaleY);

      log(`[trace-area] bounds: canvas(${selectionBounds.x.toFixed(1)}, ${selectionBounds.y.toFixed(1)}, ${selectionBounds.w.toFixed(1)}×${selectionBounds.h.toFixed(1)}) → px(${cropX}, ${cropY}, ${cropW}×${cropH})`);

      if (cropW < 2 || cropH < 2) {
        log("[trace-area] crop region too small, aborting");
        return;
      }

      // 3. Crop to temp canvas
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = cropW;
      cropCanvas.height = cropH;
      const ctx = cropCanvas.getContext("2d")!;
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      // Debug: check if the crop has any content
      const cropPixels = ctx.getImageData(0, 0, cropW, cropH);
      let opaqueCount = 0;
      let nonWhiteCount = 0;
      for (let i = 0; i < cropPixels.data.length; i += 4) {
        if (cropPixels.data[i + 3] > 10) opaqueCount++;
        if (cropPixels.data[i] < 240 || cropPixels.data[i + 1] < 240 || cropPixels.data[i + 2] < 240) nonWhiteCount++;
      }
      const totalPx = cropW * cropH;
      log(`[trace-area] crop: ${opaqueCount}/${totalPx} opaque (${(100 * opaqueCount / totalPx).toFixed(1)}%), ${nonWhiteCount}/${totalPx} non-white (${(100 * nonWhiteCount / totalPx).toFixed(1)}%)`);

      const cropUrl = cropCanvas.toDataURL("image/png");

      // 4. Trace the cropped region
      const traceResult = await traceFromImage(cropUrl, traceOptions);
      log(`[trace-area] trace: ${traceResult.strokes.length} strokes, ${traceResult.strokes.reduce((s, r) => s + r.length, 0)} segments`);

      if (traceResult.strokes.length === 0) {
        log("[trace-area] trace produced no strokes");
        return;
      }

      // 5. Remap traced coordinates from trace space (0-1024) → selection bounds in canvas space
      const remapX = selectionBounds.w / 1024;
      const remapY = selectionBounds.h / 1024;
      const offsetX = selectionBounds.x;
      const offsetY = selectionBounds.y;

      const remappedStrokes: BezierSegment[][] = traceResult.strokes.map(stroke =>
        stroke.map(seg => ({
          p0: [seg.p0[0] * remapX + offsetX, seg.p0[1] * remapY + offsetY] as [number, number],
          c1: [seg.c1[0] * remapX + offsetX, seg.c1[1] * remapY + offsetY] as [number, number],
          c2: [seg.c2[0] * remapX + offsetX, seg.c2[1] * remapY + offsetY] as [number, number],
          p3: [seg.p3[0] * remapX + offsetX, seg.p3[1] * remapY + offsetY] as [number, number],
        }))
      );

      log(`[trace-area] remap: scale(${remapX.toFixed(3)}, ${remapY.toFixed(3)}) offset(${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`);

      // 6. Optionally delete selected segments, then append remapped strokes
      setBezierData(prev => {
        const newData: BezierData = prev
          ? JSON.parse(JSON.stringify(prev))
          : { strokes: [] };

        // Only delete segments if there's a selection
        if (selectedSegments.size > 0) {
          const byStroke = new Map<number, Set<number>>();
          for (const key of selectedSegments) {
            const [si, ei] = key.split("-").map(Number);
            if (!byStroke.has(si)) byStroke.set(si, new Set());
            byStroke.get(si)!.add(ei);
          }

          newData.strokes = newData.strokes
            .map((stroke, si) => {
              const toRemove = byStroke.get(si);
              if (!toRemove) return stroke;
            return stroke.filter((_, ei) => !toRemove.has(ei));
          })
            .filter(stroke => stroke.length > 0);
        }

        // Append remapped trace strokes
        newData.strokes.push(...remappedStrokes);
        return newData;
      });

      setTraceInfo(traceResult.info);
      setSelectedSegments(new Set());
      setSelectionBounds(null);
      setShowAreaSimplify(false);
      setAreaSimplifyPreview(null);
    } catch (err) {
      log(`[trace-area] error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsTracing(false);
    }
  }, [selectionBounds, selectedSegments, traceImageSrc, traceOptions, log]);

  const handlePointMouseDown = useCallback((e: React.MouseEvent) => {
    if (tool === "hand" || e.button === 1 || (tool !== "pen" && e.button === 0 && e.altKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault();
      return;
    }
    
    if (tool === "eraser") {
      e.stopPropagation();
      const coords = getCanvasCoords(e);
      setEraserRect({ start: coords, end: coords });
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
      // Clear area selection when clicking a point
      setSelectedSegments(new Set());
      setSelectionBounds(null);
      setShowAreaSimplify(false);
      setAreaSimplifyPreview(null);
    } else {
      setSelectedPoint(null);
      // Start selection rectangle on empty space
      setSelectionRect({ start: coords, end: coords });
      setSelectedSegments(new Set());
      setSelectionBounds(null);
      setShowAreaSimplify(false);
      setAreaSimplifyPreview(null);
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

    // Update eraser rectangle
    if (tool === "eraser" && eraserRect) {
      const coords = getCanvasCoords(e);
      setEraserRect(prev => prev ? { ...prev, end: coords } : null);
    }

    // Update selection rectangle
    if (tool === "select" && selectionRect) {
      const coords = getCanvasCoords(e);
      setSelectionRect(prev => prev ? { ...prev, end: coords } : null);
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
  }, [isPanning, isDraggingPoint, selectedPoint, dragStart, getCanvasCoords, panStart, smoothStates, connectionMap, tool, penLastPoint, eraserRect, selectionRect]);

  const handleCanvasMouseUp = useCallback((commitErase = true) => {
    if (eraserRect) {
      if (commitErase) eraseInRect();
      setEraserRect(null);
    }
    if (selectionRect) {
      const dx = Math.abs(selectionRect.end.x - selectionRect.start.x);
      const dy = Math.abs(selectionRect.end.y - selectionRect.start.y);
      if (dx < 5 && dy < 5) {
        // Tiny drag = click → clear selection
        setSelectedSegments(new Set());
        setSelectionBounds(null);
      } else {
        // Commit selection hits
        const hits = new Set(selectionHits);
        const bx = Math.min(selectionRect.start.x, selectionRect.end.x);
        const by = Math.min(selectionRect.start.y, selectionRect.end.y);
        const bw = Math.abs(selectionRect.end.x - selectionRect.start.x);
        const bh = Math.abs(selectionRect.end.y - selectionRect.start.y);
        console.log(`[selection] committed: ${hits.size} hits, bounds ${Math.round(bw)}×${Math.round(bh)} at (${Math.round(bx)}, ${Math.round(by)})`);
        setSelectedSegments(hits);
        setSelectionBounds({ x: bx, y: by, w: bw, h: bh });
      }
      setSelectionRect(null);
    }
    setIsPanning(false);
    setIsDraggingPoint(false);
  }, [eraserRect, eraseInRect, selectionRect, selectionHits]);

  // Scale factor to keep SVG overlays constant on screen at any zoom level
  const visualScale = 1 / zoom;

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

  // Calculate approximate total path length for stroke-dasharray animation
  const pathLengthEstimate = useMemo(() => {
    if (!bezierData) return 0;

    let totalLength = 0;

    // Approximate bezier curve length using control polygon method
    for (const stroke of bezierData.strokes) {
      for (const seg of stroke) {
        // Distance from p0 -> c1 -> c2 -> p3 (upper bound approximation)
        const len1 = Math.hypot(seg.c1[0] - seg.p0[0], seg.c1[1] - seg.p0[1]);
        const len2 = Math.hypot(seg.c2[0] - seg.c1[0], seg.c2[1] - seg.c1[1]);
        const len3 = Math.hypot(seg.p3[0] - seg.c2[0], seg.p3[1] - seg.c2[1]);
        const controlPolygonLength = len1 + len2 + len3;

        // Straight line distance p0 -> p3 (lower bound)
        const chordLength = Math.hypot(seg.p3[0] - seg.p0[0], seg.p3[1] - seg.p0[1]);

        // Actual bezier length is between chord and control polygon
        // Use weighted average closer to control polygon for better accuracy
        totalLength += (controlPolygonLength * 0.7 + chordLength * 0.3);
      }
    }

    return totalLength;
  }, [bezierData]);

  // Calculate progressive anchor and handle reveal during animation - trails the drawing path
  const { revealedHandles, revealedAnchors } = useMemo(() => {
    if (!bezierData || animationProgress === 0) return { revealedHandles: [], revealedAnchors: [] };
    if (!showAnimationHandles && !showAnimationAngles) return { revealedHandles: [], revealedAnchors: [] };

    const totalSegments = bezierData.strokes.reduce((sum, stroke) => sum + stroke.length, 0);

    // Calculate current position in the animation
    const currentSegmentFloat = totalSegments * animationProgress;
    const currentSegmentIndex = Math.floor(currentSegmentFloat);
    const segmentProgress = currentSegmentFloat - currentSegmentIndex; // 0-1 within current segment

    const handles: Array<{
      x1: number; y1: number; x2: number; y2: number;
      angle?: number;
      anchorX: number; anchorY: number;
      handleX: number; handleY: number;
      opacity: number; // Fade in based on how recently it was revealed
    }> = [];

    let segmentIndex = 0;

    for (const stroke of bezierData.strokes) {
      for (const seg of stroke) {
        const isCurrentSegment = segmentIndex === currentSegmentIndex;
        const isPastSegment = segmentIndex < currentSegmentIndex;

        // Show handles for past segments (fully revealed)
        if (isPastSegment) {
          // Calculate angles
          const dx1 = seg.c1[0] - seg.p0[0];
          const dy1 = seg.c1[1] - seg.p0[1];
          const c1Angle = Math.round((Math.atan2(dy1, dx1) * 180) / Math.PI);

          const dx2 = seg.c2[0] - seg.p3[0];
          const dy2 = seg.c2[1] - seg.p3[1];
          const c2Angle = Math.round((Math.atan2(dy2, dx2) * 180) / Math.PI);

          // Start handle (p0 -> c1)
          handles.push({
            x1: seg.p0[0], y1: seg.p0[1],
            x2: seg.c1[0], y2: seg.c1[1],
            angle: showAnimationAngles ? c1Angle : undefined,
            anchorX: seg.p0[0], anchorY: seg.p0[1],
            handleX: seg.c1[0], handleY: seg.c1[1],
            opacity: 1,
          });

          // End handle (p3 -> c2)
          handles.push({
            x1: seg.p3[0], y1: seg.p3[1],
            x2: seg.c2[0], y2: seg.c2[1],
            angle: showAnimationAngles ? c2Angle : undefined,
            anchorX: seg.p3[0], anchorY: seg.p3[1],
            handleX: seg.c2[0], handleY: seg.c2[1],
            opacity: 1,
          });
        }
        // Show handles for current segment as they're being crossed
        else if (isCurrentSegment) {
          // Calculate angles
          const dx1 = seg.c1[0] - seg.p0[0];
          const dy1 = seg.c1[1] - seg.p0[1];
          const c1Angle = Math.round((Math.atan2(dy1, dx1) * 180) / Math.PI);

          // Start handle appears immediately when segment starts (after 15% progress)
          if (segmentProgress > 0.15) {
            const fadeIn = Math.min(1, (segmentProgress - 0.15) / 0.1); // Fast fade in
            handles.push({
              x1: seg.p0[0], y1: seg.p0[1],
              x2: seg.c1[0], y2: seg.c1[1],
              angle: showAnimationAngles ? c1Angle : undefined,
              anchorX: seg.p0[0], anchorY: seg.p0[1],
              handleX: seg.c1[0], handleY: seg.c1[1],
              opacity: fadeIn,
            });
          }

          // End handle appears in the middle of segment (after 60% progress)
          if (segmentProgress > 0.6) {
            const dx2 = seg.c2[0] - seg.p3[0];
            const dy2 = seg.c2[1] - seg.p3[1];
            const c2Angle = Math.round((Math.atan2(dy2, dx2) * 180) / Math.PI);

            const fadeIn = Math.min(1, (segmentProgress - 0.6) / 0.15); // Fast fade in
            handles.push({
              x1: seg.p3[0], y1: seg.p3[1],
              x2: seg.c2[0], y2: seg.c2[1],
              angle: showAnimationAngles ? c2Angle : undefined,
              anchorX: seg.p3[0], anchorY: seg.p3[1],
              handleX: seg.c2[0], handleY: seg.c2[1],
              opacity: fadeIn,
            });
          }
        }

        segmentIndex++;
      }
    }

    // Calculate revealed anchors (trailing the path)
    const anchors: Array<{
      x: number; y: number;
      isSmooth: boolean;
      opacity: number;
    }> = [];

    segmentIndex = 0;
    for (const stroke of bezierData.strokes) {
      for (const seg of stroke) {
        const isCurrentSegment = segmentIndex === currentSegmentIndex;
        const isPastSegment = segmentIndex < currentSegmentIndex;

        // Show anchors for past segments
        if (isPastSegment) {
          // p0 anchor (start)
          const isP0Smooth = smoothStates[`${segmentIndex}-0-p0`] || false;
          anchors.push({
            x: seg.p0[0], y: seg.p0[1],
            isSmooth: isP0Smooth,
            opacity: 1,
          });

          // p3 anchor (end)
          const isP3Smooth = smoothStates[`${segmentIndex}-${stroke.length - 1}-p3`] || false;
          anchors.push({
            x: seg.p3[0], y: seg.p3[1],
            isSmooth: isP3Smooth,
            opacity: 1,
          });
        }
        // Current segment - only show p0 (the start anchor we're drawing from)
        else if (isCurrentSegment) {
          // p0 appears early since we're drawing FROM this point
          if (segmentProgress > 0.05) {
            const fadeIn = Math.min(1, (segmentProgress - 0.05) / 0.1);
            const isP0Smooth = smoothStates[`${segmentIndex}-0-p0`] || false;
            anchors.push({
              x: seg.p0[0], y: seg.p0[1],
              isSmooth: isP0Smooth,
              opacity: fadeIn,
            });
          }
          // p3 only appears AFTER segment is complete (in past segments section)
        }

        segmentIndex++;
      }
    }

    return { revealedHandles: handles, revealedAnchors: anchors };
  }, [bezierData, animationProgress, showAnimationHandles, showAnimationAngles, smoothStates, isAnimating]);

  const handleLines = useMemo(() => {
    if (!bezierData || !showHandles) return [];
    const lines: React.ReactElement[] = [];
    bezierData.strokes.forEach((stroke, si) => {
      stroke.forEach((seg, ei) => {
        const isC1Selected = selectedPoint?.strokeIndex === si && selectedPoint?.segmentIndex === ei && selectedPoint?.pointType === "c1";
        const isC2Selected = selectedPoint?.strokeIndex === si && selectedPoint?.segmentIndex === ei && selectedPoint?.pointType === "c2";
        lines.push(
          <line key={`h1-${si}-${ei}`} x1={seg.p0[0]} y1={seg.p0[1]} x2={seg.c1[0]} y2={seg.c1[1]} className={isC1Selected ? "stroke-yellow-400" : "stroke-blue-400"} strokeWidth={(isC1Selected ? 2 : 1) * visualScale} opacity={isC1Selected ? 1 : 0.6} />,
          <line key={`h2-${si}-${ei}`} x1={seg.p3[0]} y1={seg.p3[1]} x2={seg.c2[0]} y2={seg.c2[1]} className={isC2Selected ? "stroke-yellow-400" : "stroke-blue-400"} strokeWidth={(isC2Selected ? 2 : 1) * visualScale} opacity={isC2Selected ? 1 : 0.6} />
        );
      });
    });
    return lines;
  }, [bezierData, showHandles, selectedPoint, visualScale]);

  const controlPoints = useMemo(() => {
    if (!bezierData || !showHandles) return [];
    const points: React.ReactElement[] = [];
    bezierData.strokes.forEach((stroke, si) => {
      stroke.forEach((seg, ei) => {
        const isC1Selected = selectedPoint?.strokeIndex === si && selectedPoint?.segmentIndex === ei && selectedPoint?.pointType === "c1";
        const isC2Selected = selectedPoint?.strokeIndex === si && selectedPoint?.segmentIndex === ei && selectedPoint?.pointType === "c2";
        points.push(
          <circle key={`c1-${si}-${ei}`} cx={seg.c1[0]} cy={seg.c1[1]} r={(isC1Selected ? 7 : 4) * visualScale} className={isC1Selected ? "fill-yellow-400" : "fill-blue-400"} />,
          <circle key={`c2-${si}-${ei}`} cx={seg.c2[0]} cy={seg.c2[1]} r={(isC2Selected ? 7 : 4) * visualScale} className={isC2Selected ? "fill-yellow-400" : "fill-blue-400"} />
        );
      });
    });
    return points;
  }, [bezierData, showHandles, selectedPoint, visualScale]);

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
            <circle key={`p0-ring-${si}-${ei}`} cx={seg.p0[0]} cy={seg.p0[1]} r={9 * visualScale} fill="none" stroke="#22c55e" strokeWidth={2 * visualScale} opacity="0.8" />
          );
        }
        if (isP3Smooth) {
          points.push(
            <circle key={`p3-ring-${si}-${ei}`} cx={seg.p3[0]} cy={seg.p3[1]} r={9 * visualScale} fill="none" stroke="#22c55e" strokeWidth={2 * visualScale} opacity="0.8" />
          );
        }

        points.push(
          <circle key={`p0-${si}-${ei}`} cx={seg.p0[0]} cy={seg.p0[1]} r={(isP0Selected ? 8 : 5) * visualScale} className={isP0Selected ? "fill-yellow-400" : isP0Smooth ? "fill-green-500" : "fill-red-500"} />,
          <circle key={`p3-${si}-${ei}`} cx={seg.p3[0]} cy={seg.p3[1]} r={(isP3Selected ? 8 : 5) * visualScale} className={isP3Selected ? "fill-yellow-400" : isP3Smooth ? "fill-green-500" : "fill-red-500"} />
        );
      });
    });
    return points;
  }, [bezierData, showAnchors, selectedPoint, smoothStates, visualScale]);

  const anchorLabels = useMemo(() => {
    if (!anchorsData || !showLabels) return [];
    const s = visualScale;
    return anchorsData.anchors.map((anchor, i) => (
      <g key={i}>
        <rect
          x={anchor.x + 8 * s}
          y={anchor.y - 10 * s}
          width={(anchor.name.length * 7 + 8) * s}
          height={18 * s}
          rx={3 * s}
          className="fill-zinc-900"
          opacity="0.8"
        />
        <text
          x={anchor.x + 12 * s}
          y={anchor.y + 2 * s}
          className="fill-white font-mono"
          fontSize={10 * s}
        >
          {anchor.name}
        </text>
      </g>
    ));
  }, [anchorsData, showLabels, visualScale]);

  // Static angle measurements with geometric arcs (architectural style)
  const staticAngleLabels = useMemo(() => {
    if (!bezierData || !showAnimationAngles) return [];
    // Only skip during active animation
    if (animationProgress > 0 && isAnimating) return [];

    const labels: React.ReactElement[] = [];
    const s = visualScale;
    const arcRadius = angleArcRadius * s; // Scale arc radius for zoom

    bezierData.strokes.forEach((stroke, si) => {
      stroke.forEach((seg, ei) => {
        // Handle from p0 to c1
        const dx1 = seg.c1[0] - seg.p0[0];
        const dy1 = seg.c1[1] - seg.p0[1];
        const angleRad1 = Math.atan2(dy1, dx1);
        const angleDeg1 = Math.round((angleRad1 * 180) / Math.PI);

        // Reference line (horizontal = 0°)
        const refAngle = 0;

        // Arc from reference to handle angle
        const startX1 = seg.p0[0] + arcRadius * Math.cos(refAngle);
        const startY1 = seg.p0[1] + arcRadius * Math.sin(refAngle);
        const endX1 = seg.p0[0] + arcRadius * Math.cos(angleRad1);
        const endY1 = seg.p0[1] + arcRadius * Math.sin(angleRad1);

        // Determine if we should use large arc (for angles > 180°)
        const largeArc1 = Math.abs(angleDeg1) > 180 ? 1 : 0;
        const sweepFlag1 = angleDeg1 > 0 ? 1 : 0;

        // Label position (middle of arc)
        const midAngle1 = angleRad1 / 2;
        const labelRadius1 = arcRadius + 12 * s;
        const labelX1 = seg.p0[0] + labelRadius1 * Math.cos(midAngle1);
        const labelY1 = seg.p0[1] + labelRadius1 * Math.sin(midAngle1);

        labels.push(
          <g key={`c1-angle-${si}-${ei}`}>
            {/* Reference line (horizontal) */}
            {showAngleReference && (
              <line
                x1={seg.p0[0]}
                y1={seg.p0[1]}
                x2={seg.p0[0] + arcRadius * 1.2}
                y2={seg.p0[1]}
                stroke="#60a5fa"
                strokeWidth={0.5 * s}
                opacity="0.3"
                strokeDasharray={`${2 * s},${2 * s}`}
              />
            )}
            {/* Angle arc */}
            <path
              d={`M ${startX1} ${startY1} A ${arcRadius} ${arcRadius} 0 ${largeArc1} ${sweepFlag1} ${endX1} ${endY1}`}
              fill="none"
              stroke="#60a5fa"
              strokeWidth={1.5 * s}
              opacity="0.7"
            />
            {/* Angle label */}
            <text
              x={labelX1}
              y={labelY1}
              fontSize={9 * s}
              fontFamily="monospace"
              fill="#60a5fa"
              opacity="0.7"
              fontWeight="600"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {angleDeg1}°
            </text>
          </g>
        );

        // Handle from p3 to c2
        const dx2 = seg.c2[0] - seg.p3[0];
        const dy2 = seg.c2[1] - seg.p3[1];
        const angleRad2 = Math.atan2(dy2, dx2);
        const angleDeg2 = Math.round((angleRad2 * 180) / Math.PI);

        const startX2 = seg.p3[0] + arcRadius * Math.cos(refAngle);
        const startY2 = seg.p3[1] + arcRadius * Math.sin(refAngle);
        const endX2 = seg.p3[0] + arcRadius * Math.cos(angleRad2);
        const endY2 = seg.p3[1] + arcRadius * Math.sin(angleRad2);

        const largeArc2 = Math.abs(angleDeg2) > 180 ? 1 : 0;
        const sweepFlag2 = angleDeg2 > 0 ? 1 : 0;

        const midAngle2 = angleRad2 / 2;
        const labelRadius2 = arcRadius + 12 * s;
        const labelX2 = seg.p3[0] + labelRadius2 * Math.cos(midAngle2);
        const labelY2 = seg.p3[1] + labelRadius2 * Math.sin(midAngle2);

        labels.push(
          <g key={`c2-angle-${si}-${ei}`}>
            {/* Reference line (horizontal) */}
            {showAngleReference && (
              <line
                x1={seg.p3[0]}
                y1={seg.p3[1]}
                x2={seg.p3[0] + arcRadius * 1.2}
                y2={seg.p3[1]}
                stroke="#60a5fa"
                strokeWidth={0.5 * s}
                opacity="0.3"
                strokeDasharray={`${2 * s},${2 * s}`}
              />
            )}
            {/* Angle arc */}
            <path
              d={`M ${startX2} ${startY2} A ${arcRadius} ${arcRadius} 0 ${largeArc2} ${sweepFlag2} ${endX2} ${endY2}`}
              fill="none"
              stroke="#60a5fa"
              strokeWidth={1.5 * s}
              opacity="0.7"
            />
            {/* Angle label */}
            <text
              x={labelX2}
              y={labelY2}
              fontSize={9 * s}
              fontFamily="monospace"
              fill="#60a5fa"
              opacity="0.7"
              fontWeight="600"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {angleDeg2}°
            </text>
          </g>
        );
      });
    });

    return labels;
  }, [bezierData, showAnimationAngles, animationProgress, isAnimating, angleArcRadius, showAngleReference, visualScale]);

  const strokeGroups = useMemo(() => {
    if (!anchorsData) return [];
    const groups: Record<string, NamedAnchor[]> = {};
    anchorsData.anchors.forEach((anchor) => {
      if (!groups[anchor.stroke]) groups[anchor.stroke] = [];
      groups[anchor.stroke].push(anchor);
    });
    return Object.entries(groups);
  }, [anchorsData]);

  // Parse search query and filter anchors
  // Syntax: stroke:left,top x>500 y<300 name_pattern
  // Examples:
  //   "stroke:left" → only left stroke
  //   "stroke:left,top" → left OR top
  //   "x>500" → x coordinate > 500
  //   "bridge" → name contains "bridge"
  const filteredAnchors = useMemo(() => {
    if (!anchorsData) return [];
    if (!searchQuery.trim()) return anchorsData.anchors;

    const query = searchQuery.trim();
    const filters: {
      strokes?: string[];
      xMin?: number;
      xMax?: number;
      yMin?: number;
      yMax?: number;
      namePattern?: string;
    } = {};

    // Parse query tokens
    const tokens = query.split(/\s+/);
    const nameParts: string[] = [];

    for (const token of tokens) {
      // stroke:left,top,bridge
      if (token.startsWith("stroke:")) {
        const strokes = token.slice(7).split(",").filter(Boolean);
        filters.strokes = strokes;
      }
      // x>500, x<500, x>=500, x<=500
      else if (/^x([<>]=?|=)/.test(token)) {
        const match = token.match(/^x([<>]=?|=)(\d+(?:\.\d+)?)$/);
        if (match) {
          const op = match[1];
          const val = Number(match[2]);
          if (op === ">" || op === ">=") filters.xMin = val;
          else if (op === "<" || op === "<=") filters.xMax = val;
        }
      }
      // y>300, y<300
      else if (/^y([<>]=?|=)/.test(token)) {
        const match = token.match(/^y([<>]=?|=)(\d+(?:\.\d+)?)$/);
        if (match) {
          const op = match[1];
          const val = Number(match[2]);
          if (op === ">" || op === ">=") filters.yMin = val;
          else if (op === "<" || op === "<=") filters.yMax = val;
        }
      }
      // Everything else is part of name pattern
      else {
        nameParts.push(token);
      }
    }

    if (nameParts.length > 0) {
      filters.namePattern = nameParts.join(" ").toLowerCase();
    }

    // Apply filters
    return anchorsData.anchors.filter((anchor) => {
      // Stroke filter
      if (filters.strokes && !filters.strokes.includes(anchor.stroke)) {
        return false;
      }
      // X coordinate filter
      if (filters.xMin !== undefined && anchor.x < filters.xMin) {
        return false;
      }
      if (filters.xMax !== undefined && anchor.x > filters.xMax) {
        return false;
      }
      // Y coordinate filter
      if (filters.yMin !== undefined && anchor.y < filters.yMin) {
        return false;
      }
      if (filters.yMax !== undefined && anchor.y > filters.yMax) {
        return false;
      }
      // Name pattern filter
      if (filters.namePattern && !anchor.name.toLowerCase().includes(filters.namePattern)) {
        return false;
      }
      return true;
    });
  }, [anchorsData, searchQuery]);

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

  // Save As — confirm and save to named project (Feature 4)
  const confirmSaveAs = useCallback((name: string) => {
    const pid = crypto.randomUUID();
    setProjectId(pid);
    setProjectName(name);
    setShowSaveAsModal(false);
    if (bezierData) {
      saveToDisk(bezierData, smoothStates, pid);
    }
    // Update session with project info
    try {
      const raw = localStorage.getItem('shaper-session');
      if (raw) {
        const session = JSON.parse(raw);
        session.projectId = pid;
        session.projectName = name;
        localStorage.setItem('shaper-session', JSON.stringify(session));
      }
    } catch { /* ignore */ }
  }, [bezierData, smoothStates, saveToDisk]);

  // Per-stroke paths memo (Feature 5)
  const perStrokePaths = useMemo(() => {
    if (!bezierData) return [];
    return bezierData.strokes.map((stroke) => {
      if (stroke.length === 0) return "";
      let d = `M ${stroke[0].p0[0]} ${stroke[0].p0[1]}`;
      for (const seg of stroke) {
        d += ` C ${seg.c1[0]} ${seg.c1[1]}, ${seg.c2[0]} ${seg.c2[1]}, ${seg.p3[0]} ${seg.p3[1]}`;
      }
      return d;
    });
  }, [bezierData]);

  // Initialize stroke fills when bezierData changes (Feature 5)
  useEffect(() => {
    if (!bezierData) return;
    setStrokeFills(prev => {
      const next: Record<number, { enabled: boolean; color: string; opacity: number }> = {};
      for (let i = 0; i < bezierData.strokes.length; i++) {
        next[i] = prev[i] || { enabled: false, color: pathColor, opacity: 0.5 };
      }
      return next;
    });
  }, [bezierData?.strokes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Segment infos for inspector (Feature 6)
  const segmentInfos = useMemo(() => {
    if (!bezierData) return [];
    return bezierData.strokes.map((stroke, si) =>
      stroke.map((seg, ei) => {
        // Approximate length via control polygon
        const len1 = Math.hypot(seg.c1[0] - seg.p0[0], seg.c1[1] - seg.p0[1]);
        const len2 = Math.hypot(seg.c2[0] - seg.c1[0], seg.c2[1] - seg.c1[1]);
        const len3 = Math.hypot(seg.p3[0] - seg.c2[0], seg.p3[1] - seg.c2[1]);
        const chord = Math.hypot(seg.p3[0] - seg.p0[0], seg.p3[1] - seg.p0[1]);
        const length = Math.round((len1 + len2 + len3) * 0.7 + chord * 0.3);
        return {
          strokeIndex: si,
          segmentIndex: ei,
          length,
          start: [Math.round(seg.p0[0]), Math.round(seg.p0[1])] as [number, number],
          end: [Math.round(seg.p3[0]), Math.round(seg.p3[1])] as [number, number],
        };
      })
    );
  }, [bezierData]);

  // Delete a specific segment (Feature 6)
  const deleteSegment = useCallback((si: number, ei: number) => {
    setBezierData(prev => {
      if (!prev) return prev;
      const newData = JSON.parse(JSON.stringify(prev));
      const stroke = newData.strokes[si];
      if (!stroke) return prev;
      stroke.splice(ei, 1);
      newData.strokes = newData.strokes.filter((s: unknown[]) => s.length > 0);
      return newData;
    });
    if (selectedSegment?.strokeIndex === si && selectedSegment?.segmentIndex === ei) {
      setSelectedSegment(null);
    }
  }, [selectedSegment]);

  // Simplify a stroke (Feature 7)
  const simplifyStroke = useCallback((strokeIndex: number, tolerance: number): BezierSegment[] | null => {
    if (!bezierData) return null;
    const stroke = bezierData.strokes[strokeIndex];
    if (!stroke || stroke.length === 0) return null;

    // Sample bezier segments into a dense polyline
    const points: [number, number][] = [];
    for (const seg of stroke) {
      const ctrl: [[ number, number], [number, number], [number, number], [number, number]] = [seg.p0, seg.c1, seg.c2, seg.p3];
      for (let t = 0; t <= 1; t += 0.02) {
        points.push(bezierQ(ctrl, t));
      }
    }

    // RDP simplification then re-fit
    const simplified = rdp(points, tolerance);
    if (simplified.length < 2) return null;

    const fitted = fitCurve(simplified, tolerance);
    return fitted.map(([p0, c1, c2, p3]) => ({
      p0: [p0[0], p0[1]] as [number, number],
      c1: [c1[0], c1[1]] as [number, number],
      c2: [c2[0], c2[1]] as [number, number],
      p3: [p3[0], p3[1]] as [number, number],
    }));
  }, [bezierData]);

  // Simplify preview effect (Feature 7)
  useEffect(() => {
    if (!simplifyMode || simplifyStrokeIndex === null) {
      setSimplifyPreview(null);
      return;
    }
    const result = simplifyStroke(simplifyStrokeIndex, simplifyTolerance);
    setSimplifyPreview(result);
  }, [simplifyMode, simplifyStrokeIndex, simplifyTolerance, simplifyStroke]);

  // Commit simplification (Feature 7)
  const commitSimplify = useCallback(() => {
    if (simplifyStrokeIndex === null || !simplifyPreview || !bezierData) return;
    setBezierData(prev => {
      if (!prev) return prev;
      const newData = JSON.parse(JSON.stringify(prev));
      newData.strokes[simplifyStrokeIndex] = simplifyPreview;
      return newData;
    });
    setSimplifyMode(false);
    setSimplifyPreview(null);
    setSimplifyStrokeIndex(null);
  }, [simplifyStrokeIndex, simplifyPreview, bezierData]);

  // Area simplify: simplify only the selected segments across strokes
  const simplifySelectedSegments = useCallback((tolerance: number): Map<string, BezierSegment[]> | null => {
    if (!bezierData || selectedSegments.size === 0) {
      log(`[area-simplify] skip: data=${!!bezierData}, selected=${selectedSegments.size}`);
      return null;
    }
    log(`[area-simplify] run: ${selectedSegments.size} segments, tol=${tolerance}`);

    // Group selected segments by stroke index
    const byStroke = new Map<number, number[]>();
    for (const key of selectedSegments) {
      const [si, ei] = key.split("-").map(Number);
      if (!byStroke.has(si)) byStroke.set(si, []);
      byStroke.get(si)!.push(ei);
    }

    const result = new Map<string, BezierSegment[]>();

    for (const [si, indices] of byStroke) {
      const sorted = [...indices].sort((a, b) => a - b);
      const stroke = bezierData.strokes[si];
      if (!stroke) continue;

      // Find contiguous runs
      const runs: number[][] = [];
      let run = [sorted[0]];
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === sorted[i - 1] + 1) {
          run.push(sorted[i]);
        } else {
          runs.push(run);
          run = [sorted[i]];
        }
      }
      runs.push(run);

      // Simplify each contiguous run
      for (const r of runs) {
        const runKey = `${si}-${r[0]}-${r[r.length - 1]}`;
        const points: [number, number][] = [];
        for (const ei of r) {
          const seg = stroke[ei];
          if (!seg) continue;
          const ctrl: [[number, number], [number, number], [number, number], [number, number]] = [seg.p0, seg.c1, seg.c2, seg.p3];
          for (let t = 0; t <= 1; t += 0.02) {
            points.push(bezierQ(ctrl, t));
          }
        }
        if (points.length < 2) continue;
        log(`[area-simplify] stroke ${si} [${r[0]}..${r[r.length - 1]}]: ${r.length} segs, ${points.length} pts`);
        const simplified = rdp(points, tolerance);
        if (simplified.length < 2) continue;
        log(`[area-simplify] RDP: ${points.length} → ${simplified.length} pts (tol=${tolerance})`);
        const fitted = fitCurve(simplified, tolerance);
        log(`[area-simplify] fit: ${simplified.length} pts → ${fitted.length} segs`);
        result.set(runKey, fitted.map(([p0, c1, c2, p3]) => ({
          p0: [p0[0], p0[1]] as [number, number],
          c1: [c1[0], c1[1]] as [number, number],
          c2: [c2[0], c2[1]] as [number, number],
          p3: [p3[0], p3[1]] as [number, number],
        })));
      }
    }

    return result.size > 0 ? result : null;
  }, [bezierData, selectedSegments, log]);

  // Area simplify preview effect
  useEffect(() => {
    if (!showAreaSimplify || selectedSegments.size === 0) {
      setAreaSimplifyPreview(null);
      return;
    }
    log(`[area-simplify] preview: tol=${areaSimplifyTolerance}, ${selectedSegments.size} selected`);
    const result = simplifySelectedSegments(areaSimplifyTolerance);
    log(`[area-simplify] result: ${result ? result.size + ' runs' : 'null'}`);
    setAreaSimplifyPreview(result);
  }, [showAreaSimplify, areaSimplifyTolerance, simplifySelectedSegments, selectedSegments, log]);

  // Commit area simplify
  const commitAreaSimplify = useCallback(() => {
    log(`[area-simplify] commit: preview=${!!areaSimplifyPreview}, data=${!!bezierData}`);
    if (!areaSimplifyPreview || !bezierData) return;

    // Group selected by stroke
    const byStroke = new Map<number, number[]>();
    for (const key of selectedSegments) {
      const [si, ei] = key.split("-").map(Number);
      if (!byStroke.has(si)) byStroke.set(si, []);
      byStroke.get(si)!.push(ei);
    }

    setBezierData(prev => {
      if (!prev) return prev;
      const newData: BezierData = JSON.parse(JSON.stringify(prev));

      for (const [si, indices] of byStroke) {
        const sorted = [...indices].sort((a, b) => a - b);
        const runs: number[][] = [];
        let run = [sorted[0]];
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i] === sorted[i - 1] + 1) {
            run.push(sorted[i]);
          } else {
            runs.push(run);
            run = [sorted[i]];
          }
        }
        runs.push(run);

        // Process runs in reverse so splice indices stay valid
        for (let ri = runs.length - 1; ri >= 0; ri--) {
          const r = runs[ri];
          const runKey = `${si}-${r[0]}-${r[r.length - 1]}`;
          const replacement = areaSimplifyPreview.get(runKey);
          if (replacement) {
            newData.strokes[si].splice(r[0], r.length, ...replacement);
          }
        }
      }

      return newData;
    });

    setSelectedSegments(new Set());
    setSelectionBounds(null);
    setShowAreaSimplify(false);
    setAreaSimplifyPreview(null);
  }, [areaSimplifyPreview, bezierData, selectedSegments, log]);

  // Inflate collapsed handles: set c1/c2 to 1/3 chord positions so they become draggable
  const inflateSelectedHandles = useCallback(() => {
    if (!bezierData || selectedSegments.size === 0) return;

    let inflated = 0;
    let skipped = 0;

    setBezierData(prev => {
      if (!prev) return prev;
      const newData: BezierData = JSON.parse(JSON.stringify(prev));

      for (const key of selectedSegments) {
        const [si, ei] = key.split("-").map(Number);
        const seg = newData.strokes[si]?.[ei];
        if (!seg) continue;

        const dx = seg.p3[0] - seg.p0[0];
        const dy = seg.p3[1] - seg.p0[1];
        const third = 1 / 3;

        const c1Collapsed = Math.abs(seg.c1[0] - seg.p0[0]) < 1 && Math.abs(seg.c1[1] - seg.p0[1]) < 1;
        const c2Collapsed = Math.abs(seg.c2[0] - seg.p3[0]) < 1 && Math.abs(seg.c2[1] - seg.p3[1]) < 1;

        if (c1Collapsed || c2Collapsed) {
          if (c1Collapsed) {
            seg.c1 = [seg.p0[0] + dx * third, seg.p0[1] + dy * third];
          }
          if (c2Collapsed) {
            seg.c2 = [seg.p3[0] - dx * third, seg.p3[1] - dy * third];
          }
          inflated++;
        } else {
          skipped++;
        }
      }

      return newData;
    });

    log(`[inflate] ${inflated} segments inflated, ${skipped} already had handles`);
  }, [bezierData, selectedSegments, log]);

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
    { id: "eraser-tool", label: "Tool: Eraser", action: () => switchTool("eraser"), shortcut: "E" },
    { id: "undo", label: "Undo", action: undo, shortcut: "Cmd+Z" },
    { id: "redo", label: "Redo", action: redo, shortcut: "Cmd+Shift+Z" },
    { id: "save", label: "Save", action: () => { quickSave(); confirmSound(); }, shortcut: "Cmd+S" },
    { id: "save-as", label: "Save As...", action: () => setShowSaveAsModal(true), shortcut: "Cmd+Shift+S" },
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
    { id: "toggle-animation-mode", label: `${animationModeEnabled ? "Disable" : "Enable"} Animation Mode`, action: () => { setAnimationModeEnabled(v => !v); clickSound(); }, shortcut: "T" },
    { id: "toggle-left-panel", label: `${leftCollapsed ? "Show" : "Hide"} Layers Panel`, action: () => setLeftCollapsed(v => !v) },
    { id: "toggle-right-panel", label: `${rightCollapsed ? "Show" : "Hide"} Inspector Panel`, action: () => setRightCollapsed(v => !v) },
    ...(selectedPoint ? [
      { id: "delete-point", label: "Delete Selected Point", action: deleteSelectedPoint, shortcut: "Backspace" },
      { id: "focus-point", label: "Focus on Selected Point", action: focusOnSelected },
    ] : []),
  ], [switchTool, undo, redo, quickSave, downloadJson, handleRetrace, newProject, resetZoom, zoomIn, zoomOut, showPath, showAnchors, showHandles, showLabels, showOriginal, showSilhouette, showGrid, showGuides, isTerminalOpen, leftCollapsed, rightCollapsed, selectedPoint, deleteSelectedPoint, focusOnSelected, animationModeEnabled, setAnimationModeEnabled, clickSound]);

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
          className={`absolute inset-0 ${(tool === "pen" || tool === "eraser") ? "cursor-crosshair" : ""} ${(tool === "hand" || isPanning) ? "cursor-grab" : ""} ${isPanning ? "!cursor-grabbing" : ""}`}
          style={{
            backgroundColor: "#0a0a0a",
            backgroundImage: showGrid ? 'radial-gradient(circle, #333 1px, transparent 1px)' : 'none',
            backgroundSize: "20px 20px",
          }}
          onWheel={handleWheel}
          onMouseDown={(e) => { setContextMenu(null); setSelectionContextMenu(null); handlePointMouseDown(e); }}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={() => handleCanvasMouseUp()}
          onMouseLeave={() => { handleCanvasMouseUp(false); setMousePos(null); }}
          onContextMenu={(e) => {
            e.preventDefault();
            // Selection context menu takes priority (works with or without captured segments)
            if (selectionBounds) {
              setSelectionContextMenu({ x: e.clientX, y: e.clientY });
              return;
            }
            const coords = getCanvasCoords(e);
            const nearPoint = findNearestPoint(coords.x, coords.y, 20);
            if (nearPoint && (nearPoint.pointType === "p0" || nearPoint.pointType === "p3")) {
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                strokeIndex: nearPoint.strokeIndex,
                segmentIndex: nearPoint.segmentIndex,
                pointType: nearPoint.pointType,
              });
            } else {
              setContextMenu(null);
            }
          }}
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
                <>
                  {/* Per-stroke fill layer (behind stroke) */}
                  {fillEnabled && perStrokePaths.map((d, i) => {
                    const sf = strokeFills[i];
                    if (!d || !sf?.enabled) return null;
                    return (
                      <path
                        key={`fill-${i}`}
                        d={d}
                        fill={sf.color}
                        fillOpacity={sf.opacity}
                        stroke="none"
                      />
                    );
                  })}

                  {/* Use stroke-dasharray for smooth hardware-accelerated animation */}
                  <path
                    d={strokesPath}
                    fill="none"
                    stroke={pathColor}
                    strokeWidth={3 * visualScale}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={animationProgress > 0 && animationProgress < 1 ? pathLengthEstimate : undefined}
                    strokeDashoffset={animationProgress > 0 && animationProgress < 1 ? pathLengthEstimate * (1 - animationProgress) : undefined}
                  />

                  {/* Only show handles/points when not animating or when animation is paused */}
                  {animationProgress === 0 && (
                    <>
                      {/* Only show static handles if animation features are disabled */}
                      {!showAnimationHandles && !showAnimationAngles && handleLines}
                      {!showAnimationHandles && !showAnimationAngles && controlPoints}
                      {/* Only show static anchors if animation features are disabled */}
                      {!showAnimationHandles && !showAnimationAngles && anchorPoints}
                      {anchorLabels}
                      {staticAngleLabels}
                    </>
                  )}

                  {/* Show revealed elements when animation is paused (not playing but progress > 0) */}
                  {animationProgress > 0 && !isAnimating && (
                    <>
                      {/* Show progressive handles when animation features enabled */}
                      {showAnimationHandles && revealedHandles.map((handle, i) => (
                        <g key={`paused-handle-${i}`} opacity={handleOpacity}>
                          <line
                            x1={handle.x1}
                            y1={handle.y1}
                            x2={handle.x2}
                            y2={handle.y2}
                            stroke="#60a5fa"
                            strokeWidth={1 * visualScale}
                            opacity={0.7}
                          />
                          <circle
                            cx={handle.handleX}
                            cy={handle.handleY}
                            r={2.5 * visualScale}
                            fill="#3b82f6"
                            opacity={0.8}
                          />
                        </g>
                      ))}
                      {/* Show progressive anchors when animation features enabled */}
                      {(showAnimationHandles || showAnimationAngles) && revealedAnchors.map((anchor, i) => (
                        <circle
                          key={`paused-anchor-${i}`}
                          cx={anchor.x}
                          cy={anchor.y}
                          r={3 * visualScale}
                          fill={anchor.isSmooth ? '#10b981' : '#ef4444'}
                          opacity={0.8}
                        />
                      ))}
                      {/* Only show static anchors if animation features are disabled */}
                      {!showAnimationHandles && !showAnimationAngles && anchorPoints}
                      {/* Show angle measurements on paused animation */}
                      {showAnimationAngles && revealedHandles.map((handle, i) => (
                        handle.angle !== undefined && (
                          <text
                            key={`angle-${i}`}
                            x={handle.handleX + 10 * visualScale}
                            y={handle.handleY - 6 * visualScale}
                            fontSize={10 * visualScale}
                            fontFamily="monospace"
                            fill="#60a5fa"
                            opacity="0.6"
                            fontWeight="500"
                          >
                            {handle.angle}°
                          </text>
                        )
                      ))}
                    </>
                  )}

                  {/* Progressive handle reveal during animation - trails the drawing */}
                  {animationProgress > 0 && isAnimating && revealedHandles.length > 0 && (
                    <g className="animation-handles">
                      {revealedHandles.map((handle, i) => {
                        const animArcRadius = angleArcRadius * visualScale;
                        const angleRad = (handle.angle! * Math.PI) / 180;
                        const refAngle = 0;

                        const startX = handle.anchorX + animArcRadius * Math.cos(refAngle);
                        const startY = handle.anchorY + animArcRadius * Math.sin(refAngle);
                        const endX = handle.anchorX + animArcRadius * Math.cos(angleRad);
                        const endY = handle.anchorY + animArcRadius * Math.sin(angleRad);

                        const largeArc = Math.abs(handle.angle!) > 180 ? 1 : 0;
                        const sweepFlag = handle.angle! > 0 ? 1 : 0;

                        const midAngle = angleRad / 2;
                        const labelRadius = animArcRadius + 12 * visualScale;
                        const labelX = handle.anchorX + labelRadius * Math.cos(midAngle);
                        const labelY = handle.anchorY + labelRadius * Math.sin(midAngle);

                        return (
                          <g key={i} opacity={handle.opacity * handleOpacity}>
                            {/* Handle line */}
                            <line
                              x1={handle.x1}
                              y1={handle.y1}
                              x2={handle.x2}
                              y2={handle.y2}
                              stroke="#60a5fa"
                              strokeWidth={1 * visualScale}
                              opacity={0.7}
                            />
                            {/* Handle control point */}
                            <circle
                              cx={handle.handleX}
                              cy={handle.handleY}
                              r={2.5 * visualScale}
                              fill="#3b82f6"
                              opacity={0.8}
                            />
                            {/* Geometric angle arc */}
                            {showAnimationAngles && handle.angle !== undefined && (
                              <>
                                {/* Reference line */}
                                {showAngleReference && (
                                  <line
                                    x1={handle.anchorX}
                                    y1={handle.anchorY}
                                    x2={handle.anchorX + animArcRadius * 1.2}
                                    y2={handle.anchorY}
                                    stroke="#60a5fa"
                                    strokeWidth={0.5 * visualScale}
                                    opacity={0.3}
                                    strokeDasharray={`${2 * visualScale},${2 * visualScale}`}
                                  />
                                )}
                                {/* Angle arc */}
                                <path
                                  d={`M ${startX} ${startY} A ${animArcRadius} ${animArcRadius} 0 ${largeArc} ${sweepFlag} ${endX} ${endY}`}
                                  fill="none"
                                  stroke="#60a5fa"
                                  strokeWidth={1.5 * visualScale}
                                  opacity={0.7}
                                />
                                {/* Angle label */}
                                <text
                                  x={labelX}
                                  y={labelY}
                                  fontSize={9 * visualScale}
                                  fontFamily="monospace"
                                  fill="#60a5fa"
                                  opacity={0.9}
                                  fontWeight="600"
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                >
                                  {handle.angle}°
                                </text>
                              </>
                            )}
                          </g>
                        );
                      })}
                    </g>
                  )}

                  {/* Progressive anchor reveal during animation */}
                  {animationProgress > 0 && isAnimating && revealedAnchors.length > 0 && (
                    <g className="animation-anchors">
                      {revealedAnchors.map((anchor, i) => (
                        <g key={i} opacity={anchor.opacity}>
                          {/* Smooth indicator ring */}
                          {anchor.isSmooth && (
                            <circle
                              cx={anchor.x}
                              cy={anchor.y}
                              r={9 * visualScale}
                              fill="none"
                              stroke="#22c55e"
                              strokeWidth={2 * visualScale}
                              opacity="0.8"
                            />
                          )}
                          {/* Anchor point */}
                          <circle
                            cx={anchor.x}
                            cy={anchor.y}
                            r={5 * visualScale}
                            fill={anchor.isSmooth ? "#22c55e" : "#ef4444"}
                            opacity="0.9"
                          />
                        </g>
                      ))}
                    </g>
                  )}
                </>
              )}

              {/* Eraser: highlighted segments that will be deleted */}
              {eraserRect && bezierData && eraserHits.size > 0 && (
                <>
                  {bezierData.strokes.map((stroke, si) =>
                    stroke.map((seg, ei) => {
                      if (!eraserHits.has(`${si}-${ei}`)) return null;
                      return (
                        <path
                          key={`erase-hit-${si}-${ei}`}
                          d={`M ${seg.p0[0]} ${seg.p0[1]} C ${seg.c1[0]} ${seg.c1[1]}, ${seg.c2[0]} ${seg.c2[1]}, ${seg.p3[0]} ${seg.p3[1]}`}
                          fill="none"
                          stroke="#ef4444"
                          strokeWidth={4 * visualScale}
                          opacity="0.8"
                        />
                      );
                    })
                  )}
                </>
              )}

              {/* Eraser: drag rectangle overlay */}
              {eraserRect && (
                <rect
                  x={Math.min(eraserRect.start.x, eraserRect.end.x)}
                  y={Math.min(eraserRect.start.y, eraserRect.end.y)}
                  width={Math.abs(eraserRect.end.x - eraserRect.start.x)}
                  height={Math.abs(eraserRect.end.y - eraserRect.start.y)}
                  fill="rgba(239, 68, 68, 0.08)"
                  stroke="#ef4444"
                  strokeWidth={1.5 * visualScale}
                  strokeDasharray={`${8 * visualScale} ${4 * visualScale}`}
                  opacity="0.9"
                />
              )}

              {/* Selection: highlighted segments during drag */}
              {selectionRect && bezierData && selectionHits.size > 0 && (
                <>
                  {bezierData.strokes.map((stroke, si) =>
                    stroke.map((seg, ei) => {
                      if (!selectionHits.has(`${si}-${ei}`)) return null;
                      return (
                        <path
                          key={`sel-hit-${si}-${ei}`}
                          d={`M ${seg.p0[0]} ${seg.p0[1]} C ${seg.c1[0]} ${seg.c1[1]}, ${seg.c2[0]} ${seg.c2[1]}, ${seg.p3[0]} ${seg.p3[1]}`}
                          fill="none"
                          stroke="#3b82f6"
                          strokeWidth={4 * visualScale}
                          opacity="0.6"
                        />
                      );
                    })
                  )}
                </>
              )}

              {/* Selection: drag rectangle overlay */}
              {selectionRect && (
                <rect
                  x={Math.min(selectionRect.start.x, selectionRect.end.x)}
                  y={Math.min(selectionRect.start.y, selectionRect.end.y)}
                  width={Math.abs(selectionRect.end.x - selectionRect.start.x)}
                  height={Math.abs(selectionRect.end.y - selectionRect.start.y)}
                  fill="rgba(59, 130, 246, 0.06)"
                  stroke="#3b82f6"
                  strokeWidth={1.5 * visualScale}
                  strokeDasharray={`${8 * visualScale} ${4 * visualScale}`}
                  opacity="0.9"
                />
              )}

              {/* Selection: persistent bounds rectangle (stays after mouseup) */}
              {selectionBounds && !selectionRect && (
                <rect
                  x={selectionBounds.x}
                  y={selectionBounds.y}
                  width={selectionBounds.w}
                  height={selectionBounds.h}
                  fill="rgba(59, 130, 246, 0.04)"
                  stroke="#3b82f6"
                  strokeWidth={1.5 * visualScale}
                  strokeDasharray={`${6 * visualScale} ${3 * visualScale}`}
                  opacity="0.7"
                />
              )}

              {/* Selection: persistent highlight on selected segments */}
              {selectedSegments.size > 0 && !selectionRect && bezierData && (
                <>
                  {bezierData.strokes.map((stroke, si) =>
                    stroke.map((seg, ei) => {
                      if (!selectedSegments.has(`${si}-${ei}`)) return null;
                      return (
                        <path
                          key={`selected-${si}-${ei}`}
                          d={`M ${seg.p0[0]} ${seg.p0[1]} C ${seg.c1[0]} ${seg.c1[1]}, ${seg.c2[0]} ${seg.c2[1]}, ${seg.p3[0]} ${seg.p3[1]}`}
                          fill="none"
                          stroke="#3b82f6"
                          strokeWidth={4 * visualScale}
                          opacity="0.6"
                        />
                      );
                    })
                  )}
                </>
              )}

              {/* Area simplify preview */}
              {showAreaSimplify && areaSimplifyPreview && bezierData && (
                <>
                  {Array.from(areaSimplifyPreview.entries()).map(([strokeKey, previewSegs]) => {
                    let d = `M ${previewSegs[0].p0[0]} ${previewSegs[0].p0[1]}`;
                    for (const seg of previewSegs) {
                      d += ` C ${seg.c1[0]} ${seg.c1[1]}, ${seg.c2[0]} ${seg.c2[1]}, ${seg.p3[0]} ${seg.p3[1]}`;
                    }
                    return (
                      <path
                        key={`area-simp-${strokeKey}`}
                        d={d}
                        fill="none"
                        stroke="#06b6d4"
                        strokeWidth={3 * visualScale}
                        strokeDasharray={`${8 * visualScale} ${4 * visualScale}`}
                        opacity="0.9"
                      />
                    );
                  })}
                </>
              )}

              {/* Selected segment highlight (Feature 6) */}
              {selectedSegment && bezierData && (() => {
                const seg = bezierData.strokes[selectedSegment.strokeIndex]?.[selectedSegment.segmentIndex];
                if (!seg) return null;
                return (
                  <path
                    d={`M ${seg.p0[0]} ${seg.p0[1]} C ${seg.c1[0]} ${seg.c1[1]}, ${seg.c2[0]} ${seg.c2[1]}, ${seg.p3[0]} ${seg.p3[1]}`}
                    fill="none"
                    stroke="#facc15"
                    strokeWidth={5 * visualScale}
                    opacity="0.8"
                  />
                );
              })()}

              {/* Simplify preview (Feature 7) */}
              {simplifyMode && simplifyPreview && (
                <>
                  {/* Dim original stroke */}
                  {simplifyStrokeIndex !== null && bezierData?.strokes[simplifyStrokeIndex] && (() => {
                    const stroke = bezierData.strokes[simplifyStrokeIndex];
                    let d = `M ${stroke[0].p0[0]} ${stroke[0].p0[1]}`;
                    for (const seg of stroke) {
                      d += ` C ${seg.c1[0]} ${seg.c1[1]}, ${seg.c2[0]} ${seg.c2[1]}, ${seg.p3[0]} ${seg.p3[1]}`;
                    }
                    return <path d={d} fill="none" stroke={pathColor} strokeWidth={3 * visualScale} opacity="0.15" />;
                  })()}
                  {/* Preview simplified path */}
                  {(() => {
                    let d = `M ${simplifyPreview[0].p0[0]} ${simplifyPreview[0].p0[1]}`;
                    for (const seg of simplifyPreview) {
                      d += ` C ${seg.c1[0]} ${seg.c1[1]}, ${seg.c2[0]} ${seg.c2[1]}, ${seg.p3[0]} ${seg.p3[1]}`;
                    }
                    return (
                      <path
                        d={d}
                        fill="none"
                        stroke="#06b6d4"
                        strokeWidth={3 * visualScale}
                        strokeDasharray={`${8 * visualScale} ${4 * visualScale}`}
                        opacity="0.9"
                      />
                    );
                  })()}
                </>
              )}

              {/* Pen tool: preview line from last placed point to cursor */}
              {tool === "pen" && penLastPoint && penPreviewPos && (
                <>
                  <line
                    x1={penLastPoint[0]} y1={penLastPoint[1]}
                    x2={penPreviewPos[0]} y2={penPreviewPos[1]}
                    stroke="#60a5fa" strokeWidth={1.5 * visualScale} strokeDasharray={`${6 * visualScale} ${4 * visualScale}`} opacity="0.7"
                  />
                  <circle cx={penLastPoint[0]} cy={penLastPoint[1]} r={6 * visualScale} fill="#3b82f6" opacity="0.8" />
                  <circle cx={penLastPoint[0]} cy={penLastPoint[1]} r={3 * visualScale} fill="white" opacity="0.9" />
                </>
              )}

              {/* Pen tool: show cursor dot */}
              {tool === "pen" && penPreviewPos && !penLastPoint && (
                <circle cx={penPreviewPos[0]} cy={penPreviewPos[1]} r={4 * visualScale} fill="#3b82f6" opacity="0.5" />
              )}
            </svg>
          </div>

          {/* Floating Tool Palette + Undo/Redo — positioned to clear NavigationBar */}
          <div
            className="absolute top-16 z-[45] flex items-center gap-1 rounded-lg border border-neutral-800 bg-black/90 p-1 backdrop-blur-xl shadow-lg pointer-events-auto transition-all duration-300"
            style={{ right: rightCollapsed ? '16px' : `${rightSidebarWidth + 16}px` }}
          >
            {([
              { id: "select" as Tool, icon: <MousePointer2 size={14} />, label: "Select (V)" },
              { id: "pen" as Tool, icon: <Pen size={14} />, label: "Pen (P)" },
              { id: "hand" as Tool, icon: <Hand size={14} />, label: "Hand (H)" },
              { id: "eraser" as Tool, icon: <Eraser size={14} />, label: "Eraser (E)" },
            ] as const).map((t) => (
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
            <button onClick={undo} title="Undo (Cmd+Z)" className="flex h-7 w-7 items-center justify-center rounded text-sm text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"><Undo2 size={14} /></button>
            <button onClick={redo} title="Redo (Cmd+Shift+Z)" className="flex h-7 w-7 items-center justify-center rounded text-sm text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"><Redo2 size={14} /></button>
            <div className="w-px h-5 bg-neutral-700 mx-0.5" />
            <button
              onClick={() => { setAnimationModeEnabled(!animationModeEnabled); clickSound(); }}
              title={animationModeEnabled ? "Disable Animation Mode (T)" : "Enable Animation Mode (T)"}
              className={`flex h-7 items-center justify-center rounded px-2 gap-1 text-[10px] font-bold font-mono transition-all ${
                animationModeEnabled
                  ? "bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/30"
                  : "bg-neutral-800/50 text-neutral-500 hover:bg-neutral-700/50 hover:text-neutral-300"
              }`}
            >
              <span className="text-[11px]">{animationModeEnabled ? <Square size={11} /> : <Play size={11} />}</span>
              <span className="tracking-wider">ANIM</span>
            </button>
          </div>

          {/* Floating selection action bar */}
          {selectionBounds && !selectionRect && (
            <div
              className="absolute top-28 z-[45] pointer-events-auto transition-all duration-300"
              style={{ right: rightCollapsed ? '16px' : `${rightSidebarWidth + 16}px` }}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col gap-1.5 rounded-lg border border-blue-500/30 bg-black/90 backdrop-blur-xl shadow-lg p-2 min-w-[200px]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-blue-400 font-semibold uppercase tracking-wider">
                    {selectedSegments.size > 0
                      ? `${selectedSegments.size} segment${selectedSegments.size !== 1 ? 's' : ''} selected`
                      : 'Area selected'}
                  </span>
                  <button
                    onClick={() => { setSelectedSegments(new Set()); setSelectionBounds(null); setShowAreaSimplify(false); setAreaSimplifyPreview(null); }}
                    className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:text-white hover:bg-white/10 transition-colors"
                    title="Deselect (Esc)"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                </div>
                {selectedSegments.size > 0 && (
                  <span className="text-[9px] text-neutral-500">
                    across {new Set(Array.from(selectedSegments).map(k => k.split("-")[0])).size} stroke{new Set(Array.from(selectedSegments).map(k => k.split("-")[0])).size !== 1 ? 's' : ''}
                  </span>
                )}
                <span className="text-[9px] text-neutral-500 font-mono tabular-nums">
                  {Math.round(selectionBounds.w)}×{Math.round(selectionBounds.h)} at ({Math.round(selectionBounds.x)}, {Math.round(selectionBounds.y)})
                </span>

                <button
                  onClick={() => { log('[ui] Trace Area clicked'); handleRetraceArea(); }}
                  disabled={isTracing}
                  className="w-full px-2 py-1.5 text-[10px] font-semibold bg-blue-600/80 text-white rounded hover:bg-blue-500 disabled:opacity-50 transition-colors"
                >
                  {isTracing ? 'Tracing…' : 'Trace Area'}
                </button>

                {selectedSegments.size > 0 && (
                  <button
                    onClick={() => { log('[ui] Inflate clicked'); inflateSelectedHandles(); }}
                    className="w-full px-2 py-1.5 text-[10px] font-semibold bg-purple-600/80 text-white rounded hover:bg-purple-500 transition-colors"
                  >
                    Inflate Handles
                  </button>
                )}

                {selectedSegments.size > 0 && !showAreaSimplify && (
                  <button
                    onClick={() => { log('[ui] Simplify clicked'); setShowAreaSimplify(true); }}
                    className="w-full px-2 py-1.5 text-[10px] font-semibold bg-cyan-600/80 text-white rounded hover:bg-cyan-500 transition-colors"
                  >
                    Simplify Selection
                  </button>
                )}

                {showAreaSimplify && selectedSegments.size > 0 && (
                  <div className="space-y-2 pt-1 border-t border-neutral-800">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-cyan-400 font-semibold uppercase tracking-wider">Simplify</span>
                      {areaSimplifyPreview && (
                        <span className="text-neutral-400 font-mono tabular-nums">
                          {selectedSegments.size} → {Array.from(areaSimplifyPreview.values()).reduce((s, v) => s + v.length, 0)} segs
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-neutral-500 w-12">Tol: {areaSimplifyTolerance}</span>
                      <input
                        type="range"
                        min={1}
                        max={20}
                        step={0.5}
                        value={areaSimplifyTolerance}
                        onChange={(e) => setAreaSimplifyTolerance(Number(e.target.value))}
                        className="flex-1 h-1"
                      />
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={commitAreaSimplify}
                        disabled={!areaSimplifyPreview}
                        className="flex-1 px-2 py-1 text-[9px] font-semibold bg-cyan-600 text-white rounded hover:bg-cyan-500 disabled:opacity-50 transition-colors"
                      >
                        Apply
                      </button>
                      <button
                        onClick={() => { setShowAreaSimplify(false); setAreaSimplifyPreview(null); }}
                        className="flex-1 px-2 py-1 text-[9px] font-semibold bg-neutral-800 text-neutral-400 rounded hover:bg-neutral-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

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
                      <span className="font-mono text-xs text-neutral-400">{traceOptions.errorTolerance}</span>
                    </div>
                    <input type="range" min={1} max={20} step={0.5} value={traceOptions.errorTolerance} onChange={(e) => setTraceOptions(prev => ({ ...prev, errorTolerance: Number(e.target.value) }))} className="w-full" />
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
                      onClick={() => startProjectFromImage(projectImage)}
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
            <span>{projectName || (projectImage ? projectImage.name : "talkie-bezier.json")}</span>
            <span className={`ml-2 text-[10px] transition-colors ${
              saveStatus === "saved" ? "text-green-400" : saveStatus === "saving" ? "text-blue-400" : saveStatus === "error" ? "text-red-400" : "text-neutral-600"
            }`}>
              {saveStatus === "saved" ? `saved (${bezierData?.strokes.length ?? 0} strokes)` : saveStatus === "saving" ? "saving..." : saveStatus === "error" ? "save error" : ""}
            </span>
          </>
        }
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: "stroke:left x>500 y<300 ...",
        }}
      />

      {/* Left SidePanel — Project */}
      {showEditor && (
        <SidePanel
          side="left"
          title="Project"
          isCollapsed={leftCollapsed}
          onToggleCollapse={() => setLeftCollapsed((v) => !v)}
          width={leftSidebarWidth}
          onResizeStart={handleLeftSidebarResizeStart}
          style={{
            bottom: `${28 + (isTerminalOpen ? (isTerminalMaximized ? window.innerHeight - 28 : 320) : 0)}px`,
            transition: 'bottom 0.3s ease-in-out'
          }}
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
                      <button onClick={() => { setShowSaveAsModal(true); setShowActionsMenu(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-neutral-400 hover:bg-white/5 hover:text-white transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg>
                        Save As...
                        <span className="ml-auto text-[9px] text-neutral-600 font-mono">Cmd+Shift+S</span>
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
              <div className="px-3 pt-3 pb-3 space-y-0.5">
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
              <div className="px-3 pt-3 pb-3 space-y-0.5">
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
          width={rightSidebarWidth}
          onResizeStart={handleRightSidebarResizeStart}
          style={{
            bottom: `${28 + (isTerminalOpen ? (isTerminalMaximized ? window.innerHeight - 28 : 320) : 0)}px`,
            transition: 'bottom 0.3s ease-in-out'
          }}
        >
          {/* Selected Point */}
          {selectedPointData && (
            <div className="border-b border-neutral-800/50">
              <div className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 bg-neutral-900/30">
                <button onClick={() => toggleSection("selected")} className="flex items-center gap-2 flex-1 hover:text-neutral-300 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 shrink-0"><circle cx="12" cy="12" r="3"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="m16.24 7.76 2.83-2.83"/></svg>
                  <span className="flex-1 text-left">Selected Point</span>
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-600 transition-transform ${openSections.selected ? 'rotate-0' : '-rotate-90'}`}><path d="m6 9 6 6 6-6"/></svg>
                </button>
                <div className="flex items-center gap-0.5">
                  <button onClick={focusOnSelected} title="Focus on point" className="p-1.5 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M3 12h3m15 0h3M12 3v3m0 15v3M6.34 6.34l2.12 2.12m11.08 11.08l2.12 2.12M6.34 17.66l2.12-2.12m11.08-11.08l2.12-2.12"/></svg>
                  </button>
                  <button onClick={deleteSelectedPoint} title="Delete point (Backspace)" className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                  </button>
                </div>
              </div>
              {openSections.selected && (
                <div className="px-3 pt-3 pb-3 space-y-1.5 ml-2">
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
              <span className="text-[9px] text-neutral-600 font-normal">
                {filteredAnchors.length !== anchorsData?.anchors.length
                  ? `${filteredAnchors.length}/${anchorsData?.anchors.length ?? 0}`
                  : `${anchorsData?.anchors.length ?? 0}`
                }
              </span>
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-600 transition-transform ${openSections.anchors ? 'rotate-0' : '-rotate-90'}`}><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {openSections.anchors && (
              <div className="px-3 pt-3 pb-3 space-y-0.5">
                {/* Search syntax hint (only shown when searching) */}
                {searchQuery.trim() && (
                  <div className="text-[9px] text-neutral-600 font-mono px-2 py-1 bg-neutral-900/50 rounded border border-neutral-800/50">
                    {filteredAnchors.length} match{filteredAnchors.length === 1 ? '' : 'es'}
                    {searchQuery.includes('stroke:') && <span className="ml-1 text-blue-400">• stroke filter</span>}
                    {(searchQuery.includes('x>') || searchQuery.includes('x<')) && <span className="ml-1 text-blue-400">• x filter</span>}
                    {(searchQuery.includes('y>') || searchQuery.includes('y<')) && <span className="ml-1 text-blue-400">• y filter</span>}
                  </div>
                )}

                {/* Anchor list with resize handle */}
                <div className="relative">
                  <div
                    className="overflow-y-auto space-y-0.5 frame-scrollbar"
                    style={{ height: `${anchorListHeight}px` }}
                  >
                    {filteredAnchors.length === 0 ? (
                      <div className="text-xs text-neutral-600 py-4 space-y-1">
                        <div className="text-center">No anchors found</div>
                        <div className="text-[9px] font-mono text-neutral-700 text-center">
                          Try: stroke:left x&gt;500 y&lt;300
                        </div>
                      </div>
                    ) : (
                      filteredAnchors.map((anchor, i) => {
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
                      })
                    )}
                  </div>

                  {/* Resize handle */}
                  <div
                    onMouseDown={handleAnchorResizeStart}
                    className={`
                      h-1 -mx-3 cursor-ns-resize flex items-center justify-center
                      border-t border-neutral-800/50 hover:border-neutral-600/50
                      transition-colors group
                      ${isResizingAnchors ? 'bg-blue-500/10 border-blue-500/50' : 'hover:bg-neutral-800/30'}
                    `}
                    title="Drag to resize"
                  >
                    <div className="w-8 h-0.5 rounded-full bg-neutral-700 group-hover:bg-neutral-500 transition-colors" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Segments (Feature 6) */}
          <div className="border-b border-neutral-800/50">
            <button onClick={() => toggleSection("segments")} className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 bg-neutral-900/30 hover:bg-neutral-900/50 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-600 shrink-0"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>
              <span className="flex-1 text-left">Segments</span>
              <span className="text-[9px] text-neutral-600 font-normal">{bezierData?.strokes.reduce((s, st) => s + st.length, 0) || 0}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-600 transition-transform ${openSections.segments ? 'rotate-0' : '-rotate-90'}`}><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {openSections.segments && bezierData && (
              <div className="px-3 pt-2 pb-3 space-y-1 max-h-80 overflow-y-auto frame-scrollbar">
                {/* Simplify tool controls */}
                {simplifyMode && simplifyStrokeIndex !== null && (
                  <div className="mb-2 p-2 bg-cyan-500/5 border border-cyan-500/20 rounded-lg space-y-2">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-cyan-400 font-semibold uppercase tracking-wider">Simplify Stroke {simplifyStrokeIndex}</span>
                      <span className="text-neutral-400 font-mono tabular-nums">
                        {bezierData.strokes[simplifyStrokeIndex]?.length || 0} → {simplifyPreview?.length || '?'} segments
                        {simplifyPreview && bezierData.strokes[simplifyStrokeIndex] && (
                          <span className="text-cyan-400 ml-1">
                            (-{Math.round((1 - simplifyPreview.length / bezierData.strokes[simplifyStrokeIndex].length) * 100)}%)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-neutral-500 w-12">Tol: {simplifyTolerance}</span>
                      <input
                        type="range"
                        min={1}
                        max={20}
                        step={0.5}
                        value={simplifyTolerance}
                        onChange={(e) => setSimplifyTolerance(Number(e.target.value))}
                        className="flex-1 h-1"
                      />
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={commitSimplify}
                        disabled={!simplifyPreview}
                        className="flex-1 px-2 py-1 text-[9px] font-semibold bg-cyan-600 text-white rounded hover:bg-cyan-500 disabled:opacity-50 transition-colors"
                      >
                        Apply
                      </button>
                      <button
                        onClick={() => { setSimplifyMode(false); setSimplifyPreview(null); setSimplifyStrokeIndex(null); }}
                        className="flex-1 px-2 py-1 text-[9px] font-semibold bg-neutral-800 text-neutral-400 rounded hover:bg-neutral-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {segmentInfos.map((strokeSegs, si) => (
                  <div key={si}>
                    {/* Stroke header */}
                    <button
                      onClick={() => setExpandedStrokes(prev => ({ ...prev, [si]: !prev[si] }))}
                      className="w-full flex items-center gap-1.5 px-1.5 py-1 text-[10px] text-neutral-400 hover:text-neutral-200 hover:bg-white/5 rounded transition-colors"
                    >
                      <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: Object.values(strokeColors)[si % Object.values(strokeColors).length] || "#888" }} />
                      <span className="flex-1 text-left font-medium">Stroke {si}</span>
                      <span className="text-[9px] text-neutral-600">{strokeSegs.length} seg</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSimplifyMode(true); setSimplifyStrokeIndex(si); }}
                        className="px-1 py-0.5 text-[8px] text-cyan-500 hover:text-cyan-300 hover:bg-cyan-500/10 rounded transition-colors"
                        title="Simplify stroke"
                      >
                        Simplify
                      </button>
                      <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-600 transition-transform ${expandedStrokes[si] ? 'rotate-0' : '-rotate-90'}`}><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                    {/* Segment rows */}
                    {expandedStrokes[si] && strokeSegs.map((info) => {
                      const isSelected = selectedSegment?.strokeIndex === si && selectedSegment?.segmentIndex === info.segmentIndex;
                      return (
                        <div
                          key={`${si}-${info.segmentIndex}`}
                          className={`flex items-center gap-1.5 px-2 py-0.5 ml-3 text-[9px] rounded cursor-pointer transition-colors ${
                            isSelected ? 'bg-yellow-500/10 text-yellow-300' : 'text-neutral-500 hover:bg-white/5 hover:text-neutral-300'
                          }`}
                          onClick={() => setSelectedSegment(isSelected ? null : { strokeIndex: si, segmentIndex: info.segmentIndex })}
                        >
                          <span className="font-mono w-4 text-right">{info.segmentIndex}</span>
                          <span className="flex-1 font-mono truncate">{info.start[0]},{info.start[1]} → {info.end[0]},{info.end[1]}</span>
                          <span className="text-neutral-600 font-mono">{info.length}px</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteSegment(si, info.segmentIndex); }}
                            className="p-0.5 text-neutral-700 hover:text-red-400 transition-colors"
                            title="Delete segment"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Fill */}
          <div className="border-b border-neutral-800/50">
            <button onClick={() => toggleSection("fill")} className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 bg-neutral-900/30 hover:bg-neutral-900/50 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-600 shrink-0"><path d="m4 16 6-6 6 6"/><path d="m14 10 4.3 4.3c.6.6.6 1.5 0 2.1l-2.6 2.6c-.6.6-1.5.6-2.1 0L10 14"/><path d="M7 21h10"/></svg>
              <span className="flex-1 text-left">Fill</span>
              {fillEnabled && <span className="text-[9px] text-blue-400 font-normal">Enabled</span>}
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-600 transition-transform ${openSections.fill ? 'rotate-0' : '-rotate-90'}`}><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {openSections.fill && (
              <div className="px-3 pt-3 pb-3 space-y-3 ml-2">
                {/* Master toggle */}
                <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer hover:text-neutral-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={fillEnabled}
                    onChange={(e) => setFillEnabled(e.target.checked)}
                    className="rounded"
                  />
                  <span>Enable Fill</span>
                </label>

                {fillEnabled && bezierData && (
                  <div className="space-y-1.5">
                    {/* Quick actions */}
                    <div className="flex gap-1">
                      <button
                        onClick={() => setStrokeFills(prev => {
                          const next = { ...prev };
                          for (let i = 0; i < bezierData.strokes.length; i++) {
                            next[i] = { ...(next[i] || { color: pathColor, opacity: 0.5 }), enabled: true };
                          }
                          return next;
                        })}
                        className="flex-1 px-2 py-0.5 text-[9px] text-neutral-500 hover:text-neutral-300 bg-neutral-800/50 hover:bg-neutral-800 rounded border border-neutral-700/50 transition-colors"
                      >
                        All On
                      </button>
                      <button
                        onClick={() => setStrokeFills(prev => {
                          const next = { ...prev };
                          for (let i = 0; i < bezierData.strokes.length; i++) {
                            next[i] = { ...(next[i] || { color: pathColor, opacity: 0.5 }), enabled: false };
                          }
                          return next;
                        })}
                        className="flex-1 px-2 py-0.5 text-[9px] text-neutral-500 hover:text-neutral-300 bg-neutral-800/50 hover:bg-neutral-800 rounded border border-neutral-700/50 transition-colors"
                      >
                        All Off
                      </button>
                    </div>
                    {bezierData.strokes.map((_, i) => {
                      const sf = strokeFills[i] || { enabled: true, color: pathColor, opacity: 0.5 };
                      const strokeName = strokeGroups[i] ? strokeGroups[i][0] : `Stroke ${i}`;
                      const strokeColor = strokeGroups[i] ? (strokeColors[strokeGroups[i][0]] || "#888") : Object.values(strokeColors)[i % Object.values(strokeColors).length] || "#888";
                      return (
                        <div key={i} className="flex items-center gap-2 text-[10px]">
                          <input
                            type="checkbox"
                            checked={sf.enabled}
                            onChange={(e) => setStrokeFills(prev => ({ ...prev, [i]: { ...sf, enabled: e.target.checked } }))}
                            className="rounded"
                          />
                          <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: strokeColor }} />
                          <span className="text-neutral-400 flex-1 truncate">{strokeName}</span>
                          <input
                            type="color"
                            value={sf.color}
                            onChange={(e) => setStrokeFills(prev => ({ ...prev, [i]: { ...sf, color: e.target.value } }))}
                            className="w-5 h-5 rounded border border-neutral-700 cursor-pointer bg-transparent"
                            title="Fill color"
                          />
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={Math.round(sf.opacity * 100)}
                            onChange={(e) => setStrokeFills(prev => ({ ...prev, [i]: { ...sf, opacity: Number(e.target.value) / 100 } }))}
                            className="w-16 h-1"
                            title={`${Math.round(sf.opacity * 100)}%`}
                          />
                          <span className="text-neutral-600 tabular-nums w-7 text-right font-mono">{Math.round(sf.opacity * 100)}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Trace */}
          <div className="border-b border-neutral-800/50">
            <button onClick={() => toggleSection("trace")} className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 bg-neutral-900/30 hover:bg-neutral-900/50 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-600 shrink-0"><path d="M2 12h2"/><path d="M6 12h2"/><path d="M10 12h2"/><path d="M14 12h2"/><path d="M18 12h2"/><path d="M22 12h2"/></svg>
              <span className="flex-1 text-left">Trace</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-600 transition-transform ${openSections.trace ? 'rotate-0' : '-rotate-90'}`}><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {openSections.trace && (
              <div className="px-3 pt-3 pb-3 space-y-3 ml-2">
                {/* Error tolerance */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-neutral-600 uppercase tracking-wider font-semibold">Error Tolerance</span>
                    <span className="font-mono text-xs text-neutral-400 tabular-nums">{traceOptions.errorTolerance}</span>
                  </div>
                  <input type="range" min={1} max={20} step={0.5} value={traceOptions.errorTolerance} onChange={(e) => setTraceOptions(prev => ({ ...prev, errorTolerance: Number(e.target.value) }))} className="w-full h-1" />
                  <p className="text-[10px] text-neutral-600">Lower = more detail. Higher = smoother.</p>
                </div>
                {/* Edge detection */}
                <div className="space-y-1">
                  <div className="text-[9px] text-neutral-600 uppercase tracking-wider font-semibold">Edge Detection</div>
                  <div className="flex gap-1">
                    {(['auto', 'otsu', 'canny', 'alpha'] as const).map((mode) => (
                      <button key={mode} onClick={() => setTraceOptions(prev => ({ ...prev, edgeDetection: mode }))} className={`flex-1 px-2 py-1 rounded text-[9px] font-semibold transition-all ${traceOptions.edgeDetection === mode ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'bg-neutral-800/50 text-neutral-500 border border-neutral-700/50 hover:bg-neutral-800 hover:text-neutral-300'}`}>
                        {mode === 'auto' ? 'Auto' : mode === 'otsu' ? 'Otsu' : mode === 'canny' ? 'Canny' : 'Alpha'}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Simplification */}
                <div className="space-y-1">
                  <div className="text-[9px] text-neutral-600 uppercase tracking-wider font-semibold">Simplification</div>
                  <div className="flex gap-1">
                    {(['rdp', 'none'] as const).map((mode) => (
                      <button key={mode} onClick={() => setTraceOptions(prev => ({ ...prev, simplification: mode }))} className={`flex-1 px-2 py-1 rounded text-[9px] font-semibold transition-all ${traceOptions.simplification === mode ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'bg-neutral-800/50 text-neutral-500 border border-neutral-700/50 hover:bg-neutral-800 hover:text-neutral-300'}`}>
                        {mode === 'rdp' ? 'RDP' : 'None'}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Curve fit */}
                <div className="space-y-1">
                  <div className="text-[9px] text-neutral-600 uppercase tracking-wider font-semibold">Curve Fit</div>
                  <div className="flex gap-1">
                    {(['schneider', 'polyline'] as const).map((mode) => (
                      <button key={mode} onClick={() => setTraceOptions(prev => ({ ...prev, curveFit: mode }))} className={`flex-1 px-2 py-1 rounded text-[9px] font-semibold transition-all ${traceOptions.curveFit === mode ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'bg-neutral-800/50 text-neutral-500 border border-neutral-700/50 hover:bg-neutral-800 hover:text-neutral-300'}`}>
                        {mode === 'schneider' ? 'Schneider' : 'Polyline'}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Max contours */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-neutral-600 uppercase tracking-wider font-semibold">Max Contours</span>
                    <span className="font-mono text-xs text-neutral-400 tabular-nums">{traceOptions.maxContours}</span>
                  </div>
                  <input type="range" min={1} max={30} step={1} value={traceOptions.maxContours} onChange={(e) => setTraceOptions(prev => ({ ...prev, maxContours: Number(e.target.value) }))} className="w-full h-1" />
                </div>
                {/* Resolution */}
                <div className="space-y-1">
                  <div className="text-[9px] text-neutral-600 uppercase tracking-wider font-semibold">Resolution</div>
                  <div className="flex gap-1">
                    {([{ id: 'auto' as const, label: 'Auto' }, { id: 256 as const, label: '256' }, { id: 512 as const, label: '512' }, { id: 640 as const, label: '640' }, { id: 1024 as const, label: '1024' }]).map((opt) => (
                      <button key={String(opt.id)} onClick={() => setTraceOptions(prev => ({ ...prev, resolution: opt.id }))} className={`flex-1 px-2 py-1 rounded text-[9px] font-semibold transition-all ${traceOptions.resolution === opt.id ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'bg-neutral-800/50 text-neutral-500 border border-neutral-700/50 hover:bg-neutral-800 hover:text-neutral-300'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Re-trace button */}
                <button
                  onClick={handleRetrace}
                  disabled={isTracing || (!projectImage && !bezierData)}
                  className={`w-full rounded-lg px-4 py-2 text-xs font-medium transition-colors ${
                    isTracing
                      ? 'bg-blue-600/20 text-blue-400 cursor-wait'
                      : (!projectImage && !bezierData)
                        ? 'bg-neutral-800/50 text-neutral-600 cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-500'
                  }`}
                >
                  {isTracing ? 'Tracing...' : 'Re-trace'}
                </button>
                {/* Trace info readout */}
                {traceInfo && (
                  <div className="pt-2 border-t border-neutral-800/50 space-y-1">
                    <div className="text-[9px] text-neutral-600 uppercase tracking-wider font-semibold">Last Trace</div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                      <span className="text-neutral-500">Image type</span>
                      <span className="text-neutral-400 font-mono">{traceInfo.imageKind}</span>
                      <span className="text-neutral-500">Contours</span>
                      <span className="text-neutral-400 font-mono">{traceInfo.contourCount}</span>
                      <span className="text-neutral-500">Segments</span>
                      <span className="text-neutral-400 font-mono">{traceInfo.pointCount}</span>
                      <span className="text-neutral-500">Time</span>
                      <span className="text-neutral-400 font-mono">{traceInfo.lastTraceMs}ms</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Animation */}
          <div className="border-b border-neutral-800/50">
            <button onClick={() => toggleSection("animation")} className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 bg-neutral-900/30 hover:bg-neutral-900/50 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-600 shrink-0"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span className="flex-1 text-left">Animation</span>
              {animationModeEnabled && <span className="text-[9px] text-blue-400 font-normal">Mode Enabled</span>}
              {isAnimating && <span className="text-[9px] text-emerald-500 font-normal">Playing</span>}
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-600 transition-transform ${openSections.animation ? 'rotate-0' : '-rotate-90'}`}><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {openSections.animation && (
              <div className="px-3 pt-3 pb-3 space-y-3 ml-2">
                {!animationModeEnabled && (
                  <div className="text-[10px] text-neutral-600 text-center py-2 border border-neutral-800/50 rounded bg-neutral-900/20">
                    Enable animation mode (▶) to access timeline controls
                  </div>
                )}

                {/* Animation options */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer hover:text-neutral-300 transition-colors">
                    <input
                      type="checkbox"
                      checked={showAnimationHandles}
                      onChange={(e) => setShowAnimationHandles(e.target.checked)}
                      className="rounded"
                    />
                    <span>Show construction handles</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer hover:text-neutral-300 transition-colors">
                    <input
                      type="checkbox"
                      checked={showAnimationAngles}
                      onChange={(e) => setShowAnimationAngles(e.target.checked)}
                      className="rounded"
                    />
                    <span>Show angle measurements</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer hover:text-neutral-300 transition-colors">
                    <input
                      type="checkbox"
                      checked={animationEasing}
                      onChange={(e) => setAnimationEasing(e.target.checked)}
                      className="rounded"
                    />
                    <span>Ease around corners</span>
                    <span className="ml-auto text-[9px] text-neutral-600">(coming soon)</span>
                  </label>

                  {/* Handle customization */}
                  {showAnimationHandles && (
                    <div className="pt-2 pl-4 border-l-2 border-blue-500/20 space-y-2">
                      <div className="text-[9px] text-neutral-600 uppercase tracking-wider font-semibold">Handle Settings</div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="text-neutral-500">Opacity</span>
                          <span className="text-neutral-400 font-mono tabular-nums">{Math.round(handleOpacity * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0.1}
                          max={1}
                          step={0.05}
                          value={handleOpacity}
                          onChange={(e) => setHandleOpacity(Number(e.target.value))}
                          className="w-full h-1"
                        />
                      </div>
                    </div>
                  )}

                  {/* Angle customization */}
                  {showAnimationAngles && (
                    <div className="pt-2 pl-4 border-l-2 border-blue-500/20 space-y-2">
                      <div className="text-[9px] text-neutral-600 uppercase tracking-wider font-semibold">Angle Settings</div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="text-neutral-500">Arc Radius</span>
                          <span className="text-neutral-400 font-mono tabular-nums">{angleArcRadius}px</span>
                        </div>
                        <input
                          type="range"
                          min={10}
                          max={40}
                          step={2}
                          value={angleArcRadius}
                          onChange={(e) => setAngleArcRadius(Number(e.target.value))}
                          className="w-full h-1"
                        />
                      </div>

                      <label className="flex items-center gap-2 text-[10px] text-neutral-500 cursor-pointer hover:text-neutral-400 transition-colors">
                        <input
                          type="checkbox"
                          checked={showAngleReference}
                          onChange={(e) => setShowAngleReference(e.target.checked)}
                          className="rounded"
                        />
                        <span>Show reference lines</span>
                      </label>
                    </div>
                  )}
                </div>
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
              <div className="px-3 pt-3 pb-3 space-y-2 ml-2">
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


          {/* Info */}
          <div>
            <button onClick={() => toggleSection("info")} className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 bg-neutral-900/30 hover:bg-neutral-900/50 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-600 shrink-0"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
              <span className="flex-1 text-left">Info</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-neutral-600 transition-transform ${openSections.info ? 'rotate-0' : '-rotate-90'}`}><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {openSections.info && (
              <div className="px-3 pt-3 pb-3 space-y-1 text-xs ml-2">
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
        <div style={{
          position: 'fixed',
          bottom: `${40 + (animationModeEnabled ? 64 : 0) + (isTerminalOpen ? (isTerminalMaximized ? window.innerHeight - 28 : 320) : 0)}px`,
          right: rightCollapsed ? '16px' : `${rightSidebarWidth + 16}px`,
          transition: 'bottom 0.3s ease-in-out, right 0.3s ease-in-out',
          zIndex: 30,
        }}>
          <ZoomControls
            scale={zoom}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onReset={resetZoom}
            className="pointer-events-auto flex flex-col items-center gap-0.5 bg-neutral-900/70 backdrop-blur-md border border-neutral-700/50 rounded-md shadow-lg shadow-black/30"
          />
        </div>
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

      {/* AnimationTimeline - shown when animation mode is enabled */}
      {animationModeEnabled && (
        <AnimationTimeline
          isPlaying={isAnimating}
          progress={animationProgress}
          speed={animationSpeed}
          onPlayPause={() => setIsAnimating(!isAnimating)}
          onReset={() => { setIsAnimating(false); setAnimationProgress(0); }}
          onProgressChange={(progress) => { setIsAnimating(false); setAnimationProgress(progress); }}
          onSpeedChange={(speed) => setAnimationSpeed(speed)}
          style={{
            left: `${leftCollapsed ? 0 : leftSidebarWidth}px`,
            right: `${rightCollapsed ? 0 : rightSidebarWidth}px`,
            bottom: `${28 + (isTerminalOpen ? (isTerminalMaximized ? window.innerHeight - 28 : 320) : 0)}px`,
            transition: 'bottom 0.3s ease-in-out, left 0.3s ease-in-out, right 0.3s ease-in-out'
          }}
        />
      )}

      {/* StatusBar */}
      <div style={{
        position: 'fixed',
        bottom: `${isTerminalOpen ? (isTerminalMaximized ? window.innerHeight - 28 : 320) : 0}px`,
        left: 0,
        right: 0,
        zIndex: 60,
        transition: 'bottom 0.3s ease-in-out'
      }}>
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
      </div>

      {/* Context Menu (Feature 3) */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-[71] w-44 bg-black/95 backdrop-blur-xl border border-neutral-800 rounded-lg shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="py-1">
              <button
                onClick={() => {
                  setSelectedPoint({ strokeIndex: contextMenu.strokeIndex, segmentIndex: contextMenu.segmentIndex, pointType: contextMenu.pointType });
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-neutral-400 hover:bg-white/5 hover:text-white transition-colors"
              >
                <MousePointer2 size={12} />
                Select
              </button>
              <button
                onClick={() => {
                  const key = `${contextMenu.strokeIndex}-${contextMenu.segmentIndex}-${contextMenu.pointType}`;
                  setSmoothStates(prev => ({ ...prev, [key]: !prev[key] }));
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-neutral-400 hover:bg-white/5 hover:text-white transition-colors"
              >
                <span className={`inline-block h-2 w-2 rounded-full ${smoothStates[`${contextMenu.strokeIndex}-${contextMenu.segmentIndex}-${contextMenu.pointType}`] ? 'bg-green-500' : 'bg-red-500'}`} />
                {smoothStates[`${contextMenu.strokeIndex}-${contextMenu.segmentIndex}-${contextMenu.pointType}`] ? 'Make Corner' : 'Make Smooth'}
              </button>
              <button
                onClick={() => {
                  const seg = bezierData?.strokes[contextMenu.strokeIndex]?.[contextMenu.segmentIndex];
                  if (seg) {
                    const pt = seg[contextMenu.pointType];
                    focusOnPoint(pt[0], pt[1]);
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-neutral-400 hover:bg-white/5 hover:text-white transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M3 12h3m15 0h3M12 3v3m0 15v3"/></svg>
                Focus
              </button>
              <div className="h-px bg-neutral-800 my-1" />
              <button
                onClick={() => {
                  setSelectedPoint({ strokeIndex: contextMenu.strokeIndex, segmentIndex: contextMenu.segmentIndex, pointType: contextMenu.pointType });
                  // Defer delete to next tick so selectedPoint is set
                  setTimeout(() => deleteSelectedPoint(), 0);
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                Delete Point
              </button>
            </div>
          </div>
        </>
      )}

      {/* Selection Context Menu */}
      {selectionContextMenu && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setSelectionContextMenu(null)} />
          <div
            className="fixed z-[71] w-48 bg-black/95 backdrop-blur-xl border border-neutral-800 rounded-lg shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100"
            style={{ left: selectionContextMenu.x, top: selectionContextMenu.y }}
          >
            <div className="py-1">
              <button
                onClick={() => {
                  log('[ui] ctx: Trace area clicked');
                  handleRetraceArea();
                }}
                disabled={isTracing || !selectionBounds}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-neutral-400 hover:bg-white/5 hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                {isTracing ? 'Tracing…' : 'Trace area'}
              </button>
              {selectedSegments.size > 0 && (
                <button
                  onClick={() => {
                    log('[ui] ctx: Inflate clicked');
                    inflateSelectedHandles();
                    setSelectionContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-neutral-400 hover:bg-white/5 hover:text-white transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12 4-4 4 4"/><path d="m8 12 4 4 4-4"/></svg>
                  Inflate Handles
                </button>
              )}
              {selectedSegments.size > 0 && (
                <button
                  onClick={() => {
                    log('[ui] ctx: Simplify clicked');
                    setSelectionContextMenu(null);
                    setShowAreaSimplify(true);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-neutral-400 hover:bg-white/5 hover:text-white transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.855z"/></svg>
                  Simplify
                </button>
              )}
              <div className="h-px bg-neutral-800 my-1" />
              <button
                onClick={() => {
                  setSelectionContextMenu(null);
                  setSelectedSegments(new Set());
                  setSelectionBounds(null);
                  setShowAreaSimplify(false);
                  setAreaSimplifyPreview(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] text-neutral-400 hover:bg-white/5 hover:text-white transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                Deselect
              </button>
            </div>
          </div>
        </>
      )}

      {/* Save As Modal (Feature 4) */}
      {showSaveAsModal && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm" onClick={() => setShowSaveAsModal(false)} />
          <div className="fixed inset-0 z-[81] flex items-center justify-center pointer-events-none">
            <div className="pointer-events-auto w-80 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-neutral-800">
                <h3 className="text-sm font-semibold text-neutral-200">Save As</h3>
                <p className="text-[10px] text-neutral-500 mt-0.5">Save a named copy of this project</p>
              </div>
              <form
                className="p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const input = (e.target as HTMLFormElement).elements.namedItem('projectName') as HTMLInputElement;
                  const name = input.value.trim();
                  if (name) confirmSaveAs(name);
                }}
              >
                <input
                  name="projectName"
                  type="text"
                  autoFocus
                  placeholder="Project name..."
                  defaultValue={projectName || projectImage?.name?.replace(/\.[^.]+$/, '') || ''}
                  className="w-full rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-600 focus:border-blue-500 focus:outline-none"
                />
                <div className="flex justify-end gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => setShowSaveAsModal(false)}
                    className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white transition-colors rounded-md hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-500 transition-colors"
                  >
                    Save
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}

      {/* CommandPalette */}
      <CommandPalette
        isOpen={isCmdPaletteOpen}
        onClose={() => setIsCmdPaletteOpen(false)}
        commands={commands}
      />
    </div>
  );
}
