import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from '@sinclair/typebox';
import type { SelectItem } from '@earendil-works/pi-tui';
import {
  EXTENSION_HOST_CONTRIBUTION_KINDS,
  apiGetExtensionContributionManifestIfRunning,
  createExtensionContributionFailedInvocationEnvelope,
  formatExtensionContributionDetailText,
  formatExtensionContributionFailedInvocationEnvelopeText,
  formatExtensionContributionListText,
  formatExtensionContributionOutputText,
  invokeEforgeExtensionContributionIfRunning,
  listEforgeExtensionContributionsIfRunning,
  showExtensionContributionManifestEntry,
  type ExtensionActionOutputProfile,
  type ExtensionHostContributionDetailResponse,
  type ExtensionHostContributionKind,
  type ExtensionHostContributionProjection,
} from '@eforge-build/client';
import { DAEMON_NOT_RUNNING_GUIDANCE } from './daemon-requests.js';
import { formatInvocationPanel, prepareContributionInput } from './extension-contribution-ux.js';
import { showInfoPanel, showSearchableSelectPanel, withLoader, type UIContext } from './ui-helpers.js';

const TOOL_ACTIONS = ['list', 'show', 'invoke'] as const;
const TOOL_KINDS = [...EXTENSION_HOST_CONTRIBUTION_KINDS, 'all'] as const;
const TOOL_OUTPUT_PROFILES = ['agent-compact', 'agent-paginated', 'markdown', 'ui-rich', 'debug-rich'] as const;

interface ContributionListOptions {
  kind?: ExtensionHostContributionKind | 'all';
  extensionName?: string;
  search?: string;
  idPrefix?: string;
  outputProfile?: ExtensionActionOutputProfile;
  limit?: number;
  offset?: number;
  includeInputSchema?: boolean;
  includeDiagnostics?: boolean;
  projection?: ExtensionHostContributionProjection;
}

interface ContributionShowOptions {
  id: string;
  kind?: ExtensionHostContributionKind;
  includeInputSchema?: boolean;
  includeDiagnostics?: boolean;
  projection?: ExtensionHostContributionProjection;
}

// --- eforge:region contribution-tool ---
export function registerExtensionContributionTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'eforge_extension_contribution',
    label: 'eforge extension contribution',
    description:
      'List, show, and invoke extension-provided actions, integration commands, and action-backed deep links with compact formatted output by default. Distinct from eforge_extension extension management.',
    parameters: Type.Object({
      action: StringEnum(TOOL_ACTIONS, { description: 'List host contributions, show one contribution, or invoke one contribution' }),
      kind: Type.Optional(StringEnum(TOOL_KINDS, { description: 'Contribution kind. Use "all" only when listing all contributions.' })),
      id: Type.Optional(Type.String({ minLength: 1, description: 'Contribution id. Required for show or invoke.' })),
      extensionName: Type.Optional(Type.String({ minLength: 1, description: 'Filter list results to one extension name.' })),
      search: Type.Optional(Type.String({ minLength: 1, description: 'Search id, label, description, extension, and action metadata.' })),
      idPrefix: Type.Optional(Type.String({ minLength: 1, description: 'Filter list results to contribution ids with this prefix.' })),
      outputProfile: Type.Optional(StringEnum(TOOL_OUTPUT_PROFILES, { description: 'Filter list results by declared action output profile.' })),
      limit: Type.Optional(Type.Integer({ minimum: 1, description: 'Maximum number of list entries to return.' })),
      offset: Type.Optional(Type.Integer({ minimum: 0, description: 'Zero-based list offset for pagination.' })),
      includeInputSchema: Type.Optional(Type.Boolean({ description: 'Include input schema/defaults in list or show detail.' })),
      includeDiagnostics: Type.Optional(Type.Boolean({ description: 'Include manifest diagnostics in list or show detail.' })),
      full: Type.Optional(Type.Boolean({ description: 'Return the full shared projection, including schemas and diagnostics.' })),
      input: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'JSON object input for invocation' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.action === 'list') {
        const result = await listEforgeExtensionContributionsIfRunning({
          cwd: ctx.cwd,
          ...listOptionsFromParams(params),
        });
        if (result === null) throw new Error(DAEMON_NOT_RUNNING_GUIDANCE);
        return textResult(formatExtensionContributionListText(result));
      }
      if (!params.id) throw new Error(`"id" is required when action is "${params.action}"`);
      if (params.kind === 'all') throw new Error('"kind: all" is only valid when action is "list"');
      if (params.action === 'show') {
        const detail = await showContributionIfRunning(ctx.cwd, {
          id: params.id,
          kind: params.kind as ExtensionHostContributionKind | undefined,
          includeInputSchema: params.includeInputSchema,
          includeDiagnostics: params.includeDiagnostics,
          projection: projectionFromFullFlag(params.full),
        });
        if (detail === null) throw new Error(DAEMON_NOT_RUNNING_GUIDANCE);
        return textResult(formatExtensionContributionDetailText(detail));
      }
      const result = await invokeEforgeExtensionContributionIfRunning({
        cwd: ctx.cwd,
        kind: params.kind as ExtensionHostContributionKind | undefined,
        id: params.id,
        input: normalizeInput(params.input),
        requestedBy: { host: 'pi' },
      });
      if (result === null) throw new Error(DAEMON_NOT_RUNNING_GUIDANCE);
      if (!result.response.ok) {
        const failureEnvelope = createExtensionContributionFailedInvocationEnvelope(result);
        return textResult(failureEnvelope ? formatExtensionContributionFailedInvocationEnvelopeText(failureEnvelope) : result.response.error.message);
      }
      return textResult([
        `Invocation: ${result.response.invocationId}`,
        `Target: ${result.target.kind}:${result.target.id}`,
        `Action: ${result.target.actionId}`,
        '',
        formatExtensionContributionOutputText(result.response.output, { outputProfile: result.target.outputProfile }),
      ].join('\n'));
    },
  });
}
// --- eforge:endregion contribution-tool ---

