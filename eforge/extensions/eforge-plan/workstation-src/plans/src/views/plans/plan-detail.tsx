import * as React from 'react';
import { ArrowRight, CheckCircle2, RotateCcw, Trash2, X } from 'lucide-react';
import { getBridge } from '@/bridge';
import { Badge } from '@/components/ui/badge';
import { Timestamp } from '@/components/timestamp';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardDescription, CardTitle } from '@/components/ui/card';
import { CollapsiblePanel } from '@/components/collapsible-panel';
import { useToast } from '@/components/toast';
import type { AgentRuntimeProfileOptionsResponse, Artifact, PlanData, PlanDetail, PlanRevisionAnnotationTarget, Readiness } from '@/types';
import { planDisplayTitle } from '@/lib/plan-title';
import { planLifecycleTimestamps } from '@/lib/plan-timestamps';
import { ReadinessChecklist } from './readiness-checklist';
import { MetadataEditor, type AgentProfileOptionsState, type MetadataInput } from './metadata-editor';
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
  artifact: Artifact | null;
  revision: PlanRevisionSessionApi;
  locked: boolean;
  onSelectAnnotationTarget: (target: PlanRevisionAnnotationTarget, anchor?: DOMRect | null) => void;
  onApply: (result: MutationResult) => void;
  onRefresh: () => Promise<void>;
  onHandoff: (session: string) => Promise<void>;
  onDeleted: () => Promise<void>;
  /** Deselect this plan and return to the empty detail state. */
  onClose: () => void;
}

/** Structured flat session-plan detail: header actions, readiness checklist,
 *  editable metadata, and rendered dimension sections. */
export function PlanDetailCard({ detail, artifact, revision, locked, onSelectAnnotationTarget, onApply, onRefresh, onHandoff, onDeleted, onClose }: PlanDetailCardProps) {
  const toast = useToast();
  const plan = detail.plan;
  const readiness = detail.readiness ?? {};
  const [confirmingHandoff, setConfirmingHandoff] = React.useState(false);
  const [confirmingResubmit, setConfirmingResubmit] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [agentProfileOptions, setAgentProfileOptions] = React.useState<AgentProfileOptionsState>({ status: 'loading', profiles: [] });
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
    mutate('update-session-plan-metadata', { profile: input.profile, agentProfile: input.agentProfile, openQuestions: input.openQuestions }, 'Updated metadata.').then((result) => result !== null);

  const setReady = () => void mutate('set-session-plan-ready', {}, 'Marked ready.');
  const readinessPasses = readiness.ready === true;
  const statusReady = plan.status === 'ready';
  const canMarkReady = readinessPasses && !statusReady;
  const canHandoff = readinessPasses && statusReady;
  const canResubmit = readinessPasses && (plan.status === 'submitted' || plan.status === 'removed');
  const lifecycleTimestamps = planLifecycleTimestamps(detail, artifact);

  React.useEffect(() => {
    if (!canHandoff) setConfirmingHandoff(false);
  }, [canHandoff]);

  React.useEffect(() => {
    if (!canResubmit) setConfirmingResubmit(false);
  }, [canResubmit]);

  React.useEffect(() => {
    let active = true;
    setAgentProfileOptions((current) => ({ status: 'loading', profiles: current.profiles, active: current.active }));
    bridge.invokeAction<AgentRuntimeProfileOptionsResponse>('list-agent-runtime-profiles', { scope: 'all' })
      .then((response) => {
        if (!active) return;
        setAgentProfileOptions({ status: response.profiles.length > 0 ? 'success' : 'empty', profiles: response.profiles, active: response.active });
      })
      .catch((caught) => {
        if (!active) return;
        setAgentProfileOptions({ status: 'error', profiles: [], error: caught instanceof Error ? caught.message : String(caught) });
      });
    return () => { active = false; };
  }, [plan.session]);

  const handoff = async () => {
    if (!canHandoff) return;
    if (!confirmingHandoff) { setConfirmingHandoff(true); setConfirmingResubmit(false); setConfirmingDelete(false); return; }
    setConfirmingHandoff(false);
    await onHandoff(plan.session);
  };

  const resubmit = async () => {
    if (!canResubmit) return;
    if (!confirmingResubmit) { setConfirmingResubmit(true); setConfirmingHandoff(false); setConfirmingDelete(false); return; }
    setConfirmingResubmit(false);
    try {
      const result = await getBridge().invokeAction<{ kind?: string; message?: string }>('resubmit-session-plan', { session: plan.session });
      toast.push(result.message ?? `Resubmitted ${plan.session}.`, result.kind === 'enqueued' ? 'success' : 'error');
      await onRefresh();
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
    }
  };

  const deletePlan = async () => {
    if (!confirmingDelete) { setConfirmingDelete(true); setConfirmingHandoff(false); setConfirmingResubmit(false); return; }
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
          {canResubmit && <Button variant={confirmingResubmit ? 'destructive' : 'secondary'} size="sm" disabled={locked} onClick={() => void resubmit()} onBlur={() => setConfirmingResubmit(false)}><RotateCcw className="h-4 w-4" /> {confirmingResubmit ? 'Confirm resubmit' : 'Resubmit'}</Button>}
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
          {detail.lifecycle?.lifecycleState === 'partial' && <Badge variant="outline" title={detail.lifecycle.partialReasons?.map((reason) => reason.message).join(' ')}>partial lifecycle</Badge>}
          {plan.planning_type && <Badge variant="outline">{plan.planning_type}</Badge>}
          {plan.planning_depth && <Badge variant="outline">{plan.planning_depth}</Badge>}
          <span className={`ml-auto text-xs font-semibold ${canHandoff ? 'text-[color:var(--lane-ready)]' : 'text-[color:var(--prio-medium)]'}`}>{readinessSummary}</span>
        </div>

        <PlanLifecycleMetadata timestamps={lifecycleTimestamps} />
        <PlanStatusSourceDisclosure detail={detail} />
        <PlanPartialLifecycleExplanation detail={detail} />

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
              <Button className="ml-auto" size="sm" variant="outline" disabled={locked || revision.busy || revision.loading} onClick={(event) => { const target = buildWholePlanAnnotationTarget(plan); if (target) onSelectAnnotationTarget(target, event.currentTarget.getBoundingClientRect()); }}>Annotate whole plan</Button>
            </div>
            {detailSectionEntries.map(([key, content]) => (
              <AnnotatablePlanSection key={key} plan={plan} dimension={key} content={content} disabled={locked || revision.busy || revision.loading} onSaveSection={setSection} onSelectAnnotationTarget={onSelectAnnotationTarget} />
            ))}
          </div>
        )}

        <CollapsiblePanel storageKey={`eforge-plan.provenance.${plan.session}`} title="Build activity & metadata">
          <div className="grid gap-3">
            <PlanBuildTracePanel plan={plan} detail={detail} />
            <MetadataEditor plan={plan} disabled={locked} profileOptions={agentProfileOptions} onSave={saveMetadata} />
          </div>
        </CollapsiblePanel>
      </CardContent>
    </Card>
  );
}

