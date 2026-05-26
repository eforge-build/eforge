import * as React from 'react';
import { ActiveBuildCard } from './active-build-card';
import type { NowActiveBuildCard } from '@/lib/selectors/now';

interface ActiveBuildsGridProps {
  cards: NowActiveBuildCard[];
}

export function ActiveBuildsGrid({ cards }: ActiveBuildsGridProps) {
  return (
    <section className="mb-4">
      <h2 className="text-sm font-semibold text-foreground mb-2">Active builds</h2>
      {cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active builds</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cards.map((card) => (
            <ActiveBuildCard key={card.sessionId} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}
