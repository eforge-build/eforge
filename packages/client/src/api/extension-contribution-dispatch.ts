import {
  type ExtensionActionInvokeFailureResponse,
  type ExtensionActionInvokeResponse,
  type ExtensionActionManifestEntry,
  type ExtensionActionOutputProfile,
  type ExtensionContributionAvailability,
  type ExtensionActionRequestedBy,
  type ExtensionActionSideEffect,
  type ExtensionContributionDiagnostic,
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

export const EXTENSION_HOST_CONTRIBUTION_KINDS = ['action', 'command', 'deep-link'] as const;
export type ExtensionHostContributionKind = typeof EXTENSION_HOST_CONTRIBUTION_KINDS[number];

// --- eforge:region plan-01-shared-contribution-projection ---
export type ExtensionHostContributionProjection = 'compact' | 'full';

export interface ExtensionHostContributionProjectionOptions {
  projection?: ExtensionHostContributionProjection;
  kind?: ExtensionHostContributionKind | 'all';
  extensionName?: string;
  search?: string;
  idPrefix?: string;
  outputProfile?: ExtensionActionOutputProfile;
  limit?: number;
  offset?: number;
  includeInputSchema?: boolean;
  includeDiagnostics?: boolean;
}

export interface ExtensionHostContributionDetailOptions {
  id: string;
  kind?: ExtensionHostContributionKind;
  projection?: ExtensionHostContributionProjection;
  includeInputSchema?: boolean;
  includeDiagnostics?: boolean;
}

export interface ExtensionHostContributionInputSummary {
  inputKeys: string[];
  inputKeyCount: number;
  serializedInputSize: number;
  omittedInputKeyCount?: number;
  truncatedInputKeyCount?: number;
}
// --- eforge:endregion plan-01-shared-contribution-projection ---

export interface ExtensionHostContributionEntry {
  kind: ExtensionHostContributionKind;
  id: string;
  label: string;
  description?: string;
  extensionName: string;
  extensionPath: string;
  actionId?: string;
  urlTemplate?: string;
  actionBacked: boolean;
  sideEffects?: ExtensionActionSideEffect[];
  outputProfile?: ExtensionActionOutputProfile;
  // --- eforge:region plan-01-shared-contribution-projection ---
  hasInputSchema?: boolean;
  requiredInputKeys?: string[];
  inputPropertyKeys?: string[];
  inputDefaultKeys?: string[];
  // --- eforge:endregion plan-01-shared-contribution-projection ---
  inputSchema?: ExtensionJsonObject;
  inputDefaults?: ExtensionJsonObject;
  availability?: ExtensionContributionAvailability;
}

export interface ExtensionHostContributionListResponse {
  generatedAt: string;
  entries: ExtensionHostContributionEntry[];
  // --- eforge:region plan-01-shared-contribution-projection ---
  diagnosticCount: number;
  total: number;
  returned: number;
  offset: number;
  limit?: number;
  hasMore: boolean;
  nextOffset?: number;
  // --- eforge:endregion plan-01-shared-contribution-projection ---
  diagnostics?: ExtensionContributionDiagnostic[];
}

// --- eforge:region plan-01-shared-contribution-projection ---
export interface ExtensionHostContributionDetailResponse {
  generatedAt: string;
  entry: ExtensionHostContributionEntry;
  diagnosticCount: number;
  diagnostics?: ExtensionContributionDiagnostic[];
}
// --- eforge:endregion plan-01-shared-contribution-projection ---

export interface ExtensionHostContributionInvokeParams {
  kind?: ExtensionHostContributionKind;
  id: string;
  input?: ExtensionJsonObject;
  requestedBy: ExtensionActionRequestedBy;
}

export interface ExtensionHostContributionInvokeTarget {
  kind: ExtensionHostContributionKind;
  id: string;
  label: string;
  extensionName: string;
  extensionPath: string;
  actionId: string;
  requestedBy: ExtensionActionRequestedBy;
  input: ExtensionJsonObject;
  outputProfile?: ExtensionActionOutputProfile;
}

export interface ExtensionHostContributionInvokeResult {
  target: ExtensionHostContributionInvokeTarget;
  response: ExtensionActionInvokeResponse;
}

// --- eforge:region plan-01-shared-contribution-projection ---
export interface ExtensionHostContributionFailedInvocationEnvelope {
  ok: false;
  invocationId: string;
  target: Omit<ExtensionHostContributionInvokeTarget, 'input' | 'requestedBy'>;
  requestedBy: ExtensionActionRequestedBy;
  error: Pick<ExtensionActionInvokeFailureResponse['error'], 'code' | 'message'> & { messageTruncated?: boolean };
  inputSummary: ExtensionHostContributionInputSummary;
}
// --- eforge:endregion plan-01-shared-contribution-projection ---

interface ResolveResult {
  target: ExtensionHostContributionInvokeTarget;
  unavailableMessage?: string;
}

type ActionLookup = Map<string, ExtensionActionManifestEntry>;

// --- eforge:region plan-01-shared-contribution-projection ---
const FAILED_INVOCATION_ERROR_MESSAGE_MAX_LENGTH = 1_000;
const FAILED_INVOCATION_INPUT_KEY_MAX_COUNT = 20;
const FAILED_INVOCATION_INPUT_KEY_MAX_LENGTH = 80;
const FAILED_INVOCATION_INPUT_VALUE_REDACTION_MIN_LENGTH = 80;
const EXTENSION_HOST_CONTRIBUTION_PROJECTIONS = ['compact', 'full'] as const;
const EXTENSION_ACTION_OUTPUT_PROFILES: ExtensionActionOutputProfile[] = ['agent-compact', 'agent-paginated', 'markdown', 'ui-rich', 'debug-rich'];

type ExtensionHostContributionBaseEntry = Omit<
  ExtensionHostContributionEntry,
  'hasInputSchema' | 'requiredInputKeys' | 'inputPropertyKeys' | 'inputDefaultKeys'
>;
// --- eforge:endregion plan-01-shared-contribution-projection ---

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

// --- eforge:region plan-01-shared-contribution-projection ---
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

export function summarizeExtensionContributionInvocationInput(input: ExtensionJsonObject): ExtensionHostContributionInputSummary {
  const serialized = JSON.stringify(input) ?? '{}';
  const rawInputKeys = Object.keys(input).sort((left, right) => left.localeCompare(right));
  const inputKeys = rawInputKeys
    .slice(0, FAILED_INVOCATION_INPUT_KEY_MAX_COUNT)
    .map((key) => truncateForHostEnvelope(key, FAILED_INVOCATION_INPUT_KEY_MAX_LENGTH));
  const truncatedInputKeyCount = rawInputKeys.filter((key) => key.length > FAILED_INVOCATION_INPUT_KEY_MAX_LENGTH).length;
  const omittedInputKeyCount = Math.max(0, rawInputKeys.length - inputKeys.length);
  return {
    inputKeys,
    inputKeyCount: rawInputKeys.length,
    serializedInputSize: serialized.length,
    ...(omittedInputKeyCount > 0 && { omittedInputKeyCount }),
    ...(truncatedInputKeyCount > 0 && { truncatedInputKeyCount }),
  };
}

export function createExtensionContributionFailedInvocationEnvelope(
  result: ExtensionHostContributionInvokeResult,
): ExtensionHostContributionFailedInvocationEnvelope | undefined {
  if (result.response.ok) return undefined;
  const { input: _input, requestedBy, ...target } = result.target;
  const redactedMessage = redactInputValuesFromHostEnvelopeError(result.response.error.message, result.target.input);
  const errorMessage = truncateForHostEnvelope(redactedMessage, FAILED_INVOCATION_ERROR_MESSAGE_MAX_LENGTH);
  return {
    ok: false,
    invocationId: result.response.invocationId,
    target,
    requestedBy,
    error: {
      code: result.response.error.code,
      message: errorMessage,
      ...(errorMessage.length < redactedMessage.length && { messageTruncated: true }),
    },
    inputSummary: summarizeExtensionContributionInvocationInput(result.target.input),
  };
}

function truncateForHostEnvelope(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function redactInputValuesFromHostEnvelopeError(message: string, input: ExtensionJsonObject): string {
  return collectLongStringInputValues(input)
    .reduce((redacted, value) => redacted.split(value).join('[redacted input value]'), message);
}

function collectLongStringInputValues(value: unknown): string[] {
  if (typeof value === 'string') return value.length >= FAILED_INVOCATION_INPUT_VALUE_REDACTION_MIN_LENGTH ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectLongStringInputValues(item));
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap((item) => collectLongStringInputValues(item));
  return [];
}
// --- eforge:endregion plan-01-shared-contribution-projection ---

export function resolveExtensionContributionInvocation(
  manifest: ExtensionContributionManifestResponse,
  params: ExtensionHostContributionInvokeParams,
): ResolveResult {
  return resolveExtensionContributionInvocationWithInput(manifest, params, validateExtensionContributionInvocationParams(params));
}

function validateExtensionContributionInvocationParams(params: ExtensionHostContributionInvokeParams): ExtensionJsonObject {
  if (typeof params.id !== 'string' || params.id.trim().length === 0) throw new Error('"id" is required when action is "invoke"');
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
  // --- eforge:region plan-01-shared-contribution-projection ---
} & Omit<ExtensionHostContributionProjectionOptions, 'kind'>): Promise<ExtensionHostContributionListResponse> {
  // --- eforge:endregion plan-01-shared-contribution-projection ---
  const manifest = await apiGetExtensionContributionManifest({ cwd: opts.cwd });
  return summarizeExtensionContributionManifest(manifest, { ...opts, kind: opts.kind });
}