function PlanStatusSourceDisclosure({ detail }: { detail: PlanDetail }) {
  const disclosure = detail.statusSourceDisclosure ?? detail.plan?.statusSourceDisclosure;
  if (!disclosure) return null;
  return <p className="rounded border border-border bg-background/40 p-2 text-xs text-muted-foreground">{disclosure}</p>;
}

function PlanPartialLifecycleExplanation({ detail }: { detail: PlanDetail }) {
  const reasons = detail.lifecycle?.partialReasons ?? detail.plan?.partialReasons ?? [];
  if (detail.lifecycle?.lifecycleState !== 'partial' || reasons.length === 0) return null;
  return (
    <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-100">
      <div className="font-semibold">Partial lifecycle projection</div>
      {reasons.map((reason) => <p key={reason.code}>{reason.message}</p>)}
    </div>
  );
}

function PlanLifecycleMetadata({ timestamps }: { timestamps: Record<'createdAt' | 'updatedAt' | 'readyAt' | 'submittedAt' | 'lastBuildActivityAt', string | null> }) {
  const rows = [
    ['Created', timestamps.createdAt],
    ['Updated', timestamps.updatedAt],
    ['Ready', timestamps.readyAt],
    ['Submitted', timestamps.submittedAt],
    ['Last build activity', timestamps.lastBuildActivityAt],
  ] as const;
  return (
    <dl className="grid gap-1 rounded border border-border bg-background/40 p-2 text-xs sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium text-text-bright"><Timestamp value={value} /></dd>
        </div>
      ))}
    </dl>
  );
}

function isExecutiveSummarySection(key: string): boolean {
  return key.trim().toLowerCase().replace(/-/g, ' ') === 'executive summary';
}
