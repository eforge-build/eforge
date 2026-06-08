import * as React from 'react';
import type { ConsoleWorkstationManifestEntry } from '@eforge-build/client/browser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toConsolePath } from '@/lib/navigation';
import { useWorkstationManifest } from './use-workstation-manifest';
import { selectWorkstation, sortWorkstations } from './workstation-selectors';
import { WorkstationIframe } from './workstation-iframe';

interface WorkstationsViewProps {
  selectedWorkstationId?: string;
  subPath?: string;
  onNavigate?: (href: string) => void;
}

export function WorkstationsView({ selectedWorkstationId, subPath, onNavigate }: WorkstationsViewProps) {
  const manifest = useWorkstationManifest();
  const [localSelectedId, setLocalSelectedId] = React.useState<string | null>(selectedWorkstationId ?? null);

  React.useEffect(() => {
    if (selectedWorkstationId) setLocalSelectedId(selectedWorkstationId);
  }, [selectedWorkstationId]);

  const workstations = React.useMemo(
    () => sortWorkstations(manifest.data?.consoleWorkstations ?? []),
    [manifest.data?.consoleWorkstations],
  );
  const effectiveSelectedId = selectedWorkstationId ?? localSelectedId;
  const selected = selectWorkstation(workstations, effectiveSelectedId);
  const notFound = Boolean(selectedWorkstationId && workstations.length > 0 && !selected);
  const isInitialLoading = manifest.status === 'loading' && !manifest.data;
  const isEmpty = (manifest.status === 'empty' || manifest.status === 'success') && workstations.length === 0;
  const hasWorkstations = workstations.length > 0;

  const select = (workstation: ConsoleWorkstationManifestEntry) => {
    setLocalSelectedId(workstation.id);
    onNavigate?.(toConsolePath({ id: 'workstationDetail', workstationId: workstation.id }));
  };

  const selectById = (id: string) => {
    const next = workstations.find((workstation) => workstation.id === id);
    if (next) select(next);
  };

  const hasMultiple = workstations.length > 1;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="workstations-view">
      <header className="flex items-center gap-4 border-b border-border px-4 py-2 shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Workstations</h1>
          <p className="text-xs text-muted-foreground">Sandboxed Console surfaces supplied by trusted extensions.</p>
        </div>
        <Button size="sm" variant="outline" className="ml-auto" onClick={manifest.refresh} disabled={manifest.status === 'loading'}>
          {manifest.status === 'loading' ? 'Refreshing…' : 'Refresh'}
        </Button>
      </header>

      {manifest.status === 'error' && manifest.error && (
        <div className="px-4 py-2 text-xs text-destructive shrink-0" role="alert">
          {manifest.error}
        </div>
      )}

      {isInitialLoading && (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          Loading workstations...
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          No Console workstations are registered.
        </div>
      )}

      {hasWorkstations && (
        <main className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden p-4">
          <div className="flex flex-wrap items-center gap-2 shrink-0" data-testid="workstation-switcher">
            {hasMultiple ? (
              <Select value={selected?.id ?? undefined} onValueChange={selectById}>
                <SelectTrigger className="h-8 w-auto min-w-[16rem]" aria-label="Select workstation">
                  <SelectValue placeholder="Select a workstation" />
                </SelectTrigger>
                <SelectContent>
                  {workstations.map((workstation) => (
                    <SelectItem key={workstation.id} value={workstation.id}>
                      {workstation.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              selected && <h2 className="text-base font-semibold">{selected.title}</h2>
            )}
            {selected && <Badge variant="outline">{selected.extensionName}</Badge>}
          </div>
          {selected?.description && <p className="mt-1 text-xs text-muted-foreground shrink-0">{selected.description}</p>}

          {notFound && (
            <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
              Workstation not found: {selectedWorkstationId}
            </div>
          )}
          {!notFound && selected && (
            <div className="mt-3 min-h-0 flex-1">
              <WorkstationIframe
                workstation={selected}
                subPath={subPath}
                onNavigate={(childPath) => onNavigate?.(toConsolePath({ id: 'workstationDetail', workstationId: selected.id, ...(childPath ? { subPath: childPath } : {}) }))}
              />
            </div>
          )}
        </main>
      )}
    </div>
  );
}
