import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  EXTENSION_HOST_CONTRIBUTION_KINDS,
  apiGetExtensionContributionManifest,
  createExtensionContributionFailedInvocationEnvelope,
  formatExtensionContributionDetailText,
  formatExtensionContributionFailedInvocationEnvelopeText,
  formatExtensionContributionListText,
  formatExtensionContributionOutputText,
  invokeEforgeExtensionContribution,
  listEforgeExtensionContributions,
  showExtensionContributionManifestEntry,
  type ExtensionActionOutputProfile,
  type ExtensionHostContributionDetailResponse,
  type ExtensionHostContributionKind,
  type ExtensionHostContributionProjection,
  type ExtensionJsonObject,
} from '@eforge-build/client';
import { formatCliError } from './errors.js';

const OUTPUT_PROFILES = ['agent-compact', 'agent-paginated', 'markdown', 'ui-rich', 'debug-rich'] as const;

interface ListOptions {
  kind?: ExtensionHostContributionKind | 'all';
  extensionName?: string;
  search?: string;
  idPrefix?: string;
  outputProfile?: ExtensionActionOutputProfile;
  limit?: number;
  offset?: number;
  includeSchema?: boolean;
  includeDiagnostics?: boolean;
  full?: boolean;
  json?: boolean;
}

interface ShowOptions {
  kind?: ExtensionHostContributionKind;
  includeSchema?: boolean;
  includeDiagnostics?: boolean;
  full?: boolean;
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
    .option('--extension-name <name>', 'Filter to one extension name')
    .option('--search <text>', 'Search id, label, description, extension, and action metadata')
    .option('--id-prefix <prefix>', 'Filter to contribution ids with this prefix')
    .option('--output-profile <profile>', 'Filter by action output profile', validateOutputProfile)
    .option('--limit <number>', 'Maximum entries to return', validatePositiveInteger)
    .option('--offset <number>', 'Zero-based pagination offset', validateNonNegativeInteger)
    .option('--include-schema', 'Include input schemas/defaults in the list projection')
    .option('--include-diagnostics', 'Include manifest diagnostics in the list projection')
    .option('--full', 'Use the full projection, including schemas and diagnostics')
    .option('--json', 'Output JSON')
    .action(async (options: ListOptions) => {
      try {
        const result = await listEforgeExtensionContributions({
          cwd: process.cwd(),
          kind: options.kind ?? 'all',
          extensionName: options.extensionName,
          search: options.search,
          idPrefix: options.idPrefix,
          outputProfile: options.outputProfile,
          limit: options.limit,
          offset: options.offset,
          includeInputSchema: options.includeSchema,
          includeDiagnostics: options.includeDiagnostics,
          projection: projectionFromFullFlag(options.full),
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(formatExtensionContributionListText(result));
      } catch (err) {
        renderCliError(err);
      }
    });

  contributions
    .command('show <id>')
    .description('Show one extension action, integration command, or deep link contribution')
    .option('--kind <kind>', 'Contribution kind: action, command, or deep-link', validateInvokeKind)
    .option('--include-schema', 'Include input schema/defaults in the detail projection')
    .option('--include-diagnostics', 'Include manifest diagnostics in the detail projection')
    .option('--full', 'Use the full projection, including schema and diagnostics')
    .option('--json', 'Output JSON')
    .action(async (id: string, options: ShowOptions) => {
      try {
        const result = await loadContributionDetail(id, options);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(formatExtensionContributionDetailText(result));
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

async function loadContributionDetail(id: string, options: ShowOptions): Promise<ExtensionHostContributionDetailResponse> {
  const manifest = await apiGetExtensionContributionManifest({ cwd: process.cwd() });
  return showExtensionContributionManifestEntry(manifest, {
    id,
    kind: options.kind,
    includeInputSchema: options.includeSchema,
    includeDiagnostics: options.includeDiagnostics,
    projection: projectionFromFullFlag(options.full),
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

function projectionFromFullFlag(full: boolean | undefined): ExtensionHostContributionProjection | undefined {
  return full ? 'full' : undefined;
}

function renderInvokeResult(result: Awaited<ReturnType<typeof invokeEforgeExtensionContribution>>): void {
  console.log(chalk.green(result.response.ok ? '✔' : '✘') + ` Extension contribution ${result.target.kind}:${result.target.id}`);
  console.log(`  Invocation: ${result.response.invocationId}`);
  console.log(`  Action:     ${result.target.actionId}`);
  if (result.response.ok) {
    console.log('  Output:');
    console.log(formatExtensionContributionOutputText(result.response.output, { outputProfile: result.target.outputProfile }));
    return;
  }
  const failureEnvelope = createExtensionContributionFailedInvocationEnvelope(result);
  console.error(failureEnvelope ? formatExtensionContributionFailedInvocationEnvelopeText(failureEnvelope) : `${result.response.error.code}: ${result.response.error.message}`);
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

function validateOutputProfile(value: string): ExtensionActionOutputProfile {
  if (OUTPUT_PROFILES.includes(value as ExtensionActionOutputProfile)) return value as ExtensionActionOutputProfile;
  throw new Error('--output-profile must be one of: agent-compact, agent-paginated, markdown, ui-rich, debug-rich');
}

function validatePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  throw new Error('--limit must be a positive integer');
}

function validateNonNegativeInteger(value: string): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  throw new Error('--offset must be a non-negative integer');
}

function isJsonObject(value: unknown): value is ExtensionJsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function renderCliError(err: unknown): never {
  const { message, exitCode } = formatCliError(err);
  console.error(chalk.red(`Error: ${message}`));
  process.exit(exitCode);
}
