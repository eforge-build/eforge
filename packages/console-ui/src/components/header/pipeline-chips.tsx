import * as React from 'react';

/**
 * PipelineChips — a condensed Intake · Queued · Active glance that lives in the
 * global header. It is the single count surface for the build pipeline (the Now
 * dashboard renders the matching detail), replacing the former standalone Q: /
 * Active: chips. Zero-count stages dim so the eye lands on whatever is live.
 */
interface PipelineChipsProps {
  intake: number;
  queued: number;
  active: number;
}

interface StageProps {
  label: string;
  count: number;
  ariaLabel: string;
}

function Stage({ label, count, ariaLabel }: StageProps) {
  const dim = count === 0;
  return (
    <span
      aria-label={ariaLabel}
      className={dim ? 'text-muted-foreground/50' : undefined}
    >
      {label} <span className={dim ? 'tabular-nums' : 'tabular-nums text-foreground'}>{count}</span>
    </span>
  );
}

export function PipelineChips({ intake, queued, active }: PipelineChipsProps) {
  return (
    <span aria-label="build pipeline" className="flex items-center gap-1.5">
      <Stage label="Intake" count={intake} ariaLabel="intake count" />
      <span className="text-border" aria-hidden="true">·</span>
      <Stage label="Queued" count={queued} ariaLabel="queue count" />
      <span className="text-border" aria-hidden="true">·</span>
      <Stage label="Active" count={active} ariaLabel="active builds count" />
    </span>
  );
}
