import * as React from 'react';
import { AlertTriangle, Ban, CheckCircle2, CircleDashed, Trash2, XCircle, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ToneChip } from '@/components/ui/tone-chip';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';
import { agentTaskTone, type Tone } from '@/lib/tone';
import { formatRelativeTime, shortTaskId } from '@/lib/format-time';
import { isGeneratedPlannerPrompt, selectionItemsLabel } from '@/lib/plan-title';
import type { BacklogCurationItemProgress, BacklogCurationItemProgressStatus, BacklogCurationProgress, JsonObject, PlanningAgentTaskListItem, PlanningAgentTaskRecord, PlanningTaskApplyError, PlanningTaskSectionProgress, PlanningTaskWorkflowEntry } from '@/types';
import { PlanningTaskLatestActivity } from './planning-task-activity';
import { PlanningTaskResultPreview } from './planning-task-result-preview';
import type { RedraftInput } from './use-planning-task-workflows';

interface PlanningTaskCardProps {
  item: PlanningAgentTaskListItem;
  busy: boolean;
  /** Board id->title map so a task heading can name its backlog item(s). */
  titles?: Map<string, string>;
  onCancel: (taskId: string) => Promise<void>;
  onRemove: (taskId: string) => Promise<void>;
  onRetry: (taskId: string) => Promise<void>;
  onRedraft: (taskId: string, input: RedraftInput) => Promise<void>;
  onApply: (taskId: string, input: JsonObject) => Promise<unknown>;
  applyError?: PlanningTaskApplyError;
  detailLoading?: boolean;
  detailError?: string;
}

export function PlanningTaskCard({ item, busy, titles, onCancel, onRemove, onRetry, onRedraft, onApply, applyError, detailLoading = false, detailError }: PlanningTaskCardProps) {
  const { entry, task } = item;
  const status = task?.status ?? item.status ?? 'queued';
  const running = status === 'queued' || status === 'running';
  const heading = planningHeading(item, titles);
  const groupRef = entry.selection.recommendationRef ?? entry.selection.sourceRecommendationRef;
  const retryable = (status === 'failed' || status === 'cancelled') && item.available;
  const removable = !running;

  return (
    <article className="rounded-md border border-border bg-background/60 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ToneChip tone={agentTaskTone(status)} className="shrink-0 text-xs">{status}</ToneChip>
            <p className="line-clamp-2 min-w-0 flex-1 break-words font-medium leading-snug text-foreground" title={heading.full}>{heading.title}</p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
            {entry.purpose === 'recommendation-refresh' && <span className="rounded border border-primary/30 bg-primary/10 px-1.5 text-text-bright">Recommendation refresh</span>}
            {entry.purpose === 'backlog-curation' && <span className="rounded border border-primary/30 bg-primary/10 px-1.5 text-text-bright">Backlog analysis</span>}
            <TaskIdBadge taskId={entry.taskId} />
            {groupRef && <span className="max-w-full truncate" title={groupRef}>{groupRef}</span>}
            {entry.parentTaskId && <span title={entry.parentTaskId}>↳ {shortTaskId(entry.parentTaskId)}</span>}
            {entry.createdAt && <span title={entry.createdAt}>started {formatRelativeTime(entry.createdAt)}</span>}
            {entry.appliedAt && <span title={entry.appliedAt}>applied {formatRelativeTime(entry.appliedAt)}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {running && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void onCancel(entry.taskId)}><XCircle className="h-4 w-4" /> Cancel</Button>
          )}
          {removable && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onRemove(entry.taskId)}><Trash2 className="h-4 w-4" /> Dismiss</Button>
          )}
        </div>
      </div>

      {!item.available && <p className="mt-2 text-xs text-muted-foreground">{item.staleReason ?? 'Task record is no longer available from the daemon.'}</p>}

      {running && <RunningProgress task={task} />}
      <PlanningTaskLatestActivity activityLog={task?.metadata?.activityLog} />

      {detailLoading && (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="h-3.5 w-3.5" /> Loading full task result…</p>
      )}
      {detailError && (
        <p className="mt-2 text-xs text-destructive-foreground">Could not load full task result: {detailError}</p>
      )}

      {applyError && (
        <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs">
          <p className="font-semibold text-destructive-foreground">{applyError.automatic ? 'Automatic session-plan creation failed.' : 'Session-plan creation failed.'}</p>
          <p className="mt-1 break-words text-destructive-foreground">{applyError.message}</p>
          <p className="mt-1 text-muted-foreground">Review the draft below, resolve any collision or validation issue, then use Create session plan to retry manually.</p>
        </div>
      )}

      {status === 'failed' && (
        <div className="mt-2 grid gap-2">
          <p className="text-xs text-destructive-foreground">{task?.errorMessage ?? task?.errorCode ?? 'Task failed.'}</p>
          {retryable && <div><Button size="sm" variant="secondary" disabled={busy} onClick={() => void onRetry(entry.taskId)}>Retry with preserved context</Button></div>}
        </div>
      )}

      {status === 'cancelled' && (
        <div className="mt-2 grid gap-2">
          <p className="text-xs text-muted-foreground">{task?.errorMessage ?? 'Task cancelled.'}</p>
          {retryable && <div><Button size="sm" variant="secondary" disabled={busy} onClick={() => void onRetry(entry.taskId)}>Retry with preserved context</Button></div>}
        </div>
      )}

      {status === 'completed' && task?.result && (
        <PlanningTaskResultPreview item={item} busy={busy} onRedraft={onRedraft} onApply={onApply} applyError={applyError} />
      )}
      {status === 'completed' && !task?.result && item.resultOmitted && !detailLoading && !detailError && (
        <p className="mt-2 text-xs text-muted-foreground">Open the task details to load the full generated result.</p>
      )}
    </article>
  );
}