export async function listEforgeExtensionContributionsIfRunning(opts: {
  cwd: string;
  kind?: ExtensionHostContributionKind | 'all';
  // --- eforge:region plan-01-shared-contribution-projection ---
} & Omit<ExtensionHostContributionProjectionOptions, 'kind'>): Promise<ExtensionHostContributionListResponse | null> {
  // --- eforge:endregion plan-01-shared-contribution-projection ---
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

// --- eforge:region plan-01-shared-contribution-projection ---
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
// --- eforge:endregion plan-01-shared-contribution-projection ---

function actionEntry(entry: ExtensionActionManifestEntry, options: ExtensionHostContributionProjectionOptions = {}): ExtensionHostContributionEntry {
  return projectEntry({
    kind: 'action',
    id: entry.id,
    label: entry.title,
    description: entry.description,
    extensionName: entry.extensionName,
    extensionPath: entry.extensionPath,
    actionId: entry.id,
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
    actionId: entry.action.actionId,
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
    actionId: entry.action?.actionId,
    urlTemplate: entry.urlTemplate,
    actionBacked: Boolean(entry.action),
    sideEffects: boundAction?.sideEffects,
    outputProfile: boundAction?.outputProfile,
    inputSchema: boundAction?.inputSchema,
    inputDefaults: entry.action?.inputDefaults,
    availability: entry.action ? combineContributionAvailability(entry.availability, boundAction?.availability) : entry.availability,
  }, options);
}

// --- eforge:region plan-01-shared-contribution-projection ---
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
    ...(entry.actionId !== undefined && { actionId: entry.actionId }),
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
): Pick<ExtensionHostContributionEntry, 'hasInputSchema' | 'requiredInputKeys' | 'inputPropertyKeys' | 'inputDefaultKeys'> {
  return {
    hasInputSchema: inputSchema !== undefined,
    requiredInputKeys: stringArrayProperty(inputSchema, 'required'),
    inputPropertyKeys: objectKeysProperty(inputSchema, 'properties'),
    inputDefaultKeys: inputDefaults ? Object.keys(inputDefaults).sort((left, right) => left.localeCompare(right)) : [],
  };
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
// --- eforge:endregion plan-01-shared-contribution-projection ---

function buildActionLookup(entries: ExtensionActionManifestEntry[]): ActionLookup {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

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
