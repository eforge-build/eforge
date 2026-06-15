import {
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
  inputSchema?: ExtensionJsonObject;
  inputDefaults?: ExtensionJsonObject;
  availability?: ExtensionContributionAvailability;
}

export interface ExtensionHostContributionListResponse {
  generatedAt: string;
  entries: ExtensionHostContributionEntry[];
  diagnostics?: ExtensionContributionDiagnostic[];
}

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

interface ResolveResult {
  target: ExtensionHostContributionInvokeTarget;
  unavailableMessage?: string;
}

type ActionLookup = Map<string, ExtensionActionManifestEntry>;

export function summarizeExtensionContributionManifest(
  manifest: ExtensionContributionManifestResponse,
  options?: { kind?: ExtensionHostContributionKind | 'all' },
): ExtensionHostContributionListResponse {
  const kind = options?.kind === 'all' ? undefined : options?.kind;
  const actionLookup = buildActionLookup(manifest.actions);
  const actionEntries = kind && kind !== 'action' ? [] : manifest.actions.map(actionEntry);
  const commandEntries = kind && kind !== 'command' ? [] : manifest.integrationCommands.map((entry) => commandEntry(entry, actionLookup));
  const deepLinkEntries = kind && kind !== 'deep-link' ? [] : manifest.deepLinks.map((entry) => deepLinkEntry(entry, actionLookup));
  return {
    generatedAt: manifest.generatedAt,
    entries: [...actionEntries, ...commandEntries, ...deepLinkEntries],
    diagnostics: manifest.diagnostics,
  };
}

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
}): Promise<ExtensionHostContributionListResponse> {
  const manifest = await apiGetExtensionContributionManifest({ cwd: opts.cwd });
  return summarizeExtensionContributionManifest(manifest, { kind: opts.kind });
}

export async function listEforgeExtensionContributionsIfRunning(opts: {
  cwd: string;
  kind?: ExtensionHostContributionKind | 'all';
}): Promise<ExtensionHostContributionListResponse | null> {
  const manifest = await apiGetExtensionContributionManifestIfRunning({ cwd: opts.cwd });
  return manifest ? summarizeExtensionContributionManifest(manifest, { kind: opts.kind }) : null;
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

function actionEntry(entry: ExtensionActionManifestEntry): ExtensionHostContributionEntry {
  return {
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
  };
}

function commandEntry(entry: IntegrationCommandManifestEntry, actionLookup: ActionLookup): ExtensionHostContributionEntry {
  const boundAction = actionLookup.get(entry.action.actionId);
  return {
    kind: 'command',
    id: entry.id,
    label: entry.label,
    description: entry.description,
    extensionName: entry.extensionName,
    extensionPath: entry.extensionPath,
    actionId: entry.action.actionId,
    actionBacked: true,
    outputProfile: boundAction?.outputProfile,
    inputSchema: entry.inputSchema ?? boundAction?.inputSchema,
    inputDefaults: entry.action.inputDefaults,
    availability: combineContributionAvailability(entry.availability, boundAction?.availability),
  };
}

function deepLinkEntry(entry: ExtensionDeepLinkManifestEntry, actionLookup: ActionLookup): ExtensionHostContributionEntry {
  const boundAction = entry.action ? actionLookup.get(entry.action.actionId) : undefined;
  return {
    kind: 'deep-link',
    id: entry.id,
    label: entry.label,
    description: entry.description,
    extensionName: entry.extensionName,
    extensionPath: entry.extensionPath,
    actionId: entry.action?.actionId,
    urlTemplate: entry.urlTemplate,
    actionBacked: Boolean(entry.action),
    outputProfile: boundAction?.outputProfile,
    inputSchema: boundAction?.inputSchema,
    inputDefaults: entry.action?.inputDefaults,
    availability: entry.action ? combineContributionAvailability(entry.availability, boundAction?.availability) : entry.availability,
  };
}

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
