import * as React from 'react';
import { Bot } from 'lucide-react';
import { RailCard } from '@/components/ui/rail-card';
import type { Artifact, PlanData, PlanRevisionAnnotationTarget } from '@/types';
import { PlanContextRail } from './plan-context-rail';
import { PendingAnnotationComposer } from './plans/pending-annotation-composer';
import { PlanRevisionAnnotationsPanel } from './plans/plan-revision-annotations-panel';
import { PlanRevisionPanel } from './plans/plan-revision-panel';
import type { PlanRevisionSessionApi } from './plans/use-plan-revision-session';

interface PlanReviewRailProps {
  artifact: Artifact | null;
  titles: Map<string, string>;
  plan: PlanData;
  revision: PlanRevisionSessionApi;
  pendingAnnotationTarget: PlanRevisionAnnotationTarget | null;
  onSavePendingAnnotation: (body: string) => Promise<boolean>;
  onCancelPendingAnnotation: () => void;
}

export function PlanReviewRail({ artifact, titles, plan, revision, pendingAnnotationTarget, onSavePendingAnnotation, onCancelPendingAnnotation }: PlanReviewRailProps) {
  return (
    <div className="grid gap-3" aria-label={`Plan review rail for ${plan.session}`}>
      <PlanContextRail artifact={artifact} titles={titles} />

      <RailCard icon={Bot} title="Review controls" contentClassName="grid gap-3">
        <PendingAnnotationComposer target={pendingAnnotationTarget} busy={revision.busy || revision.loading || revision.hasRunningTurn} onSave={onSavePendingAnnotation} onCancel={onCancelPendingAnnotation} />
        <PlanRevisionAnnotationsPanel plan={plan} api={revision} disabled={revision.hasRunningTurn} />
        <PlanRevisionPanel plan={plan} api={revision} rail />
      </RailCard>
    </div>
  );
}
