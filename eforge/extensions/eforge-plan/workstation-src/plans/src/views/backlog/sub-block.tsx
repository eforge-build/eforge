import * as React from 'react';
import { cn } from '@/lib/utils';

// A sub-section divided from what precedes it by a top rule, with an optional
// uppercase muted label. Consolidates the repeated `border-t border-border
// pt-2/pt-3` (+ heading) pattern across the planning and curation result
// previews. Pass `className` to vary spacing/layout - tailwind-merge lets later
// classes win over the defaults (e.g. `pt-3`, `gap-3`, or `flex` to drop the grid).
export function SubBlock({ title, className, children }: { title?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('grid gap-2 border-t border-border pt-2', className)}>
      {title && <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>}
      {children}
    </div>
  );
}
