import React from 'react';
import { Plus, Minus } from 'lucide-react';

interface ZoomControlsProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset?: () => void;
  /** CSS class for position override (default: right side, above status bar) */
  className?: string;
}

/**
 * Map-style vertical zoom controls that float on the canvas.
 * Matches HUD's design: Plus / percentage / Minus in a vertical strip.
 */
const ZoomControls: React.FC<ZoomControlsProps> = ({ scale, onZoomIn, onZoomOut, onReset, className }) => {
  return (
    <div className={className ?? "fixed bottom-16 right-[296px] z-30 pointer-events-auto flex flex-col items-center gap-0.5 bg-neutral-900/70 backdrop-blur-md border border-neutral-700/50 rounded-md shadow-lg shadow-black/30"}>
      <button
        onClick={onZoomIn}
        className="w-8 h-7 flex items-center justify-center rounded-t-md hover:bg-white/10 text-neutral-400 hover:text-white transition-colors border-b border-neutral-700/30"
        title="Zoom In"
      >
        <Plus size={14} />
      </button>
      <button
        onClick={onReset}
        className="w-8 py-1 text-center text-[9px] font-mono text-neutral-500 hover:text-white hover:bg-white/10 select-none tabular-nums bg-neutral-800/30 transition-colors cursor-pointer"
        title="Reset Zoom"
      >
        {Math.round(scale * 100)}%
      </button>
      <button
        onClick={onZoomOut}
        className="w-8 h-7 flex items-center justify-center rounded-b-md hover:bg-white/10 text-neutral-400 hover:text-white transition-colors border-t border-neutral-700/30"
        title="Zoom Out"
      >
        <Minus size={14} />
      </button>
    </div>
  );
};

export default ZoomControls;
