import React from 'react';
import { Search } from 'lucide-react';
import { PANEL_STYLES } from '../../lib/chrome';

interface CommandDockProps {
  onOpenCommandPalette: () => void;
  /** Additional toggle buttons rendered after the CMD+K trigger */
  extraControls?: React.ReactNode;
}

const CommandDock: React.FC<CommandDockProps> = ({
  onOpenCommandPalette, extraControls
}) => {
  return (
    <div className={`${PANEL_STYLES.commandDock} pointer-events-auto`}>
      <div className="px-4 py-3.5 flex items-center justify-between text-[10px] font-mono">
        <button
          onClick={onOpenCommandPalette}
          className="flex items-center gap-1.5 text-neutral-500 hover:text-white transition-colors"
        >
          <Search size={10} />
          <span className="text-[9px]">CMD+K</span>
        </button>

        {extraControls && (
          <div className="flex items-center gap-3">
            {extraControls}
          </div>
        )}
      </div>
    </div>
  );
};

export default CommandDock;
