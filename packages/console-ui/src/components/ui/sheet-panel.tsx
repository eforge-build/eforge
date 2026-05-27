import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';

interface SheetPanelProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Convenience wrapper that adapts monitor-ui's SheetContent API
 * (`{open, onClose, title, description}`) to console-ui's Radix-based Sheet.
 */
export function SheetPanel({ open, onClose, title, description, className, children }: SheetPanelProps) {
  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className={className}>
        <div className="flex items-start justify-between px-4 py-3 border-b border-border shrink-0">
          <div>
            {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
            {description && <p className="text-[11px] text-text-dim mt-0.5">{description}</p>}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
