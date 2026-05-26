/**
 * Pure selectors for System configuration view section summaries.
 * Imports wire types from @eforge-build/client/browser.
 */
import type {
  AgentRuntimeProfileInfo,
  ExtensionDiagnostic,
  ExtensionListResponse,
  PlaybookListEntry,
  SessionPlanListEntryWire,
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

// ---------------------------------------------------------------------------
// Playbook selectors
// ---------------------------------------------------------------------------

export interface PlaybookModeCounts {
  autonomous: number;
  planning: number;
  total: number;
}

/** Count playbooks by execution mode. */
export function selectPlaybookModeCounts(playbooks: PlaybookListEntry[]): PlaybookModeCounts {
  let autonomous = 0;
  let planning = 0;
  for (const p of playbooks) {
    if (p.mode === 'autonomous') autonomous++;
    else if (p.mode === 'planning') planning++;
  }
  return { autonomous, planning, total: playbooks.length };
}

// ---------------------------------------------------------------------------
// Session-plan selectors
// ---------------------------------------------------------------------------

export interface SessionPlanReadinessCounts {
  ready: number;
  notReady: number;
  total: number;
  byStatus: Record<string, number>;
}

/** Count session plans by readiness and status. */
export function selectSessionPlanReadinessCounts(
  plans: SessionPlanListEntryWire[],
): SessionPlanReadinessCounts {
  let ready = 0;
  let notReady = 0;
  const byStatus: Record<string, number> = {};
  for (const p of plans) {
    if (p.ready) ready++;
    else notReady++;
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  }
  return { ready, notReady, total: plans.length, byStatus };
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
