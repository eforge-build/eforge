import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { serializePlaybook, type Playbook, type PlaybookMode, type PlaybookScope } from '@eforge-build/input';
import type { ExtensionJsonObject } from '@eforge-build/client';
import { invokePlaybookContributionForHost, renderPlaybookContributionResult, type PlaybookCommandAction } from './playbook-contributions.js';
import { formatCliError } from './errors.js';

interface CommonOptions { json?: boolean }
interface ScopedOptions extends CommonOptions { scope?: string }
interface NewOptions extends CommonOptions { scope: string; mode?: string; profile?: string }
interface SaveOptions extends CommonOptions { scope: string; raw?: string; file?: string; overwrite?: boolean }
interface CopyOptions extends CommonOptions { sourceScope?: string; targetScope: string; overwrite?: boolean }
interface RunOptions extends ScopedOptions { mode?: string; profile?: string; after?: string; landingAction?: string; landingAutoMerge?: boolean }

export function registerPlaybookCommands(program: Command): void {
  // Compatibility surface for playbook files commonly edited with git add workflows.
  const playbook = program.command('playbook').description('Manage eforge playbooks through eforge-playbooks host contributions');

  playbook.command('list')
    .description('List playbooks')
    .option('--scope <scope>', 'Filter by scope')
    .option('--mode <mode>', 'Filter by mode')
    .option('--include-shadowed', 'Include shadowed playbooks')
    .option('--json', 'Output JSON')
    .action((options: ScopedOptions & { mode?: string; includeShadowed?: boolean }) => invokeAndRender('list', compact({ scope: options.scope, mode: options.mode, includeShadowed: options.includeShadowed }), options));

  playbook.command('show <name>')
    .description('Show a playbook')
    .option('--scope <scope>', 'Resolve from an exact scope')
    .option('--json', 'Output JSON')
    .action((name: string, options: ScopedOptions) => invokeAndRender('show', compact({ name, scope: options.scope }), options));

  playbook.command('new <name>')
    .description('Create a playbook in $EDITOR')
    .option('--scope <scope>', 'Target scope', 'project-local')
    .option('--mode <mode>', 'Playbook mode', 'autonomous')
    .option('--profile <profile>', 'Agent profile')
    .option('--json', 'Output JSON')
    .action((name: string, options: NewOptions) => createNewPlaybook(name, options));

  playbook.command('edit <name>')
    .description('Edit a playbook in $EDITOR')
    .option('--scope <scope>', 'Resolve from an exact scope')
    .option('--json', 'Output JSON')
    .action((name: string, options: ScopedOptions) => editExistingPlaybook(name, options));

  playbook.command('save')
    .description('Save a playbook')
    .requiredOption('--scope <scope>', 'Target scope')
    .option('--raw <markdown>', 'Raw playbook Markdown')
    .option('--file <path>', 'Read raw playbook Markdown from a file')
    .option('--overwrite <boolean>', 'Overwrite existing playbook', parseBoolean)
    .option('--json', 'Output JSON')
    .action(async (options: SaveOptions) => invokeAndRender('save', compact({ scope: options.scope, raw: await rawInput(options), overwrite: options.overwrite }), options));

  playbook.command('validate')
    .description('Validate raw playbook Markdown')
    .option('--raw <markdown>', 'Raw playbook Markdown')
    .option('--file <path>', 'Read raw playbook Markdown from a file')
    .option('--scope <scope>', 'Validation scope')
    .option('--json', 'Output JSON')
    .action(async (options: SaveOptions) => invokeAndRender('validate', compact({ raw: await rawInput(options), scope: options.scope }), options));

  playbook.command('copy <name>')
    .description('Copy a playbook to another scope')
    .requiredOption('--target-scope <scope>', 'Target scope')
    .option('--source-scope <scope>', 'Source scope')
    .option('--overwrite <boolean>', 'Overwrite target playbook', parseBoolean)
    .option('--json', 'Output JSON')
    .action((name: string, options: CopyOptions) => invokeAndRender('copy', compact({ name, sourceScope: options.sourceScope, targetScope: options.targetScope, overwrite: options.overwrite }), options));

  playbook.command('promote <name>').description('Promote a playbook').option('--json', 'Output JSON').action((name: string, options: CommonOptions) => invokeAndRender('promote', { name }, options));
  playbook.command('demote <name>').description('Demote a playbook').option('--json', 'Output JSON').action((name: string, options: CommonOptions) => invokeAndRender('demote', { name }, options));

  playbook.command('run <name>')
    .description('Run a playbook')
    .option('--scope <scope>', 'Resolve from an exact scope')
    .option('--mode <mode>', 'Expected playbook mode')
    .option('--profile <profile>', 'Agent profile override')
    .option('--after <queue-id>', 'Queue after an upstream queue item')
    .option('--landing-action <action>', 'Landing action: pr, merge, or leave')
    .option('--landing-auto-merge <boolean>', 'Enable or disable PR auto-merge', parseBoolean)
    .option('--json', 'Output JSON')
    .action((name: string, options: RunOptions) => invokeAndRender('run', compact({ name, scope: options.scope, mode: options.mode, profile: options.profile, afterQueueId: options.after, landingAction: options.landingAction, landingAutoMerge: options.landingAutoMerge }), options));

  program.command('play <name>')
    .description('Alias for eforge playbook run <name>')
    .option('--scope <scope>', 'Resolve from an exact scope')
    .option('--mode <mode>', 'Expected playbook mode')
    .option('--profile <profile>', 'Agent profile override')
    .option('--after <queue-id>', 'Queue after an upstream queue item')
    .option('--landing-action <action>', 'Landing action: pr, merge, or leave')
    .option('--landing-auto-merge <boolean>', 'Enable or disable PR auto-merge', parseBoolean)
    .option('--json', 'Output JSON')
    .action((name: string, options: RunOptions) => invokeAndRender('run', compact({ name, scope: options.scope, mode: options.mode, profile: options.profile, afterQueueId: options.after, landingAction: options.landingAction, landingAutoMerge: options.landingAutoMerge }), options));
}

