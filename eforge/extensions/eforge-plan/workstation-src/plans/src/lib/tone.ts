// Single source of truth for the workstation's status-chip color recipe. Every
// status pill (planning tasks, lifecycle evidence, build state, recommendation
// freshness, roadmap sources) maps its domain status to one of these semantic
// tones, and the tone resolves to the same `border/40 bg/10 text` class string.
// Domain status -> Tone maps stay with their domain; the *class recipe* lives
// here so chips never drift apart again. Render with <ToneChip>.

export type Tone = 'neutral' | 'info' | 'progress' | 'done' | 'warn' | 'danger' | 'destructive' | 'accent';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'border-border text-muted-foreground',
  info: 'border-[color:var(--lane-ready)]/40 bg-[color:var(--lane-ready)]/10 text-[color:var(--lane-ready)]',
  progress: 'border-[color:var(--lane-progress)]/40 bg-[color:var(--lane-progress)]/10 text-[color:var(--lane-progress)]',
  done: 'border-[color:var(--lane-done)]/40 bg-[color:var(--lane-done)]/10 text-[color:var(--lane-done)]',
  warn: 'border-[color:var(--prio-medium)]/40 bg-[color:var(--prio-medium)]/10 text-[color:var(--prio-medium)]',
  danger: 'border-[color:var(--lane-blocked)]/40 bg-[color:var(--lane-blocked)]/10 text-[color:var(--lane-blocked)]',
  destructive: 'border-destructive/40 bg-destructive/10 text-destructive-foreground',
  accent: 'border-primary/40 bg-primary/10 text-text-bright',
};

export function toneClass(tone: Tone): string {
  return TONE_CLASS[tone];
}

// Shared agent-task status tone. Previously the activity rail and the planning
// task card colored the *same* statuses differently; routing both through this
// keeps a queued/running/completed task one color across the workstation.
export function agentTaskTone(status: string | undefined): Tone {
  switch (status) {
    case 'running':
      return 'progress';
    case 'queued':
      return 'warn';
    case 'completed':
      return 'done';
    case 'failed':
      return 'danger';
    case 'cancelled':
      return 'neutral';
    default:
      return 'neutral';
  }
}

// Recommendation freshness: fresh reads as informational/steady, everything else
// (missing, stale) reads as needs-attention.
export function recommendationStateTone(state: string): Tone {
  return state === 'fresh' ? 'info' : 'warn';
}

// Lifecycle evidence chip labels (see lifecycle-panel) -> tone.
export function lifecycleChipTone(label: string): Tone {
  switch (label) {
    case 'Plan':
      return 'accent';
    case 'Queue':
      return 'info';
    case 'Run':
      return 'progress';
    case 'PR open':
    case 'Partial':
      return 'warn';
    case 'Merged':
      return 'done';
    case 'Failed':
      return 'danger';
    default:
      return 'neutral';
  }
}
