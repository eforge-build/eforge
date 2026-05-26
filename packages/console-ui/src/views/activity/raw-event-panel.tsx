/**
 * RawEventPanel — slide-over panel displaying pretty-printed JSON for a selected activity event.
 */
import * as React from 'react';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { ActivityEventRowModel } from '@/lib/selectors/activity';

interface RawEventPanelProps {
  /** The selected activity event row, or null when no row is selected. */
  row: ActivityEventRowModel | null;
  /** Whether the panel is open. */
  open: boolean;
  /** Called when the panel should close. */
  onClose: () => void;
}

export function RawEventPanel({ row, open, onClose }: RawEventPanelProps) {
  return (
    <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <SheetContent side="right">
        <SheetHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-0.5 min-w-0">
              <SheetTitle className="truncate">
                {row?.eventType ?? 'Raw Event'}
              </SheetTitle>
              <SheetDescription>
                {row ? `${row.family} · ${row.timestampLabel}` : 'No event selected'}
              </SheetDescription>
            </div>
            <SheetClose
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="Close raw event panel"
            >
              ✕
            </SheetClose>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-auto px-4 py-3">
          {row && (
            <pre className="text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words font-mono">
              {row.rawJson}
            </pre>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
