import React from 'react';
import { Search, Terminal } from 'lucide-react';
import { PANEL_STYLES } from '../../lib/chrome';

interface CommandDockProps {
  onOpenCommandPalette: () => void;
  onToggleTerminal: () => void;
  isTerminalOpen: boolean;
  /** Additional toggle buttons */
  extraControls?: React.ReactNode;
}

const CommandDock: React.FC<CommandDockProps> = ({
  onOpenCommandPalette, onToggleTerminal, isTerminalOpen, extraControls
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

        <div className="flex items-center gap-3">
          {extraControls}
          <button
            onClick={onToggleTerminal}
            className={`flex items-center justify-center transition-colors ${
              isTerminalOpen ? 'text-white' : 'text-neutral-500 hover:text-white'
            }`}
            title="Toggle Terminal"
          >
            <Terminal size={12} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CommandDock;
