import * as React from 'react';
import { SafeMarkdown } from '@/components/safe-markdown';
import { Badge } from '@/components/ui/badge';
import type { PlanRevisionTurnProjection } from '@/types';
import { titleCase } from './dimensions';
import { patchSections } from './plan-revision-view-model';

interface Props { turn: PlanRevisionTurnProjection }

/**
 * Read-only record of the sections a completed revision turn changed. The patch
 * is auto-applied, so this is a collapsed "what changed" disclosure rather than
 * an apply gate: no checkboxes, no apply/confirm controls.
 */
export function PlanRevisionPatchSummary({ turn }: Props) {
  const sections = patchSections(turn);
  if (sections.length === 0) return null;
  const skipped = turn.task?.result?.planRevisionTurn?.proposedPatch?.skippedDimensions ?? [];
  return (
    <details className="rounded-md border bg-background/50 p-2 text-xs">
      <summary className="cursor-pointer font-medium text-muted-foreground">
        View changes ({sections.length} {sections.length === 1 ? 'section' : 'sections'})
      </summary>
      <div className="mt-2 grid gap-2">
        {sections.map((section) => (
          <section key={section.dimension} className="grid gap-1 rounded border bg-background p-2">
            <Badge variant="outline" className="w-fit">{titleCase(section.dimension)}</Badge>
            {section.rationale && <p className="text-muted-foreground">{section.rationale}</p>}
            <SafeMarkdown markdown={section.content} />
          </section>
        ))}
        {skipped.length > 0 && <p className="text-muted-foreground">Skipped: {skipped.map((entry) => `${titleCase(entry.dimension)} (${entry.reason})`).join('; ')}</p>}
      </div>
    </details>
  );
}
