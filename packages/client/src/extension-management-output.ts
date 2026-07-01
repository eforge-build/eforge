import type {
  ExtensionDemoteResponse,
  ExtensionDiagnostic,
  ExtensionEntry,
  ExtensionInstallResponse,
  ExtensionListResponse,
  ExtensionNewResponse,
  ExtensionPromoteResponse,
  ExtensionReloadResponse,
  ExtensionRemoveResponse,
  ExtensionRegistrationSummary,
  ExtensionShowResponse,
  ExtensionTestResponse,
  ExtensionTrustResponse,
  ExtensionUntrustResponse,
  ExtensionUpdateResponse,
  ExtensionValidateResponse,
} from './types.js';

const DETAIL_ARRAY_KEYS = [
  'reviewerPerspectiveDetails', 'validationProviderDetails', 'actionDetails', 'agentTaskDetails',
  'consoleContributionDetails', 'consoleWorkstationDetails', 'integrationCommandDetails', 'deepLinkDetails',
] as const;

const REGISTRATION_KEYS = [
  'eventHooks', 'agentRunHooks', 'policyGates', 'profileRouters', 'runtimeChoiceRouters', 'inputSources', 'reviewerPerspectives',
  'validationProviders', 'tools', 'prdEnrichers', 'actions', 'agentTasks', 'consoleContributions',
  'consoleWorkstations', 'integrationCommands', 'deepLinks',
] as const satisfies readonly (keyof ExtensionRegistrationSummary)[];

export type EforgeExtensionManagementProjectionAction =
  | 'list' | 'show' | 'validate' | 'reload' | 'test' | 'new' | 'trust' | 'untrust'
  | 'install' | 'update' | 'remove' | 'promote' | 'demote';

export interface CompactExtensionDiagnosticSample { severity: ExtensionDiagnostic['severity']; code: string; name?: string; message?: string; scope?: ExtensionDiagnostic['scope']; source?: ExtensionDiagnostic['source']; dependencyName?: string; providerName?: string; capabilityName?: string; dependencyKind?: ExtensionDiagnostic['dependencyKind'] }
export interface CompactExtensionDiagnosticsProjection { count: number; samples: CompactExtensionDiagnosticSample[]; omitted: number }
export interface CompactExtensionDetailArrayProjection { count: number; samples: Array<Record<string, unknown>>; omitted: number }
export interface CompactExtensionManagementProjection { action: EforgeExtensionManagementProjectionAction; nextSteps: string[]; [key: string]: unknown }
export interface CompactExtensionProjectionOptions { diagnosticSamples?: number; detailSamples?: number }

export interface CompactExtensionEntryProjection {
  name: string; path: string; entrypoint?: string; scope: ExtensionEntry['scope']; source: ExtensionEntry['source']; status: ExtensionEntry['status']; enabled?: boolean;
  trust?: ExtensionEntry['trust']; trustState?: ExtensionEntry['trustState']; currentHash?: string; trustedHash?: string; trustedAt?: string; trustedBy?: string; trustStorePath?: string;
  format?: ExtensionEntry['format']; layout?: ExtensionEntry['layout']; strategy?: string; registrations: ExtensionRegistrationSummary; registrationTotal: number;
  diagnostics: CompactExtensionDiagnosticsProjection; shadows: CompactExtensionDetailArrayProjection; details: Partial<Record<(typeof DETAIL_ARRAY_KEYS)[number], CompactExtensionDetailArrayProjection>>;
  capabilities?: CompactExtensionDetailArrayProjection; dependencies?: Record<string, unknown>; resolvedDependencies?: Record<string, unknown>; package?: Record<string, unknown>; install?: Record<string, unknown>; nextSteps: string[];
}

