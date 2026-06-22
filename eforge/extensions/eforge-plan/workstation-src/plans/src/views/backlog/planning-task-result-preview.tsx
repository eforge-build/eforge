import * as React from 'react';
import { Button } from '@/components/ui/button';
import { SafeMarkdown } from '@/components/safe-markdown';
import { Textarea } from '@/components/ui/textarea';
import type {
  JsonObject,
  PlanningAgentTaskListItem,
  PlanningTaskApplyError,
  PlanningTaskClarificationQuestion,
  PlanningTaskResult,
} from '@/types';
import { BacklogCurationPreview } from './backlog-curation-preview';
import { SubBlock } from './sub-block';
import type { RedraftInput } from './use-planning-task-workflows';

interface PlanningTaskResultPreviewProps {
  item: PlanningAgentTaskListItem;
  busy: boolean;
  onRedraft: (taskId: string, input: RedraftInput) => Promise<void>;
  onApply: (taskId: string, input: JsonObject) => Promise<unknown>;
  applyError?: PlanningTaskApplyError;
}

export function PlanningTaskResultPreview({ item, busy, onRedraft, onApply, applyError }: PlanningTaskResultPreviewProps) {
  const taskId = item.entry.taskId;
  const result = item.task?.result;
  if (!result) return null;

  if (result.decision === 'needs-input' && result.clarificationQuestions && result.clarificationQuestions.length > 0) {
    return (
      <NeedsInputPreview
        taskId={taskId}
        busy={busy}
        summary={result.summary}
        rationale={result.rationale}
        questions={result.clarificationQuestions}
        onRedraft={onRedraft}
      />
    );
  }

  if (item.entry.purpose === 'backlog-curation') {
    if (result.backlogCurationDraft) return <BacklogCurationPreview taskId={taskId} entry={item.entry} draft={result.backlogCurationDraft} recommendations={result.recommendations} curationPreview={item.backlogCurationPreview} busy={busy} onApply={onApply} onRedraft={onRedraft} />;
    return <CurationUnavailablePreview taskId={taskId} result={result} busy={busy} onRedraft={onRedraft} canRedraft />;
  }

  if (result.backlogCurationDraft) return <CurationUnavailablePreview taskId={taskId} result={result} busy={busy} onRedraft={onRedraft} />;

  return <ReadyResultPreview taskId={taskId} result={result} sessionHint={item.entry.session} busy={busy} onApply={onApply} applyError={applyError} />;
}

interface CurationUnavailablePreviewProps {
  taskId: string;
  result: PlanningTaskResult;
  busy: boolean;
  onRedraft: (taskId: string, input: RedraftInput) => Promise<void>;
  canRedraft?: boolean;
}

function CurationUnavailablePreview({ taskId, result, busy, onRedraft, canRedraft = false }: CurationUnavailablePreviewProps) {
  const [steering, setSteering] = React.useState('');
  const trimmedSteering = steering.trim();

  return (
    <SubBlock className="mt-3 pt-3 text-sm">
      <p className="text-foreground">{result.summary}</p>
      {result.nextSteps && result.nextSteps.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-muted-foreground">{result.nextSteps.map((step) => <li key={step}>{step}</li>)}</ul>
      )}
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Backlog curation draft unavailable</span>
      <p className="text-xs text-muted-foreground">This result cannot be applied as backlog curation because it did not include an applicable curation draft.</p>
      {canRedraft && (
        <SubBlock>
          <Textarea className="min-h-16" value={steering} onChange={(event) => setSteering(event.target.value)} placeholder="Optional steering for a curation redraft" />
          <div><Button size="sm" variant="secondary" disabled={busy || trimmedSteering.length === 0} onClick={() => void onRedraft(taskId, { steering: trimmedSteering })}>Redraft curation</Button></div>
        </SubBlock>
      )}
    </SubBlock>
  );
}

interface NeedsInputPreviewProps {
  taskId: string;
  busy: boolean;
  summary: string;
  rationale?: string;
  questions: PlanningTaskClarificationQuestion[];
  onRedraft: (taskId: string, input: RedraftInput) => Promise<void>;
}

