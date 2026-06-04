import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from '@sinclair/typebox';
import type { SelectItem } from '@earendil-works/pi-tui';
import {
  EXTENSION_HOST_CONTRIBUTION_KINDS,
  invokeEforgeExtensionContributionIfRunning,
  listEforgeExtensionContributionsIfRunning,
  type ExtensionHostContributionEntry,
  type ExtensionHostContributionKind,
} from '@eforge-build/client';
import { DAEMON_NOT_RUNNING_GUIDANCE } from './daemon-requests.js';
import { showInfoPanel, showSearchableSelectPanel, withLoader, type UIContext } from './ui-helpers.js';

const TOOL_ACTIONS = ['list', 'invoke'] as const;

export function registerExtensionContributionTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'eforge_extension_contribution',
    label: 'eforge extension contribution',
    description:
      'List and invoke extension-provided actions, integration commands, and action-backed deep links. Distinct from eforge_extension extension management.',
    parameters: Type.Object({
      action: StringEnum(TOOL_ACTIONS, { description: 'List host contributions or invoke one contribution' }),
      kind: Type.Optional(StringEnum(EXTENSION_HOST_CONTRIBUTION_KINDS, { description: 'Contribution kind' })),
      id: Type.Optional(Type.String({ minLength: 1, description: 'Contribution id. Required for invoke.' })),
      input: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'JSON object input for invocation' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.action === 'list') {
        const result = await listEforgeExtensionContributionsIfRunning({
          cwd: ctx.cwd,
          kind: params.kind as ExtensionHostContributionKind | undefined,
        });
        if (result === null) throw new Error(DAEMON_NOT_RUNNING_GUIDANCE);
        return jsonResult(result);
      }
      if (!params.id) throw new Error('"id" is required when action is "invoke"');
      const result = await invokeEforgeExtensionContributionIfRunning({
        cwd: ctx.cwd,
        kind: params.kind as ExtensionHostContributionKind | undefined,
        id: params.id,
        input: normalizeInput(params.input),
        requestedBy: { host: 'pi' },
      });
      if (result === null) throw new Error(DAEMON_NOT_RUNNING_GUIDANCE);
      return jsonResult(result);
    },
  });
}

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
    await showList(ctx);
    return;
  }
  if (branch === 'invoke') {
    await invokeFromArgs(ctx, rest);
    return;
  }
  await showInfoPanel(ctx, 'eforge extensions', 'Usage: `/eforge:extensions list` or `/eforge:extensions invoke <id> [json]`.');
}

async function showList(ctx: UIContext): Promise<void> {
  const result = await withLoader(ctx, 'Loading extension contributions...', () =>
    listEforgeExtensionContributionsIfRunning({ cwd: ctx.cwd }),
  );
  if (result === null) {
    await showInfoPanel(ctx, 'eforge - Daemon Not Running', DAEMON_NOT_RUNNING_GUIDANCE);
    return;
  }
  await showInfoPanel(ctx, 'eforge extensions', JSON.stringify(result, null, 2));
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
  const entry = candidates.find((candidate) => candidate.kind === kind && candidate.id === id);
  if (entry?.kind === 'deep-link' && !entry.actionBacked) {
    await showInfoPanel(ctx, 'eforge extensions', `Deep link \`${entry.id}\` is URL-only. Generic host invocation only supports action-backed deep links.`);
    return;
  }
  const inputText = await ctx.ui.editor('eforge extensions - JSON input', '{}');
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
    const body = result.response.ok
      ? JSON.stringify(result.response.output, null, 2)
      : `${result.response.error.code}: ${result.response.error.message}\n${JSON.stringify(result.response.error.details ?? null, null, 2)}`;
    await showInfoPanel(
      ctx,
      result.response.ok ? 'eforge extensions - Success' : 'eforge extensions - Failure',
      [`Invocation: ${result.response.invocationId}`, `Target: ${result.target.kind}:${result.target.id}`, `Action: ${result.target.actionId}`, '', body].join('\n'),
    );
  } catch (err) {
    await showInfoPanel(ctx, 'eforge extensions - Error', err instanceof Error ? err.message : String(err));
  }
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

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonResult(data: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
