import {
  type ExtensionActionInvokeResponse,
  type ExtensionActionManifestEntry,
  type ExtensionActionOutputProfile,
  ExtensionActionRequestedBySchema,
  type ExtensionActionRequestedBy,
  type ExtensionContributionAvailability,
  type ExtensionContributionManifestResponse,
  type ExtensionDeepLinkManifestEntry,
  type ExtensionJsonObject,
  type IntegrationCommandManifestEntry,
} from '../extension-contributions.js';
import {
  apiGetExtensionContributionManifest,
  apiGetExtensionContributionManifestIfRunning,
  apiInvokeExtensionAction,
  apiInvokeExtensionActionIfRunning,
} from './extension-contributions.js';
import { formatSchemaError, safeParseWithSchema } from '../schema-utils.js';
import {
  EXTENSION_HOST_CONTRIBUTION_KINDS,
  type ExtensionHostContributionDetailOptions,
  type ExtensionHostContributionDetailResponse,
  type ExtensionHostContributionEntry,
  type ExtensionHostContributionInvokeParams,
  type ExtensionHostContributionInvokeResult,
  type ExtensionHostContributionInvokeTarget,
  type ExtensionHostContributionKind,
  type ExtensionHostContributionListResponse,
  type ExtensionHostContributionProjectionOptions,
} from './extension-contribution-projection-types.js';
import {
  createExtensionContributionFailedInvocationEnvelope,
  summarizeExtensionContributionInvocationInput,
} from './extension-contribution-failure-envelope.js';

export {
  createExtensionContributionFailedInvocationEnvelope,
  summarizeExtensionContributionInvocationInput,
};

export {
  EXTENSION_HOST_CONTRIBUTION_KINDS,
  type ExtensionHostContributionDetailOptions,
  type ExtensionHostContributionDetailResponse,
  type ExtensionHostContributionEntry,
  type ExtensionHostContributionFailedInvocationEnvelope,
  type ExtensionHostContributionInputSummary,
  type ExtensionHostContributionInvokeParams,
  type ExtensionHostContributionInvokeResult,
  type ExtensionHostContributionInvokeTarget,
  type ExtensionHostContributionKind,
  type ExtensionHostContributionListResponse,
  type ExtensionHostContributionProjection,
  type ExtensionHostContributionProjectionOptions,
} from './extension-contribution-projection-types.js';

interface ResolveResult {
  target: ExtensionHostContributionInvokeTarget;
  unavailableMessage?: string;
}

type ActionLookup = Map<string, ExtensionActionManifestEntry>;

const EXTENSION_HOST_CONTRIBUTION_PROJECTIONS = ['compact', 'full'] as const;
const EXTENSION_ACTION_OUTPUT_PROFILES: ExtensionActionOutputProfile[] = ['agent-compact', 'agent-paginated', 'markdown', 'ui-rich', 'debug-rich'];

type ExtensionHostContributionBaseEntry = Omit<
  ExtensionHostContributionEntry,
  'hasInputSchema' | 'requiredInputKeys' | 'conditionalRequiredInputAlternatives' | 'inputPropertyKeys' | 'inputDefaultKeys'
>;

// --- eforge:region public-dispatch-api ---
export function summarizeExtensionContributionManifest(
  manifest: ExtensionContributionManifestResponse,
  options: ExtensionHostContributionProjectionOptions = {},
): ExtensionHostContributionListResponse {
  const projectionOptions = validateExtensionContributionProjectionOptions(options, { allowAllKind: true });
  const pagination = normalizePagination(projectionOptions);
  const diagnostics = manifest.diagnostics ?? [];
  const filteredEntries = applyContributionFilters(buildContributionEntries(manifest, projectionOptions), projectionOptions);
  const entries = filteredEntries.slice(pagination.offset, pagination.end);
  const nextOffset = pagination.offset + entries.length;
  const hasMore = nextOffset < filteredEntries.length;
  return {
    generatedAt: manifest.generatedAt,
    entries,
    diagnosticCount: diagnostics.length,
    total: filteredEntries.length,
    returned: entries.length,
    offset: pagination.offset,
    ...(pagination.limit !== undefined && { limit: pagination.limit }),
    hasMore,
    ...(hasMore && { nextOffset }),
    ...(shouldIncludeDiagnostics(projectionOptions) && { diagnostics }),
  };
}

