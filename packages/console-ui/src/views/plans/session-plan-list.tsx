/**
 * Sidebar/list presentation for the Planning Workspace.
 *
 * Renders a combined list of flat session plans and grouped session plan sets
 * from the `PlanningArtifactListItem` union. Selection is keyed by artifact key
 * so flat-plan sessions and plan-set ids cannot collide.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type {
  FlatPlanArtifact,
  PlanSetArtifact,
  PlanningArtifactListItem,
} from './planning-artifacts';

interface SessionPlanListProps {
  items: PlanningArtifactListItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

function rowClassName(selected: boolean): string {
  return cn(
    'w-full min-w-0 overflow-hidden text-left px-3 py-2 rounded-md text-xs hover:bg-accent/50 transition-colors',
    selected && 'bg-accent text-accent-foreground',
  );
}

function FlatPlanRow({ artifact }: { artifact: FlatPlanArtifact }) {
  const plan = artifact.entry;
  return (
    <>
      <div className="flex min-w-0 items-center gap-2 flex-wrap">
        <span className="font-mono font-medium truncate max-w-[160px]">{plan.session}</span>
        <Badge variant="outline" className="text-xs shrink-0">
          {plan.status}
        </Badge>
        <Badge variant={plan.ready ? 'secondary' : 'outline'} className="text-xs shrink-0">
          {plan.ready ? 'ready' : 'not ready'}
        </Badge>
        {plan.eforge_session && (
          <Badge variant="default" className="text-xs shrink-0 font-mono">
            {plan.eforge_session}
          </Badge>
        )}
      </div>
      {plan.topic && <p className="text-muted-foreground mt-0.5 truncate">{plan.topic}</p>}
      {plan.path && (
        <p className="text-muted-foreground mt-0.5 truncate text-xs font-mono">{plan.path}</p>
      )}
      {plan.missingDimensions.length > 0 && (
        <p className="text-yellow-600 mt-0.5 truncate text-xs">
          Missing: {plan.missingDimensions.join(', ')}
        </p>
      )}
    </>
  );
}

function PlanSetRow({ artifact }: { artifact: PlanSetArtifact }) {
  const planSet = artifact.entry;
  return (
    <>
      <div className="flex min-w-0 items-center gap-2 flex-wrap">
        <Badge variant="secondary" className="text-xs shrink-0">
          plan set
        </Badge>
        <span className="font-medium truncate max-w-[160px]">{planSet.title}</span>
        <Badge variant="outline" className="text-xs shrink-0">
          {planSet.status}
        </Badge>
        <Badge variant="outline" className="text-xs shrink-0">
          {planSet.childCount} children
        </Badge>
      </div>
      {planSet.dir && (
        <p className="text-muted-foreground mt-0.5 truncate text-xs font-mono">{planSet.dir}</p>
      )}
    </>
  );
}

export function SessionPlanList({ items, selectedKey, onSelect }: SessionPlanListProps) {
  return (
    <ScrollArea className="h-full min-w-0">
      <ul className="space-y-1 p-2 min-w-0">
        {items.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => onSelect(item.key)}
              aria-label={
                item.kind === 'plan'
                  ? `${item.entry.session} ${item.entry.topic}`
                  : `plan set ${item.entry.title}`
              }
              className={rowClassName(selectedKey === item.key)}
            >
              {item.kind === 'plan' ? (
                <FlatPlanRow artifact={item} />
              ) : (
                <PlanSetRow artifact={item} />
              )}
            </button>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
