import * as React from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { getBridge } from '@/bridge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardDescription, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/toast';
import type { PlanData, PlanDetail, Readiness } from '@/types';
import { ReadinessChecklist } from './readiness-checklist';
import { MetadataEditor, type MetadataInput } from './metadata-editor';
import { titleCase } from './dimensions';

const bridge = getBridge();

interface MutationResult { plan?: PlanData; readiness?: Readiness }

interface PlanDetailCardProps {
  detail: PlanDetail & { plan: PlanData };
  onApply: (result: MutationResult) => void;
  onRefresh: () => Promise<void>;
}

/** Structured flat session-plan detail: header actions, readiness checklist,
 *  editable metadata, and rendered dimension sections. */
export function PlanDetailCard({ detail, onApply, onRefresh }: PlanDetailCardProps) {
  const toast = useToast();
  const plan = detail.plan;
  const readiness = detail.readiness ?? {};
  const [confirmingHandoff, setConfirmingHandoff] = React.useState(false);

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

  const checkReadiness = () => void mutate('check-session-plan-readiness', {}, 'Readiness checked.');
  const setReady = () => void mutate('set-session-plan-ready', {}, 'Marked ready.');

  const handoff = async () => {
    if (!confirmingHandoff) { setConfirmingHandoff(true); return; }
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

  const sectionEntries = Object.entries(plan.sections ?? {});

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{plan.topic}</CardTitle>
          <CardDescription>{plan.session}</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={checkReadiness}>Check readiness</Button>
          <Button size="sm" disabled={!readiness.ready} onClick={setReady}><CheckCircle2 className="h-4 w-4" /> Set ready</Button>
          <Button variant={confirmingHandoff ? 'destructive' : 'secondary'} size="sm" onClick={() => void handoff()} onBlur={() => setConfirmingHandoff(false)}>
            {confirmingHandoff ? 'Confirm handoff' : 'Handoff'} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge>{plan.status}</Badge>
          <Badge variant={readiness.ready ? 'default' : 'outline'}>{readiness.ready ? 'ready' : 'not ready'}</Badge>
          {plan.planning_type && <Badge variant="outline">{plan.planning_type}</Badge>}
          {plan.planning_depth && <Badge variant="outline">{plan.planning_depth}</Badge>}
        </div>

        <ReadinessChecklist plan={plan} readiness={readiness} onSetSection={setSection} onSelectDimensions={selectDimensions} />
        <MetadataEditor plan={plan} onSave={saveMetadata} />

        {sectionEntries.length > 0 && (
          <div className="grid gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sections</h4>
            {sectionEntries.map(([key, content]) => (
              <section key={key} className="rounded-md border bg-background/50 p-3">
                <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titleCase(key)}</h5>
                <pre className="whitespace-pre-wrap break-words text-xs text-foreground">{content}</pre>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
