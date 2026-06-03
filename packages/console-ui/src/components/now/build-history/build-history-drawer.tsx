/**
 * BuildHistoryDrawer — right-side Sheet containing the full, filterable build
 * list (status + search). One row per build; click a row to open Build detail.
 * Mirrors the ActivityDrawer pattern; opened from the "Open full build history →"
 * button on the rail's Build history card.
 */
import * as React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { NowBuildItem } from '@/lib/selectors/now';
import {
  BuildRow,
  FilterBar,
  DEFAULT_FILTERS,
  filterBuilds,
  type FilterState,
} from './shared';

interface BuildHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  builds: NowBuildItem[];
  onNavigate?: (href: string) => void;
}

export function BuildHistoryDrawer({ open, onClose, builds, onNavigate }: BuildHistoryDrawerProps) {
  const [filters, setFilters] = React.useState<FilterState>(DEFAULT_FILTERS);

  const filteredBuilds = React.useMemo(() => filterBuilds(builds, filters), [builds, filters]);

  return (
    <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <SheetContent side="right" className="flex flex-col w-full sm:max-w-2xl p-0">
        <SheetHeader className="px-4 pt-4 pb-2 border-b border-border shrink-0">
          <SheetTitle className="text-sm font-semibold">Build history</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col flex-1 overflow-hidden px-4 pt-3">
          <div className="shrink-0">
            <FilterBar filters={filters} onFiltersChange={setFilters} />
          </div>
          <div className="flex-1 overflow-y-auto pb-4">
            {filteredBuilds.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No builds match the current filters.</p>
            ) : (
              <ul className="space-y-1">
                {filteredBuilds.map((build) => (
                  <BuildRow key={build.id} build={build} onNavigate={onNavigate} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
