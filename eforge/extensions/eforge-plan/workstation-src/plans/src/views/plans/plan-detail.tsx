import * as React from 'react';
import { ArrowRight, CheckCircle2, Trash2, X } from 'lucide-react';
import { getBridge } from '@/bridge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardDescription, CardTitle } from '@/components/ui/card';
import { CollapsiblePanel } from '@/components/collapsible-panel';
import { useToast } from '@/components/toast';
import type { PlanData, PlanDetail, PlanRevisionAnnotationTarget, Readiness } from '@/types';
import { planDisplayTitle } from '@/lib/plan-title';
import { ReadinessChecklist } from './readiness-checklist';
import { MetadataEditor, type MetadataInput } from './metadata-editor';
import { OpenQuestionsPanel } from './open-questions-panel';
import { titleCase } from './dimensions';
import { PlanBuildTracePanel } from './lifecycle-evidence-panel';
import { AnnotatablePlanSection } from './plan-annotatable-section';
import { buildWholePlanAnnotationTarget } from './plan-revision-annotation-targets';
import type { PlanRevisionSessionApi } from './use-plan-revision-session';

const bridge = getBridge();

interface MutationResult { plan?: PlanData; readiness?: Readiness }

interface PlanDetailCardProps {
  detail: PlanDetail & { plan: PlanData };
  revision: PlanRevisionSessionApi;
  locked: boolean;
  onSelectAnnotationTarget: (target: PlanRevisionAnnotationTarget) => void;
  onApply: (result: MutationResult) => void;
  onRefresh: () => Promise<void>;
  onDeleted: () => Promise<void>;
  /** Deselect this plan and return to the empty detail state. */
  onClose: () => void;
}

/** Structured flat session-plan detail: header actions, readiness checklist,
 *  editable metadata, and rendered dimension sections. */
