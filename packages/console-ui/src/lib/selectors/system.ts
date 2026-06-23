/**
 * Pure selectors for System configuration view section summaries.
 * Imports wire types from @eforge-build/client/browser.
 */
import type {
  AgentRuntimeProfileInfo,
  ExtensionDiagnostic,
  ExtensionEntry,
  ExtensionListResponse,
  ExtensionContributionManifestResponse,
  ConsoleContributionRendererId,
  ConfigShowVerboseResponse,
  ModelInfo,
} from '@eforge-build/client/browser';

// ---------------------------------------------------------------------------
// Profile selectors
// ---------------------------------------------------------------------------

export interface ProfileCountsSummary {
  total: number;
  byScope: Record<string, number>;
}

/** Count profiles by scope. */
export function selectProfileCounts(profiles: AgentRuntimeProfileInfo[]): ProfileCountsSummary {
  const byScope: Record<string, number> = {};
  for (const p of profiles) {
    byScope[p.scope] = (byScope[p.scope] ?? 0) + 1;
  }
  return { total: profiles.length, byScope };
}

// ---------------------------------------------------------------------------
// Extension selectors
// ---------------------------------------------------------------------------

export interface ExtensionDiagnosticCounts {
  errors: number;
  warnings: number;
  total: number;
}

export interface ExtensionRegistrationTotals {
  eventHooks: number;
  agentRunHooks: number;
  policyGates: number;
  profileRouters: number;
  inputSources: number;
  reviewerPerspectives: number;
  validationProviders: number;
  tools: number;
  prdEnrichers: number;
  actions: number;
  consoleContributions: number;
  consoleWorkstations: number;
  integrationCommands: number;
  deepLinks: number;
}

/** Count extension diagnostics by severity. */
export function selectExtensionDiagnosticCounts(
  diagnostics: ExtensionDiagnostic[],
): ExtensionDiagnosticCounts {
  let errors = 0;
  let warnings = 0;
  for (const d of diagnostics) {
    if (d.severity === 'error') errors++;
    else if (d.severity === 'warning') warnings++;
  }
  return { errors, warnings, total: diagnostics.length };
}

/** Sum registration totals across all extensions in a list response. */
export function selectExtensionRegistrationTotals(
  response: ExtensionListResponse,
): ExtensionRegistrationTotals {
  return { ...response.totals };
}

export interface ExtensionContributionManifestSummary {
  families: {
    actions: number;
    consoleContributions: number;
    consoleWorkstations: number;
    integrationCommands: number;
    deepLinks: number;
  };
  renderers: Partial<Record<ConsoleContributionRendererId, number>>;
  diagnostics: ExtensionDiagnosticCounts;
}

export function selectExtensionContributionManifestSummary(
  manifest: ExtensionContributionManifestResponse,
): ExtensionContributionManifestSummary {
  const renderers: Partial<Record<ConsoleContributionRendererId, number>> = {};
  for (const contribution of manifest.consoleContributions) {
    for (const block of contribution.blocks) {
      renderers[block.rendererId] = (renderers[block.rendererId] ?? 0) + 1;
    }
  }
  let errors = 0;
  let warnings = 0;
  for (const diagnostic of manifest.diagnostics ?? []) {
    if (diagnostic.severity === 'error') errors++;
    if (diagnostic.severity === 'warning') warnings++;
  }
  return {
    families: {
      actions: manifest.actions.length,
      consoleContributions: manifest.consoleContributions.length,
      consoleWorkstations: manifest.consoleWorkstations.length,
      integrationCommands: manifest.integrationCommands.length,
      deepLinks: manifest.deepLinks.length,
    },
    renderers,
    diagnostics: { errors, warnings, total: manifest.diagnostics?.length ?? 0 },
  };
}

/**
 * Whether a project-team extension needs trust. True when the richer
 * `trustState` is `untrusted` or `changed`, or — for legacy payloads without a
 * `trustState` — when the coarse `trust` field is `untrusted`. Extensions in any
 * scope other than `project-team` never need Console-driven trust.
 */
export function extensionNeedsTrust(ext: ExtensionEntry): boolean {
  if (ext.scope !== 'project-team') return false;
  if (ext.trustState) {
    return ext.trustState === 'untrusted' || ext.trustState === 'changed';
  }
  return ext.trust === 'untrusted';
}

/** Select the project-team extensions that need trust from a list response. */
export function selectExtensionsNeedingTrust(
  response: ExtensionListResponse,
): ExtensionEntry[] {
  return response.extensions.filter(extensionNeedsTrust);
}

/**
 * Action label for a trust control: `changed` extensions are re-trusted,
 * untrusted (and legacy coarse-untrusted) extensions are trusted.
 */
export function extensionTrustActionLabel(ext: ExtensionEntry): 'Trust' | 'Re-trust' {
  return ext.trustState === 'changed' ? 'Re-trust' : 'Trust';
}

// ---------------------------------------------------------------------------
// Config source selectors
// ---------------------------------------------------------------------------

export interface ConfigSourceRow {
  scope: string;
  path: string | null;
  found: boolean;
}

/** Extract config source rows from verbose config response. */
export function selectConfigSourceRows(
  sources: ConfigShowVerboseResponse['sources'],
): ConfigSourceRow[] {
  if (!sources) return [];
  return Object.entries(sources).map(([scope, info]) => ({
    scope,
    path: info?.path ?? null,
    found: info?.found ?? false,
  }));
}

// ---------------------------------------------------------------------------
// Model selectors
// ---------------------------------------------------------------------------

export interface ModelTotals {
  total: number;
  deprecated: number;
  byProvider: Record<string, number>;
}

/** Count models, deprecated models, and group by provider. */
export function selectModelTotals(models: ModelInfo[]): ModelTotals {
  let deprecated = 0;
  const byProvider: Record<string, number> = {};
  for (const m of models) {
    if (m.deprecated) deprecated++;
    const provider = m.provider ?? 'unknown';
    byProvider[provider] = (byProvider[provider] ?? 0) + 1;
  }
  return { total: models.length, deprecated, byProvider };
}

export interface ModelsByProvider {
  provider: string;
  models: ModelInfo[];
}

/**
 * Group a flat model list by provider. Order is insertion-stable: providers
 * appear in the order their first model is encountered.
 */
export function selectModelsByProvider(models: ModelInfo[]): ModelsByProvider[] {
  const map = new Map<string, ModelInfo[]>();
  for (const m of models) {
    const provider = m.provider ?? 'unknown';
    const bucket = map.get(provider);
    if (bucket) {
      bucket.push(m);
    } else {
      map.set(provider, [m]);
    }
  }
  return Array.from(map.entries()).map(([provider, ms]) => ({ provider, models: ms }));
}
