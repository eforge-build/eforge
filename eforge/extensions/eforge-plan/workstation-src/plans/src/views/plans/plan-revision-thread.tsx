import * as React from 'react';
import { RotateCcw, StopCircle } from 'lucide-react';
import { SafeMarkdown } from '@/components/safe-markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatRelativeTime, shortTaskId } from '@/lib/format-time';
import type { PlanData, PlanRevisionApplyOutput, PlanRevisionRedraftAnswer, PlanRevisionTurnProjection } from '@/types';
import { PlanRevisionPatchPreview } from './plan-revision-patch-preview';
import { chronologicalTurns, classifyRevisionTurn, patchSections, statusLabel, taskProgressText } from './plan-revision-view-model';

interface Props {
  plan: PlanData;
  turns: PlanRevisionTurnProjection[];
  busy: boolean;
  lastApplyByTurn: Record<string, PlanRevisionApplyOutput>;
  onCancel: (turn: PlanRevisionTurnProjection) => Promise<void>;
  onRetry: (turn: PlanRevisionTurnProjection) => Promise<void>;
  onRedraft: (turn: PlanRevisionTurnProjection, answers: PlanRevisionRedraftAnswer[], steering?: string) => Promise<void>;
  onApply: (turn: PlanRevisionTurnProjection, sections: string[]) => Promise<unknown>;
}

function ClarificationForm({ turn, busy, onRedraft }: Pick<Props, 'busy' | 'onRedraft'> & { turn: PlanRevisionTurnProjection }) {
  const questions = turn.task?.result?.clarificationQuestions ?? [];
  const [answers, setAnswers] = React.useState<Record<number, string>>({});
  const [steering, setSteering] = React.useState('');
  const submit = () => {
    const payload = questions.map((question, index) => ({ prompt: question.question, answer: answers[index] ?? '' })).filter((entry) => entry.answer.trim().length > 0);
    void onRedraft(turn, payload, steering);
  };
  return <div className="grid gap-2 rounded-md border bg-background/50 p-3">
    <p className="text-xs text-muted-foreground">{turn.task?.result?.rationale}</p>
    {questions.map((question, index) => <label key={`${question.question}-${index}`} className="grid gap-1 text-xs"><span className="font-medium">{question.question}</span>{question.why && <span className="text-muted-foreground">{question.why}</span>}<Textarea value={answers[index] ?? ''} onChange={(event) => setAnswers((prev) => ({ ...prev, [index]: event.target.value }))} /></label>)}
    <label className="grid gap-1 text-xs"><span className="font-medium">Optional steering</span><Textarea value={steering} onChange={(event) => setSteering(event.target.value)} /></label>
    <div><Button size="sm" disabled={busy} onClick={submit}>Answer and redraft</Button></div>
  </div>;
}

export function PlanRevisionThread({ plan, turns, busy, lastApplyByTurn, onCancel, onRetry, onRedraft, onApply }: Props) {
  if (turns.length === 0) return <p className="text-xs text-muted-foreground">No revision turns yet. Ask a question or request a targeted plan change.</p>;
  return <div className="grid gap-3">
    {chronologicalTurns(turns).map((turn) => {
      const task = turn.task;
      const kind = classifyRevisionTurn(turn);
      const revision = task?.result?.planRevisionTurn;
      const progress = taskProgressText(task);
      return <article key={turn.turnId} className="grid gap-2 rounded-md border p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{statusLabel(turn)}</Badge>
          <span>{task?.taskId ? shortTaskId(task.taskId) : turn.taskId}</span>
          <span>{formatRelativeTime(turn.createdAt) ?? turn.createdAt}</span>
          {turn.staleReason && <span>{turn.staleReason}</span>}
        </div>
        <div className="rounded-md bg-secondary/40 p-2 text-sm"><strong>You:</strong> {turn.userMessage}</div>
        {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
        {(kind === 'queued' || kind === 'running') && <div className="flex items-center gap-2"><Badge>{kind}</Badge><Button size="sm" variant="outline" disabled={busy} onClick={() => void onCancel(turn)}><StopCircle className="h-4 w-4" /> Cancel</Button></div>}
        {(kind === 'failed' || kind === 'cancelled') && <div className="grid gap-2"><p className="text-xs text-destructive-foreground">{task?.errorMessage ?? 'Revision turn did not complete.'}</p><div><Button size="sm" variant="outline" disabled={busy} onClick={() => void onRetry(turn)}><RotateCcw className="h-4 w-4" /> Retry with preserved context</Button></div></div>}
        {kind === 'unavailable' && <p className="text-xs text-muted-foreground">Revision task unavailable: {turn.staleReason ?? 'missing linked task record'}.</p>}
        {kind === 'needs-input' && <ClarificationForm turn={turn} busy={busy} onRedraft={onRedraft} />}
        {revision?.assistantMessage && <div className="rounded-md border bg-background/50 p-2 text-sm"><SafeMarkdown markdown={revision.assistantMessage} /></div>}
        {(revision?.citations?.length ?? 0) > 0 && <div className="flex flex-wrap gap-1 text-xs">{revision?.citations?.map((citation, index) => <Badge key={`${citation.label}-${index}`} variant="outline">{citation.label}{citation.excerpt ? `: ${citation.excerpt}` : ''}</Badge>)}</div>}
        {kind === 'answer' && patchSections(turn).length === 0 && <p className="text-xs text-muted-foreground">Answer-only revision turn. No mutation controls are available.</p>}
        {kind === 'patch' && <PlanRevisionPatchPreview plan={plan} turn={turn} busy={busy} applyResult={lastApplyByTurn[turn.turnId]} onApply={onApply} />}
        {(turn.appliedSections?.length ?? 0) > 0 && <div className="flex flex-wrap gap-1 text-xs"><span>Applied {turn.appliedAt ?? ''}</span>{turn.appliedSections?.map((dimension) => <Badge key={dimension}>{dimension}</Badge>)}</div>}
      </article>;
    })}
  </div>;
}
