# Hudson Integration Guide — Shaper

How the Shaper bezier editor integrates with the Hudson app shell.

## HudsonApp Contract

Every Hudson app exports a single `HudsonApp` object. Shaper's is at `src/hudson/index.ts`:

```ts
export const shaperApp: HudsonApp = {
  id: 'shaper',
  name: 'Shaper',
  mode: 'panel',          // 'panel' = left + right sidebars, 'canvas' = full-bleed
  manifest: shaperManifest,
  intents: shaperIntents,
  leftPanel: { title, icon, headerActions },
  rightPanel: { title, icon },
  tools: shaperTools,
  Provider: ShaperProvider,
  slots: { Content, LeftPanel, Inspector, LeftFooter, Terminal },
  hooks: { useCommands, useStatus, useSearch, useNavCenter, useNavActions, useLayoutMode, useActiveToolHint },
};
```

### Required fields
- `id`, `name`, `mode`, `Provider`, `slots.Content`, `hooks.useCommands`, `hooks.useStatus`

### Optional fields
- `manifest` — serializable snapshot for command palette indexing
- `intents` — LLM/voice/search intent descriptors
- `leftPanel` / `rightPanel` — sidebar config (title, icon, header actions)
- `tools` — right-sidebar accordion tools
- All other `hooks.*` and `slots.*`

## App Registration

1. Create `src/hudson/index.ts` that exports a `HudsonApp` object
2. The parent workspace imports `shaperApp` and passes it to `<HudsonShell app={shaperApp} />`
3. The manifest is indexed for command palette search; intents are indexed for LLM routing

## Boundary: App vs Integration

**All app features live in the app itself** (`page.tsx`, `src/lib/`, app components). The `src/hudson/` directory is strictly the integration adapter — it declares contracts, translates between the app's internal world and Hudson's interfaces, and handles any inbound Hudson messages.

Examples:
- Trace pipeline settings → app feature → lives in `page.tsx`
- Fill controls, animation controls → app features → live in `page.tsx`
- Command palette entries, status bar state → integration contracts → declared in `hooks.ts`
- Intent descriptors for LLM routing → integration metadata → declared in `intents.ts`

If Hudson needed a new sidebar component type that Shaper had to support, the adapter code for receiving/rendering it would go in `src/hudson/`. But the content of any such component — the actual feature — stays in the app.

## Provider Pattern

`ShaperProvider` wraps the entire app in a React context:

```
<ShaperProvider>         ← all state lives here
  <ShaperContent />      ← canvas/SVG
  <ShaperLeftPanel />    ← stroke list, visibility toggles
  <ShaperInspector />    ← selected point details
  ...
</ShaperProvider>
```

### Rules
- **All state** lives in the Provider — no prop drilling, no per-component useState for shared data
- Components access state via `useShaper()` hook
- The `ShaperContextValue` interface defines the full contract (~200 fields)
- Computed values use `useMemo`, handlers use `useCallback`
- The context value itself is wrapped in `useMemo` with an explicit deps array

### Adding new state
1. Add the field to `ShaperContextValue` interface
2. Add `useState` in `ShaperProvider`
3. Add to the `useMemo` value object AND its deps array
4. Access via `useShaper()` in any component

## Tool Pattern

Tools appear as accordion items in the right sidebar (Inspector panel). The Hudson integration exposes app components as tools via the `AppTool` interface — but the components themselves are app features, not Hudson code.

### AppTool interface
```ts
interface AppTool {
  id: string;           // unique identifier
  name: string;         // display label
  icon: ReactNode;      // lucide-react icon, size 12
  Component: React.FC;  // rendered inside accordion body — an app component, not a hudson component
}
```

### Registration
1. Import the app component in `index.ts`
2. Add to `shaperTools` array with `createElement(Icon, { size: 12 })`
3. Add to `shaperManifest.tools` (id + name only)

## Intent System

Intents bridge the command palette to LLM/voice/search understanding.

### AppIntent interface
```ts
interface AppIntent {
  commandId: string;       // must match a CommandOption.id from useCommands()
  title: string;
  description: string;     // natural language, for LLM context
  category: string;        // 'tool' | 'edit' | 'file' | 'view' | 'navigation' | 'toggle'
  keywords: string[];      // search terms (5-6 per intent)
  shortcut?: string;
  dangerous?: boolean;     // shows confirmation dialog before executing
}
```

### Adding a new intent
1. Add a `CommandOption` in `hooks.ts` → `useShaperCommands()`
2. Add a matching `AppIntent` in `intents.ts` with same `commandId`
3. Add the command to `shaperManifest.commands` if it should appear in the palette

## Hook System

Hudson calls these hooks to integrate the app into the shell chrome.

| Hook | Returns | Purpose |
|------|---------|---------|
| `useCommands` | `CommandOption[]` | Command palette entries with actions |
| `useStatus` | `{ label, color }` | Status bar indicator (READY/SAVING/ERROR) |
| `useSearch` | `SearchConfig` | Search bar value, onChange, placeholder |
| `useNavCenter` | `ReactNode` | Center of navigation bar (current tool label) |
| `useNavActions` | `ReactNode` | Right side of nav bar (filename + save status) |
| `useLayoutMode` | `'canvas' \| 'panel'` | Layout mode (Shaper always returns 'panel') |
| `useActiveToolHint` | `string \| null` | Which right-sidebar tool to auto-expand |

All hooks must be called inside `ShaperProvider` context.

## API Routes & URL Convention

Hudson apps share the host Next.js app's `/api/` namespace. Routes are **not** prefixed per-app — there is no `/api/shaper/` or `/api/hudson/` prefix. All apps use the same flat `/api/` directory.

```
src/app/api/save/route.ts   →  POST /api/save
```

The Provider and the legacy `page.tsx` both POST to `/api/save`. The `projectId` field in the request body is what determines the save path on disk:

| `projectId` | Saves to |
|---|---|
| `null` / absent | `public/talkie-bezier.json` (legacy) |
| UUID string | `public/projects/{id}/bezier.json` |

**Do not** create app-prefixed API routes like `/api/shaper/save`. Keep routes flat so the legacy component and the Hudson Provider share the same endpoint without duplication.

## Key Architecture Decisions

1. **Single-file state** — The Provider is large (~1400 lines) but all state is colocated, making it easy to find any piece of state and understand dependencies.

2. **No external state library** — Pure React context + hooks. The app is single-user, single-window, no SSR state hydration needed.

3. **Auto-save with debounce** — 2-second debounce writes to disk via POST to `/api/save`. No localStorage.

4. **Undo/redo via JSON snapshots** — Simple, reliable, max 100 states. 300ms debounce prevents noise.

5. **Project isolation** — Each project gets a UUID. Data saves to `public/projects/{id}/bezier.json`. Legacy "talkie" project uses `public/talkie-bezier.json` for backward compatibility.

6. **Trace pipeline is configurable** — `TraceOptions` controls edge detection, simplification, curve fitting, resolution, and max contours. The Trace panel in the app's right sidebar provides persistent UI for all settings.

7. **Connection map** — Built with `useMemo`, links anchor points across strokes within 2px. Dragging one anchor moves all linked points. This is the core multi-stroke editing mechanism.