export function showExtensionContributionManifestEntry(
  manifest: ExtensionContributionManifestResponse,
  options: ExtensionHostContributionDetailOptions,
): ExtensionHostContributionDetailResponse {
  const validatedOptions = validateExtensionContributionDetailOptions(options);
  if (typeof validatedOptions.id !== 'string' || validatedOptions.id.trim().length === 0) throw new Error('"id" is required when showing an extension contribution');
  const kind = validatedOptions.kind ?? inferKind(manifest, validatedOptions.id);
  const detailOptions: ExtensionHostContributionProjectionOptions = { ...validatedOptions, kind };
  const entry = buildContributionEntries(manifest, detailOptions).find((candidate) => candidate.kind === kind && candidate.id === validatedOptions.id);
  if (!entry) throw new Error(`Unknown extension contribution "${validatedOptions.id}"`);
  const diagnostics = manifest.diagnostics ?? [];
  return {
    generatedAt: manifest.generatedAt,
    entry,
    diagnosticCount: diagnostics.length,
    ...(shouldIncludeDiagnostics(validatedOptions) && { diagnostics }),
  };
}

export const getExtensionContributionManifestEntry = showExtensionContributionManifestEntry;

export function resolveExtensionContributionInvocation(
  manifest: ExtensionContributionManifestResponse,
  params: ExtensionHostContributionInvokeParams,
): ResolveResult {
  return resolveExtensionContributionInvocationWithInput(manifest, params, validateExtensionContributionInvocationParams(params));
}

function validateExtensionContributionInvocationParams(params: ExtensionHostContributionInvokeParams): ExtensionJsonObject {
  if (typeof params.id !== 'string' || params.id.trim().length === 0) throw new Error('"id" is required when action is "invoke"');
  if (params.kind !== undefined && !EXTENSION_HOST_CONTRIBUTION_KINDS.includes(params.kind)) throw new Error('"kind" must be action, command, or deep-link');
  const requestedBy = safeParseWithSchema(ExtensionActionRequestedBySchema, params.requestedBy);
  if (!requestedBy.success) throw new Error(`"requestedBy" is invalid: ${formatSchemaError(requestedBy.error)}`);
  return normalizeInput(params.input);
}

function resolveExtensionContributionInvocationWithInput(
  manifest: ExtensionContributionManifestResponse,
  params: ExtensionHostContributionInvokeParams,
  input: ExtensionJsonObject,
): ResolveResult {
  const kind = params.kind ?? inferKind(manifest, params.id);
  if (kind === 'action') return resolveAction(manifest.actions, params.id, input, params.requestedBy);
  if (kind === 'command') return resolveCommand(manifest.integrationCommands, manifest.actions, params.id, input, params.requestedBy);
  return resolveDeepLink(manifest.deepLinks, manifest.actions, params.id, input, params.requestedBy);
}

export async function listEforgeExtensionContributions(opts: {
  cwd: string;
  kind?: ExtensionHostContributionKind | 'all';
} & Omit<ExtensionHostContributionProjectionOptions, 'kind'>): Promise<ExtensionHostContributionListResponse> {
  const manifest = await apiGetExtensionContributionManifest({ cwd: opts.cwd });
  return summarizeExtensionContributionManifest(manifest, { ...opts, kind: opts.kind });
}

export async function listEforgeExtensionContributionsIfRunning(opts: {
  cwd: string;
  kind?: ExtensionHostContributionKind | 'all';
} & Omit<ExtensionHostContributionProjectionOptions, 'kind'>): Promise<ExtensionHostContributionListResponse | null> {
  const manifest = await apiGetExtensionContributionManifestIfRunning({ cwd: opts.cwd });
  return manifest ? summarizeExtensionContributionManifest(manifest, { ...opts, kind: opts.kind }) : null;
}

export async function invokeEforgeExtensionContribution(opts: {
  cwd: string;
} & ExtensionHostContributionInvokeParams): Promise<ExtensionHostContributionInvokeResult> {
  const input = validateExtensionContributionInvocationParams(opts);
  const manifest = await apiGetExtensionContributionManifest({ cwd: opts.cwd });
  const { target, unavailableMessage } = resolveExtensionContributionInvocationWithInput(manifest, opts, input);
  const response = unavailableMessage !== undefined
    ? unavailableResponse(unavailableMessage)
    : await apiInvokeExtensionAction({
      cwd: opts.cwd,
      body: { actionId: target.actionId, input: target.input, requestedBy: target.requestedBy },
    });
  return { target, response };
}