// The stored request is a machine-built prompt ("Draft a session plan for
// recommendation group-x covering ...") used to seed the planner - not a title.
// Prefer the real plan topic once a draft exists; otherwise show a readable
// request (explicit goals, curation/refresh) or a compact selection label so the
// card heading stays scannable instead of restating the whole prompt.
function planningHeading(item: PlanningAgentTaskListItem, titles?: Map<string, string>): { title: string; full: string } {
  const { entry, task } = item;
  const topic = task?.result?.sessionPlanCreationDraft?.topic?.trim();
  const derived = entry.derivedRequest?.trim() ?? '';
  if (topic && !isGeneratedPlannerPrompt(topic)) return { title: topic, full: topic };
  if (derived && !isGeneratedPlannerPrompt(derived)) return { title: derived, full: derived };
  const fallback = `Plan ${selectionLabel(entry, titles)}`;
  return { title: fallback, full: derived || fallback };
}

function selectionLabel(entry: PlanningTaskWorkflowEntry, titles?: Map<string, string>): string {
  const group = entry.selection.recommendationRef ?? entry.selection.sourceRecommendationRef;
  if (group) return `lane ${group}`;
  const items = selectionItemsLabel(entry.selection, titles);
  if (items) return items;
  if (entry.selection.epicId) return `epic ${entry.selection.epicId}`;
  return shortTaskId(entry.taskId);
}

// Task ids are UUID-sized; show the short form and copy the full id on click
// so it never has to be read or transcribed from the screen.
function TaskIdBadge({ taskId }: { taskId: string }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(taskId);
      toast.push('Task id copied', 'success');
    } catch {
      toast.push('Could not copy task id', 'error');
    }
  };
  return (
    <button type="button" title={`${taskId}\n\nClick to copy the full task id.`} onClick={() => void copy()} className="font-mono text-xs text-muted-foreground hover:text-foreground">
      {shortTaskId(taskId)}
    </button>
  );
}

function RunningProgress({ task }: { task?: PlanningAgentTaskRecord }) {
  const progress = task?.metadata?.sectionProgress;
  const backlogCurationProgress = task?.metadata?.backlogCurationProgress;
  const message = task?.metadata?.progressMessage;
  return (
    <div className="mt-2 grid gap-2 text-xs text-muted-foreground">
      <span className="flex items-start gap-2"><Spinner className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="min-w-0 break-words text-foreground">{message ?? 'Planning in progress…'}</span></span>
      {backlogCurationProgress && <BacklogCurationProgressView progress={backlogCurationProgress} />}
      {progress && <SectionProgressView progress={progress} />}
    </div>
  );
}

// The backlog audit fans one agent out per item. A fixed 3-lane grid went
// lopsided the moment the work skewed (7 done, 1 running, 0 queued left two
// near-empty columns) and squeezed every title to "Validate backlog epic…" in
// the 34rem drawer. Instead show one full-width roster ordered by what needs
// attention first - running, then failures, then queued, then analyzed - so the
// list reads top-to-bottom, titles wrap to two readable lines, and empty buckets
// simply disappear rather than reserving dead space.
function BacklogCurationProgressView({ progress }: { progress: BacklogCurationProgress }) {
  const total = Math.max(0, progress.total);
  const percent = total === 0 ? 0 : Math.min(100, Math.round((progress.completed / total) * 100));
  const groups = groupCurationItems(progress.items);
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-medium text-foreground">Backlog item agents</span>
        <span className="text-2xs text-muted-foreground">
          <span className="text-foreground">{progress.completed}/{total} analyzed</span>
          {progress.running > 0 && <span className="ml-2 text-[color:var(--lane-progress)]">{progress.running} running</span>}
          {progress.remaining > 0 && <span className="ml-2">{progress.remaining} queued</span>}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-3 grid gap-3">
        {groups.map((group) => <CurationGroup key={group.key} group={group} />)}
      </div>
    </div>
  );
}

interface CurationGroupData { key: string; label: string; cap: number; items: BacklogCurationItemProgress[]; }

