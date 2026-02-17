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
  children: React.ReactNode;
}

const SidePanel: React.FC<SidePanelProps> = ({
  side, title, isCollapsed = false, onToggleCollapse, headerActions, footer, children
}) => {
  if (isCollapsed) return null;

  const panelClass = side === 'left' ? PANEL_STYLES.manifest : PANEL_STYLES.inspector;
  const CollapseIcon = side === 'left' ? PanelLeftClose : PanelRightClose;

  return (
    <div
      data-frame-panel={side === 'left' ? 'manifest' : 'inspector'}
      className={`${panelClass} pointer-events-none select-none font-mono text-[10px] flex flex-col`}
    >
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