function NeedsInputPreview({ taskId, busy, summary, rationale, questions, onRedraft }: NeedsInputPreviewProps) {
  const [answers, setAnswers] = React.useState<string[]>(() => questions.map(() => ''));
  const [steering, setSteering] = React.useState('');
  const trimmedAnswers = answers.map((value) => value.trim());
  const hasAnswers = trimmedAnswers.some((value) => value.length > 0);
  const canRedraft = hasAnswers || steering.trim().length > 0;

  const submit = () => {
    const input: RedraftInput = {};
    const answered = questions
      .map((question, index) => ({ question: question.question, answer: trimmedAnswers[index] ?? '' }))
      .filter((entry) => entry.answer.length > 0)
      .map((entry) => `Q: ${entry.question}\nA: ${entry.answer}`);
    if (answered.length > 0) input.answers = answered;
    if (steering.trim().length > 0) input.steering = steering.trim();
    void onRedraft(taskId, input);
  };

  return (
    <SubBlock className="mt-3 pt-3">
      <p className="text-foreground">{summary}</p>
      {rationale && <p className="text-xs text-muted-foreground">{rationale}</p>}
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Needs input before drafting</span>
      <ol className="grid gap-2">
        {questions.map((question, index) => (
          <li key={question.question} className="grid gap-1">
            <span className="text-foreground">{index + 1}. {question.question}</span>
            {question.why && <span className="text-xs text-muted-foreground">{question.why}</span>}
            {question.options && question.options.length > 0 && <span className="text-xs text-muted-foreground">Options: {question.options.join(', ')}</span>}
            <Textarea
              className="min-h-16"
              value={answers[index]}
              onChange={(event) => setAnswers((prev) => prev.map((value, idx) => (idx === index ? event.target.value : value)))}
              placeholder="Your answer"
            />
          </li>
        ))}
      </ol>
      <Textarea className="min-h-16" value={steering} onChange={(event) => setSteering(event.target.value)} placeholder="Optional steering for the redraft" />
      <div>
        <Button size="sm" disabled={busy || !canRedraft} onClick={submit}>Answer and redraft</Button>
      </div>
    </SubBlock>
  );
}

interface ReadyResultPreviewProps {
  taskId: string;
  result: PlanningTaskResult;
  sessionHint?: string;
  busy: boolean;
  onApply: (taskId: string, input: JsonObject) => Promise<unknown>;
  applyError?: PlanningTaskApplyError;
}

