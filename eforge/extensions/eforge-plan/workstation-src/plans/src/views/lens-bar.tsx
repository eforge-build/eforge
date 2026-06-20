import * as React from 'react';
import { Layers } from 'lucide-react';
import type { LensTag } from '@/lib/lens';

interface LensBarProps {
  tags: LensTag[];
  active: string;
  matchCount: number;
  onSelect: (tag: string) => void;
}

/**
 * Perspective lens selector spanning the whole continuum. Choosing a tag does
 * not filter anything out - it highlights the work under that perspective and
 * dims the rest across the board, recommendation lanes, and plans. A perspective
 * is a view, not a container, so items keep their place and can sit under
 * several lenses at once.
 */
export function LensBar({ tags, active, matchCount, onSelect }: LensBarProps) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card/40 px-3 py-2">
      <span className="mr-1 inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Layers className="h-3.5 w-3.5" /> Perspective
      </span>
      <LensChip label="All" active={!active} onClick={() => onSelect('')} />
      {tags.map((entry) => (
        <LensChip
          key={entry.tag}
          label={entry.tag}
          count={entry.count}
          active={active === entry.tag}
          onClick={() => onSelect(active === entry.tag ? '' : entry.tag)}
        />
      ))}
      {active && (
        <span className="ml-auto text-2xs text-muted-foreground">
          {matchCount} item{matchCount === 1 ? '' : 's'} in “{active}” · others dimmed
        </span>
      )}
    </div>
  );
}

function LensChip({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors ${active ? 'border-primary bg-primary/10 text-text-bright' : 'border-border text-muted-foreground hover:border-muted-foreground/50'}`}
    >
      {label}
      {count !== undefined && <span className="rounded-full border border-border px-1 text-2xs">{count}</span>}
    </button>
  );
}
