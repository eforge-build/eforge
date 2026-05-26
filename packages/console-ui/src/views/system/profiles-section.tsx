/**
 * Profiles section — active profile summary, profile list, scope/harness counts, metadata, shadowing.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { SystemSection } from './system-section';
import { JsonDetails } from './json-details';
import { selectProfileCounts } from '@/lib/selectors';
import type { Loadable, ProfileListResponse, ProfileShowResponse } from './system-types';

interface ProfilesSectionProps {
  list: Loadable<ProfileListResponse>;
  active: Loadable<ProfileShowResponse>;
}

export function ProfilesSection({ list, active }: ProfilesSectionProps) {
  const isLoading = list.status === 'loading' || active.status === 'loading';
  const listError = list.status === 'error' ? list.error : undefined;
  const activeError = active.status === 'error' ? active.error : undefined;

  const profiles = (list.status === 'success' || (list.status === 'error' && list.data))
    ? list.data?.profiles ?? []
    : [];
  const counts = selectProfileCounts(profiles);

  const isEmpty = list.status === 'empty' || (list.status === 'success' && profiles.length === 0);

  const activeName =
    active.status === 'success' ? active.data.active
    : active.status === 'error' && active.data ? active.data.active
    : null;
  const activeSource =
    active.status === 'success' ? active.data.source
    : active.status === 'error' && active.data ? active.data.source
    : null;

  return (
    <SystemSection
      title="Profiles"
      description="Agent runtime profiles discovered across all scopes."
      loading={isLoading}
      empty={isEmpty}
      emptyText="No profiles discovered"
    >
      {listError && <p className="text-xs text-destructive" role="alert">{listError}</p>}
      {activeError && <p className="text-xs text-destructive" role="alert">{activeError}</p>}

      <div className="space-y-3 text-xs">
        {(activeName !== undefined && activeName !== null) && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-muted-foreground font-medium">Active profile</span>
            <span className="font-mono">{activeName}</span>
            {activeSource && (
              <Badge variant="outline" className="text-xs">{activeSource}</Badge>
            )}
          </div>
        )}
        {activeName === null && active.status === 'success' && (
          <p className="text-muted-foreground">No active profile set</p>
        )}

        {counts.total > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(counts.byScope).map(([scope, count]) => (
              <Badge key={scope} variant="secondary" className="text-xs">
                {scope}: {count}
              </Badge>
            ))}
          </div>
        )}

        {profiles.length > 0 && (
          <ul className="space-y-1.5">
            {profiles.map((p) => (
              <li key={`${p.scope}:${p.name}`} className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-medium">{p.name}</span>
                <Badge variant="outline" className="text-xs">{p.scope}</Badge>
                {p.harness && (
                  <Badge variant="secondary" className="text-xs">{p.harness}</Badge>
                )}
                {p.shadowedBy && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    shadowed by {p.shadowedBy}
                  </Badge>
                )}
                {p.metadata?.description && (
                  <span className="text-muted-foreground">{p.metadata.description}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {active.status === 'success' && active.data.resolved.profile != null && (
          <JsonDetails label="Active profile data (JSON)" value={active.data.resolved.profile} />
        )}
      </div>
    </SystemSection>
  );
}
