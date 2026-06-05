/**
 * QueueIntakeLane — the "Intake" subsection of the merged QueueCard. Renders
 * pre-build PRD formatting/validation runs as transient queue rows: work that
 * is entering the queue, not a build that is running. Each row stays lighter
 * than a build card (dashed chrome, no lifecycle rail, no plan swimlane) so it
 * reads as "preparing input", and keeps the Cancel affordance. Returns null
 * when nothing is being prepared.
 */
import * as React from 'react';
import { FileCog } from 'lucide-react';
import type { NowEnqueueCard } from '@/lib/selectors/now';
import { formatDuration, truncateId, compactTokens } from '@/lib/format';
import { CancelBuildButton } from './cancel-build-button';

interface QueueIntakeLaneProps {
  cards: NowEnqueueCard[];
}

function IntakeRow({ card }: { card: NowEnqueueCard }) {
  const durationLabel = formatDuration(card.durationMs);
  const tokensLabel = card.tokens > 0 ? `${compactTokens(card.tokens)} tok` : null;
  const costLabel = card.cost > 0 ? `$${card.cost.toFixed(2)}` : null;
  const metricBits = [durationLabel, tokensLabel, costLabel].filter(
    (bit): bit is string => Boolean(bit),
  );

  return (
    <li className="relative pl-6">
      <span
        className="absolute left-0 top-2 h-3.5 w-3.5 rounded-full border border-blue/60 bg-blue/20"
        aria-hidden="true"
      />
      <div className="rounded-md border border-dashed border-border/70 bg-muted/10 px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <FileCog className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Preparing PRD
            </span>
            <p className="mt-1 truncate text-sm font-medium text-foreground" title={card.title}>
              {card.title}
            </p>
            {card.latestError ? (
              <p className="mt-0.5 truncate text-xs text-destructive" title={card.latestError}>
                {card.latestError}
              </p>
            ) : card.step ? (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-blue">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue motion-safe:animate-pulse"
                  aria-hidden="true"
                />
                {card.step}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">Preparing…</p>
            )}
          </div>
          <div className="shrink-0">
            <CancelBuildButton sessionId={card.sessionId} label={card.title} />
          </div>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-1.5 text-xs tabular-nums text-muted-foreground">
          {metricBits.map((bit, index) => (
            <React.Fragment key={bit}>
              {index > 0 && (
                <span className="text-border" aria-hidden="true">·</span>
              )}
              <span className={index === 0 ? 'font-medium text-foreground' : undefined}>{bit}</span>
            </React.Fragment>
          ))}
          <span className="text-border" aria-hidden="true">·</span>
          <code className="font-mono">{truncateId(card.sessionId)}</code>
        </div>
      </div>
    </li>
  );
}

export function QueueIntakeLane({ cards }: QueueIntakeLaneProps) {
  if (cards.length === 0) return null;
  return (
    <section aria-label="Intake">
      <p className="mb-2 text-xs font-medium text-foreground">Intake</p>
      <ul className="space-y-2">
        {cards.map((card) => (
          <IntakeRow key={card.sessionId} card={card} />
        ))}
      </ul>
    </section>
  );
}
