import React from 'react';
import { PanelLeftClose, PanelRightClose } from 'lucide-react';
import { PANEL_STYLES } from '../../lib/chrome';

interface SidePanelProps {
  side: 'left' | 'right';
  title?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  /** Additional header actions (right of title) */
  headerActions?: React.ReactNode;
  /** Footer content pinned to bottom (outside scroll area) */
  footer?: React.ReactNode;
  /** Additional inline styles (for dynamic positioning) */
  style?: React.CSSProperties;
  /** Width of the panel */
  width?: number;
  /** Resize start handler */
  onResizeStart?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}

const SidePanel: React.FC<SidePanelProps> = ({
  side, title, isCollapsed = false, onToggleCollapse, headerActions, footer, style, width, onResizeStart, children
}) => {
  if (isCollapsed) return null;

  const CollapseIcon = side === 'left' ? PanelLeftClose : PanelRightClose;

  // Build className manually to avoid any conflicts
  const baseClasses = 'bg-black/95 backdrop-blur-xl border border-neutral-800/80 shadow-[0_0_30px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.05)] fixed top-[48px] bottom-[28px] z-40 rounded-none border-t-0 overflow-hidden';
  const sideSpecificClasses = side === 'left' ? 'border-l-0' : 'border-r-0';
  const panelClass = `${baseClasses} ${sideSpecificClasses}`;

  const finalStyle: React.CSSProperties = {
    ...style,
    // Explicitly set positioning and width via inline styles
    position: 'fixed',
    left: side === 'left' ? 0 : undefined,
    right: side === 'right' ? 0 : undefined,
    width: `${width || 280}px`
  };

  return (
    <div
      data-frame-panel={side === 'left' ? 'manifest' : 'inspector'}
      className={`${panelClass} pointer-events-none select-none font-mono text-[10px] flex flex-col`}
      style={finalStyle}
    >
      {/* Resize handle */}
      {onResizeStart && (
        <div
          className={`absolute top-0 ${side === 'left' ? 'right-0' : 'left-0'} bottom-0 w-1 cursor-ew-resize hover:bg-blue-500/20 transition-colors z-50 pointer-events-auto group`}
          onMouseDown={onResizeStart}
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-neutral-700 group-hover:bg-blue-500 transition-colors" />
        </div>
      )}
      {/* Top highlight */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent z-10" />

      <div className="pointer-events-auto flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        {title && (
          <div className="shrink-0 p-4 border-b border-neutral-800/50">
            <div className="flex items-center justify-between text-neutral-400">
              <span className="tracking-widest font-bold uppercase">{title}</span>
              <div className="flex items-center gap-2">
                {headerActions}
                {onToggleCollapse && (
                  <button
                    onClick={onToggleCollapse}
                    className="p-1 hover:bg-white/10 rounded transition-colors text-neutral-500 hover:text-white"
                    title="Collapse panel"
                  >
                    <CollapseIcon size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto frame-scrollbar">
          {children}
        </div>

        {/* Footer — pinned to bottom */}
        {footer && (
          <div className="shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default SidePanel;
