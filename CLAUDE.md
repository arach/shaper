# Shaper

Interactive bezier curve editor for logo design. Loads bezier path data and anchor points from JSON, renders them on an SVG canvas overlaid on the original logo image, and allows interactive editing.

## Commands

```bash
pnpm dev          # Start dev server (http://localhost:3000)
pnpm build        # Production build (validates types)
pnpm lint         # ESLint
```

## Architecture

Single-page Next.js 16 app (App Router) with one main component and two library modules.

### Source files

- `src/app/page.tsx` — Main component. All UI, state, event handlers, and SVG rendering live here (~1100 lines). Uses React hooks extensively: `useState` for UI state, `useCallback` for handlers, `useMemo` for derived data (connection map, SVG paths, point rendering).
- `src/app/api/save/route.ts` — POST endpoint that writes bezier + smooth JSON to `public/` directory on disk.
- `src/lib/contour.ts` — Marching squares contour extraction, Otsu threshold, RDP simplification, image-to-mask conversion. Ported from Python (`extract_logo_primitives.py`).
- `src/lib/bezier-fit.ts` — Schneider's cubic bezier fitting algorithm and `traceFromImage()` entry point. Ported from Python (`fit_bowtie_bezier.py`).

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

## Conventions

- Single-file component pattern — `page.tsx` contains everything for now
- Tailwind CSS for all styling (v4, via PostCSS)
- No external UI component libraries
- pnpm as package manager
- Gitmoji in commit messages
- No `alert()` or `confirm()` dialogs
- Canvas is 1024×1024, SVG viewBox matches
- All coordinates are in canvas space (0–1024)