// Running and failed items always show in full - they are the ones a human acts
// on. Queued/analyzed buckets cap so a 50-item backlog does not bury them under
// an endless tail; the overflow count keeps the total honest.
function groupCurationItems(items: BacklogCurationItemProgress[]): CurationGroupData[] {
  const buckets: Record<string, BacklogCurationItemProgress[]> = { running: [], attention: [], pending: [], done: [] };
  for (const item of items) buckets[curationGroupKey(item.status)].push(item);
  const defs: Array<Omit<CurationGroupData, 'items'>> = [
    { key: 'running', label: 'Running', cap: Infinity },
    { key: 'attention', label: 'Needs attention', cap: Infinity },
    { key: 'pending', label: 'Queued', cap: 10 },
    { key: 'done', label: 'Analyzed', cap: 10 },
  ];
  return defs.filter((def) => buckets[def.key].length > 0).map((def) => ({ ...def, items: buckets[def.key] }));
}

function curationGroupKey(status: BacklogCurationItemProgressStatus): string {
  if (status === 'running') return 'running';
  if (status === 'failed' || status === 'cancelled') return 'attention';
  if (status === 'pending') return 'pending';
  return 'done';
}

function CurationGroup({ group }: { group: CurationGroupData }) {
  const shown = group.items.slice(0, group.cap);
  const hidden = group.items.length - shown.length;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-2xs uppercase tracking-wide text-muted-foreground">
        <span>{group.label}</span>
        <span className="h-px flex-1 bg-border/60" />
        <span>{group.items.length}</span>
      </div>
      <div className="grid gap-1.5">
        {shown.map((item) => <CurationItemRow key={item.itemId} item={item} />)}
        {hidden > 0 && <p className="px-1 text-2xs text-muted-foreground">+{hidden} more</p>}
      </div>
    </div>
  );
}

function CurationItemRow({ item }: { item: BacklogCurationItemProgress }) {
  const meta = curationStatusMeta(item.status);
  return (
    <div title={item.summary ?? item.itemId} className="flex items-start gap-2 rounded border border-border/60 bg-background/60 px-2.5 py-1.5">
      {item.status === 'running'
        ? <Spinner className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', meta.className)} />
        : <meta.icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', meta.className)} aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 line-clamp-2 leading-snug text-foreground">{item.title ?? item.itemId}</span>
          {item.verdict && <ToneChip tone={verdictTone(item.verdict)} className="shrink-0">{item.verdict}</ToneChip>}
        </div>
        {item.summary && <p className="mt-0.5 line-clamp-2 text-2xs text-muted-foreground">{item.summary}</p>}
      </div>
    </div>
  );
}

function curationStatusMeta(status: BacklogCurationItemProgressStatus): { icon: LucideIcon; className: string } {
  switch (status) {
    case 'running': return { icon: CircleDashed, className: 'text-[color:var(--lane-progress)]' };
    case 'completed':
    case 'cache-hit': return { icon: CheckCircle2, className: 'text-[color:var(--lane-done)]' };
    case 'failed': return { icon: AlertTriangle, className: 'text-[color:var(--lane-blocked)]' };
    case 'cancelled': return { icon: Ban, className: 'text-muted-foreground' };
    case 'pending':
    default: return { icon: CircleDashed, className: 'text-muted-foreground/60' };
  }
}

// Audit verdicts ("partial", "shipped", "still-needed", "archive") used to all
// read as the same bright green, so nothing stood out. Map them onto the shared
// tone recipe so "partial" reads as caution and a clean "shipped" reads as done.
function verdictTone(verdict: string): Tone {
  const value = verdict.toLowerCase();
  if (value.includes('ship') || value === 'done' || value === 'complete') return 'done';
  if (value.includes('partial') || value.includes('progress')) return 'warn';
  if (value.includes('need') || value.includes('keep')) return 'info';
  if (value.includes('archive') || value.includes('drop') || value.includes('remove')) return 'neutral';
  return 'neutral';
}

// The planner streams draft-section progress separately from the per-item audit.
// Render the slugs as wrapping chips rather than a comma-joined run-on so the
// covered/remaining split stays scannable.
function SectionProgressView({ progress }: { progress: PlanningTaskSectionProgress }) {
  const covered = progress.coveredSections ?? [];
  const remaining = progress.remainingSections ?? [];
  if (!progress.currentSection && covered.length === 0 && remaining.length === 0) return null;
  return (
    <div className="grid gap-2 rounded-md border border-border/70 bg-muted/20 p-3">
      <span className="font-medium text-foreground">Draft sections</span>
      {progress.currentSection && (
        <div className="flex items-center gap-2">
          <Spinner className="h-3 w-3 shrink-0 text-[color:var(--lane-progress)]" />
          <span>Current section: <span className="font-mono text-foreground">{progress.currentSection}</span></span>
        </div>
      )}
      {covered.length > 0 && <SectionChips label="Covered" sections={covered} tone="done" />}
      {remaining.length > 0 && <SectionChips label="Remaining" sections={remaining} tone="neutral" />}
    </div>
  );
}

function SectionChips({ label, sections, tone }: { label: string; sections: string[]; tone: Tone }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-2xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {sections.map((section) => <ToneChip key={section} tone={tone} className="font-mono normal-case">{section}</ToneChip>)}
    </div>
  );
}
