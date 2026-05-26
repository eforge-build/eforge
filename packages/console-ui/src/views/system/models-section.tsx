/**
 * Models section — provider and model summaries for pi and claude-sdk harnesses.
 *
 * Models are grouped by provider with each group rendered as a controlled
 * <details> disclosure block closed by default.  <li> elements are only
 * mounted for expanded providers so the initial DOM contains zero model rows.
 * A search input filters the visible models across all providers.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { SystemSection } from './system-section';
import { selectModelTotals, selectModelsByProvider } from '@/lib/selectors';
import { cn } from '@/lib/utils';
import type { SystemModelCatalog, SystemModelHarness } from './system-types';

interface ModelCatalogViewProps {
  harness: SystemModelHarness;
  catalog: SystemModelCatalog;
}

function ModelCatalogView({ harness, catalog }: ModelCatalogViewProps) {
  const { providers, models } = catalog;

  const [openProviders, setOpenProviders] = React.useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = React.useState('');

  const modelList =
    models.status === 'success' || (models.status === 'error' && models.data)
      ? (models.data?.models ?? [])
      : [];

  const modelTotals = selectModelTotals(modelList);
  const groupedByProvider = selectModelsByProvider(modelList);

  // Apply model search filter per provider group
  const filteredGroups = searchQuery.trim()
    ? groupedByProvider
        .map(({ provider, models: ms }) => ({
          provider,
          models: ms.filter((m) =>
            m.id.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
        }))
        .filter(({ models: ms }) => ms.length > 0)
    : groupedByProvider;

  const isLoadingModels = models.status === 'loading' || models.status === 'idle';
  const modelsEmpty =
    models.status === 'empty' || (models.status === 'success' && modelList.length === 0);
  const hasModels = !isLoadingModels && !modelsEmpty && modelList.length > 0;

  const handleToggle = (provider: string, open: boolean) => {
    setOpenProviders((prev) => {
      const next = new Set(prev);
      if (open) next.add(provider);
      else next.delete(provider);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {/* Harness header */}
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-foreground">{harness}</h3>
        {modelTotals.total > 0 && (
          <Badge variant="secondary" className="text-xs">
            {modelTotals.total} model{modelTotals.total !== 1 ? 's' : ''}
          </Badge>
        )}
        {modelTotals.deprecated > 0 && (
          <Badge variant="destructive" className="text-xs">
            {modelTotals.deprecated} deprecated
          </Badge>
        )}
      </div>

      {providers.status === 'error' && (
        <p className="text-xs text-destructive" role="alert">
          Providers: {providers.error}
        </p>
      )}
      {models.status === 'error' && (
        <p className="text-xs text-destructive" role="alert">
          Models: {models.error}
        </p>
      )}

      {isLoadingModels && (
        <p className="text-xs text-muted-foreground animate-pulse">Loading models...</p>
      )}
      {!isLoadingModels && modelsEmpty && (
        <p className="text-xs text-muted-foreground">No models reported</p>
      )}

      {/* Model search + provider disclosures (shown only when models exist) */}
      {hasModels && (
        <input
          type="text"
          aria-label={`Search models for ${harness}`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search models..."
          className={cn(
            'h-7 w-full rounded-md border border-input bg-background px-2.5 py-1',
            'text-xs text-foreground placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-1 focus:ring-ring',
          )}
        />
      )}

      {hasModels && filteredGroups.length === 0 && (
        <p className="text-xs text-muted-foreground">No models match your search.</p>
      )}

      {hasModels && filteredGroups.length > 0 && (
        <div className="space-y-1">
          {filteredGroups.map(({ provider, models: providerModels }) => {
            const isOpen = openProviders.has(provider);
            return (
              <details
                key={provider}
                open={isOpen || undefined}
                className="group"
              >
                <summary
                  onClick={(e) => {
                    // Prevent browser default toggle; let React state control open.
                    e.preventDefault();
                    handleToggle(provider, !isOpen);
                  }}
                  className={cn(
                    'flex cursor-pointer select-none items-center gap-1.5',
                    'list-none rounded px-1 py-0.5 text-xs font-medium text-foreground',
                    'hover:bg-muted/60 focus:outline-none focus:ring-1 focus:ring-ring',
                    '[&::-webkit-details-marker]:hidden',
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-2.5 w-2.5 shrink-0 transition-transform',
                      isOpen ? 'rotate-90' : 'rotate-0',
                    )}
                    aria-hidden
                  >
                    ▶
                  </span>
                  <span>{provider}</span>
                  <span className="text-muted-foreground">
                    ({providerModels.length})
                  </span>
                </summary>

                {isOpen && (
                  <ul className="mt-1 space-y-0.5 pl-4">
                    {providerModels.map((m) => (
                      <li
                        key={m.id}
                        className="flex flex-wrap items-center gap-2 text-xs"
                      >
                        <span className="font-mono text-foreground">{m.id}</span>
                        {m.deprecated && (
                          <Badge variant="destructive" className="text-xs">
                            deprecated
                          </Badge>
                        )}
                        {m.contextWindow != null && (
                          <span className="text-muted-foreground">
                            {m.contextWindow.toLocaleString()} ctx
                          </span>
                        )}
                        {m.releasedAt && (
                          <span className="text-muted-foreground">{m.releasedAt}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            );
          })}
        </div>
      )}

      {/* Show provider list badges when models are empty but providers are known */}
      {modelsEmpty &&
        providers.status === 'success' &&
        (providers.data?.providers ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {(providers.data?.providers ?? []).map((p) => (
              <Badge key={p} variant="outline" className="text-xs">
                {p}
              </Badge>
            ))}
          </div>
        )}
    </div>
  );
}

interface ModelsSectionProps {
  catalogs: Record<SystemModelHarness, SystemModelCatalog>;
}

export function ModelsSection({ catalogs }: ModelsSectionProps) {
  const harnesses: SystemModelHarness[] = ['pi', 'claude-sdk'];

  return (
    <SystemSection
      title="Models"
      description="Model providers and model lists for pi and claude-sdk harnesses."
    >
      <div className="space-y-4">
        {harnesses.map((h) => (
          <ModelCatalogView key={h} harness={h} catalog={catalogs[h]} />
        ))}
      </div>
    </SystemSection>
  );
}
