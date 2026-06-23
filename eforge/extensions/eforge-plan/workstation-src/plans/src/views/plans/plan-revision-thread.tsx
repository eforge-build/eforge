import * as React from 'react';
import { RotateCcw, StopCircle } from 'lucide-react';
import { SafeMarkdown } from '@/components/safe-markdown';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatRelativeTime, shortTaskId } from '@/lib/format-time';
import type { PlanRevisionRedraftAnswer, PlanRevisionTurnProjection } from '@/types';
import { PlanRevisionPatchSummary } from './plan-revision-patch-summary';
import { titleCase } from './dimensions';
import { chronologicalTurns, classifyRevisionTurn, patchSections, statusLabel, taskProgressText } from './plan-revision-view-model';

interface Props {
  turns: PlanRevisionTurnProjection[];
  busy: boolean;
  onCancel: (turn: PlanRevisionTurnProjection) => Promise<void>;
  onRetry: (turn: PlanRevisionTurnProjection) => Promise<void>;
  onRedraft: (turn: PlanRevisionTurnProjection, answers: PlanRevisionRedraftAnswer[], steering?: string) => Promise<void>;
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

export function PlanRevisionThread({ turns, busy, onCancel, onRetry, onRedraft }: Props) {
  if (turns.length === 0) return <p className="text-xs text-muted-foreground">No revision turns yet. Ask a question or request a targeted plan change.</p>;
  return <div className="grid gap-3">
    {chronologicalTurns(turns).map((turn) => {
      const task = turn.task;
      const kind = classifyRevisionTurn(turn);
      const revision = task?.result?.planRevisionTurn;
      const progress = taskProgressText(task);
      const running = kind === 'queued' || kind === 'running';
      return <article key={turn.turnId} className="grid gap-2 rounded-md border p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{statusLabel(turn)}</Badge>
          <span>{task?.taskId ? shortTaskId(task.taskId) : turn.taskId}</span>
          <span>{formatRelativeTime(turn.createdAt) ?? turn.createdAt}</span>
          {turn.staleReason && <span>{turn.staleReason}</span>}
        </div>
        <div className="rounded-md bg-secondary/40 p-2 text-sm"><strong>You:</strong> {turn.userMessage}</div>
        {running && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner />{progress ?? 'Working on this revision…'}</p>}
        {!running && progress && <p className="text-xs text-muted-foreground">{progress}</p>}
        {running && <div><Button size="sm" variant="outline" disabled={busy} onClick={() => void onCancel(turn)}><StopCircle className="h-4 w-4" /> Cancel</Button></div>}
        {(kind === 'failed' || kind === 'cancelled') && <div className="grid gap-2"><p className="text-xs text-destructive-foreground">{task?.errorMessage ?? 'Revision turn did not complete.'}</p><div><Button size="sm" variant="outline" disabled={busy} onClick={() => void onRetry(turn)}><RotateCcw className="h-4 w-4" /> Retry with preserved context</Button></div></div>}
        {kind === 'unavailable' && <p className="text-xs text-muted-foreground">Revision task unavailable: {turn.staleReason ?? 'missing linked task record'}.</p>}
        {kind === 'needs-input' && <ClarificationForm turn={turn} busy={busy} onRedraft={onRedraft} />}
        {revision?.assistantMessage && <div className="rounded-md border bg-background/50 p-2 text-sm"><SafeMarkdown markdown={revision.assistantMessage} /></div>}
        {(revision?.citations?.length ?? 0) > 0 && <div className="flex flex-wrap gap-1 text-xs">{revision?.citations?.map((citation, index) => <Badge key={`${citation.label}-${index}`} variant="outline">{citation.label}{citation.excerpt ? `: ${citation.excerpt}` : ''}</Badge>)}</div>}
        {kind === 'answer' && patchSections(turn).length === 0 && <p className="text-xs text-muted-foreground">Answer-only revision turn.</p>}
        {kind === 'patch' && <PlanRevisionPatchSummary turn={turn} />}
        {(turn.appliedSections?.length ?? 0) > 0 && <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"><span>Applied {turn.appliedAt ? formatRelativeTime(turn.appliedAt) ?? '' : ''}:</span>{turn.appliedSections?.map((dimension) => <Badge key={dimension} variant="outline">{titleCase(dimension)}</Badge>)}</div>}
      </article>;
    })}
  </div>;
}