export function projectCompactExtensionEntry(entry: ExtensionEntry, options: CompactExtensionProjectionOptions = {}): CompactExtensionEntryProjection {
  const diagnosticSamples = options.diagnosticSamples ?? 3;
  const detailSamples = options.detailSamples ?? 3;
  const details = Object.fromEntries(
    DETAIL_ARRAY_KEYS.flatMap((key) => summarizeDetailArray(key, entry[key], detailSamples)),
  ) as CompactExtensionEntryProjection['details'];
  return omitUndefined({
    name: entry.name, path: entry.path, entrypoint: entry.entrypoint, scope: entry.scope, source: entry.source, status: entry.status, enabled: entry.enabled,
    trust: entry.trust, trustState: entry.trustState, currentHash: entry.currentHash, trustedHash: entry.trustedHash, trustedAt: entry.trustedAt, trustedBy: entry.trustedBy, trustStorePath: entry.trustStorePath,
    format: entry.format, layout: entry.layout, strategy: entry.strategy, registrations: entry.registrations, registrationTotal: registrationTotal(entry.registrations),
    diagnostics: summarizeDiagnostics(entry.diagnostics, diagnosticSamples), shadows: summarizeRecords(entry.shadows, detailSamples), details,
    capabilities: entry.capabilities ? summarizeRecords(entry.capabilities, detailSamples) : undefined,
    dependencies: entry.dependencies ? summarizeDependencyManifest(entry.dependencies) : undefined,
    resolvedDependencies: entry.resolvedDependencies ? summarizeResolvedDependencies(entry.resolvedDependencies, diagnosticSamples) : undefined,
    package: entry.package ? summarizeRecord(entry.package) : undefined,
    install: entry.install ? summarizeRecord(entry.install) : undefined,
    nextSteps: extensionNextSteps(entry),
  }) as CompactExtensionEntryProjection;
}

export function projectExtensionManagementListResponse(response: ExtensionListResponse): CompactExtensionManagementProjection {
  const extensions = response.extensions.map((entry) => projectCompactExtensionEntry(entry));
  return {
    action: 'list', count: extensions.length, totals: response.totals, diagnosticCount: response.diagnostics.length,
    diagnostics: summarizeDiagnostics(response.diagnostics), extensions, nextSteps: listNextSteps(response),
  };
}

export function projectExtensionManagementShowResponse(response: ExtensionShowResponse): CompactExtensionManagementProjection {
  const extension = projectCompactExtensionEntry(response.extension);
  return { action: 'show', extension, nextSteps: extension.nextSteps };
}

export function projectExtensionManagementValidateResponse(response: ExtensionValidateResponse): CompactExtensionManagementProjection {
  return {
    action: 'validate', valid: response.valid, count: response.extensions.length, diagnosticCount: response.diagnostics.length,
    diagnostics: summarizeDiagnostics(response.diagnostics), extensions: response.extensions.map((entry) => projectCompactExtensionEntry(entry)),
    nextSteps: response.valid ? ['Validation passed. Reload extensions to activate code changes when needed.'] : ['Fix diagnostics, then run validate again.'],
  };
}

export function projectExtensionManagementReloadResponse(response: ExtensionReloadResponse): CompactExtensionManagementProjection {
  return {
    ...projectExtensionManagementListResponse(response), action: 'reload', running: response.running, previousSessionId: response.previousSessionId,
    sessionId: response.sessionId, watcher: response.watcher, message: response.message,
    nextSteps: response.diagnostics.length > 0 ? ['Review diagnostics; untrusted or invalid extensions remain blocked.'] : ['Reload complete. Use list or show to inspect active registrations.'],
  };
}

export function projectExtensionManagementTestResponse(response: ExtensionTestResponse): CompactExtensionManagementProjection {
  return {
    action: 'test', valid: response.valid, source: response.source, replay: response.replay,
    matchCount: response.matches.length, matches: summarizeRecords(response.matches, 10),
    emittedDiagnosticCount: response.emittedDiagnostics.length, emittedDiagnostics: summarizeRecords(response.emittedDiagnostics, 5),
    deferredRegistrations: summarizeRecords(response.deferredRegistrations, 5),
    diagnosticCount: response.diagnostics.length, diagnostics: summarizeDiagnostics(response.diagnostics), extensions: response.extensions.map((entry) => projectCompactExtensionEntry(entry)),
    nextSteps: response.valid ? ['Replay test passed. Reload extensions if you changed implementation code.'] : ['Fix diagnostics or replay failures, then run test again.'],
  };
}