async function invokeAndRender(action: PlaybookCommandAction, input: ExtensionJsonObject, options: CommonOptions): Promise<void> {
  try {
    const result = await invokePlaybookContributionForHost({ cwd: process.cwd(), action, input });
    if (options.json) console.log(JSON.stringify(result.response.ok ? result.response.output : result.response, null, 2));
    else renderPlaybookContributionResult(result);
    if (!result.response.ok) process.exit(1);
  } catch (err) {
    const { message, exitCode } = formatCliError(err);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(exitCode);
  }
}

async function createNewPlaybook(name: string, options: NewOptions): Promise<void> {
  try {
    const raw = await editPlaybookMarkdown(serializePlaybook({
      name,
      description: `Describe ${name}`,
      scope: options.scope as PlaybookScope,
      mode: (options.mode ?? 'autonomous') as PlaybookMode,
      ...(options.profile ? { profile: options.profile } : {}),
      goal: 'Describe the goal.',
      outOfScope: 'Describe what is out of scope.',
      acceptanceCriteria: '- [ ] Describe acceptance criteria.',
      plannerNotes: 'Add planner notes.',
    }));
    await validateAndSave(raw, options.scope, { json: options.json });
  } catch (err) {
    const { message, exitCode } = formatCliError(err);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(exitCode);
  }
}

async function editExistingPlaybook(name: string, options: ScopedOptions): Promise<void> {
  try {
    const shown = await invokePlaybookContributionForHost({ cwd: process.cwd(), action: 'show', input: compact({ name, scope: options.scope }) });
    if (!shown.response.ok) return failContribution(shown, options);
    const output = shown.response.output as unknown as { playbook: Playbook; source: { source: string } };
    const raw = await editPlaybookMarkdown(serializePlaybook(output.playbook));
    await validateAndSave(raw, output.source.source, { json: options.json, overwrite: true });
  } catch (err) {
    const { message, exitCode } = formatCliError(err);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(exitCode);
  }
}

async function validateAndSave(raw: string, scope: string, options: CommonOptions & { overwrite?: boolean }): Promise<void> {
  const validation = await invokePlaybookContributionForHost({ cwd: process.cwd(), action: 'validate', input: { raw, scope } });
  if (!validation.response.ok) return failContribution(validation, options);
  const validationOutput = validation.response.output as { ok?: boolean; errors?: string[] };
  if (validationOutput.ok === false) {
    if (options.json) console.log(JSON.stringify(validationOutput, null, 2));
    else console.error((validationOutput.errors ?? ['Playbook validation failed']).join('\n'));
    process.exit(1);
  }
  await invokeAndRender('save', compact({ scope, raw, overwrite: options.overwrite }), options);
}

async function editPlaybookMarkdown(initial: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eforge-playbook-'));
  const file = join(dir, 'playbook.md');
  try {
    await writeFile(file, initial, 'utf-8');
    const editor = process.env.VISUAL ?? process.env.EDITOR;
    if (!editor) throw new Error('Set $VISUAL or $EDITOR to edit playbooks.');
    const child = spawnSync(editor, [file], { stdio: 'inherit', shell: true });
    if (child.error) throw child.error;
    if (child.status !== 0) throw new Error(`Editor exited with status ${child.status ?? 'unknown'}`);
    return await readFile(file, 'utf-8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function failContribution(result: Awaited<ReturnType<typeof invokePlaybookContributionForHost>>, options: CommonOptions): never {
  if (options.json) console.log(JSON.stringify(result.response, null, 2));
  else renderPlaybookContributionResult(result);
  process.exit(1);
}

async function rawInput(options: { raw?: string; file?: string }): Promise<string | undefined> {
  if (options.raw !== undefined && options.file !== undefined) throw new Error('--raw and --file are mutually exclusive');
  return options.raw ?? (options.file ? readFile(options.file, 'utf-8') : undefined);
}

function compact(input: Record<string, unknown>): ExtensionJsonObject {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as ExtensionJsonObject;
}

function parseBoolean(value: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('Expected true or false');
}
