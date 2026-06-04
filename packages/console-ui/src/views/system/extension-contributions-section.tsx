import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { SystemSection } from './system-section';
import { ExtensionContributionCard } from './extension-contribution-card';
import { buildActionLookup } from './extension-contribution-rendering';
import { selectExtensionContributionManifestSummary } from '@/lib/selectors';
import type { ExtensionContributionManifestResponse, Loadable } from './system-types';

interface ExtensionContributionsSectionProps {
  manifest: Loadable<ExtensionContributionManifestResponse>;
}

export function ExtensionContributionsSection({ manifest }: ExtensionContributionsSectionProps) {
  const data = (manifest.status === 'success' || manifest.status === 'empty' || (manifest.status === 'error' && manifest.data))
    ? manifest.data
    : undefined;
  const summary = data ? selectExtensionContributionManifestSummary(data) : undefined;
  const actionLookup = React.useMemo(() => buildActionLookup(data?.actions ?? []), [data?.actions]);
  const isEmpty = manifest.status === 'empty'
    || (data ? data.consoleContributions.length === 0 && summary?.diagnostics.total === 0 : false);

  return (
    <SystemSection
      title="Extension Console contributions"
      description="Declarative extension panels and action controls rendered by Console."
      loading={manifest.status === 'loading'}
      error={manifest.status === 'error' ? manifest.error : undefined}
      empty={isEmpty}
      emptyText="No Console contributions discovered"
    >
      {summary && (
        <div className="space-y-3 text-xs">
          <div>
            <p className="text-muted-foreground font-medium mb-1">Manifest families</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">actions: {summary.families.actions}</Badge>
              <Badge variant="outline">Console contributions: {summary.families.consoleContributions}</Badge>
              <Badge variant="outline">integration commands: {summary.families.integrationCommands}</Badge>
              <Badge variant="outline">deep links: {summary.families.deepLinks}</Badge>
            </div>
          </div>

          {Object.keys(summary.renderers).length > 0 && (
            <div>
              <p className="text-muted-foreground font-medium mb-1">Renderer counts</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(summary.renderers).map(([renderer, count]) => (
                  <Badge key={renderer} variant="secondary">{renderer}: {count}</Badge>
                ))}
              </div>
            </div>
          )}

          {(data?.diagnostics?.length ?? 0) > 0 && (
            <div>
              <p className="text-muted-foreground font-medium mb-1">Manifest diagnostics</p>
              <ul className="space-y-0.5">
                {data?.diagnostics?.map((diagnostic, index) => (
                  <li key={`${diagnostic.code}:${index}`} className={diagnostic.severity === 'error' ? 'text-destructive' : diagnostic.severity === 'warning' ? 'text-yellow-600' : 'text-muted-foreground'}>
                    [{diagnostic.severity}] {diagnostic.code}: {diagnostic.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(data?.consoleContributions.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">No Console contributions discovered</p>
          ) : (
            <div className="space-y-3">
              {data?.consoleContributions.map((contribution) => (
                <ExtensionContributionCard
                  key={contribution.id}
                  contribution={contribution}
                  actionLookup={actionLookup}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </SystemSection>
  );
}