export function projectExtensionManagementNewResponse(response: ExtensionNewResponse): CompactExtensionManagementProjection {
  return {
    action: 'new', name: response.name, template: response.template, requestScope: response.requestScope, scope: response.scope,
    configDir: response.configDir, scopeDir: response.scopeDir, extensionsDir: response.extensionsDir, path: response.path,
    created: response.created, overwritten: response.overwritten, message: response.message,
    nextSteps: ['Edit the generated extension, validate it, then trust/reload if required for its scope.'],
  };
}

export function projectExtensionManagementTrustResponse(response: ExtensionTrustResponse): CompactExtensionManagementProjection {
  const extension = projectCompactExtensionEntry(response.extension);
  return { action: 'trust', extension, message: response.message, nextSteps: ['Reload extensions after trusting if the daemon has not reloaded automatically.'] };
}

export function projectExtensionManagementUntrustResponse(response: ExtensionUntrustResponse): CompactExtensionManagementProjection {
  const extension = projectCompactExtensionEntry(response.extension);
  return { action: 'untrust', extension, message: response.message, nextSteps: ['The extension is no longer trusted; reload or validate before relying on it.'] };
}

export function projectExtensionManagementPackageResponse(
  action: 'install' | 'update' | 'remove' | 'promote' | 'demote',
  response: ExtensionInstallResponse | ExtensionUpdateResponse | ExtensionRemoveResponse | ExtensionPromoteResponse | ExtensionDemoteResponse,
): CompactExtensionManagementProjection {
  if (!('extension' in response)) return { action, message: response.message, nextSteps: ['Run list to confirm the extension inventory.'] };
  const extension = projectCompactExtensionEntry(response.extension);
  return { action, extension, message: response.message, ...('previousVersion' in response && { previousVersion: response.previousVersion }), nextSteps: packageNextSteps(action, extension) };
}

export function projectExtensionManagementResponse(action: EforgeExtensionManagementProjectionAction, response: unknown): CompactExtensionManagementProjection {
  if (action === 'list') return projectExtensionManagementListResponse(response as ExtensionListResponse);
  if (action === 'show') return projectExtensionManagementShowResponse(response as ExtensionShowResponse);
  if (action === 'validate') return projectExtensionManagementValidateResponse(response as ExtensionValidateResponse);
  if (action === 'reload') return projectExtensionManagementReloadResponse(response as ExtensionReloadResponse);
  if (action === 'test') return projectExtensionManagementTestResponse(response as ExtensionTestResponse);
  if (action === 'new') return projectExtensionManagementNewResponse(response as ExtensionNewResponse);
  if (action === 'trust') return projectExtensionManagementTrustResponse(response as ExtensionTrustResponse);
  if (action === 'untrust') return projectExtensionManagementUntrustResponse(response as ExtensionUntrustResponse);
  return projectExtensionManagementPackageResponse(action, response as ExtensionInstallResponse | ExtensionUpdateResponse | ExtensionRemoveResponse | ExtensionPromoteResponse | ExtensionDemoteResponse);
}

function summarizeDiagnostics(diagnostics: ExtensionDiagnostic[], limit = 3): CompactExtensionDiagnosticsProjection {
  return { count: diagnostics.length, samples: diagnostics.slice(0, limit).map(sanitizeDiagnosticSample), omitted: Math.max(0, diagnostics.length - limit) };
}

function sanitizeDiagnosticSample(diagnostic: ExtensionDiagnostic): CompactExtensionDiagnosticSample {
  return omitUndefined({
    severity: diagnostic.severity,
    code: diagnostic.code,
    name: diagnostic.name,
    message: diagnostic.message ? summarizePrimitive(diagnostic.message, 120) as string : undefined,
    scope: diagnostic.scope,
    source: diagnostic.source,
    dependencyName: diagnostic.dependencyName,
    providerName: diagnostic.providerName,
    capabilityName: diagnostic.capabilityName,
    dependencyKind: diagnostic.dependencyKind,
  });
}

function summarizeDetailArray(key: (typeof DETAIL_ARRAY_KEYS)[number], value: unknown, limit: number): Array<[string, CompactExtensionDetailArrayProjection]> {
  return Array.isArray(value) ? [[key, summarizeRecords(value, limit)]] : [];
}