export function PlanDetailCard({ detail, revision, locked, onSelectAnnotationTarget, onApply, onRefresh, onDeleted, onClose }: PlanDetailCardProps) {
  const toast = useToast();
  const plan = detail.plan;
  const readiness = detail.readiness ?? {};
  const [confirmingHandoff, setConfirmingHandoff] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  // While an AI revision turn is running it auto-applies on completion, so the
  // rest of the plan is locked to avoid concurrent edits and competing turns.
  // Run a mutating action, surface a toast, apply the returned plan/readiness to
  // local detail state, then refresh the artifact list so statuses stay in sync.
  const mutate = async (
    actionId: string,
    input: Record<string, unknown>,
    successMessage: string,
  ): Promise<MutationResult | null> => {
    try {
      const result = await bridge.invokeAction<MutationResult & { message?: string }>(actionId, { session: plan.session, ...input });
      onApply(result);
      toast.push(successMessage, 'success');
      await onRefresh();
      return result;
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
      return null;
    }
  };

  const setSection = (dimension: string, content: string) =>
    mutate('set-session-plan-section', { dimension, content }, `Saved ${titleCase(dimension)}.`).then(() => undefined);

  const selectDimensions = (planningType: string, planningDepth: string) =>
    mutate('select-session-plan-dimensions', { planningType, planningDepth }, 'Applied dimension selection.').then(() => undefined);

  const saveMetadata = (input: MetadataInput) =>
    mutate('update-session-plan-metadata', { profile: input.profile, agentProfile: input.agentProfile, openQuestions: input.openQuestions }, 'Updated metadata.').then(() => undefined);

  const setReady = () => void mutate('set-session-plan-ready', {}, 'Marked ready.');
  const readinessPasses = readiness.ready === true;
  const statusReady = plan.status === 'ready';
  const canMarkReady = readinessPasses && !statusReady;
  const canHandoff = readinessPasses && statusReady;

  React.useEffect(() => {
    if (!canHandoff) setConfirmingHandoff(false);
  }, [canHandoff]);

  const handoff = async () => {
    if (!canHandoff) return;
    if (!confirmingHandoff) { setConfirmingHandoff(true); setConfirmingDelete(false); return; }
    setConfirmingHandoff(false);
    try {
      const result = await bridge.invokeAction<{ kind?: string; command?: string; message?: string }>('handoff-session-plan', { session: plan.session });
      const failed = result.kind === 'not-ready' || result.kind === 'enqueue-failed';
      toast.push(result.message ?? result.command ?? 'Handoff prepared.', failed ? 'error' : 'success');
      await onRefresh();
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
    }
  };

  const deletePlan = async () => {
    if (!confirmingDelete) { setConfirmingDelete(true); setConfirmingHandoff(false); return; }
    setConfirmingDelete(false);
    try {
      const result = await bridge.invokeAction<{ message?: string }>('delete-session-plan', { session: plan.session });
      toast.push(result.message ?? `Deleted ${plan.session}.`, 'success');
      await onDeleted();
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
    }
  };

  const sectionEntries = Object.entries(plan.sections ?? {});
  const executiveSummary = sectionEntries.find(([key]) => isExecutiveSummarySection(key));
  const detailSectionEntries = sectionEntries.filter(([key]) => !isExecutiveSummarySection(key));

  // Lead-with-status summary: how close the plan is to a clean handoff.
  const missingCount = (readiness.missingDimensions?.length ?? 0) + (readiness.acDiagnostics?.length ?? 0);
  const coveredCount = readiness.coveredDimensions?.length ?? 0;
  const totalCount = coveredCount + (readiness.missingDimensions?.length ?? 0) + (readiness.skippedDimensions?.length ?? 0);
  const readinessSummary = canHandoff
    ? 'Ready for handoff'
    : readinessPasses ? 'Checks pass · mark ready to hand off' : totalCount > 0 ? `${coveredCount}/${totalCount} covered · ${missingCount} to resolve` : 'Not started';

  return (
    <Card aria-label={`Plan ${plan.session}`}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{planDisplayTitle(plan.topic, plan.session)}</CardTitle>
          <CardDescription>{plan.session}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canMarkReady && <Button variant="secondary" size="sm" disabled={locked} onClick={setReady}><CheckCircle2 className="h-4 w-4" /> Mark ready</Button>}
          <Button variant={confirmingDelete ? 'destructive' : 'outline'} size="sm" disabled={locked} onClick={() => void deletePlan()} onBlur={() => setConfirmingDelete(false)}>
            <Trash2 className="h-4 w-4" /> {confirmingDelete ? 'Confirm delete' : 'Delete'}
          </Button>
          <Button
            variant={confirmingHandoff ? 'destructive' : 'secondary'}
            size="sm"
            disabled={locked || !canHandoff}
            title={canHandoff ? undefined : readinessPasses ? 'Mark ready before handoff.' : 'Resolve readiness issues before handoff.'}
            onClick={() => void handoff()}
            onBlur={() => setConfirmingHandoff(false)}
          >
            {confirmingHandoff ? 'Confirm handoff' : 'Handoff'} <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Close plan" title="Close" className="ml-1" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {!statusReady && <Badge>{plan.status}</Badge>}
          {!canHandoff && <Badge variant={readinessPasses ? 'default' : 'outline'}>{readinessPasses ? 'checks pass' : 'not ready'}</Badge>}
          {plan.planning_type && <Badge variant="outline">{plan.planning_type}</Badge>}
          {plan.planning_depth && <Badge variant="outline">{plan.planning_depth}</Badge>}
          <span className={`ml-auto text-xs font-semibold ${canHandoff ? 'text-[color:var(--lane-ready)]' : 'text-[color:var(--prio-medium)]'}`}>{readinessSummary}</span>
        </div>

        {executiveSummary !== undefined && (
          <AnnotatablePlanSection
            plan={plan}
            dimension="executive-summary"
            content={executiveSummary[1]}
            disabled={locked || revision.busy || revision.loading}
            defaultOpen
            onSaveSection={setSection}
            onSelectAnnotationTarget={onSelectAnnotationTarget}
          />
        )}

        <ReadinessChecklist plan={plan} readiness={readiness} disabled={locked} onSetSection={setSection} onSelectDimensions={selectDimensions} />
        <OpenQuestionsPanel plan={plan} />

        {detailSectionEntries.length > 0 && (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sections</h4>
              <Button className="ml-auto" size="sm" variant="outline" disabled={locked || revision.busy || revision.loading} onClick={() => { const target = buildWholePlanAnnotationTarget(plan); if (target) onSelectAnnotationTarget(target); }}>Annotate whole plan</Button>
            </div>
            {detailSectionEntries.map(([key, content]) => (
              <AnnotatablePlanSection key={key} plan={plan} dimension={key} content={content} disabled={locked || revision.busy || revision.loading} onSaveSection={setSection} onSelectAnnotationTarget={onSelectAnnotationTarget} />
            ))}
          </div>
        )}

        <CollapsiblePanel storageKey={`eforge-plan.provenance.${plan.session}`} title="Build activity & metadata">
          <div className="grid gap-3">
            <PlanBuildTracePanel plan={plan} detail={detail} />
            <MetadataEditor plan={plan} disabled={locked} onSave={saveMetadata} />
          </div>
        </CollapsiblePanel>
      </CardContent>
    </Card>
  );
}

function isExecutiveSummarySection(key: string): boolean {
  return key.trim().toLowerCase().replace(/-/g, ' ') === 'executive summary';
}
