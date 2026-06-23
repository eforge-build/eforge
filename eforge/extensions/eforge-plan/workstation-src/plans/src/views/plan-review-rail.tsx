import * as React from 'react';
import { Bot, ClipboardList } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Artifact, PlanData, PlanRevisionAnnotationTarget } from '@/types';
import { PlanContextRailContent } from './plan-context-rail';
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
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><ClipboardList className="h-4 w-4 text-muted-foreground" /> Plan context</CardTitle>
        </CardHeader>
        <CardContent>
          <PlanContextRailContent artifact={artifact} titles={titles} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Bot className="h-4 w-4 text-muted-foreground" /> Review controls</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <PendingAnnotationComposer target={pendingAnnotationTarget} busy={revision.busy || revision.loading || revision.hasRunningTurn} onSave={onSavePendingAnnotation} onCancel={onCancelPendingAnnotation} />
          <PlanRevisionAnnotationsPanel plan={plan} api={revision} disabled={revision.hasRunningTurn} />
          <PlanRevisionPanel plan={plan} api={revision} rail />
        </CardContent>
      </Card>
    </div>
  );
}
