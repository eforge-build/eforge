import * as React from 'react';
import type { Artifact, PlanData, PlanDetail, PlanRevisionAnnotationTarget, Readiness } from '@/types';
import { PlanReviewRail } from '../plan-review-rail';
import { PlanDetailCard } from './plan-detail';
import { usePlanRevisionSession } from './use-plan-revision-session';

interface MutationResult { plan?: PlanData; readiness?: Readiness }

interface PlanDetailWorkspaceProps {
  detail: PlanDetail & { plan: PlanData };
  artifact: Artifact | null;
  titles: Map<string, string>;
  onApply: (result: MutationResult) => void;
  onRefresh: () => Promise<void>;
  onDeleted: () => Promise<void>;
  onClose: () => void;
}

export function PlanDetailWorkspace({ detail, artifact, titles, onApply, onRefresh, onDeleted, onClose }: PlanDetailWorkspaceProps) {
  const plan = detail.plan;
  const revision = usePlanRevisionSession({ session: plan.session, onApply, onRefresh, autoLoadExisting: true });
  const [pendingAnnotationTarget, setPendingAnnotationTarget] = React.useState<PlanRevisionAnnotationTarget | null>(null);

  React.useEffect(() => {
    setPendingAnnotationTarget(null);
  }, [plan.session]);

  const savePendingAnnotation = React.useCallback(async (body: string) => {
    if (!pendingAnnotationTarget || revision.hasRunningTurn) return false;
    const result = await revision.createAnnotation(pendingAnnotationTarget, body.trim());
    if (result) setPendingAnnotationTarget(null);
    return Boolean(result);
  }, [pendingAnnotationTarget, revision]);

  return (
    <>
      <section className="min-w-0">
        <PlanDetailCard detail={detail} revision={revision} locked={revision.hasRunningTurn} onSelectAnnotationTarget={setPendingAnnotationTarget} onApply={onApply} onRefresh={onRefresh} onDeleted={onDeleted} onClose={onClose} />
      </section>
      <aside className="grid min-w-0 content-start gap-3 lg:sticky lg:top-[5.5rem]">
        <PlanReviewRail artifact={artifact} titles={titles} plan={plan} revision={revision} pendingAnnotationTarget={pendingAnnotationTarget} onSavePendingAnnotation={savePendingAnnotation} onCancelPendingAnnotation={() => setPendingAnnotationTarget(null)} />
      </aside>
    </>
  );
}
