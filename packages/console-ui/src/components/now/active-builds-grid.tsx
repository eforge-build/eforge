import * as React from 'react';
import { ActiveBuildCard } from './active-build-card';
import { ActiveEfficiencySummary } from './active-efficiency-summary';
import type { NowActiveBuildCard } from '@/lib/selectors/now';
import type { QueueRowActionCallbacks } from './queue-row-actions';

interface ActiveBuildsGridProps extends Pick<QueueRowActionCallbacks, 'onPreviewCascade' | 'onApplyCascade'> {
  cards: NowActiveBuildCard[];
  onNavigate?: (href: string) => void;
}

export function ActiveBuildsGrid({ cards, onNavigate, onPreviewCascade, onApplyCascade }: ActiveBuildsGridProps) {
  if (cards.length === 0) return null;

  // Single column: each active build fills the full width of its container
  // (the dashboard main column). A 2-up grid left a dead half-width column
  // whenever a single build was running, which read as a large empty void.
  return (
    <div className="grid grid-cols-1 gap-5">
      <ActiveEfficiencySummary cards={cards} />
      {cards.map((card) => (
        <ActiveBuildCard key={card.sessionId} card={card} onNavigate={onNavigate} onPreviewCascade={onPreviewCascade} onApplyCascade={onApplyCascade} />
      ))}
    </div>
  );
}
