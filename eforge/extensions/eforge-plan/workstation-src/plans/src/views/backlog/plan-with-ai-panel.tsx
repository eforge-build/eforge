import * as React from 'react';
import { Loader2, Sparkles, XCircle } from 'lucide-react';
import { getBridge } from '@/bridge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast';
import type { ApplyPlanningTaskResponse, JsonObject, PlanningAgentTaskRecord, PlanningAgentTaskResponse, RecommendationModel } from '@/types';

const bridge = getBridge();
const POLL_MS = 1600;

interface PlanWithAiPanelProps {
  selectedItemIds: string[];
  recommendationRefs: string[];
  recommendations: RecommendationModel | null;
  onRefresh: () => Promise<void>;
}

export function PlanWithAiPanel({ selectedItemIds, recommendationRefs, recommendations, onRefresh }: PlanWithAiPanelProps) {
  const toast = useToast();
  const [userGoal, setUserGoal] = React.useState('Draft a safe planning update for the selected backlog work.');
  const [session, setSession] = React.useState('');
  const [task, setTask] = React.useState<PlanningAgentTaskRecord | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirmingRecommendations, setConfirmingRecommendations] = React.useState(false);
  const [confirmingSessionPlan, setConfirmingSessionPlan] = React.useState(false);
  const [confirmingHandoff, setConfirmingHandoff] = React.useState(false);

  const running = task?.status === 'queued' || task?.status === 'running';
  const patchSections = task?.result?.sessionPlanPatch?.sections ?? [];
  const handoffDrafts = task?.result?.handoffDrafts ?? (task?.result?.handoffDraft ? [task.result.handoffDraft] : []);
  const canApplyRecommendations = Boolean(task?.result?.recommendations);
  const canApplySessionPlan = patchSections.length > 0 && session.trim().length > 0;

  React.useEffect(() => {
    if (!running || !task) return undefined;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void bridge.invokeAction<PlanningAgentTaskResponse>('get-planning-agent-task', { taskId: task.taskId }).then((response) => {
        if (!cancelled) setTask(response.task);
      }).catch((caught) => {
        if (!cancelled) toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
      });
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [running, task, toast]);

  const start = async () => {
    setBusy(true);
    setConfirmingRecommendations(false);
    setConfirmingSessionPlan(false);
    setConfirmingHandoff(false);
    try {
      const input: JsonObject = {
        userGoal,
        includeRoadmap: true,
        requestedOutputSections: ['recommendations', 'handoffDrafts', 'sessionPlanPatch'],
      };
      if (selectedItemIds.length > 0) input.itemIds = selectedItemIds;
      else if (recommendationRefs.length > 0) input.recommendationRef = recommendationRefs[0];
      if (session.trim()) input.session = session.trim();
      const response = await bridge.invokeAction<PlanningAgentTaskResponse>('start-planning-agent-task', input);
      setTask(response.task);
      toast.push(`Started planning task ${response.task.taskId}.`, 'success');
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!task) return;
    setBusy(true);
    try {
      const response = await bridge.invokeAction<PlanningAgentTaskResponse>('cancel-planning-agent-task', { taskId: task.taskId, reason: 'user requested cancellation' });
      setTask(response.task);
      toast.push(`Cancelled ${response.task.taskId}.`, 'success');
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
    } finally {
      setBusy(false);
    }
  };

  const apply = async (input: JsonObject) => {
    if (!task) return;
    setBusy(true);
    try {
      const response = await bridge.invokeAction<ApplyPlanningTaskResponse>('apply-planning-agent-task-result', { taskId: task.taskId, ...input });
      toast.push(`Applied generated output from ${response.taskId}.`, 'success');
      setConfirmingRecommendations(false);
      setConfirmingSessionPlan(false);
      setConfirmingHandoff(false);
      await onRefresh();
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-bright"><Sparkles className="h-4 w-4 text-primary" /> Plan with AI</h3>
          <p className="mt-1 text-xs text-muted-foreground">Start one daemon-owned planning draft task. Preview the result here, then explicitly apply only the pieces you want.</p>
        </div>
        {running && <Button size="sm" variant="outline" disabled={busy} onClick={() => void cancel()}><XCircle className="h-4 w-4" /> Cancel</Button>}
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_13rem_auto]">
        <input className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground" value={userGoal} onChange={(event) => setUserGoal(event.target.value)} />
        <input className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground" value={session} onChange={(event) => setSession(event.target.value)} placeholder="session for patch apply" />
        <Button disabled={busy || running || !userGoal.trim()} onClick={() => void start()}>{busy && !running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Plan with AI</Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Context: {selectedItemIds.length > 0 ? `${selectedItemIds.length} selected item(s)` : recommendationRefs.length > 0 ? `recommendation ${recommendationRefs[0]}` : 'open backlog'} · current recommendations: {recommendations ? 'available' : 'none'}</p>

      {task && <TaskPreview task={task} />}

      {task?.status === 'completed' && task.result && (
        <div className="mt-3 grid gap-2 border-t border-border pt-3 text-sm">
          {canApplyRecommendations && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Generated recommendations are available.</span>
              <Button size="sm" variant={confirmingRecommendations ? 'destructive' : 'secondary'} disabled={busy} onClick={() => confirmingRecommendations ? void apply({ applyRecommendations: true }) : setConfirmingRecommendations(true)}>{confirmingRecommendations ? 'Confirm apply recommendations' : 'Apply recommendations'}</Button>
              {confirmingRecommendations && <Button size="sm" variant="ghost" onClick={() => setConfirmingRecommendations(false)}>Cancel</Button>}
            </div>
          )}
          {handoffDrafts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Generated handoff draft{handoffDrafts.length === 1 ? '' : 's'} are available.</span>
              <Button size="sm" variant={confirmingHandoff ? 'destructive' : 'secondary'} disabled={busy} onClick={() => confirmingHandoff ? void apply({ applyHandoffDrafts: handoffDrafts.map((_, index) => ({ index })) }) : setConfirmingHandoff(true)}>{confirmingHandoff ? 'Confirm apply handoff drafts' : 'Apply handoff drafts'}</Button>
              {confirmingHandoff && <Button size="sm" variant="ghost" onClick={() => setConfirmingHandoff(false)}>Cancel</Button>}
            </div>
          )}
          {patchSections.length > 0 && (
            <div className="grid gap-2 rounded-md border bg-background/50 p-2">
              <span className="text-muted-foreground">Session-plan patch sections: {patchSections.map((section) => section.dimension).join(', ')}</span>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={confirmingSessionPlan ? 'destructive' : 'secondary'} disabled={busy || !canApplySessionPlan} onClick={() => confirmingSessionPlan ? void apply({ applySessionPlanDrafts: [{ session: session.trim(), sections: patchSections.map((section) => section.dimension) }] }) : setConfirmingSessionPlan(true)}>{confirmingSessionPlan ? 'Confirm apply session-plan content' : 'Apply session-plan content'}</Button>
                {confirmingSessionPlan && <Button size="sm" variant="ghost" onClick={() => setConfirmingSessionPlan(false)}>Cancel</Button>}
              </div>
              {!session.trim() && <span className="text-xs text-muted-foreground">Enter a session id before applying generated session-plan content.</span>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function TaskPreview({ task }: { task: PlanningAgentTaskRecord }) {
  const result = task.result;
  return (
    <div className="mt-3 rounded-md border bg-background/60 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{task.taskId}</span>
        <span className="rounded border border-border px-1.5 py-0.5 text-xs text-text-bright">{task.status}</span>
        {task.metadata?.progressMessage && <span className="text-xs text-muted-foreground">{task.metadata.progressMessage}</span>}
      </div>
      {task.status === 'failed' && <p className="mt-2 text-xs text-destructive-foreground">{task.errorMessage ?? task.errorCode ?? 'Task failed.'}</p>}
      {task.status === 'cancelled' && <p className="mt-2 text-xs text-muted-foreground">{task.errorMessage ?? 'Task cancelled.'}</p>}
      {result && (
        <div className="mt-2 grid gap-2">
          <p className="text-foreground">{result.summary}</p>
          {result.planDrafts?.map((draft) => <PreviewBlock key={draft.title} title={draft.title} body={draft.body} />)}
          {result.playbookDraft && <PreviewBlock title={`Playbook: ${result.playbookDraft.name}`} body={result.playbookDraft.body} />}
          {result.recommendations && <RecommendationsPreview recommendations={result.recommendations} />}
          {result.handoffDraft && <PreviewBlock title="Handoff draft" body={JSON.stringify(result.handoffDraft, null, 2)} />}
          {result.handoffDrafts?.map((draft, index) => <PreviewBlock key={draft.session ?? index} title={`Handoff draft ${index + 1}`} body={JSON.stringify(draft, null, 2)} />)}
          {result.sessionPlanPatch?.sections.map((section) => <PreviewBlock key={section.dimension} title={`Session section: ${section.dimension}`} body={section.content} />)}
          {result.assumptionsOpenQuestions.length > 0 && <ul className="list-disc pl-4 text-xs text-muted-foreground">{result.assumptionsOpenQuestions.map((entry) => <li key={entry}>{entry}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}

function RecommendationsPreview({ recommendations }: { recommendations: NonNullable<PlanningAgentTaskRecord['result']>['recommendations'] }) {
  if (!recommendations) return null;
  const next = Array.isArray(recommendations.recommendedNextSequence) ? recommendations.recommendedNextSequence.map((entry) => entry.itemId).join(', ') : '';
  const groups = Array.isArray(recommendations.safeParallelizableGroups) ? recommendations.safeParallelizableGroups.map((group) => group.itemIds.join('+')).join('; ') : '';
  const rationale = Array.isArray(recommendations.rationaleAndAssumptions) ? recommendations.rationaleAndAssumptions.slice(0, 3).join('\n') : '';
  const concise = [
    next ? `Next sequence: ${next}` : '',
    groups ? `Parallel groups: ${groups}` : '',
    rationale ? `Rationale:\n${rationale}` : '',
  ].filter(Boolean).join('\n\n') || 'Generated recommendations are available.';
  return <PreviewBlock title="Generated recommendations" body={`${concise}\n\nDetails:\n${JSON.stringify(recommendations, null, 2)}`} />;
}

function PreviewBlock({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded border border-border bg-card p-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">{body}</pre>
    </section>
  );
}