function ReadyResultPreview({ taskId, result, sessionHint, busy, onApply, applyError }: ReadyResultPreviewProps) {
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const creationDraft = result.sessionPlanCreationDraft;
  const recommendations = result.recommendations;
  const handoffDrafts = result.handoffDrafts ?? (result.handoffDraft ? [result.handoffDraft] : []);
  const patchSections = result.sessionPlanPatch?.sections ?? [];
  const sessionForPatch = (sessionHint ?? creationDraft?.session ?? '').trim();

  const apply = (key: string, input: JsonObject) => {
    if (confirming !== key) { setConfirming(key); return; }
    setConfirming(null);
    void onApply(taskId, input);
  };

  const assumptions = result.assumptionsOpenQuestions ?? [];
  const hasDetail =
    Boolean(result.summary) ||
    (result.nextSteps?.length ?? 0) > 0 ||
    (creationDraft?.sections.length ?? 0) > 0 ||
    patchSections.length > 0 ||
    assumptions.length > 0;

  return (
    <SubBlock className="mt-3 pt-3 text-sm">
      {/* Primary actions stay visible; the verbose summary/sections/assumptions
          collapse so a list of ready cards stays scannable. The card header
          already carries the plan topic, so it is not repeated here. */}
      {applyError && creationDraft && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive-foreground">
          {applyError.automatic ? 'Automatic session-plan creation failed' : 'Session-plan creation failed'}: <span className="break-words">{applyError.message}</span>. Manual creation remains available below after review.
        </div>
      )}

      {creationDraft && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-2xs uppercase tracking-wide text-muted-foreground">Session-plan draft · {creationDraft.planningType}/{creationDraft.planningDepth} · {creationDraft.sections.length} section{creationDraft.sections.length === 1 ? '' : 's'}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={confirming === 'creation' ? 'destructive' : 'default'} disabled={busy} onClick={() => apply('creation', { applySessionPlanCreationDraft: {} })}>{confirming === 'creation' ? 'Confirm create session plan' : 'Create session plan'}</Button>
            {confirming === 'creation' && <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>}
          </div>
        </div>
      )}

      {recommendations && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Generated recommendations are available.</span>
          <Button size="sm" variant={confirming === 'recommendations' ? 'destructive' : 'secondary'} disabled={busy} onClick={() => apply('recommendations', { applyRecommendations: true })}>{confirming === 'recommendations' ? 'Confirm apply recommendations' : 'Apply recommendations'}</Button>
          {confirming === 'recommendations' && <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>}
        </div>
      )}

      {handoffDrafts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Generated handoff draft{handoffDrafts.length === 1 ? '' : 's'} are available.</span>
          <Button size="sm" variant={confirming === 'handoff' ? 'destructive' : 'secondary'} disabled={busy} onClick={() => apply('handoff', { applyHandoffDrafts: handoffDrafts.map((_, index) => ({ index })) })}>{confirming === 'handoff' ? 'Confirm apply handoff drafts' : 'Apply handoff drafts'}</Button>
          {confirming === 'handoff' && <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>}
        </div>
      )}

      {patchSections.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-2xs uppercase tracking-wide text-muted-foreground">Session-plan patch{sessionForPatch ? ` · ${sessionForPatch}` : ''} · {patchSections.length} section{patchSections.length === 1 ? '' : 's'}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={confirming === 'patch' ? 'destructive' : 'default'} disabled={busy || sessionForPatch.length === 0} onClick={() => apply('patch', { applySessionPlanDrafts: [{ session: sessionForPatch, sections: patchSections.map((section) => section.dimension) }] })}>{confirming === 'patch' ? 'Confirm apply session-plan content' : 'Apply session-plan content'}</Button>
            {confirming === 'patch' && <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>}
          </div>
        </div>
      )}
      {patchSections.length > 0 && sessionForPatch.length === 0 && <span className="text-xs text-muted-foreground">No target session is associated with this task; patch apply is unavailable.</span>}

      {hasDetail && (
        <details className="mt-0.5">
          <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">Review draft details</summary>
          <div className="mt-2 grid gap-2">
            {result.summary && <p className="text-foreground">{result.summary}</p>}
            {result.nextSteps && result.nextSteps.length > 0 && (
              <ul className="list-disc pl-4 text-xs text-muted-foreground">{result.nextSteps.map((step) => <li key={step}>{step}</li>)}</ul>
            )}
            {creationDraft && creationDraft.sections.length > 0 && (
              <div className="grid gap-1">{creationDraft.sections.map((section) => <PreviewSection key={section.dimension} title={section.dimension} body={section.content} />)}</div>
            )}
            {patchSections.length > 0 && (
              <div className="grid gap-1">{patchSections.map((section) => <PreviewSection key={section.dimension} title={section.dimension} body={section.content} />)}</div>
            )}
            {assumptions.length > 0 && (
              <ul className="list-disc pl-4 text-xs text-muted-foreground">{assumptions.map((entry) => <li key={entry}>{entry}</li>)}</ul>
            )}
            {creationDraft && <p className="text-2xs text-muted-foreground">Creating the plan opens it in the Plans tab, where you can keep iterating.</p>}
          </div>
        </details>
      )}
    </SubBlock>
  );
}

// Collapsed-by-default section row. A left rule instead of a box keeps the
// draft scannable as a list of section names without nesting more borders;
// expand only the sections worth verifying before apply.
function PreviewSection({ title, body }: { title: string; body: string }) {
  const lineCount = body.split('\n').length;
  return (
    <details className="border-l-2 border-border pl-2 open:border-primary/50">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
        {title} <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground/70">{lineCount} line{lineCount === 1 ? '' : 's'}</span>
      </summary>
      <div className="mt-1">
        <SafeMarkdown markdown={body} />
      </div>
    </details>
  );
}
