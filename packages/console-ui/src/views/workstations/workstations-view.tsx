import * as React from 'react';
import type { ConsoleWorkstationManifestEntry } from '@eforge-build/client/browser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toConsolePath } from '@/lib/navigation';
import { useWorkstationManifest } from './use-workstation-manifest';
import { selectWorkstation, sortWorkstations } from './workstation-selectors';
import { WorkstationIframe } from './workstation-iframe';

interface WorkstationsViewProps {
  selectedWorkstationId?: string;
  onNavigate?: (href: string) => void;
}

export function WorkstationsView({ selectedWorkstationId, onNavigate }: WorkstationsViewProps) {
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
        <div className="grid flex-1 min-h-0 grid-cols-[280px_minmax(0,1fr)] overflow-hidden">
          <aside className="min-h-0 overflow-auto border-r border-border p-3">
            <div className="space-y-2">
              {workstations.map((workstation) => (
                <button
                  key={workstation.id}
                  type="button"
                  className={`w-full rounded-md border p-3 text-left transition-colors ${selected?.id === workstation.id ? 'border-primary bg-muted' : 'border-border hover:bg-muted/60'}`}
                  onClick={() => select(workstation)}
                  aria-current={selected?.id === workstation.id ? 'page' : undefined}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{workstation.title}</span>
                    <Badge variant="outline" className="ml-auto text-[10px]">{workstation.extensionName}</Badge>
                  </div>
                  {workstation.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{workstation.description}</p>
                  )}
                </button>
              ))}
            </div>
          </aside>

          <main className="min-h-0 min-w-0 overflow-auto p-4">
            {notFound && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
                Workstation not found: {selectedWorkstationId}
              </div>
            )}
            {!notFound && selected && (
              <section className="flex h-full min-h-0 flex-col gap-3">
                <header className="shrink-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold">{selected.title}</h2>
                    <Badge variant="outline">{selected.extensionName}</Badge>
                  </div>
                  {selected.description && <p className="mt-1 text-xs text-muted-foreground">{selected.description}</p>}
                </header>
                <div className="min-h-0 flex-1">
                  <WorkstationIframe workstation={selected} />
                </div>
              </section>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
