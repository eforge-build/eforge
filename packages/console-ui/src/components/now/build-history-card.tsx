/**
 * BuildHistoryCard — a glanceable preview of the most recent builds plus an
 * "Open full build history →" button that opens the filterable build-history
 * drawer (mirrors the "Open activity log →" affordance on the Build health card).
 *
 * Each row is one build (a session rolled up from its compile/build/continue-and-repair
 * phases), with the full-width title on line 1 and a color-coded status dot +
 * status + phase qualifier on line 2. Successful enqueue bookkeeping is already
 * folded into its build by the rollup, so there are no duplicate phase rows.
 */
import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { NowBuildItem } from '@/lib/selectors/now';
import { BuildRow } from './build-history/shared';
import { BuildHistoryDrawer } from './build-history/build-history-drawer';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ROW_COUNT = 4;
const COMPACT_ROW_COUNT = 6;

// ---------------------------------------------------------------------------
// BuildHistoryCard
// ---------------------------------------------------------------------------

interface BuildHistoryCardProps {
  builds: NowBuildItem[];
  onNavigate?: (href: string) => void;
  /** Rail mode: a slightly taller preview list so the card reads well in the
   *  narrow sidebar column. */
  compact?: boolean;
}

export function BuildHistoryCard({ builds, onNavigate, compact = false }: BuildHistoryCardProps) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const rowCount = compact ? COMPACT_ROW_COUNT : DEFAULT_ROW_COUNT;
  const previewBuilds = builds.slice(0, rowCount);

  return (
    <Card className="bg-card/50 border-border/60">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold text-muted-foreground">Build history</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {builds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent builds</p>
        ) : (
          <>
            <ul className="space-y-1">
              {previewBuilds.map((build) => (
                <BuildRow key={build.id} build={build} onNavigate={onNavigate} />
              ))}
            </ul>
            <div className="border-t border-border/60 pt-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => setDrawerOpen(true)}
              >
                Open full build history →
              </Button>
            </div>
          </>
        )}
      </CardContent>

      <BuildHistoryDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        builds={builds}
        onNavigate={onNavigate}
      />
    </Card>
  );
}