// --- eforge:region contribution-command ---
export function registerExtensionContributionsCommand(pi: ExtensionAPI, getLatestCtx: () => UIContext | null): void {
  pi.registerCommand('eforge:extensions', {
    description: 'Browse and invoke extension-provided commands and deep links',
    handler: async (args) => {
      const ctx = getLatestCtx();
      if (!ctx?.hasUI) {
        pi.sendUserMessage(`Use eforge_extension_contribution with these arguments: ${args ?? ''}`.trim());
        return;
      }
      await handleCommand(ctx, args ?? '');
    },
  });
}

async function handleCommand(ctx: UIContext, rawArgs: string): Promise<void> {
  const args = rawArgs.trim();
  if (!args) {
    await runInteractiveFlow(ctx);
    return;
  }
  const branch = args.split(/\s+/, 1)[0];
  const rest = args.slice(branch.length).trim();
  if (branch === 'list') {
    await showList(ctx, parseListArgs(rest));
    return;
  }
  if (branch === 'show') {
    await showDetail(ctx, parseShowArgs(rest));
    return;
  }
  if (branch === 'invoke') {
    await invokeFromArgs(ctx, rest);
    return;
  }
  await showInfoPanel(ctx, 'eforge extensions', 'Usage: `/eforge:extensions list`, `/eforge:extensions show <id>`, or `/eforge:extensions invoke <id> [json]`.');
}

async function showList(ctx: UIContext, options: ContributionListOptions = {}): Promise<void> {
  const result = await withLoader(ctx, 'Loading extension contributions...', () =>
    listEforgeExtensionContributionsIfRunning({ cwd: ctx.cwd, ...options }),
  );
  if (result === null) {
    await showInfoPanel(ctx, 'eforge - Daemon Not Running', DAEMON_NOT_RUNNING_GUIDANCE);
    return;
  }
  await showInfoPanel(ctx, 'eforge extensions', formatExtensionContributionListText(result));
}

async function showDetail(ctx: UIContext, options: ContributionShowOptions): Promise<void> {
  if (!options.id) {
    await showInfoPanel(ctx, 'eforge extensions', 'Usage: `/eforge:extensions show <id>`.');
    return;
  }
  const result = await withLoader(ctx, 'Loading extension contribution detail...', () =>
    showContributionIfRunning(ctx.cwd, options),
  );
  if (result === null) {
    await showInfoPanel(ctx, 'eforge - Daemon Not Running', DAEMON_NOT_RUNNING_GUIDANCE);
    return;
  }
  await showInfoPanel(ctx, 'eforge extensions', formatExtensionContributionDetailText(result));
}

async function invokeFromArgs(ctx: UIContext, rest: string): Promise<void> {
  let parsed: ReturnType<typeof parseInvokeArgs>;
  try {
    parsed = parseInvokeArgs(rest);
  } catch (err) {
    await showInfoPanel(ctx, 'eforge extensions - Invalid Input', err instanceof Error ? err.message : String(err));
    return;
  }
  if (!parsed.id) {
    await showInfoPanel(ctx, 'eforge extensions', 'Usage: `/eforge:extensions invoke <id> [json]`.');
    return;
  }
  await invokeAndShow(ctx, parsed.id, parsed.kind, parsed.input);
}

