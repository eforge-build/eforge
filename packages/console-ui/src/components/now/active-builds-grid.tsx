import * as React from 'react';
import { ActiveBuildCard } from './active-build-card';
import type { NowActiveBuildCard } from '@/lib/selectors/now';

interface ActiveBuildsGridProps {
  cards: NowActiveBuildCard[];
  onNavigate?: (href: string) => void;
}

export function ActiveBuildsGrid({ cards, onNavigate }: ActiveBuildsGridProps) {
  if (cards.length === 0) return null;

  // Single column: each active build fills the full width of its container
  // (the dashboard main column). A 2-up grid left a dead half-width column
  // whenever a single build was running, which read as a large empty void.
  return (
    <div className="grid grid-cols-1 gap-5">
      {cards.map((card) => (
        <ActiveBuildCard key={card.sessionId} card={card} onNavigate={onNavigate} />
      ))}
    </div>
  );
}
