'use client';

import {
  createContext,
  useContext,
  useState,
  useMemo,
  type ReactNode,
} from 'react';
import { ShaperCoreProvider, useShaperCore } from '../lib/ShaperContext';
import type { ShaperCoreValue } from '../lib/ShaperContext';
import type { ProjectMeta } from './types';

// ---------------------------------------------------------------------------
// Hudson-specific context value — extends core with fill/project metadata
// ---------------------------------------------------------------------------
export interface ShaperContextValue extends ShaperCoreValue {
  fillPattern: 'solid' | 'dither' | 'halftone' | 'noise';
  setFillPattern: React.Dispatch<React.SetStateAction<'solid' | 'dither' | 'halftone' | 'noise'>>;
  fillWeights: Record<string, number>;
  setFillWeights: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  projectMeta: ProjectMeta | null;
}

const ShaperContext = createContext<ShaperContextValue | null>(null);

export function useShaper() {
  const ctx = useContext(ShaperContext);
  if (!ctx) throw new Error('useShaper must be used inside ShaperProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider — wraps the core engine, adds Hudson-specific fields
// ---------------------------------------------------------------------------
export function ShaperProvider({ children }: { children: ReactNode }) {
  return (
    <ShaperCoreProvider basePath="/shaper">
      <HudsonAdapter>{children}</HudsonAdapter>
    </ShaperCoreProvider>
  );
}

function HudsonAdapter({ children }: { children: ReactNode }) {
  const core = useShaperCore();

  // Hudson-specific state (not in the core engine)
  const [fillPattern, setFillPattern] = useState<'solid' | 'dither' | 'halftone' | 'noise'>('solid');
  const [fillWeights, setFillWeights] = useState<Record<string, number>>({});
  const [projectMeta] = useState<ProjectMeta | null>(null);

  const value = useMemo<ShaperContextValue>(() => ({
    ...core,
    fillPattern, setFillPattern,
    fillWeights, setFillWeights,
    projectMeta,
  }), [core, fillPattern, fillWeights, projectMeta]);

  return <ShaperContext.Provider value={value}>{children}</ShaperContext.Provider>;
}
