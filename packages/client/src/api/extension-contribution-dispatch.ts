import {
  type ExtensionActionInvokeResponse,
  type ExtensionActionManifestEntry,
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
  actionBacked: boolean;
  sideEffects?: ExtensionActionSideEffect[];
  inputSchema?: ExtensionJsonObject;
  inputDefaults?: ExtensionJsonObject;
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
}

export interface ExtensionHostContributionInvokeResult {
  target: ExtensionHostContributionInvokeTarget;
  response: ExtensionActionInvokeResponse;
}

interface ResolveResult {
  target: ExtensionHostContributionInvokeTarget;
}

export function summarizeExtensionContributionManifest(
  manifest: ExtensionContributionManifestResponse,
  options?: { kind?: ExtensionHostContributionKind | 'all' },
): ExtensionHostContributionListResponse {
  const kind = options?.kind === 'all' ? undefined : options?.kind;
  const actionEntries = kind && kind !== 'action' ? [] : manifest.actions.map(actionEntry);
  const commandEntries = kind && kind !== 'command' ? [] : manifest.integrationCommands.map(commandEntry);
  const deepLinkEntries = kind && kind !== 'deep-link' ? [] : manifest.deepLinks.map(deepLinkEntry);
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
  if (kind === 'command') return resolveCommand(manifest.integrationCommands, params.id, input, params.requestedBy);
  return resolveDeepLink(manifest.deepLinks, params.id, input, params.requestedBy);
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
  const { target } = resolveExtensionContributionInvocationWithInput(manifest, opts, input);
  const response = await apiInvokeExtensionAction({
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
  const { target } = resolveExtensionContributionInvocation(manifest, opts);
  const response = await apiInvokeExtensionActionIfRunning({
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
    inputSchema: entry.inputSchema,
  };
}

function commandEntry(entry: IntegrationCommandManifestEntry): ExtensionHostContributionEntry {
  return {
    kind: 'command',
    id: entry.id,
    label: entry.label,
    description: entry.description,
    extensionName: entry.extensionName,
    extensionPath: entry.extensionPath,
    actionId: entry.action.actionId,
    actionBacked: true,
    inputSchema: entry.inputSchema,
    inputDefaults: entry.action.inputDefaults,
  };
}

function deepLinkEntry(entry: ExtensionDeepLinkManifestEntry): ExtensionHostContributionEntry {
  return {
    kind: 'deep-link',
    id: entry.id,
    label: entry.label,
    description: entry.description,
    extensionName: entry.extensionName,
    extensionPath: entry.extensionPath,
    actionId: entry.action?.actionId,
    actionBacked: Boolean(entry.action),
    inputDefaults: entry.action?.inputDefaults,
  };
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
  return {
    target: {
      kind: 'action',
      id: entry.id,
      label: entry.title,
      extensionName: entry.extensionName,
      extensionPath: entry.extensionPath,
      actionId: entry.id,
      requestedBy,
      input,
    },
  };
}

function resolveCommand(
  entries: IntegrationCommandManifestEntry[],
  id: string,
  input: ExtensionJsonObject,
  requestedBy: ExtensionActionRequestedBy,
): ResolveResult {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown extension integration command "${id}"`);
  return {
    target: {
      kind: 'command',
      id: entry.id,
      label: entry.label,
      extensionName: entry.extensionName,
      extensionPath: entry.extensionPath,
      actionId: entry.action.actionId,
      requestedBy: { ...requestedBy, commandId: entry.id } as ExtensionActionRequestedBy,
      input: { ...(entry.action.inputDefaults ?? {}), ...input },
    },
  };
}

function resolveDeepLink(
  entries: ExtensionDeepLinkManifestEntry[],
  id: string,
  input: ExtensionJsonObject,
  requestedBy: ExtensionActionRequestedBy,
): ResolveResult {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown extension deep link "${id}"`);
  if (!entry.action) throw new Error(`Deep link "${id}" is not action-backed`);
  return {
    target: {
      kind: 'deep-link',
      id: entry.id,
      label: entry.label,
      extensionName: entry.extensionName,
      extensionPath: entry.extensionPath,
      actionId: entry.action.actionId,
      requestedBy: { ...requestedBy, deepLinkId: entry.id } as ExtensionActionRequestedBy,
      input: { ...(entry.action.inputDefaults ?? {}), ...input },
    },
  };
}

function normalizeInput(input: ExtensionJsonObject | undefined): ExtensionJsonObject {
  const value = input === undefined ? {} : input;
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('"input" must be a JSON object');
  }
  return value;
}