async function runInteractiveFlow(ctx: UIContext): Promise<void> {
  const result = await withLoader(ctx, 'Loading extension contributions...', () =>
    listEforgeExtensionContributionsIfRunning({ cwd: ctx.cwd }),
  );
  if (result === null) {
    await showInfoPanel(ctx, 'eforge - Daemon Not Running', DAEMON_NOT_RUNNING_GUIDANCE);
    return;
  }
  const candidates = result.entries.filter((entry) =>
    entry.kind === 'command' || entry.kind === 'action' || entry.kind === 'deep-link',
  );
  if (candidates.length === 0) {
    await showInfoPanel(ctx, 'eforge extensions', 'No extension host contributions found.');
    return;
  }
  const items: SelectItem[] = candidates.map((entry) => ({
    value: `${entry.kind}:${entry.id}`,
    label: `[${entry.kind}] ${entry.label} (${entry.id}) — ${entry.extensionName}${entry.kind === 'deep-link' && !entry.actionBacked ? ' [URL-only]' : ''}`,
  }));
  const selected = await showSearchableSelectPanel(ctx, 'eforge extensions - select contribution', items);
  if (!selected) return;
  const { kind, id } = splitKindId(selected);
  if (!kind) return;
  const detail = await withLoader(ctx, 'Loading extension contribution detail...', () =>
    showContributionIfRunning(ctx.cwd, { id, kind, includeInputSchema: true }),
  );
  if (detail === null) {
    await showInfoPanel(ctx, 'eforge - Daemon Not Running', DAEMON_NOT_RUNNING_GUIDANCE);
    return;
  }
  const entry = detail.entry;
  if (entry.kind === 'deep-link' && !entry.actionBacked) {
    await showInfoPanel(ctx, 'eforge extensions', `Deep link \`${entry.id}\` is URL-only. Generic host invocation only supports action-backed deep links.`);
    return;
  }
  const inputDecision = prepareContributionInput(entry);
  if (inputDecision.kind === 'no-prompt') {
    await invokeAndShow(ctx, id, kind, inputDecision.input);
    return;
  }
  const inputText = await ctx.ui.editor(inputDecision.title, inputDecision.prefillText);
  if (inputText === undefined) return;
  let input: Record<string, unknown>;
  try {
    input = parseJsonObject(inputText);
  } catch (err) {
    await showInfoPanel(ctx, 'eforge extensions - Invalid JSON', err instanceof Error ? err.message : String(err));
    return;
  }
  await invokeAndShow(ctx, id, kind, input);
}

async function invokeAndShow(
  ctx: UIContext,
  id: string,
  kind: ExtensionHostContributionKind | undefined,
  input: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await withLoader(ctx, 'Invoking extension contribution...', () =>
      invokeEforgeExtensionContributionIfRunning({
        cwd: ctx.cwd,
        id,
        kind,
        input,
        requestedBy: { host: 'pi' },
      }),
    );
    if (result === null) {
      await showInfoPanel(ctx, 'eforge - Daemon Not Running', DAEMON_NOT_RUNNING_GUIDANCE);
      return;
    }
    const panel = formatInvocationPanel(result);
    await showInfoPanel(ctx, panel.title, panel.content);
  } catch (err) {
    await showInfoPanel(ctx, 'eforge extensions - Error', err instanceof Error ? err.message : String(err));
  }
}
// --- eforge:endregion contribution-command ---

// --- eforge:region contribution-helpers ---
async function showContributionIfRunning(cwd: string, options: ContributionShowOptions): Promise<ExtensionHostContributionDetailResponse | null> {
  const manifest = await apiGetExtensionContributionManifestIfRunning({ cwd });
  return manifest ? showExtensionContributionManifestEntry(manifest, options) : null;
}

function listOptionsFromParams(params: {
  kind?: string;
  extensionName?: string;
  search?: string;
  idPrefix?: string;
  outputProfile?: string;
  limit?: number;
  offset?: number;
  includeInputSchema?: boolean;
  includeDiagnostics?: boolean;
  full?: boolean;
}): ContributionListOptions {
  return {
    kind: params.kind as ExtensionHostContributionKind | 'all' | undefined,
    extensionName: params.extensionName,
    search: params.search,
    idPrefix: params.idPrefix,
    outputProfile: params.outputProfile as ExtensionActionOutputProfile | undefined,
    limit: params.limit,
    offset: params.offset,
    includeInputSchema: params.includeInputSchema,
    includeDiagnostics: params.includeDiagnostics,
    projection: projectionFromFullFlag(params.full),
  };
}

