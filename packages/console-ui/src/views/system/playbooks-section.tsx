/**
 * Playbooks section — playbook list, warnings, mode chips, scope/source/profile/shadow metadata.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { SystemSection } from './system-section';
import { selectPlaybookModeCounts } from '@/lib/selectors';
import type { Loadable, PlaybookListResponse } from './system-types';

interface PlaybooksSectionProps {
  list: Loadable<PlaybookListResponse>;
}

export function PlaybooksSection({ list }: PlaybooksSectionProps) {
  const isLoading = list.status === 'loading';
  const listError = list.status === 'error' ? list.error : undefined;

  const playbooks = (list.status === 'success' || list.status === 'empty' || (list.status === 'error' && list.data))
    ? list.data?.playbooks ?? []
    : [];
  const warnings = list.data != null
    ? list.data.warnings ?? []
    : [];

  const modeCounts = selectPlaybookModeCounts(playbooks);
  const isEmpty = list.status === 'empty' || (list.status === 'success' && playbooks.length === 0);

  return (
    <SystemSection
      title="Playbooks"
      description="Discovered playbooks with mode, scope, and source metadata."
      loading={isLoading}
      empty={isEmpty}
      emptyText="No playbooks discovered"
    >
      {listError && <p className="text-xs text-destructive" role="alert">{listError}</p>}

      <div className="space-y-3 text-xs">
        {warnings.length > 0 && (
          <div>
            <p className="text-muted-foreground font-medium mb-1">Warnings</p>
            <ul className="space-y-0.5">
              {warnings.map((w, i) => (
                <li key={i} className="text-yellow-600">{w}</li>
              ))}
            </ul>
          </div>
        )}

        {modeCounts.total > 0 && (
          <div className="flex gap-2 flex-wrap">
            <Badge variant="outline">{modeCounts.autonomous} autonomous</Badge>
            <Badge variant="outline">{modeCounts.planning} planning</Badge>
          </div>
        )}

        {playbooks.length > 0 && (
          <ul className="space-y-2">
            {playbooks.map((pb) => (
              <li key={`${pb.scope}:${pb.name}`} className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-medium">{pb.name}</span>
                  <Badge variant={pb.mode === 'autonomous' ? 'secondary' : 'outline'} className="text-xs">
                    {pb.mode}
                  </Badge>
                  <Badge variant="outline" className="text-xs">{pb.scope}</Badge>
                  <Badge variant="outline" className="text-xs">src: {pb.source}</Badge>
                  {pb.profile && (
                    <Badge variant="secondary" className="text-xs">profile: {pb.profile}</Badge>
                  )}
                  {pb.shadows.length > 0 && (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      {pb.shadows.length} shadow{pb.shadows.length !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
                {pb.description && (
                  <p className="text-muted-foreground pl-1">{pb.description}</p>
                )}
                <p className="font-mono text-muted-foreground pl-1 break-all">{pb.path}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SystemSection>
  );
}
