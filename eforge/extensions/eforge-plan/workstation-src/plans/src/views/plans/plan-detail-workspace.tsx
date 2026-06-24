import * as React from 'react';
import type { Artifact, PlanData, PlanDetail, PlanRevisionAnnotationTarget, Readiness } from '@/types';
import { PlanReviewRail } from '../plan-review-rail';
import { PlanDetailCard } from './plan-detail';
import { PendingAnnotationComposer } from './pending-annotation-composer';
import { usePlanRevisionSession } from './use-plan-revision-session';

interface PendingAnnotation { target: PlanRevisionAnnotationTarget; anchor: DOMRect | null }

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
  const [pending, setPending] = React.useState<PendingAnnotation | null>(null);

  React.useEffect(() => {
    setPending(null);
  }, [plan.session]);

  const selectTarget = React.useCallback((target: PlanRevisionAnnotationTarget, anchor?: DOMRect | null) => {
    setPending({ target, anchor: anchor ?? null });
  }, []);

  const savePendingAnnotation = React.useCallback(async (body: string) => {
    if (!pending || revision.hasRunningTurn) return false;
    const result = await revision.createAnnotation(pending.target, body.trim());
    if (result) setPending(null);
    return Boolean(result);
  }, [pending, revision]);

  return (
    <>
      <section className="min-w-0">
        <PlanDetailCard detail={detail} revision={revision} locked={revision.hasRunningTurn} onSelectAnnotationTarget={selectTarget} onApply={onApply} onRefresh={onRefresh} onDeleted={onDeleted} onClose={onClose} />
      </section>
      <aside className="grid min-w-0 content-start gap-3 lg:sticky lg:top-[5.5rem]">
        <PlanReviewRail artifact={artifact} titles={titles} plan={plan} revision={revision} />
      </aside>
      {pending && (
        <PendingAnnotationComposer
          target={pending.target}
          anchor={pending.anchor}
          busy={revision.busy || revision.loading || revision.hasRunningTurn}
          onSave={savePendingAnnotation}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
