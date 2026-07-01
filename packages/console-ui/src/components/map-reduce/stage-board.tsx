/**
 * Vertical stage board for a map/reduce run (Phase 3, decision #5).
 *
 * Sections stack top-to-bottom — `Map atoms`, then one `Reduce level N` per
 * reduce-tree depth — rather than horizontal columns, because 14-22 nodes read
 * better vertically in the panel height and avoid horizontal scroll. Each
 * section is a collapsible group; the active level (a section with a
 * queued/running node) is expanded by default. Node click bubbles
 * `onSelect(planId)` for log filtering.
 *
 * Pure presentational: takes a precomputed `MapReduceBoard`
 * (`buildMapReduceBoard(state.mapReduce, state.agentThreads)`).
 */
import { ChevronRight } from 'lucide-react';
import type { MapReduceBoard, MapReduceBoardSection } from '@/lib/run-state';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { TooltipProvider } from '@/components/ui/tooltip';
import { NodeCard } from './node-card';
import { cn } from '@/lib/utils';

interface StageBoardProps {
  board: MapReduceBoard;
  onSelectNode?: (planId: string) => void;
  /** The planId currently filtering the log, highlighted in the board. */
  selectedPlanId?: string | null;
}

function sectionSubtitle(section: MapReduceBoardSection): string {
  const active = section.nodes.filter((n) => n.status === 'running' || n.status === 'queued').length;
  const done = section.nodes.filter((n) => n.status === 'completed' || n.status === 'skipped').length;
  const failed = section.nodes.filter((n) => n.status === 'failed' || n.status === 'incomplete').length;
  const parts = [`${done} done`];
  if (active > 0) parts.push(`${active} active`);
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(', ');
}

function BoardSection({ section, onSelectNode, selectedPlanId }: {
  section: MapReduceBoardSection;
  onSelectNode?: (planId: string) => void;
  selectedPlanId?: string | null;
}) {
  return (
    <Collapsible defaultOpen={section.active} className="border-b border-border/50 last:border-b-0">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-secondary/40">
        <ChevronRight className="w-3.5 h-3.5 text-text-dim transition-transform group-data-[state=open]:rotate-90" />
        <span className="text-11px uppercase tracking-wider text-text-bright">{section.title}</span>
        {section.active && <span className="w-1.5 h-1.5 rounded-full bg-blue animate-pulse" />}
        <span className="ml-auto text-10px text-text-dim">{sectionSubtitle(section)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className={cn('grid gap-1.5 px-3 pb-2.5', 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
          {section.nodes.map((node) => (
            <NodeCard
              key={node.id}
              node={node}
              onSelect={onSelectNode}
              selected={selectedPlanId === node.id}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function StageBoard({ board, onSelectNode, selectedPlanId }: StageBoardProps) {
  return (
    <TooltipProvider>
      <div className="flex flex-col rounded-md border border-border bg-bg-secondary/20">
        {board.sections.map((section) => (
          <BoardSection
            key={section.key}
            section={section}
            onSelectNode={onSelectNode}
            selectedPlanId={selectedPlanId}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}
