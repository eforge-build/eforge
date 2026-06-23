import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { formatExtensionContributionOutputText, type ExtensionJsonObject } from '@eforge-build/client';
import { eforgePlaybooksUnavailableMessage, invokePlaybookContributionIfRunning, type PlaybookCommandAction } from './playbook-contributions.js';
import { DAEMON_NOT_RUNNING_GUIDANCE } from './daemon-requests.js';
import { showInfoPanel, type UIContext } from './ui-helpers.js';
import { promptForPlaybookLandingGate } from './landing-gate.js';

// Planning-mode results render planningEntry metadata; autonomous runs forward afterQueueId and do not call apiGetQueueIfRunning before invoking the contribution.

export function registerPlaybookCommand(pi: ExtensionAPI, getLatestCtx: () => UIContext | null): void {
  pi.registerCommand("eforge:playbook", {
    description: "Manage and run eforge playbooks through eforge-playbooks",
    handler: async (args, ctx) => {
      await handlePlaybookCommand(pi, (ctx as UIContext) ?? getLatestCtx(), args ?? "");
    },
  });
}

export async function handlePlaybookCommand(pi: ExtensionAPI, ctx: UIContext | null, rawArgs: string): Promise<void> {
  if (!ctx || !ctx.hasUI) {
    pi.sendUserMessage(`Use eforge_playbook with these arguments: ${rawArgs}`.trim());
    return;
  }
  const parsed = parsePlaybookArgs(rawArgs);
  if (!parsed) {
    await showInfoPanel(ctx, 'eforge playbook', 'Usage: /eforge:playbook <list|show|save|validate|copy|promote|demote|run> [name] [--key value]');
    return;
  }
  let input = parsed.input;
  try {
    if (parsed.action === 'run' && input.mode !== 'planning') {
      const choice = await promptForPlaybookLandingGate(pi, ctx);
      if (choice.cancelled) {
        await showInfoPanel(ctx, 'eforge playbook', 'Playbook run cancelled before enqueue.');
        return;
      }
      input = compact({
        ...input,
        landingAction: choice.landingAction ?? input.landingAction,
        landingAutoMerge: choice.landingAutoMerge ?? input.landingAutoMerge,
      });
    }
    const result = await invokePlaybookContributionIfRunning({ cwd: ctx.cwd, action: parsed.action, input: input as ExtensionJsonObject });
    if (!result.response.ok) {
      await showInfoPanel(ctx, 'eforge playbook - Error', result.response.error.message);
      return;
    }
    await showInfoPanel(ctx, 'eforge playbook', formatExtensionContributionOutputText(result.response.output, { outputProfile: result.target.outputProfile }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await showInfoPanel(ctx, 'eforge playbook - Error', message.includes(DAEMON_NOT_RUNNING_GUIDANCE) ? message : eforgePlaybooksUnavailableMessage(message));
  }
}

function parsePlaybookArgs(rawArgs: string): { action: PlaybookCommandAction; input: Record<string, unknown> } | null {
  const tokens = tokenize(rawArgs);
  const action = tokens.shift() as PlaybookCommandAction | undefined;
  if (!action || !['list', 'show', 'save', 'validate', 'copy', 'promote', 'demote', 'run'].includes(action)) return null;
  const input: Record<string, unknown> = {};
  const nameActions = new Set(['show', 'copy', 'promote', 'demote', 'run']);
  if (nameActions.has(action) && tokens[0] && !tokens[0].startsWith('--')) input.name = tokens.shift();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith('--')) continue;
    const key = toCamel(token.slice(2));
    const next = tokens[i + 1];
    if (next === undefined || next.startsWith('--')) input[key] = true;
    else input[key] = parseScalar(next), i++;
  }
  return { action, input: compact(input) };
}

function tokenize(input: string): string[] {
  return input.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^(["'])(.*)\1$/, '$2')) ?? [];
}

function toCamel(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function parseScalar(value: string): string | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
