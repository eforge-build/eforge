/**
 * A single map/reduce board node cell (Phase 3).
 *
 * Renders one atom or reduce node: status-colored, with badges (model, tokens,
 * duration, turns) joined from the matching agent thread, and reduce fan-in as a
 * count of input atoms/nodes. Clicking the card calls `onSelect(node.id)` so the
 * host can filter the log to that `planId` — atoms and reduce nodes are keyed by
 * `planId === atomId / nodeId`.
 *
 * Pure presentational: takes an enriched `MapReduceBoardNode`; no run-state access.
 */
import type { MapReduceBoardNode } from '@/lib/run-state';
import { formatDuration, formatNumber } from '@/lib/run-state/format';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface NodeCardProps {
  node: MapReduceBoardNode;
  /** Called with the node id (== planId) when the card is clicked. */
  onSelect?: (planId: string) => void;
  /** Highlights the card as the one currently filtering the log. */
  selected?: boolean;
}

/** Border/text accent per lifecycle status. Atom + reduce unions share these keys. */
const STATUS_ACCENT: Record<string, { dot: string; border: string }> = {
  queued: { dot: 'bg-text-dim/40', border: 'border-border' },
  running: { dot: 'bg-blue animate-pulse', border: 'border-blue/50' },
  completed: { dot: 'bg-green', border: 'border-green/40' },
  skipped: { dot: 'bg-text-dim/40', border: 'border-border border-dashed' },
  failed: { dot: 'bg-red', border: 'border-red/50' },
  incomplete: { dot: 'bg-yellow', border: 'border-yellow/50' },
};

function fanInLabel(node: MapReduceBoardNode): string | null {
  if (node.kind !== 'reduce') return null;
  const atoms = node.inputAtomIds?.length ?? 0;
  const nodes = node.inputNodeIds?.length ?? 0;
  if (atoms === 0 && nodes === 0) return null;
  const parts: string[] = [];
  if (atoms > 0) parts.push(`${atoms} atom${atoms === 1 ? '' : 's'}`);
  if (nodes > 0) parts.push(`${nodes} node${nodes === 1 ? '' : 's'}`);
  return parts.join(' + ');
}

export function NodeCard({ node, onSelect, selected }: NodeCardProps) {
  const accent = STATUS_ACCENT[node.status] ?? STATUS_ACCENT.queued;
  const fanIn = fanInLabel(node);
  const t = node.thread;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect?.(node.id)}
      className={cn(
        'group flex flex-col gap-1 rounded-md border bg-bg-secondary/40 px-2 py-1.5 text-left transition-colors',
        'hover:bg-bg-secondary/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue',
        accent.border,
        selected && 'ring-1 ring-blue bg-bg-secondary/70',
      )}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', accent.dot)} />
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-11px font-mono text-text-bright truncate">{node.title}</span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="flex flex-col gap-0.5">
              <span>{node.title}</span>
              {node.statusReason && (
                <span className="text-text-dim">{node.status}: {node.statusReason}</span>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-10px text-text-dim pl-3">
        {node.kind === 'atom' && node.reason && (
          <span className="truncate max-w-[12rem]">{node.reason}</span>
        )}
        {fanIn && <span title="reduce fan-in">&larr; {fanIn}</span>}
        {t && (
          <>
            <span className="font-mono truncate max-w-[10rem]" title={t.model}>{t.model}</span>
            {t.totalTokens !== null && (
              <span className="font-mono tabular-nums">{formatNumber(t.totalTokens)} tok</span>
            )}
            {t.durationMs !== null && (
              <span className="font-mono tabular-nums">{formatDuration(t.durationMs)}</span>
            )}
            {t.numTurns !== null && (
              <span className="font-mono tabular-nums">{t.numTurns} turn{t.numTurns === 1 ? '' : 's'}</span>
            )}
          </>
        )}
        {node.status === 'skipped' && <span className="italic">skipped</span>}
      </div>
    </button>
  );
}