export async function invokeEforgeExtensionContributionIfRunning(opts: {
  cwd: string;
} & ExtensionHostContributionInvokeParams): Promise<ExtensionHostContributionInvokeResult | null> {
  const manifest = await apiGetExtensionContributionManifestIfRunning({ cwd: opts.cwd });
  if (!manifest) return null;
  const { target, unavailableMessage } = resolveExtensionContributionInvocation(manifest, opts);
  const response = unavailableMessage !== undefined
    ? unavailableResponse(unavailableMessage)
    : await apiInvokeExtensionActionIfRunning({
      cwd: opts.cwd,
      body: { actionId: target.actionId, input: target.input, requestedBy: target.requestedBy },
    });
  return response ? { target, response } : null;
}

// --- eforge:endregion public-dispatch-api ---

// --- eforge:region contribution-projection ---
function buildContributionEntries(
  manifest: ExtensionContributionManifestResponse,
  options: ExtensionHostContributionProjectionOptions,
): ExtensionHostContributionEntry[] {
  const kind = options.kind === 'all' ? undefined : options.kind;
  const actionLookup = buildActionLookup(manifest.actions);
  const actionEntries = kind && kind !== 'action' ? [] : manifest.actions.map((entry) => actionEntry(entry, options));
  const commandEntries = kind && kind !== 'command' ? [] : manifest.integrationCommands.map((entry) => commandEntry(entry, actionLookup, options));
  const deepLinkEntries = kind && kind !== 'deep-link' ? [] : manifest.deepLinks.map((entry) => deepLinkEntry(entry, actionLookup, options));
  return [...actionEntries, ...commandEntries, ...deepLinkEntries];
}

function applyContributionFilters(
  entries: ExtensionHostContributionEntry[],
  options: ExtensionHostContributionProjectionOptions,
): ExtensionHostContributionEntry[] {
  return entries.filter((entry) => matchesContributionFilters(entry, options));
}

function matchesContributionFilters(entry: ExtensionHostContributionEntry, options: ExtensionHostContributionProjectionOptions): boolean {
  if (options.extensionName && entry.extensionName !== options.extensionName) return false;
  if (options.idPrefix && !entry.id.startsWith(options.idPrefix)) return false;
  if (options.outputProfile && entry.outputProfile !== options.outputProfile) return false;
  if (options.search && !searchableContributionText(entry).includes(options.search.toLowerCase())) return false;
  return true;
}

function searchableContributionText(entry: ExtensionHostContributionEntry): string {
  return [entry.kind, entry.id, entry.label, entry.description, entry.extensionName, entry.actionId, entry.outputProfile]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n')
    .toLowerCase();
}

function validateExtensionContributionDetailOptions(options: ExtensionHostContributionDetailOptions): ExtensionHostContributionDetailOptions {
  return validateExtensionContributionProjectionOptions(options, { allowAllKind: false }) as ExtensionHostContributionDetailOptions;
}

function validateExtensionContributionProjectionOptions(
  options: ExtensionHostContributionProjectionOptions,
  config: { allowAllKind: boolean },
): ExtensionHostContributionProjectionOptions {
  validateStringFilter(options.extensionName, 'extensionName');
  validateStringFilter(options.search, 'search');
  validateStringFilter(options.idPrefix, 'idPrefix');
  validateBooleanFlag(options.includeInputSchema, 'includeInputSchema');
  validateBooleanFlag(options.includeDiagnostics, 'includeDiagnostics');
  if (options.kind !== undefined && !isValidContributionKindOption(options.kind, config.allowAllKind)) {
    throw new Error(config.allowAllKind ? '"kind" must be action, command, deep-link, or all' : '"kind" must be action, command, or deep-link');
  }
  if (options.projection !== undefined && !EXTENSION_HOST_CONTRIBUTION_PROJECTIONS.includes(options.projection)) {
    throw new Error('"projection" must be compact or full');
  }
  if (options.outputProfile !== undefined && !EXTENSION_ACTION_OUTPUT_PROFILES.includes(options.outputProfile)) {
    throw new Error('"outputProfile" must be agent-compact, agent-paginated, markdown, ui-rich, or debug-rich');
  }
  return options;
}

