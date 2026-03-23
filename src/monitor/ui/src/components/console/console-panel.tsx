import { forwardRef, type ReactNode, type RefObject } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { TimelineControls } from '@/components/timeline/timeline-controls';

interface ConsolePanelProps {
  showVerbose: boolean;
  onToggleVerbose: (checked: boolean) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  autoScroll: boolean;
  onEnableAutoScroll: () => void;
  children: ReactNode;
}

export const ConsolePanel = forwardRef<HTMLDivElement, ConsolePanelProps>(
  function ConsolePanel(
    {
      showVerbose,
      onToggleVerbose,
      collapsed,
      onToggleCollapse,
      scrollRef,
      autoScroll,
      onEnableAutoScroll,
      children,
    },
    _ref,
  ) {
    return (
      <div className="flex flex-col h-full">
        {/* Console header */}
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-foreground">Timeline</span>
            {!collapsed && (
              <TimelineControls showVerbose={showVerbose} onToggleVerbose={onToggleVerbose} />
            )}
          </div>
          <button
            onClick={onToggleCollapse}
            className="p-1 text-text-dim hover:text-foreground transition-colors cursor-pointer"
            title={collapsed ? 'Expand console' : 'Collapse console'}
          >
            {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Console body — scrollable area */}
        {!collapsed && (
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-2 relative"
          >
            {children}

            {/* Auto-scroll button */}
            {!autoScroll && (
              <button
                onClick={onEnableAutoScroll}
                className="sticky bottom-2 left-1/2 -translate-x-1/2 bg-bg-tertiary border border-border rounded-md px-3 py-1.5 text-[11px] text-text-dim cursor-pointer hover:text-foreground z-10"
              >
                ↓ Auto-scroll
              </button>
            )}
          </div>
        )}
      </div>
    );
  },
);
