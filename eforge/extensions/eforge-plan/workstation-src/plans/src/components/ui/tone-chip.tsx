import * as React from 'react';
import { cn } from '@/lib/utils';
import { toneClass, type Tone } from '@/lib/tone';

export interface ToneChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: Tone;
}

/**
 * The workstation's status pill. One markup, one color recipe (see lib/tone) so
 * every status chip - planning tasks, lifecycle evidence, build state, freshness,
 * roadmap sources - reads the same. Pass `className` to vary case/weight/spacing
 * (e.g. `uppercase tracking-wide`); tailwind-merge lets it win over the defaults.
 */
export function ToneChip({ tone, className, ...props }: ToneChipProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-semibold', toneClass(tone), className)}
      {...props}
    />
  );
}
