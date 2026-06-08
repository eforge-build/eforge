import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type {
  JsonObject,
  PlanningAgentTaskListItem,
  PlanningTaskClarificationQuestion,
  PlanningTaskResult,
} from '@/types';
import type { RedraftInput } from './use-planning-task-workflows';

interface PlanningTaskResultPreviewProps {
  item: PlanningAgentTaskListItem;
  busy: boolean;
  onRedraft: (taskId: string, input: RedraftInput) => Promise<void>;
  onApply: (taskId: string, input: JsonObject) => Promise<void>;
}

export function PlanningTaskResultPreview({ item, busy, onRedraft, onApply }: PlanningTaskResultPreviewProps) {
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

  return <ReadyResultPreview taskId={taskId} result={result} sessionHint={item.entry.session} busy={busy} onApply={onApply} />;
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
    <div className="mt-3 grid gap-2 border-t border-border pt-3">
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
    </div>
  );
}

interface ReadyResultPreviewProps {
  taskId: string;
  result: PlanningTaskResult;
  sessionHint?: string;
  busy: boolean;
  onApply: (taskId: string, input: JsonObject) => Promise<void>;
}

function ReadyResultPreview({ taskId, result, sessionHint, busy, onApply }: ReadyResultPreviewProps) {
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

  return (
    <div className="mt-3 grid gap-2 border-t border-border pt-3 text-sm">
      <p className="text-foreground">{result.summary}</p>
      {result.nextSteps && result.nextSteps.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-muted-foreground">{result.nextSteps.map((step) => <li key={step}>{step}</li>)}</ul>
      )}

      {creationDraft && (
        <div className="grid gap-2 rounded-md border border-primary/30 bg-primary/5 p-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ready session-plan draft · {creationDraft.session}</span>
          <span className="text-xs text-muted-foreground">{creationDraft.topic} · {creationDraft.planningType}/{creationDraft.planningDepth}</span>
          {creationDraft.sections.map((section) => <PreviewBlock key={section.dimension} title={section.dimension} body={section.content} />)}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={confirming === 'creation' ? 'destructive' : 'secondary'} disabled={busy} onClick={() => apply('creation', { applySessionPlanCreationDraft: {} })}>{confirming === 'creation' ? 'Confirm create session plan' : 'Create session plan'}</Button>
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
        <div className="grid gap-2 rounded-md border border-border bg-background/50 p-2">
          <span className="text-muted-foreground">Session-plan patch sections: {patchSections.map((section) => section.dimension).join(', ')}</span>
          {patchSections.map((section) => <PreviewBlock key={section.dimension} title={section.dimension} body={section.content} />)}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={confirming === 'patch' ? 'destructive' : 'secondary'} disabled={busy || sessionForPatch.length === 0} onClick={() => apply('patch', { applySessionPlanDrafts: [{ session: sessionForPatch, sections: patchSections.map((section) => section.dimension) }] })}>{confirming === 'patch' ? 'Confirm apply session-plan content' : 'Apply session-plan content'}</Button>
            {confirming === 'patch' && <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>}
          </div>
          {sessionForPatch.length === 0 && <span className="text-xs text-muted-foreground">No target session is associated with this task; patch apply is unavailable.</span>}
        </div>
      )}

      {result.assumptionsOpenQuestions.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-muted-foreground">{result.assumptionsOpenQuestions.map((entry) => <li key={entry}>{entry}</li>)}</ul>
      )}
    </div>
  );
}

function PreviewBlock({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded border border-border bg-card p-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">{body}</pre>
    </section>
  );
}
