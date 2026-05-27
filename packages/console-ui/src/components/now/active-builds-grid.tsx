import * as React from 'react';
import { ActiveBuildCard } from './active-build-card';
import type { NowActiveBuildCard } from '@/lib/selectors/now';

interface ActiveBuildsGridProps {
  cards: NowActiveBuildCard[];
  onNavigate?: (href: string) => void;
}

export function ActiveBuildsGrid({ cards, onNavigate }: ActiveBuildsGridProps) {
  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      {cards.map((card) => (
        <ActiveBuildCard key={card.sessionId} card={card} onNavigate={onNavigate} />
      ))}
    </div>
  );
}