function summarizeRecords(values: unknown[], limit: number): CompactExtensionDetailArrayProjection {
  return { count: values.length, samples: values.slice(0, limit).map(summarizeRecord), omitted: Math.max(0, values.length - limit) };
}

function summarizeRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return { value };
  const result: Record<string, unknown> = {};
  for (const key of ['id', 'type', 'name', 'label', 'title', 'kind', 'status', 'severity', 'code', 'message', 'scope', 'source', 'path', 'entrypoint', 'actionId', 'outputProfile', 'available', 'eventIndex', 'eventType', 'extensionName', 'pattern', 'family', 'count']) {
    if (value[key] !== undefined) result[key] = summarizePrimitive(value[key]);
  }
  for (const [key, child] of Object.entries(value)) {
    if (result[key] !== undefined) continue;
    if (Array.isArray(child)) result[key] = { count: child.length, omitted: child.length };
    else if (isRecord(child)) result[key] = { keys: Object.keys(child).length, omittedKeys: Object.keys(child).length };
    else if (Object.keys(result).length < 8) result[key] = summarizePrimitive(child);
  }
  return result;
}

function summarizeDependencyManifest(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return summarizeRecord(value);
  return omitUndefined({
    required: Array.isArray(value.required) ? { count: value.required.length, samples: value.required.slice(0, 3).map(summarizeRecord), omitted: Math.max(0, value.required.length - 3) } : undefined,
    optional: Array.isArray(value.optional) ? { count: value.optional.length, samples: value.optional.slice(0, 3).map(summarizeRecord), omitted: Math.max(0, value.optional.length - 3) } : undefined,
  });
}

function summarizeResolvedDependencies(value: unknown, diagnosticLimit: number): Record<string, unknown> {
  if (!isRecord(value)) return summarizeRecord(value);
  return omitUndefined({
    available: value.available,
    required: Array.isArray(value.required) ? summarizeRecords(value.required, 3) : undefined,
    optional: Array.isArray(value.optional) ? summarizeRecords(value.optional, 3) : undefined,
    diagnostics: Array.isArray(value.diagnostics) ? summarizeDiagnostics(value.diagnostics as ExtensionDiagnostic[], diagnosticLimit) : undefined,
  });
}

function extensionNextSteps(entry: Pick<ExtensionEntry, 'status' | 'trustState' | 'diagnostics' | 'name'>): string[] {
  const steps: string[] = [];
  if (entry.trustState === 'untrusted') steps.push(`Run trust for ${entry.name} after reviewing its source.`);
  if (entry.trustState === 'changed') steps.push(`Re-trust ${entry.name} after reviewing the changed source.`);
  if (entry.status !== 'loaded') steps.push('Run validate to inspect load or registration diagnostics.');
  if (entry.diagnostics.length > 0) steps.push('Use show or validate for focused diagnostic detail; use raw CLI/HTTP JSON only for full schemas/detail arrays.');
  if (steps.length === 0) steps.push('Use show for focused details, or raw CLI/HTTP JSON for full schemas/detail arrays.');
  return steps;
}

function listNextSteps(response: ExtensionListResponse): string[] {
  const steps = ['Use show for one extension before inspecting raw schemas/detail arrays.'];
  if (response.diagnostics.length > 0) steps.push('Run validate to focus on diagnostics.');
  return steps;
}

function packageNextSteps(action: string, extension: CompactExtensionEntryProjection): string[] {
  if (action === 'remove') return ['Run list to confirm removal.'];
  return extension.trustState === 'untrusted' || extension.trustState === 'changed'
    ? ['Review and trust the extension, then reload.']
    : ['Run validate or reload before relying on changed registrations.'];
}

function registrationTotal(summary: ExtensionRegistrationSummary): number {
  return REGISTRATION_KEYS.reduce((total, key) => total + (summary[key] ?? 0), 0);
}

function summarizePrimitive(value: unknown, maxChars = 160): unknown {
  if (typeof value !== 'string' || value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 24))}… (${value.length.toLocaleString()} chars)`;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
