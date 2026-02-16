# Shaper

Interactive bezier curve editor for logo design. Load bezier path data from JSON, render on an SVG canvas overlaid on the original logo image, and edit curves interactively.

## Getting started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Features

- **Bezier path editing** — Select, drag, and edit anchor points and control handles on cubic bezier curves
- **Connected anchors** — Points within 2px across strokes are linked; moving one moves all connected points
- **Smooth/corner points** — Alt+click to toggle; smooth points enforce symmetric handles
- **Undo/redo** — Cmd+Z / Cmd+Shift+Z with 100-state snapshot history
- **Auto-save** — Writes to disk via API route with 2-second debounce
- **Re-trace from image** — Client-side pipeline: silhouette alpha channel → marching squares → RDP simplification → Schneider bezier fitting
- **Pen tool** — Click to add new bezier segments
- **Hand tool** — Pan with drag, scroll to zoom
- **Layers panel** — Toggle visibility of paths, anchors, handles, labels, images, grid
- **Point inspector** — View and edit X/Y coordinates numerically
- **SVG console** — View and copy the full SVG path `d` attribute
- **Minimap** — Overview with viewport indicator
- **Export** — Download bezier data as JSON

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| V | Select tool |
| P | Pen tool |
| H | Hand tool |
| Space (hold) | Temporary hand tool |
| Cmd+Z | Undo |
| Cmd+Shift+Z | Redo |
| Cmd+S | Save |
| Alt+click | Toggle smooth/corner point |
| Shift+drag | Move anchor without handles |
| Backspace/Delete | Delete selected point |

## Tech stack

- [Next.js](https://nextjs.org) 16 (App Router)
- [React](https://react.dev) 19
- [Tailwind CSS](https://tailwindcss.com) v4
- [TypeScript](https://www.typescriptlang.org) 5
- [pnpm](https://pnpm.io)

## Project structure

```
src/
  app/
    page.tsx              Main component (all UI, state, rendering)
    api/save/route.ts     POST endpoint — writes JSON to public/
  lib/
    contour.ts            Marching squares, Otsu threshold, RDP simplification
    bezier-fit.ts         Schneider's cubic bezier fitting algorithm
public/
    talkie-bezier.json    Bezier curve data (editable, auto-saved)
    talkie-anchors.json   Named anchor points + cross-stroke junctions
    talkie-smooth.json    Smooth/corner state per anchor
    talkie-original.png   Original logo image (1024x1024)
    talkie-silhouette.png Silhouette for re-tracing (RGBA, alpha = shape)
```

## Scripts

```bash
pnpm dev          # Start dev server
pnpm build        # Production build (type-checks)
pnpm lint         # ESLint
```
