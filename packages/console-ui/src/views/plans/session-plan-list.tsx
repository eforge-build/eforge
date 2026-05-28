/**
 * Sidebar/list presentation for session plans in the Planning Workspace.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { SessionPlanListEntryWire } from '@eforge-build/client/browser';

interface SessionPlanListProps {
  plans: SessionPlanListEntryWire[];
  selectedSession: string | null;
  onSelect: (session: string) => void;
}

export function SessionPlanList({ plans, selectedSession, onSelect }: SessionPlanListProps) {
  return (
    <ScrollArea className="h-full">
      <ul className="space-y-1 p-2">
        {plans.map((plan) => (
          <li key={plan.session}>
            <button
              type="button"
              onClick={() => onSelect(plan.session)}
              aria-label={`${plan.session} ${plan.topic}`}
              className={cn(
                'w-full text-left px-3 py-2 rounded-md text-xs hover:bg-accent/50 transition-colors',
                selectedSession === plan.session && 'bg-accent text-accent-foreground',
              )}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-medium truncate max-w-[160px]">
                  {plan.session}
                </span>
                <Badge variant="outline" className="text-xs shrink-0">
                  {plan.status}
                </Badge>
                <Badge
                  variant={plan.ready ? 'secondary' : 'outline'}
                  className="text-xs shrink-0"
                >
                  {plan.ready ? 'ready' : 'not ready'}
                </Badge>
                {plan.eforge_session && (
                  <Badge variant="default" className="text-xs shrink-0 font-mono">
                    {plan.eforge_session}
                  </Badge>
                )}
              </div>
              {plan.topic && (
                <p className="text-muted-foreground mt-0.5 truncate">{plan.topic}</p>
              )}
              {plan.path && (
                <p className="text-muted-foreground mt-0.5 truncate text-xs font-mono">
                  {plan.path}
                </p>
              )}
              {plan.missingDimensions.length > 0 && (
                <p className="text-yellow-600 mt-0.5 truncate text-xs">
                  Missing: {plan.missingDimensions.join(', ')}
                </p>
              )}
            </button>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