function isValidContributionKindOption(value: unknown, allowAllKind: boolean): value is ExtensionHostContributionProjectionOptions['kind'] {
  return EXTENSION_HOST_CONTRIBUTION_KINDS.includes(value as ExtensionHostContributionKind) || (allowAllKind && value === 'all');
}

function validateStringFilter(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== 'string') throw new Error(`"${field}" must be a string`);
}

function validateBooleanFlag(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== 'boolean') throw new Error(`"${field}" must be a boolean`);
}

function normalizePagination(options: ExtensionHostContributionProjectionOptions): { offset: number; limit?: number; end?: number } {
  const offset = normalizeNonNegativeInteger(options.offset, 'offset') ?? 0;
  const limit = normalizePositiveInteger(options.limit, 'limit');
  return { offset, ...(limit !== undefined && { limit, end: offset + limit }) };
}

function normalizeNonNegativeInteger(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) throw new Error(`"${field}" must be a non-negative integer`);
  return value;
}

function normalizePositiveInteger(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value <= 0) throw new Error(`"${field}" must be a positive integer`);
  return value;
}

function actionEntry(entry: ExtensionActionManifestEntry, options: ExtensionHostContributionProjectionOptions = {}): ExtensionHostContributionEntry {
  return projectEntry({
    kind: 'action',
    id: entry.id,
    label: entry.title,
    description: entry.description,
    extensionName: entry.extensionName,
    extensionPath: entry.extensionPath,
    localId: entry.localId,
    actionId: entry.id,
    actionLocalId: entry.localId,
    actionBacked: true,
    sideEffects: entry.sideEffects,
    outputProfile: entry.outputProfile,
    inputSchema: entry.inputSchema,
    availability: entry.availability,
  }, options);
}

function commandEntry(
  entry: IntegrationCommandManifestEntry,
  actionLookup: ActionLookup,
  options: ExtensionHostContributionProjectionOptions = {},
): ExtensionHostContributionEntry {
  const boundAction = actionLookup.get(entry.action.actionId);
  return projectEntry({
    kind: 'command',
    id: entry.id,
    label: entry.label,
    description: entry.description,
    extensionName: entry.extensionName,
    extensionPath: entry.extensionPath,
    localId: entry.localId,
    actionId: entry.action.actionId,
    actionLocalId: boundAction?.localId,
    actionBacked: true,
    sideEffects: boundAction?.sideEffects,
    outputProfile: boundAction?.outputProfile,
    inputSchema: entry.inputSchema ?? boundAction?.inputSchema,
    inputDefaults: entry.action.inputDefaults,
    availability: combineContributionAvailability(entry.availability, boundAction?.availability),
  }, options);
}

function deepLinkEntry(
  entry: ExtensionDeepLinkManifestEntry,
  actionLookup: ActionLookup,
  options: ExtensionHostContributionProjectionOptions = {},
): ExtensionHostContributionEntry {
  const boundAction = entry.action ? actionLookup.get(entry.action.actionId) : undefined;
  return projectEntry({
    kind: 'deep-link',
    id: entry.id,
    label: entry.label,
    description: entry.description,
    extensionName: entry.extensionName,
    extensionPath: entry.extensionPath,
    localId: entry.localId,
    actionId: entry.action?.actionId,
    actionLocalId: boundAction?.localId,
    urlTemplate: entry.urlTemplate,
    actionBacked: Boolean(entry.action),
    sideEffects: boundAction?.sideEffects,
    outputProfile: boundAction?.outputProfile,
    inputSchema: boundAction?.inputSchema,
    inputDefaults: entry.action?.inputDefaults,
    availability: entry.action ? combineContributionAvailability(entry.availability, boundAction?.availability) : entry.availability,
  }, options);
}

function projectEntry(entry: ExtensionHostContributionBaseEntry, options: ExtensionHostContributionProjectionOptions): ExtensionHostContributionEntry {
  const includeInputSchema = shouldIncludeInputSchema(options);
  const includeDiagnostics = shouldIncludeDiagnostics(options);
  const inputMetadata = contributionInputMetadata(entry.inputSchema, entry.inputDefaults);
  return {
    kind: entry.kind,
    id: entry.id,
    label: entry.label,
    ...(entry.description !== undefined && { description: entry.description }),
    extensionName: entry.extensionName,
    extensionPath: entry.extensionPath,
    ...(entry.localId !== undefined && { localId: entry.localId }),
    ...(entry.actionId !== undefined && { actionId: entry.actionId }),
    ...(entry.actionLocalId !== undefined && { actionLocalId: entry.actionLocalId }),
    ...(entry.urlTemplate !== undefined && { urlTemplate: entry.urlTemplate }),
    actionBacked: entry.actionBacked,
    ...(entry.sideEffects !== undefined && { sideEffects: entry.sideEffects }),
    ...(entry.outputProfile !== undefined && { outputProfile: entry.outputProfile }),
    ...inputMetadata,
    ...(includeInputSchema && entry.inputSchema !== undefined && { inputSchema: entry.inputSchema }),
    ...(includeInputSchema && entry.inputDefaults !== undefined && { inputDefaults: entry.inputDefaults }),
    ...(entry.availability !== undefined && { availability: projectAvailability(entry.availability, includeDiagnostics) }),
  };
}

