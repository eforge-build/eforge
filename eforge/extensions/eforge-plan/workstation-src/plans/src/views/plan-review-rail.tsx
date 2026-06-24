import * as React from 'react';
import { Bot, ClipboardList, type LucideIcon } from 'lucide-react';
import { RailCard } from '@/components/ui/rail-card';
import { cn } from '@/lib/utils';
import type { Artifact, PlanData } from '@/types';
import { PlanContextRailContent } from './plan-context-rail';
import { PlanRevisionAnnotationsPanel } from './plans/plan-revision-annotations-panel';
import type { PlanRevisionSessionApi } from './plans/use-plan-revision-session';

interface PlanReviewRailProps {
  artifact: Artifact | null;
  titles: Map<string, string>;
  plan: PlanData;
  revision: PlanRevisionSessionApi;
}

type RailMode = 'review' | 'context';

/**
 * The plan review rail: one focal job at a time instead of a single long stack.
 * "Review" holds the annotation and AI-revision workspace; "Context" demotes the
 * plan's lineage (source items, build state) to a secondary, on-demand view.
 */
export function PlanReviewRail({ artifact, titles, plan, revision }: PlanReviewRailProps) {
  const [mode, setMode] = React.useState<RailMode>('review');
  return (
    <div className="grid gap-3" aria-label={`Plan review rail for ${plan.session}`}>
      <div className="flex gap-1 rounded-md border bg-background/50 p-1" role="tablist" aria-label="Rail mode">
        <RailModeButton active={mode === 'review'} icon={Bot} onClick={() => setMode('review')}>Review</RailModeButton>
        <RailModeButton active={mode === 'context'} icon={ClipboardList} onClick={() => setMode('context')}>Context</RailModeButton>
      </div>

      {mode === 'review' ? (
        <RailCard icon={Bot} title="Review controls" contentClassName="grid gap-3">
          <PlanRevisionAnnotationsPanel plan={plan} api={revision} disabled={revision.hasRunningTurn} />
        </RailCard>
      ) : (
        <RailCard icon={ClipboardList} title="Plan context">
          <PlanContextRailContent artifact={artifact} titles={titles} />
        </RailCard>
      )}
    </div>
  );
}

function RailModeButton({ active, icon: Icon, onClick, children }: { active: boolean; icon: LucideIcon; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors',
        active ? 'bg-card text-text-bright shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" /> {children}
    </button>
  );
}
