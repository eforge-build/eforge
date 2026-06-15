import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  EXTENSION_HOST_CONTRIBUTION_KINDS,
  formatExtensionContributionOutputText,
  invokeEforgeExtensionContribution,
  listEforgeExtensionContributions,
  type ExtensionHostContributionEntry,
  type ExtensionHostContributionKind,
  type ExtensionJsonObject,
} from '@eforge-build/client';
import { formatCliError } from './errors.js';

interface ListOptions {
  kind?: ExtensionHostContributionKind | 'all';
  json?: boolean;
}

interface InvokeOptions {
  kind?: ExtensionHostContributionKind;
  inputJson?: string;
  inputFile?: string;
  json?: boolean;
}

export function registerExtensionContributionCommands(extension: Command): void {
  const contributions = extension
    .command('contributions')
    .description('Discover and invoke extension-provided host contributions');

  contributions
    .command('list')
    .description('List extension-provided actions, integration commands, and deep links')
    .option('--kind <kind>', 'Contribution kind: action, command, deep-link, or all', validateListKind, 'all')
    .option('--json', 'Output JSON')
    .action(async (options: ListOptions) => {
      try {
        const result = await listEforgeExtensionContributions({ cwd: process.cwd(), kind: options.kind ?? 'all' });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        renderContributionTable(result.entries);
      } catch (err) {
        renderCliError(err);
      }
    });

  contributions
    .command('invoke <id>')
    .description('Invoke an extension action, integration command, or action-backed deep link')
    .option('--kind <kind>', 'Contribution kind: action, command, or deep-link', validateInvokeKind)
    .option('--input-json <json>', 'JSON object input for the action')
    .option('--input-file <path>', 'Path to a JSON object input file')
    .option('--json', 'Output JSON')
    .action(async (id: string, options: InvokeOptions) => {
      try {
        const input = await parseJsonObjectInput(options);
        const result = await invokeEforgeExtensionContribution({
          cwd: process.cwd(),
          id,
          kind: options.kind,
          input,
          requestedBy: { host: 'cli' },
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          if (!result.response.ok) process.exit(1);
          return;
        }
        renderInvokeResult(result);
        if (!result.response.ok) process.exit(1);
      } catch (err) {
        renderCliError(err);
      }
    });
}

export async function parseJsonObjectInput(options: { inputJson?: string; inputFile?: string }): Promise<ExtensionJsonObject> {
  if (options.inputJson !== undefined && options.inputFile !== undefined) {
    throw new Error('--input-json and --input-file are mutually exclusive');
  }
  if (options.inputJson === undefined && options.inputFile === undefined) return {};
  const raw = options.inputJson ?? await readFile(options.inputFile!, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON input: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isJsonObject(parsed)) throw new Error('"input" must be a JSON object');
  return parsed;
}

function renderContributionTable(entries: ExtensionHostContributionEntry[]): void {
  if (entries.length === 0) {
    console.log(chalk.dim('No extension host contributions found'));
    return;
  }
  const headers = ['kind', 'id', 'label', 'action', 'extension', 'backed'] as const;
  const rows = entries.map((entry) => ({
    kind: entry.kind,
    id: entry.id,
    label: entry.label,
    action: entry.actionId ?? '-',
    extension: entry.extensionName,
    backed: entry.kind === 'deep-link' ? (entry.actionBacked ? 'yes' : 'no') : '-',
  }));
  const widths = Object.fromEntries(headers.map((header) => [
    header,
    Math.max(header.length, ...rows.map((row) => row[header].length)),
  ])) as Record<typeof headers[number], number>;
  console.log(headers.map((header) => header.padEnd(widths[header])).join('  '));
  console.log(headers.map((header) => '-'.repeat(widths[header])).join('  '));
  for (const row of rows) {
    console.log(headers.map((header) => row[header].padEnd(widths[header])).join('  '));
  }
}

function renderInvokeResult(result: Awaited<ReturnType<typeof invokeEforgeExtensionContribution>>): void {
  console.log(chalk.green(result.response.ok ? '✔' : '✘') + ` Extension contribution ${result.target.kind}:${result.target.id}`);
  console.log(`  Invocation: ${result.response.invocationId}`);
  console.log(`  Action:     ${result.target.actionId}`);
  if (result.response.ok) {
    console.log('  Output:');
    console.log(formatExtensionContributionOutputText(result.response.output, { outputProfile: result.target.outputProfile }));
  } else {
    console.error(`${result.response.error.code}: ${result.response.error.message}`);
    if (result.response.error.details !== undefined) console.error(JSON.stringify(result.response.error.details, null, 2));
  }
}

function validateListKind(value: string): ExtensionHostContributionKind | 'all' {
  if (value === 'all' || EXTENSION_HOST_CONTRIBUTION_KINDS.includes(value as ExtensionHostContributionKind)) {
    return value as ExtensionHostContributionKind | 'all';
  }
  throw new Error('--kind must be one of: action, command, deep-link, all');
}

function validateInvokeKind(value: string): ExtensionHostContributionKind {
  if (EXTENSION_HOST_CONTRIBUTION_KINDS.includes(value as ExtensionHostContributionKind)) {
    return value as ExtensionHostContributionKind;
  }
  throw new Error('--kind must be one of: action, command, deep-link');
}

function isJsonObject(value: unknown): value is ExtensionJsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function renderCliError(err: unknown): never {
  const { message, exitCode } = formatCliError(err);
  console.error(chalk.red(`Error: ${message}`));
  process.exit(exitCode);
}
