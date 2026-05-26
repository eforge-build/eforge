/**
 * Session Plans section — plan list, status/readiness counts, missing dimensions, path.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { SystemSection } from './system-section';
import { selectSessionPlanReadinessCounts } from '@/lib/selectors';
import type { Loadable, SessionPlanListResponse } from './system-types';

interface SessionPlansSectionProps {
  list: Loadable<SessionPlanListResponse>;
}

export function SessionPlansSection({ list }: SessionPlansSectionProps) {
  const isLoading = list.status === 'loading';
  const listError = list.status === 'error' ? list.error : undefined;

  const plans = (list.status === 'success' || (list.status === 'error' && list.data))
    ? list.data?.plans ?? []
    : [];

  const readiness = selectSessionPlanReadinessCounts(plans);
  const isEmpty = list.status === 'empty' || (list.status === 'success' && plans.length === 0);

  return (
    <SystemSection
      title="Session Plans"
      description="Discovered session plans with status and readiness summary."
      loading={isLoading}
      empty={isEmpty}
      emptyText="No session plans discovered"
    >
      {listError && <p className="text-xs text-destructive" role="alert">{listError}</p>}

      <div className="space-y-3 text-xs">
        {readiness.total > 0 && (
          <div className="flex gap-2 flex-wrap">
            <Badge variant="secondary">{readiness.ready} ready</Badge>
            <Badge variant="outline">{readiness.notReady} not ready</Badge>
            {Object.entries(readiness.byStatus).map(([status, count]) => (
              <Badge key={status} variant="outline">{status}: {count}</Badge>
            ))}
          </div>
        )}

        {plans.length > 0 && (
          <ul className="space-y-2">
            {plans.map((plan) => (
              <li key={`${plan.session}:${plan.topic}`} className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-medium">{plan.session}</span>
                  <Badge variant="outline" className="text-xs">{plan.status}</Badge>
                  <Badge variant={plan.ready ? 'secondary' : 'outline'} className="text-xs">
                    {plan.ready ? 'ready' : 'not ready'}
                  </Badge>
                </div>
                {plan.topic && (
                  <p className="text-muted-foreground pl-1">{plan.topic}</p>
                )}
                {plan.missingDimensions.length > 0 && (
                  <p className="text-yellow-600 pl-1">
                    Missing: {plan.missingDimensions.join(', ')}
                  </p>
                )}
                <p className="font-mono text-muted-foreground pl-1 break-all">{plan.path}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SystemSection>
  );
}
