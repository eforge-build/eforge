import * as React from 'react';
import { ActiveBuildCard } from './active-build-card';
import type { NowActiveBuildCard } from '@/lib/selectors/now';

interface ActiveBuildsGridProps {
  cards: NowActiveBuildCard[];
}

export function ActiveBuildsGrid({ cards }: ActiveBuildsGridProps) {
  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {cards.map((card) => (
        <ActiveBuildCard key={card.sessionId} card={card} />
      ))}
    </div>
  );
}