function contributionInputMetadata(
  inputSchema: ExtensionJsonObject | undefined,
  inputDefaults: ExtensionJsonObject | undefined,
): Pick<ExtensionHostContributionEntry, 'hasInputSchema' | 'requiredInputKeys' | 'conditionalRequiredInputAlternatives' | 'inputPropertyKeys' | 'inputDefaultKeys'> {
  const conditionalRequiredInputAlternatives = conditionalRequiredAlternatives(inputSchema);
  return {
    hasInputSchema: inputSchema !== undefined,
    requiredInputKeys: stringArrayProperty(inputSchema, 'required'),
    ...(conditionalRequiredInputAlternatives.length > 0 && { conditionalRequiredInputAlternatives }),
    inputPropertyKeys: objectKeysProperty(inputSchema, 'properties'),
    inputDefaultKeys: inputDefaults ? Object.keys(inputDefaults).sort((left, right) => left.localeCompare(right)) : [],
  };
}

function conditionalRequiredAlternatives(inputSchema: ExtensionJsonObject | undefined): string[][] {
  const alternatives: string[][] = [];
  for (const key of ['oneOf', 'anyOf']) {
    const variants = inputSchema?.[key];
    if (!Array.isArray(variants)) continue;
    for (const variant of variants) {
      const fields = variant !== null && typeof variant === 'object' && !Array.isArray(variant)
        ? stringArrayProperty(variant as ExtensionJsonObject, 'required')
        : [];
      if (fields.length > 0) alternatives.push(fields);
    }
  }
  return alternatives;
}

function stringArrayProperty(value: ExtensionJsonObject | undefined, key: string): string[] {
  const child = value?.[key];
  return Array.isArray(child) ? child.filter((item): item is string => typeof item === 'string').sort((left, right) => left.localeCompare(right)) : [];
}

function objectKeysProperty(value: ExtensionJsonObject | undefined, key: string): string[] {
  const child = value?.[key];
  return child !== null && typeof child === 'object' && !Array.isArray(child)
    ? Object.keys(child).sort((left, right) => left.localeCompare(right))
    : [];
}

function projectAvailability(
  availability: ExtensionContributionAvailability,
  includeDiagnostics: boolean,
): ExtensionContributionAvailability {
  if (includeDiagnostics) return availability;
  return { available: availability.available, ...(availability.message !== undefined && { message: availability.message }) };
}

function shouldIncludeInputSchema(options: ExtensionHostContributionProjectionOptions): boolean {
  return options.projection === 'full' || options.includeInputSchema === true;
}

function shouldIncludeDiagnostics(options: ExtensionHostContributionProjectionOptions): boolean {
  return options.projection === 'full' || options.includeDiagnostics === true;
}

