# Shaper

Interactive bezier curve editor for logo design. Loads bezier path data and anchor points from JSON, renders them on an SVG canvas overlaid on the original logo image, and allows interactive editing.

## Commands

```bash
pnpm dev          # Start dev server (http://localhost:3000)
pnpm build        # Production build (validates types)
pnpm lint         # ESLint
```

## Architecture

Next.js 16 app (App Router). The editor is being migrated from a single-file component (`page.tsx`) into a Hudson app at `src/hudson/`.

### Shared libraries (`src/lib/`) — single source of truth

- `src/lib/bezier-fit.ts` — Schneider's cubic bezier fitting + `traceFromImage()`. Accepts `TraceOptions`, returns `TraceResult`. Used by both `page.tsx` and `ShaperProvider`.
- `src/lib/contour.ts` — Marching squares, Otsu threshold, Canny edge detection, RDP simplification.

### Hudson app (`src/hudson/`) — active development

- `src/hudson/index.ts` — App registration: exports `shaperApp` (HudsonApp object), tools, manifest, intents.
- `src/hudson/ShaperProvider.tsx` — All state, handlers, and computed values in a single React context (~1400 lines). Imports trace from `@/lib/bezier-fit`.
- `src/hudson/types.ts` — Shared types: `BezierData`, `TraceOptions`, `ProjectMeta`, etc. Also used by `src/lib/bezier-fit.ts`.
- `src/hudson/hooks.ts` — Hudson shell hooks: commands, status, search, nav, active tool hint.
- `src/hudson/intents.ts` — LLM/voice/search intent descriptors for command palette.
- `src/hudson/tools/TraceTool.tsx` — Trace pipeline settings panel (tolerance, edge detection, simplification, curve fit, resolution).
- `src/hudson/components/DropZone.tsx` — Image import drop zone with preview and trace trigger.
- `src/hudson/HUDSON.md` — Full Hudson integration guide (contracts, patterns, conventions).

### App routes (`src/app/`) — still renders at `/`

- `src/app/page.tsx` — Original single-file component. Still the active route, uses its own state. Imports trace from `@/lib/bezier-fit`.
- `src/app/api/save/route.ts` — POST endpoint shared by both `page.tsx` and `ShaperProvider`. Writes to `public/` (legacy) or `public/projects/{id}/` (Hudson projects).

### Data files (public/)

- `talkie-bezier.json` — Bezier curve data (strokes → segments, each with p0/c1/c2/p3). This is the primary file being edited and auto-saved.
- `talkie-anchors.json` — Named anchor points and shared cross-stroke junction declarations.
- `talkie-smooth.json` — Smooth/corner state per anchor point.
- `talkie-original.png` — Original logo image (1024×1024).
- `talkie-silhouette.png` — Silhouette for re-tracing (1024×1024 RGBA, alpha channel defines shape).

## Key concepts

- **Connection map**: Built with `useMemo`, links anchor points across strokes that are within 2px of each other. Dragging one anchor moves all linked points.
- **Smooth vs corner points**: Alt+click toggles. Smooth points (green) enforce symmetric handles; corner points (red) allow independent handle movement.
- **Drag behavior**: Handles move WITH anchors by default (Illustrator-style). Hold Shift to move anchor without handles.
- **Auto-save**: 2-second debounce writes to disk via `/api/save`. No localStorage.
- **Undo/redo**: JSON snapshot history (max 100 states), 300ms debounce.
- **Re-trace**: Client-side pipeline: load silhouette → alpha-channel mask → marching squares → RDP → Schneider bezier fit. The silhouette uses RGBA where opaque pixels = foreground (not RGB luminance).
- **Image drop zone**: Drag-and-drop (or click-to-browse) any logo image to start a new project. Two-stage flow: drop image → preview with specs/warnings + error tolerance slider → "Extract Shapes" runs the trace pipeline. Supports PNG, SVG, JPEG, WebP. Validates dimensions and warns about non-square, too-small, or too-large images. PNGs use alpha channel; JPEGs fall back to Otsu threshold.

## Conventions

- Tailwind CSS for all styling (v4, via PostCSS)
- No external UI component libraries
- pnpm as package manager
- Gitmoji in commit messages
- No `alert()` or `confirm()` dialogs
- Canvas is 1024×1024, SVG viewBox matches
- All coordinates are in canvas space (0–1024)
- API routes are flat under `/api/` — no per-app prefixes. Hudson apps share the host app's API namespace.
