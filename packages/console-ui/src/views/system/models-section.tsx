/**
 * Models section — provider and model summaries for pi and claude-sdk harnesses,
 * with per-harness error states.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { SystemSection } from './system-section';
import { selectModelTotals } from '@/lib/selectors';
import type { SystemModelCatalog, SystemModelHarness } from './system-types';

interface ModelCatalogViewProps {
  harness: SystemModelHarness;
  catalog: SystemModelCatalog;
}

function ModelCatalogView({ harness, catalog }: ModelCatalogViewProps) {
  const { providers, models } = catalog;

  const providerList = (providers.status === 'success' || (providers.status === 'error' && providers.data))
    ? providers.data?.providers ?? []
    : [];
  const modelList = (models.status === 'success' || (models.status === 'error' && models.data))
    ? models.data?.models ?? []
    : [];

  const modelTotals = selectModelTotals(modelList);
  const providersEmpty = providers.status === 'empty' || (providers.status === 'success' && providerList.length === 0);
  const modelsEmpty = models.status === 'empty' || (models.status === 'success' && modelList.length === 0);
  const isLoadingProviders = providers.status === 'loading' || providers.status === 'idle';
  const isLoadingModels = models.status === 'loading' || models.status === 'idle';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-foreground">{harness}</h3>
        {modelTotals.total > 0 && (
          <Badge variant="secondary" className="text-xs">{modelTotals.total} model{modelTotals.total !== 1 ? 's' : ''}</Badge>
        )}
        {modelTotals.deprecated > 0 && (
          <Badge variant="destructive" className="text-xs">{modelTotals.deprecated} deprecated</Badge>
        )}
      </div>

      {providers.status === 'error' && (
        <p className="text-xs text-destructive" role="alert">Providers: {providers.error}</p>
      )}
      {models.status === 'error' && (
        <p className="text-xs text-destructive" role="alert">Models: {models.error}</p>
      )}

      {isLoadingProviders && (
        <p className="text-xs text-muted-foreground animate-pulse">Loading providers...</p>
      )}
      {!isLoadingProviders && providersEmpty && (
        <p className="text-xs text-muted-foreground">No providers reported</p>
      )}
      {providerList.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {providerList.map((p) => (
            <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
          ))}
        </div>
      )}

      {isLoadingModels && (
        <p className="text-xs text-muted-foreground animate-pulse">Loading models...</p>
      )}
      {!isLoadingModels && modelsEmpty && (
        <p className="text-xs text-muted-foreground">No models reported</p>
      )}
      {modelList.length > 0 && (
        <ul className="space-y-1">
          {modelList.map((m) => (
            <li key={m.id} className="flex items-center gap-2 flex-wrap text-xs">
              <span className="font-mono">{m.id}</span>
              {m.provider && <Badge variant="outline" className="text-xs">{m.provider}</Badge>}
              {m.deprecated && <Badge variant="destructive" className="text-xs">deprecated</Badge>}
              {m.contextWindow != null && (
                <span className="text-muted-foreground">{m.contextWindow.toLocaleString()} ctx</span>
              )}
              {m.releasedAt && (
                <span className="text-muted-foreground">{m.releasedAt}</span>
              )}
            </li>
          ))}
        </ul>
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