function parseListArgs(rest: string): ContributionListOptions {
  const tokens = rest.trim().length > 0 ? rest.trim().split(/\s+/) : [];
  const options: ContributionListOptions = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--include-schema') options.includeInputSchema = true;
    else if (token === '--include-diagnostics') options.includeDiagnostics = true;
    else if (token === '--full') options.projection = 'full';
    else if (token === '--kind') options.kind = parseListKind(nextToken(tokens, ++index, token));
    else if (token === '--extension-name' || token === '--extension') options.extensionName = nextToken(tokens, ++index, token);
    else if (token === '--search') options.search = nextToken(tokens, ++index, token);
    else if (token === '--id-prefix') options.idPrefix = nextToken(tokens, ++index, token);
    else if (token === '--output-profile') options.outputProfile = parseOutputProfile(nextToken(tokens, ++index, token));
    else if (token === '--limit') options.limit = parsePositiveInteger(nextToken(tokens, ++index, token), token);
    else if (token === '--offset') options.offset = parseNonNegativeInteger(nextToken(tokens, ++index, token), token);
    else throw new Error(`Unknown list option: ${token}`);
  }
  return options;
}

function parseShowArgs(rest: string): ContributionShowOptions {
  const tokens = rest.trim().length > 0 ? rest.trim().split(/\s+/) : [];
  const rawId = tokens.shift() ?? '';
  const prefixed = splitKindId(rawId);
  const options: ContributionShowOptions = { id: prefixed.id, kind: prefixed.kind };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--include-schema') options.includeInputSchema = true;
    else if (token === '--include-diagnostics') options.includeDiagnostics = true;
    else if (token === '--full') options.projection = 'full';
    else if (token === '--kind') options.kind = parseInvokeKind(nextToken(tokens, ++index, token));
    else throw new Error(`Unknown show option: ${token}`);
  }
  return options;
}

function parseInvokeArgs(rest: string): { kind?: ExtensionHostContributionKind; id: string; input: Record<string, unknown> } {
  const trimmed = rest.trim();
  if (!trimmed) return { id: '', input: {} };
  const match = /^(\S+)(?:\s+([\s\S]+))?$/.exec(trimmed);
  const rawId = match?.[1] ?? '';
  const input = match?.[2] ? parseJsonObject(match[2]) : {};
  const prefixed = splitKindId(rawId);
  return { kind: prefixed.kind, id: prefixed.id, input };
}

function splitKindId(value: string): { kind?: ExtensionHostContributionKind; id: string } {
  for (const kind of EXTENSION_HOST_CONTRIBUTION_KINDS) {
    const prefix = `${kind}:`;
    if (value.startsWith(prefix)) return { kind, id: value.slice(prefix.length) };
  }
  return { id: value };
}

function parseJsonObject(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON input: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isJsonObject(parsed)) throw new Error('"input" must be a JSON object');
  return parsed;
}

function normalizeInput(input: unknown): Record<string, unknown> {
  if (input === undefined) return {};
  if (!isJsonObject(input)) throw new Error('"input" must be a JSON object');
  return input;
}

function parseListKind(value: string): ExtensionHostContributionKind | 'all' {
  if (value === 'all' || EXTENSION_HOST_CONTRIBUTION_KINDS.includes(value as ExtensionHostContributionKind)) return value as ExtensionHostContributionKind | 'all';
  throw new Error('--kind must be one of: action, command, deep-link, all');
}

function parseInvokeKind(value: string): ExtensionHostContributionKind {
  if (EXTENSION_HOST_CONTRIBUTION_KINDS.includes(value as ExtensionHostContributionKind)) return value as ExtensionHostContributionKind;
  throw new Error('--kind must be one of: action, command, deep-link');
}

function parseOutputProfile(value: string): ExtensionActionOutputProfile {
  if (TOOL_OUTPUT_PROFILES.includes(value as ExtensionActionOutputProfile)) return value as ExtensionActionOutputProfile;
  throw new Error('--output-profile must be one of: agent-compact, agent-paginated, markdown, ui-rich, debug-rich');
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  throw new Error(`${option} must be a positive integer`);
}

function parseNonNegativeInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  throw new Error(`${option} must be a non-negative integer`);
}

function nextToken(tokens: string[], index: number, option: string): string {
  const value = tokens[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function projectionFromFullFlag(full: boolean | undefined): ExtensionHostContributionProjection | undefined {
  return full ? 'full' : undefined;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textResult(text: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text }] };
}
// --- eforge:endregion contribution-helpers ---