function buildActionLookup(entries: ExtensionActionManifestEntry[]): ActionLookup {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

// --- eforge:endregion contribution-projection ---

// --- eforge:region contribution-resolution ---
function inferKind(manifest: ExtensionContributionManifestResponse, id: string): ExtensionHostContributionKind {
  const matches: ExtensionHostContributionKind[] = [];
  if (manifest.actions.some((entry) => entry.id === id)) matches.push('action');
  if (manifest.integrationCommands.some((entry) => entry.id === id)) matches.push('command');
  if (manifest.deepLinks.some((entry) => entry.id === id)) matches.push('deep-link');
  if (matches.length > 1) {
    throw new Error(`Ambiguous extension contribution id "${id}"; pass kind action, command, or deep-link`);
  }
  if (matches[0]) return matches[0];
  throw new Error(`Unknown extension action "${id}"`);
}

function resolveAction(
  entries: ExtensionActionManifestEntry[],
  id: string,
  input: ExtensionJsonObject,
  requestedBy: ExtensionActionRequestedBy,
): ResolveResult {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown extension action "${id}"`);
  const unavailableMessage = contributionUnavailableMessage(entry.availability, `Extension action "${id}" is unavailable`);
  return {
    unavailableMessage,
    target: {
      kind: 'action',
      id: entry.id,
      label: entry.title,
      extensionName: entry.extensionName,
      extensionPath: entry.extensionPath,
      actionId: entry.id,
      requestedBy,
      input,
      outputProfile: entry.outputProfile,
    },
  };
}

function resolveCommand(
  entries: IntegrationCommandManifestEntry[],
  actions: ExtensionActionManifestEntry[],
  id: string,
  input: ExtensionJsonObject,
  requestedBy: ExtensionActionRequestedBy,
): ResolveResult {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown extension integration command "${id}"`);
  const boundAction = actions.find((candidate) => candidate.id === entry.action.actionId);
  const unavailableMessage = contributionUnavailableMessage(entry.availability, `Extension integration command "${id}" is unavailable`)
    ?? contributionUnavailableMessage(boundAction?.availability, `Extension action "${entry.action.actionId}" is unavailable`);
  return {
    unavailableMessage,
    target: {
      kind: 'command',
      id: entry.id,
      label: entry.label,
      extensionName: entry.extensionName,
      extensionPath: entry.extensionPath,
      actionId: entry.action.actionId,
      requestedBy: { ...requestedBy, commandId: entry.id } as ExtensionActionRequestedBy,
      input: { ...(entry.action.inputDefaults ?? {}), ...input },
      outputProfile: boundAction?.outputProfile,
    },
  };
}

function resolveDeepLink(
  entries: ExtensionDeepLinkManifestEntry[],
  actions: ExtensionActionManifestEntry[],
  id: string,
  input: ExtensionJsonObject,
  requestedBy: ExtensionActionRequestedBy,
): ResolveResult {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown extension deep link "${id}"`);
  if (!entry.action) throw new Error(`Deep link "${id}" is not action-backed`);
  const boundAction = actions.find((candidate) => candidate.id === entry.action?.actionId);
  const unavailableMessage = contributionUnavailableMessage(entry.availability, `Extension deep link "${id}" is unavailable`)
    ?? contributionUnavailableMessage(boundAction?.availability, `Extension action "${entry.action.actionId}" is unavailable`);
  return {
    unavailableMessage,
    target: {
      kind: 'deep-link',
      id: entry.id,
      label: entry.label,
      extensionName: entry.extensionName,
      extensionPath: entry.extensionPath,
      actionId: entry.action.actionId,
      requestedBy: { ...requestedBy, deepLinkId: entry.id } as ExtensionActionRequestedBy,
      input: { ...(entry.action.inputDefaults ?? {}), ...input },
      outputProfile: boundAction?.outputProfile,
    },
  };
}

function contributionUnavailableMessage(availability: ExtensionContributionAvailability | undefined, fallbackMessage: string): string | undefined {
  return availability?.available === false ? availability.message ?? fallbackMessage : undefined;
}

function combineContributionAvailability(
  entryAvailability: ExtensionContributionAvailability | undefined,
  actionAvailability: ExtensionContributionAvailability | undefined,
): ExtensionContributionAvailability | undefined {
  if (entryAvailability?.available === false || actionAvailability?.available === false) {
    const diagnostics = [...(entryAvailability?.diagnostics ?? []), ...(actionAvailability?.diagnostics ?? [])];
    return {
      available: false,
      message: entryAvailability?.available === false ? entryAvailability.message ?? actionAvailability?.message : actionAvailability?.message,
      ...(diagnostics.length > 0 && { diagnostics }),
    };
  }
  return entryAvailability ?? actionAvailability;
}

// --- eforge:endregion contribution-resolution ---

// --- eforge:region dispatch-helpers ---
function unavailableResponse(message: string): ExtensionActionInvokeResponse {
  return {
    ok: false,
    invocationId: `client-unavailable-${Date.now()}`,
    error: { code: 'unavailable', message },
  };
}

function normalizeInput(input: ExtensionJsonObject | undefined): ExtensionJsonObject {
  const value = input === undefined ? {} : input;
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('"input" must be a JSON object');
  }
  return value;
}
// --- eforge:endregion dispatch-helpers ---
