import { Command } from 'commander';
import chalk from 'chalk';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { stat as fsStat, readFile as fsReadFile } from 'node:fs/promises';

declare const EFORGE_VERSION: string;

import { EforgeEngine } from '@eforge-build/engine/eforge';
import { preprocessBuildSource, FatalPreprocessingError } from '@eforge-build/input';
import { QueueExecExitCode, queueExecExitCode } from '@eforge-build/engine/prd-queue';
import type { EforgeConfig, HookConfig } from '@eforge-build/engine/config';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { withHooks } from '@eforge-build/engine/hooks';
import { withSessionId, withRunId, runSession } from '@eforge-build/engine/session';
import { withNativeEventHooks, type NativeExtensionRegistry } from '@eforge-build/engine/extensions/index';
import { initDisplay, renderEvent, renderStatus, renderLangfuseStatus, renderQueueList, stopAllSpinners } from './display.js';
import { registerExtensionContributionCommands } from './extension-contributions.js';
import { createClarificationHandler, createApprovalHandler } from './interactive.js';
import { registerDebugComposerCommand } from './debug-composer.js';
import { registerPlaybookCommands } from './playbook.js';
// --- eforge:region host-queue-controls ---
import { registerQueueControlCommands } from './queue-control.js';
// --- eforge:endregion host-queue-controls ---
import { ensureMonitor, signalMonitorShutdown, type Monitor } from '@eforge-build/monitor';
import {
  readLockfile,
  isServerAlive,
  killPidIfAlive,
  removeLockfile,
  isAgentWorktreeCwd,
  apiListExtensions,
  apiShowExtension,
  apiValidateExtensions,
  apiTestExtension,
  apiNewExtension,
  apiReloadExtensions,
  apiTrustExtension,
  apiUntrustExtension,
  apiInstallExtension,
  apiUpdateExtension,
  apiRemoveExtension,
  apiPromoteExtension,
  apiDemoteExtension,
  type ExtensionEntry,
  type ExtensionNewRequest,
  type ExtensionTestRequest,
  type ExtensionTestResponse,
  type ExtensionInstallRequest,
  type ExtensionInstallResponse,
  type ExtensionUpdateRequest,
  type ExtensionUpdateResponse,
  type ExtensionRemoveResponse,
  type ExtensionPromoteResponse,
  type ExtensionDemoteResponse,
  type ContinueRepairRequest,
  apiStackSync,
  apiStackSyncIfRunning,
  apiContinueRepair,
  type StackSyncResponse,
  daemonRequestFromWorktree,
  DaemonNotDiscoverableError,
  API_ROUTES,
} from '@eforge-build/client';
import { runOrDelegate } from './run-or-delegate.js';
import { formatCliError } from './errors.js';
import { resolveAndValidateLandingFlags, CLILandingFlagError } from './landing-options.js';
import { resolveAndValidateLandingAutoMergeFlags } from './landing-options.js';
// --- eforge:region daemon-lifecycle-imports ---
import {
  addDaemonStartOptions,
  addDaemonStopOptions,
  setDaemonRestartAction,
  setDaemonStartAction,
  setDaemonStopAction,
} from './daemon-lifecycle.js';
// --- eforge:endregion daemon-lifecycle-imports ---

const SHUTDOWN_TIMEOUT_MS = 5000;

function collectRepeatableOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function buildConfigOverrides(options: { maxConcurrentBuilds?: number; plugins?: boolean }): Partial<EforgeConfig> | undefined {
  const overrides: Partial<EforgeConfig> = {};
  if (options.maxConcurrentBuilds !== undefined) overrides.maxConcurrentBuilds = options.maxConcurrentBuilds;
  if (options.plugins === false) overrides.plugins = { enabled: false };
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

let activeMonitor: Monitor | undefined;

/** Exposed for testing only — sets the module-level active monitor. */
export function setActiveMonitor(m: Monitor | undefined): void {
  activeMonitor = m;
}

export function setupSignalHandlers(): AbortController {
  const controller = new AbortController();
  let teardownStarted = false;

  const handleSignal = (exitCode: number) => {
    if (teardownStarted) return;
    teardownStarted = true;
    controller.abort();
    stopAllSpinners();
    const timer = setTimeout(() => process.exit(exitCode), SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    if (activeMonitor) {
      try { activeMonitor.stop(); } catch {}
      activeMonitor = undefined;
    }
  };

  const handleException = (exitCode: number, err: unknown) => {
    process.stderr.write(`[eforge] unhandled error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    handleSignal(exitCode);
  };

  process.on('SIGINT', () => handleSignal(130));
  process.on('SIGTERM', () => handleSignal(130));
  process.on('SIGHUP', () => handleSignal(130));
  process.on('uncaughtException', (err) => handleException(1, err));
  process.on('unhandledRejection', (reason) => handleException(1, reason));

  return controller;
}

async function withMonitor<T>(
  noServer: boolean | undefined,
  fn: (monitor: Monitor) => Promise<T>,
): Promise<T> {
  const monitor = await ensureMonitor(process.cwd(), { noServer: noServer ?? false });
  activeMonitor = monitor;
  if (monitor.server) {
    if (monitor.server.port !== 4567) {
      console.error(chalk.green.bold(`  Monitor: ${monitor.server.url}`));
    } else {
      console.error(chalk.dim(`  Monitor: ${monitor.server.url}`));
    }
  }

  try {
    return await fn(monitor);
  } finally {
    if (activeMonitor) {
      monitor.stop();
      activeMonitor = undefined;
    }
  }
}

interface WrapEventsOptions {
  monitor: Monitor;
  hooks: readonly HookConfig[];
  native: {
    registry: Pick<NativeExtensionRegistry, 'eventHooks'>;
    timeoutMs: number;
    cwd?: string;
    configDir?: string;
  };
  sessionOpts?: import('@eforge-build/engine/session').SessionOptions;
}

function wrapEvents(
  events: AsyncGenerator<EforgeEvent>,
  opts: WrapEventsOptions,
): AsyncGenerator<EforgeEvent> {
  let wrapped = opts.sessionOpts ? withSessionId(events, opts.sessionOpts) : events;
  wrapped = withRunId(wrapped);
  wrapped = withNativeEventHooks(wrapped, opts.native.registry, {
    cwd: opts.native.cwd ?? process.cwd(),
    configDir: opts.native.configDir,
    timeoutMs: opts.native.timeoutMs,
  });
  wrapped = opts.monitor.wrapEvents(wrapped);
  return opts.hooks.length > 0 ? withHooks(wrapped, opts.hooks, process.cwd()) : wrapped;
}

async function consumeEvents(
  events: AsyncGenerator<EforgeEvent>,
  opts?: { afterStart?: () => void },
): Promise<'completed' | 'failed' | 'skipped'> {
  let result: 'completed' | 'failed' | 'skipped' = 'completed';
  for await (const event of events) {
    renderEvent(event);
    if (event.type === 'phase:start' && opts?.afterStart) {
      opts.afterStart();
    }
    if (event.type === 'phase:end') {
      result = event.result.status;
    }
  }
  return result;
}

function extensionRegistrationSummary(entry: ExtensionEntry): string {
  const parts = Object.entries(entry.registrations)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind}:${count}`);
  return parts.length > 0 ? parts.join(',') : '-';
}

function formatTrustColumn(entry: ExtensionEntry): string {
  if (entry.trustState === undefined || entry.trustState === 'not-required') return '-';
  if (entry.trustState === 'trusted') {
    const hash = entry.currentHash ? entry.currentHash.slice(0, 8) : '';
    return hash ? `trusted (${hash})` : 'trusted';
  }
  if (entry.trustState === 'changed') {
    const hash = entry.currentHash ? entry.currentHash.slice(0, 8) : '';
    return hash ? `changed (${hash})` : 'changed';
  }
  // untrusted
  const hash = entry.currentHash ? entry.currentHash.slice(0, 8) : '';
  return hash ? `untrusted (${hash})` : 'untrusted';
}

function renderExtensionTable(extensions: ExtensionEntry[]): void {
  if (extensions.length === 0) {
    console.log(chalk.dim('No extensions found'));
    return;
  }
  const rows = extensions.map((entry) => ({
    name: entry.name,
    status: entry.status,
    enabled: String(entry.enabled),
    scope: entry.scope,
    source: entry.source,
    trust: formatTrustColumn(entry),
    registrations: extensionRegistrationSummary(entry),
    path: entry.path,
  }));
  const headers = ['name', 'status', 'enabled', 'scope', 'source', 'trust', 'registrations', 'path'] as const;
  const widths = Object.fromEntries(headers.map((header) => [
    header,
    Math.max(header.length, ...rows.map((row) => String(row[header]).length)),
  ])) as Record<typeof headers[number], number>;
  console.log(headers.map((header) => header.padEnd(widths[header])).join('  '));
  console.log(headers.map((header) => '-'.repeat(widths[header])).join('  '));
  for (const row of rows) {
    console.log(headers.map((header) => String(row[header]).padEnd(widths[header])).join('  '));
  }
}

function renderExtensionDetail(entry: ExtensionEntry): void {
  console.log(chalk.bold(entry.name));
  console.log(`  Status:        ${entry.status}`);
  console.log(`  Enabled:       ${entry.enabled}`);
  console.log(`  Scope:         ${entry.scope}`);
  console.log(`  Source:        ${entry.source}`);
  console.log(`  Path:          ${entry.path}`);
  if (entry.entrypoint) console.log(`  Entrypoint:    ${entry.entrypoint}`);
  if (entry.strategy) console.log(`  Strategy:      ${entry.strategy}`);
  console.log(`  Registrations: ${extensionRegistrationSummary(entry)}`);
  if (entry.trustState !== undefined && entry.trustState !== 'not-required') {
    console.log(`  Trust:         ${entry.trustState}`);
    if (entry.currentHash) console.log(`  Current hash:  ${entry.currentHash}`);
    if (entry.trustedHash) console.log(`  Trusted hash:  ${entry.trustedHash}`);
    if (entry.trustedAt) console.log(`  Trusted at:    ${entry.trustedAt}`);
    if (entry.trustedBy) console.log(`  Trusted by:    ${entry.trustedBy}`);
  }
  if (entry.package) {
    const pkg = entry.package;
    if (pkg.packageName) console.log(`  Package:       ${pkg.packageName}${pkg.version ? `@${pkg.version}` : ''}`);
    if (pkg.description) console.log(`  Description:   ${pkg.description}`);
    if (pkg.repository) console.log(`  Repository:    ${pkg.repository}`);
  }
  if (entry.install) {
    const inst = entry.install;
    console.log(`  Installed from: ${inst.sourceKind}:${inst.sourceSpec}`);
    if (inst.installedAt) console.log(`  Installed at:  ${inst.installedAt}`);
  }
  if (entry.reviewerPerspectiveDetails && entry.reviewerPerspectiveDetails.length > 0) {
    console.log('  Reviewer perspectives:');
    for (const perspective of entry.reviewerPerspectiveDetails) {
      console.log(`    - ${chalk.cyan(perspective.key)}: ${perspective.label}`);
      console.log(`      ${perspective.description}`);
      if (perspective.applicability) {
        const parts: string[] = [];
        if (perspective.applicability.fileGlobs?.length) parts.push(`globs: ${perspective.applicability.fileGlobs.join(', ')}`);
        if (perspective.applicability.paths?.length) parts.push(`paths: ${perspective.applicability.paths.join(', ')}`);
        if (perspective.applicability.extensions?.length) parts.push(`exts: ${perspective.applicability.extensions.join(', ')}`);
        if (perspective.applicability.categories?.length) parts.push(`categories: ${perspective.applicability.categories.join(', ')}`);
        if (perspective.applicability.minChangedFiles !== undefined) parts.push(`minFiles: ${perspective.applicability.minChangedFiles}`);
        if (perspective.applicability.minChangedLines !== undefined) parts.push(`minLines: ${perspective.applicability.minChangedLines}`);
        if (perspective.applicability.hasFn) parts.push('fn: yes');
        if (parts.length > 0) console.log(chalk.dim(`      Applies to: ${parts.join('; ')}`));
      }
    }
  }
  if (entry.validationProviderDetails && entry.validationProviderDetails.length > 0) {
    console.log('  Validation providers:');
    for (const provider of entry.validationProviderDetails) {
      const kindLabel = provider.kind === 'commands'
        ? `commands (${provider.commandCount ?? 0} command(s))`
        : 'function';
      console.log(`    - ${chalk.cyan(provider.name)}: ${provider.description}`);
      console.log(chalk.dim(`      Kind: ${kindLabel}`));
    }
  }
  if (entry.shadows.length > 0) {
    console.log('  Shadows:');
    for (const shadow of entry.shadows) {
      console.log(`    - ${shadow.scope}: ${shadow.path}`);
    }
  }
  if (entry.diagnostics.length > 0) {
    console.log('  Diagnostics:');
    for (const diagnostic of entry.diagnostics) {
      const color = diagnostic.severity === 'error' ? chalk.red : chalk.yellow;
      console.log(color(`    - ${diagnostic.code}: ${diagnostic.message}`));
    }
  }
}

function renderInstallNextSteps(entry: ExtensionEntry): void {
  if (entry.trustState === 'untrusted' || entry.trustState === 'changed') {
    console.log(chalk.dim(`Next: eforge extension trust ${entry.name}`));
  }
  console.log(chalk.dim(`Next: eforge extension validate ${entry.name}`));
  console.log(chalk.dim('Next: eforge extension reload'));
}

function formatExtensionTestSource(source: ExtensionTestResponse['source']): string {
  const parts: string[] = [source.kind];
  if (source.fixture) parts.push(source.fixture);
  if (source.run) parts.push(`run=${source.run}`);
  if (source.sessionId) parts.push(`session=${source.sessionId}`);
  if (source.event) parts.push(`event=${source.event}`);
  return parts.join(' ');
}

function renderExtensionTestResult(data: ExtensionTestResponse): void {
  if (data.valid) {
    console.log(chalk.green('✔') + ' Extensions test passed');
  } else {
    console.error(chalk.red('✘') + ' Extensions test failed');
  }

  console.log(`  Source:                ${formatExtensionTestSource(data.source)}`);
  console.log(`  Extensions:            ${data.extensions.length}`);
  console.log(`  Replayed events:       ${data.replay.inputEventCount}`);
  console.log(`  Filtered events:       ${data.replay.filteredEventCount}`);
  console.log(`  Emitted events:        ${data.replay.emittedEventCount}`);
  console.log(`  Matches:               ${data.matches.length}`);
  console.log(`  Emitted diagnostics:   ${data.emittedDiagnostics.length}`);

  if (data.matches.length === 0) {
    console.log(chalk.dim('  No event hooks matched the replay input.'));
  } else {
    console.log('  Matched event hooks:');
    for (const match of data.matches) {
      console.log(`    - event[${match.eventIndex}] ${match.eventType} -> ${match.extensionName} (${match.pattern})`);
    }
  }

  // Filter out validationProviders from the deferred display — they are runtime-supported
  // and shown in their own section below. The API response still carries the count.
  const RUNTIME_SUPPORTED_FAMILIES = new Set(['validationProviders']);
  const deferredEntries = data.deferredRegistrations.filter((entry) => entry.count > 0 && !RUNTIME_SUPPORTED_FAMILIES.has(entry.family));
  if (deferredEntries.length > 0) {
    console.log('  Deferred registrations:');
    for (const entry of deferredEntries) {
      console.log(`    - ${entry.family}: ${entry.count}`);
    }
  } else {
    console.log('  Deferred registrations: none');
  }
  // Surface runtime-supported reviewer perspectives from the extension entries
  const allPerspectives = data.extensions.flatMap((ext) => ext.reviewerPerspectiveDetails ?? []);
  if (allPerspectives.length > 0) {
    console.log('  Reviewer perspectives (runtime-supported):');
    for (const p of allPerspectives) {
      console.log(`    - ${p.key} [${p.extensionName}]: ${p.label}`);
    }
  }
  // Surface runtime-supported validation providers from the extension entries
  const allValidationProviders = data.extensions.flatMap((ext) => ext.validationProviderDetails ?? []);
  const validationProviderCount = data.extensions.reduce((sum, ext) => sum + (ext.registrations.validationProviders), 0);
  if (allValidationProviders.length > 0 || validationProviderCount > 0) {
    console.log('  Validation providers (runtime-supported):');
    console.log(`    validationProviders: ${validationProviderCount} (execution skipped in replay mode)`);
    for (const p of allValidationProviders) {
      const kindLabel = p.kind === 'commands'
        ? `commands (${p.commandCount ?? 0} command(s))`
        : 'function';
      console.log(`    - ${p.name} [${p.extensionName}]: ${p.description} (${kindLabel})`);
    }
  }

  if (data.diagnostics.length > 0) {
    console.log('  Diagnostics:');
    for (const diagnostic of data.diagnostics) {
      const color = diagnostic.severity === 'error' ? chalk.red : chalk.yellow;
      const target = diagnostic.name ?? diagnostic.path;
      console.log(color(`    - ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}${target ? ` (${target})` : ''}`));
    }
  }

  if (data.emittedDiagnostics.length > 0) {
    console.log('  Emitted diagnostic details:');
    for (const diagnostic of data.emittedDiagnostics) {
      const timeout = 'timeoutMs' in diagnostic ? ` timeoutMs=${diagnostic.timeoutMs}` : '';
      const message = 'message' in diagnostic ? `: ${diagnostic.message}` : '';
      console.log(chalk.red(`    - ${diagnostic.type}: ${diagnostic.extensionName} ${diagnostic.pattern} on ${diagnostic.triggeringEventType}${message}${timeout}`));
    }
  }
}

function isExtensionPathArg(value: string): boolean {
  return /[\\/]/.test(value) || /\.(?:mjs|mts|js|ts)$/.test(value);
}

function renderStackSyncReport(report: StackSyncResponse, _dryRun: boolean): void {
  const outcomeColor =
    report.outcome === 'complete'
      ? chalk.green
      : report.outcome === 'skipped' || report.outcome === 'deferred'
        ? chalk.yellow
        : chalk.red;

  console.log(outcomeColor(`Stack sync outcome: ${report.outcome}`));
  if (report.reason) {
    console.log(chalk.dim(`  Reason: ${report.reason}`));
  }
  if (report.localTrunkSha) {
    console.log(`  Local trunk SHA:  ${report.localTrunkSha}`);
  }
  if (report.originTrunkSha) {
    console.log(`  Origin trunk SHA: ${report.originTrunkSha}`);
  }
  if (report.fastForward !== undefined) {
    console.log(`  Fast-forward:     ${report.fastForward ? 'yes' : 'no'}`);
  }
  if (report.restackCandidates && report.restackCandidates.length > 0) {
    console.log(`  Restack candidates:`);
    for (const branch of report.restackCandidates) {
      console.log(chalk.dim(`    - ${branch}`));
    }
  }
  if (report.activeBuildSkips.length > 0) {
    console.log(`  Active-build skips:`);
    for (const skip of report.activeBuildSkips) {
      const detail = skip.worktree ? ` (${skip.worktree})` : '';
      console.log(chalk.yellow(`    - ${skip.branch}${detail}: ${skip.reason}`));
    }
  }
  if (report.providerCommands.length > 0) {
    const header = report.dryRun ? '  Provider commands (dry-run):' : '  Provider commands:';
    console.log(header);
    for (const cmd of report.providerCommands) {
      const argv = [cmd.command, ...cmd.args].join(' ');
      const status = cmd.ran ? chalk.green('ran') : chalk.dim('not run');
      console.log(`    [${status}] ${argv}`);
      if (cmd.exitCode !== undefined && cmd.exitCode !== 0) {
        console.log(chalk.red(`      exit: ${cmd.exitCode}`));
      }
      if (cmd.stderr) {
        console.log(chalk.red(`      stderr: ${cmd.stderr}`));
      }
    }
  }
  if (report.error) {
    console.error(chalk.red(`  Error: ${report.error}`));
  }
}

export function createProgram(abortController?: AbortController, version?: string): Command {
  const program = new Command();

  program
    .name('eforge')
    .description('Autonomous plan-build-review CLI for code generation')
    .version(version ?? EFORGE_VERSION);

  registerPlaybookCommands(program);

  program
    .command('enqueue <source>')
    .description('Normalize input and add it to the PRD queue')
    .option('--name <name>', 'Override the inferred PRD title')
    .option('--verbose', 'Stream agent output')
    .option('--no-plugins', 'Disable plugin loading')
    .option('--profile <name>', 'Override active profile for this enqueue + build')
    .option('--landing-action <action>', 'Landing action for this build (pr|merge|leave)')
    .option('--landing-auto-merge', 'Enable PR auto-merge for this build')
    .option('--no-landing-auto-merge', 'Disable PR auto-merge for this build')
    .option('--after <queue-id>', 'Explicit upstream dependency: waits in waiting/ if the upstream is active; enqueues immediately as an eligible dependent if the upstream completed with a usable artifact')
    .option('--post-merge <command>', 'Per-enqueue post-merge validation command (repeatable)', collectRepeatableOption, [])
    .action(
      async (
        source: string,
        options: {
          name?: string;
          verbose?: boolean;
          plugins?: boolean;
          profile?: string;
          landingAction?: string;
          landingAutoMerge?: boolean;
          after?: string;
          postMerge?: string[];
        },
      ) => {
        let resolvedLandingAction: 'pr' | 'merge' | 'leave' | undefined;
        try {
          resolvedLandingAction = resolveAndValidateLandingFlags({ landingAction: options.landingAction });
        } catch (err) {
          if (err instanceof CLILandingFlagError) {
            console.error(chalk.red(`Error: ${err.message}`));
            process.exit(1);
          }
          throw err;
        }
        const resolvedLandingAutoMerge = resolveAndValidateLandingAutoMergeFlags({ landingAutoMerge: options.landingAutoMerge });
        initDisplay({ verbose: options.verbose });

        const configOverrides = buildConfigOverrides(options);

        let inheritedAgentProfile: string | undefined;
        try {
          const resolvedSourcePath = resolve(process.cwd(), source);
          const sourceStat = await fsStat(resolvedSourcePath).catch(() => null);
          if (sourceStat?.isFile()) {
            const rawContent = await fsReadFile(resolvedSourcePath, 'utf-8');
            const { createSessionPlanningWorkflowAdapter } = await import('@eforge-build/input');
            const normalized = createSessionPlanningWorkflowAdapter().flat.normalizeBuildSource({ sourcePath: resolvedSourcePath, content: rawContent });
            inheritedAgentProfile = normalized.agentProfile;
          }
        } catch {
          // Not a session plan or file not accessible — no inherited profile.
        }
        const effectiveProfile = options.profile ?? inheritedAgentProfile;

        const engine = await EforgeEngine.create({
          ...(configOverrides && { config: configOverrides }),
          ...(effectiveProfile && { profileOverride: effectiveProfile }),
        });

        await withMonitor(true /* noServer */, async (monitor) => {
          const sessionId = randomUUID();

          async function* preprocessAndEnqueue(): AsyncGenerator<EforgeEvent> {
            let normalizedSource: string;
            try {
              const preprocessResult = await preprocessBuildSource({
                source,
                inputSources: engine.nativeExtensionRegistry.inputSources,
                prdEnrichers: engine.nativeExtensionRegistry.prdEnrichers,
                cwd: process.cwd(),
                configDir: engine.nativeExtensionConfigDir,
                timeoutMs: engine.resolvedConfig.extensions.eventHookTimeoutMs,
              });

              // Yield provenance events with timestamps before engine enqueue
              const timestamp = new Date().toISOString();
              for (const event of preprocessResult.events) {
                yield { ...event, timestamp } as EforgeEvent;
              }

              normalizedSource = preprocessResult.content;
            } catch (err) {
              if (err instanceof FatalPreprocessingError) {
                const timestamp = new Date().toISOString();
                yield { ...err.diagnosticEvent, timestamp } as EforgeEvent;
                yield { type: 'enqueue:failed', timestamp, error: err.message } as EforgeEvent;
                return;
              }
              throw err;
            }

            yield* engine.enqueue(normalizedSource, {
              name: options.name,
              verbose: options.verbose,
              abortController,
              ...(effectiveProfile && { profile: effectiveProfile }),
              ...(options.postMerge !== undefined && options.postMerge.length > 0 && { postMerge: options.postMerge }),
              ...(resolvedLandingAction && { landingAction: resolvedLandingAction }),
              ...(resolvedLandingAutoMerge !== undefined && { landingAutoMerge: resolvedLandingAutoMerge }),
              ...(options.after !== undefined && { afterQueueId: options.after }),
            });
          }

          await consumeEvents(
            wrapEvents(runSession(preprocessAndEnqueue(), sessionId), {
              monitor,
              hooks: engine.resolvedConfig.hooks,
              native: {
                registry: engine.nativeExtensionRegistry,
                timeoutMs: engine.resolvedConfig.extensions.eventHookTimeoutMs,
                configDir: engine.nativeExtensionConfigDir,
              },
            }),
          );
        });
      },
    );

  const buildCmd = program
    .command('build [source]')
    .alias('run')
    .description('Compile + build + validate in one step')
    .option('--auto', 'Run without approval gates')
    .option('--verbose', 'Stream agent output')
    .option('--name <name>', 'Plan set name (inferred from source if omitted)')
    .option('--queue', 'Process all PRDs from the queue')
    .option('--max-concurrent-builds <n>', 'Max parallel queue PRDs', parseInt)
    .option('--dry-run', 'Compile only, then show execution plan without building')
    .option('--foreground', 'Run in-process instead of delegating to daemon')
    .option('--no-cleanup', 'Keep plan files after successful build')
    .option('--no-monitor', 'Disable web monitor')
    .option('--no-plugins', 'Disable plugin loading')
    .option('--watch', 'Watch mode: continuously poll the queue for new PRDs')
    .option('--poll-interval <ms>', 'Poll interval in milliseconds for watch mode', parseInt)
    .option('--profile <name>', 'Override active profile for this build')
    .option('--landing-action <action>', 'Landing action for this build (pr|merge|leave)')
    .option('--landing-auto-merge', 'Enable PR auto-merge for this build')
    .option('--no-landing-auto-merge', 'Disable PR auto-merge for this build')
    .option('--after <queue-id>', 'Explicit upstream dependency: waits in waiting/ if the upstream is active; enqueues immediately as an eligible dependent if the upstream completed with a usable artifact')
    .action(
      async (
        source: string | undefined,
        options: {
          auto?: boolean;
          verbose?: boolean;
          name?: string;
          queue?: boolean;
          cleanup?: boolean;
          maxConcurrentBuilds?: number;
          dryRun?: boolean;
          foreground?: boolean;
          monitor?: boolean;
          plugins?: boolean;
          watch?: boolean;
          pollInterval?: number;
          profile?: string;
          landingAction?: string;
          landingAutoMerge?: boolean;
          after?: string;
        },
      ) => {
        let resolvedLandingActionBuild: 'pr' | 'merge' | 'leave' | undefined;
        try {
          resolvedLandingActionBuild = resolveAndValidateLandingFlags({ landingAction: options.landingAction });
        } catch (err) {
          if (err instanceof CLILandingFlagError) {
            console.error(chalk.red(`Error: ${err.message}`));
            process.exit(1);
          }
          throw err;
        }
        const resolvedLandingAutoMergeBuild = resolveAndValidateLandingAutoMergeFlags({ landingAutoMerge: options.landingAutoMerge });
        if (resolvedLandingActionBuild !== undefined) {
          options.landingAction = resolvedLandingActionBuild;
        }
        // --queue mode: delegate to engine.runQueue() or engine.watchQueue()
        if (options.queue) {
          if (options.watch) process.title = 'eforge-watcher';
          initDisplay({ verbose: options.verbose });

          const configOverrides = buildConfigOverrides(options);

          const engine = await EforgeEngine.create({
            onClarification: createClarificationHandler(options.auto ?? false),
            onApproval: createApprovalHandler(options.auto ?? false),
            ...(configOverrides && { config: configOverrides }),
            ...(options.profile && { profileOverride: options.profile }),
          });

          await withMonitor(options.monitor === false, async (monitor) => {
            const queueOpts = {
              name: options.name,
              all: true,
              auto: options.auto,
              verbose: options.verbose,
              abortController,
              ...(options.pollInterval !== undefined && { pollIntervalMs: options.pollInterval }),
              ...(options.landingAction && { landingAction: options.landingAction as 'pr' | 'merge' | 'leave' }),
              ...(resolvedLandingAutoMergeBuild !== undefined && { landingAutoMerge: resolvedLandingAutoMergeBuild }),
            };

            const queueEvents = options.watch
              ? engine.watchQueue(queueOpts)
              : engine.runQueue(queueOpts);

            const result = await consumeEvents(
              wrapEvents(queueEvents, {
                monitor,
                hooks: engine.resolvedConfig.hooks,
                native: {
                  registry: engine.nativeExtensionRegistry,
                  timeoutMs: engine.resolvedConfig.extensions.eventHookTimeoutMs,
                  configDir: engine.nativeExtensionConfigDir,
                },
              }),
              { afterStart: () => renderLangfuseStatus(engine.resolvedConfig) },
            );

            // In watch mode, abort is a clean exit
            process.exit(options.watch ? 0 : (result === 'completed' ? 0 : 1));
          });
          return;
        }

        // Normal mode: source is required
        if (!source) {
          console.error(chalk.red('Error: <source> is required unless --queue is specified'));
          process.exit(1);
        }

        try {
          const result = await runOrDelegate({
            mode: 'build',
            source,
            options: {
              auto: options.auto,
              verbose: options.verbose,
              name: options.name,
              dryRun: options.dryRun,
              foreground: options.foreground,
              monitor: options.monitor,
              plugins: options.plugins,
              cleanup: options.cleanup,
              maxConcurrentBuilds: options.maxConcurrentBuilds,
              profile: options.profile,
              landingAction: resolvedLandingActionBuild,
              landingAutoMerge: resolvedLandingAutoMergeBuild,
              afterQueueId: options.after,
            },
            abortController,
            onMonitor: (m) => { activeMonitor = m; },
          });
          process.exit(result.code);
        } catch (err) {
          const { message, exitCode } = formatCliError(err);
          console.error(chalk.red(`Error: ${message}`));
          process.exit(exitCode);
        }
      },
    );

  program
    .command('monitor')
    .description('Start or connect to the monitor dashboard')
    .option('--port <port>', 'Preferred port', parseInt)
    .action(async (options: { port?: number }) => {
      const cwd = process.cwd();
      const monitor = await ensureMonitor(cwd, { port: options.port });

      if (!monitor.server) {
        console.error(chalk.red('Failed to start monitor server'));
        process.exit(1);
      }
      console.log(chalk.bold(`Monitor: ${monitor.server.url}`));
      console.log(chalk.dim('Press Ctrl+C to exit'));

      // Signal handlers don't keep the event loop alive — use a timer
      const keepAlive = setInterval(() => {}, 1 << 30);

      await new Promise<void>((resolveWait) => {
        const handler = async () => {
          process.removeListener('SIGINT', handler);
          process.removeListener('SIGTERM', handler);

          monitor.stop();

          // If no active runs remain, signal the detached server to shut down
          await signalMonitorShutdown(cwd);

          clearInterval(keepAlive);
          resolveWait();
        };

        process.on('SIGINT', handler);
        process.on('SIGTERM', handler);
      });
    });

  program
    .command('status')
    .description('Check running builds')
    .action(async () => {
      const engine = await EforgeEngine.create();
      renderStatus(engine.status());
    });

  // Queue commands
  const queue = program
    .command('queue')
    .description('Manage PRD queue');

  // --- eforge:region host-queue-controls ---
  registerQueueControlCommands(queue);
  // --- eforge:endregion host-queue-controls ---

  queue
    .command('list')
    .description('Show PRDs in the queue')
    .action(async () => {
      const { loadQueue, isPrdRunning } = await import('@eforge-build/engine/prd-queue');
      const { loadConfig } = await import('@eforge-build/engine/config');
      const { config, warnings: configWarnings } = await loadConfig();
      for (const warning of configWarnings) {
        process.stderr.write(`${warning}\n`);
      }
      const cwd = process.cwd();
      const queueDir = config.prdQueue.dir;

      // Load PRDs from main queue dir and subdirectories
      const [allPending, failed, skipped, waiting] = await Promise.all([
        loadQueue(queueDir, cwd),
        loadQueue(`${queueDir}/failed`, cwd),
        loadQueue(`${queueDir}/skipped`, cwd),
        loadQueue(`${queueDir}/waiting`, cwd).catch(() => [] as Awaited<ReturnType<typeof loadQueue>>),
      ]);

      // Split pending into running vs pending by checking lock files
      const pending: typeof allPending = [];
      const running: typeof allPending = [];
      for (const prd of allPending) {
        if (await isPrdRunning(prd.id, cwd)) {
          running.push(prd);
        } else {
          pending.push(prd);
        }
      }

      renderQueueList({ pending, running, failed, skipped, waiting });
    });

  queue
    .command('run [name]')
    .description('Process PRDs from the queue')
    .option('--all', 'Process all pending PRDs')
    .option('--auto', 'Run without approval gates')
    .option('--verbose', 'Stream agent output')
    .option('--no-monitor', 'Disable web monitor')
    .option('--no-plugins', 'Disable plugin loading')
    .option('--max-concurrent-builds <n>', 'Max parallel queue PRDs', parseInt)
    .option('--watch', 'Watch mode: continuously poll the queue for new PRDs')
    .option('--poll-interval <ms>', 'Poll interval in milliseconds for watch mode', parseInt)
    .option('--landing-action <action>', 'Landing action for this build (pr|merge|leave)')
    .option('--landing-auto-merge', 'Enable PR auto-merge for this build')
    .option('--no-landing-auto-merge', 'Disable PR auto-merge for this build')
    .action(
      async (
        name: string | undefined,
        options: {
          all?: boolean;
          auto?: boolean;
          verbose?: boolean;
          monitor?: boolean;
          plugins?: boolean;
          maxConcurrentBuilds?: number;
          watch?: boolean;
          pollInterval?: number;
          landingAction?: string;
          landingAutoMerge?: boolean;
        },
      ) => {
        let resolvedLandingActionQueue: 'pr' | 'merge' | 'leave' | undefined;
        try {
          resolvedLandingActionQueue = resolveAndValidateLandingFlags({ landingAction: options.landingAction });
        } catch (err) {
          if (err instanceof CLILandingFlagError) {
            console.error(chalk.red(`Error: ${err.message}`));
            process.exit(1);
          }
          throw err;
        }
        let resolvedLandingAutoMergeQueue: boolean | undefined;
        try {
          resolvedLandingAutoMergeQueue = resolveAndValidateLandingAutoMergeFlags({ landingAutoMerge: options.landingAutoMerge });
        } catch (err) {
          if (err instanceof CLILandingFlagError) {
            console.error(chalk.red(`Error: ${err.message}`));
            process.exit(1);
          }
          throw err;
        }
        if (resolvedLandingActionQueue !== undefined) {
          options.landingAction = resolvedLandingActionQueue;
        }
        try {
          const result = await runOrDelegate({ mode: 'queue', name, options: { ...options, landingAction: options.landingAction as 'pr' | 'merge' | 'leave' | undefined, landingAutoMerge: resolvedLandingAutoMergeQueue }, abortController, onMonitor: (m) => { activeMonitor = m; } });
          process.exit(result.code);
        } catch (err) {
          const { message, exitCode } = formatCliError(err);
          console.error(chalk.red(`Error: ${message}`));
          process.exit(exitCode);
        }
      },
    );

  queue
    .command('exec <prdId>')
    .description('Build a single PRD directly (subprocess entry point for the queue scheduler)')
    .option('--auto', 'Run without approval gates')
    .option('--verbose', 'Stream agent output')
    .option('--no-monitor', 'Disable web monitor')
    .option('--no-plugins', 'Disable plugin loading')
    .option('--session-id <uuid>', 'Session ID injected by parent scheduler (skips child session:start emission)')
    .option('--profile <name>', 'Override active profile for this build')
    .option('--landing-action <action>', 'Landing action for this build (pr|merge|leave)')
    .option('--landing-auto-merge <bool>', 'Enable PR auto-merge for this build (true|false)')
    .action(
      async (
        prdId: string,
        options: {
          auto?: boolean;
          verbose?: boolean;
          monitor?: boolean;
          plugins?: boolean;
          sessionId?: string;
          profile?: string;
          landingAction?: string;
          landingAutoMerge?: string;
        },
      ) => {
        let resolvedLandingActionExec: 'pr' | 'merge' | 'leave' | undefined;
        try {
          resolvedLandingActionExec = resolveAndValidateLandingFlags({ landingAction: options.landingAction });
        } catch (err) {
          if (err instanceof CLILandingFlagError) {
            console.error(chalk.red(`Error: ${err.message}`));
            process.exit(QueueExecExitCode.Failed);
          }
          throw err;
        }
        if (resolvedLandingActionExec !== undefined) {
          options.landingAction = resolvedLandingActionExec;
        }
        let resolvedLandingAutoMerge: boolean | undefined;
        if (options.landingAutoMerge !== undefined) {
          if (options.landingAutoMerge === 'true') resolvedLandingAutoMerge = true;
          else if (options.landingAutoMerge === 'false') resolvedLandingAutoMerge = false;
          else {
            console.error(chalk.red(`Error: --landing-auto-merge must be exactly 'true' or 'false', got '${options.landingAutoMerge}'`));
            process.exit(QueueExecExitCode.Failed);
          }
        }
        process.title = `eforge-build:${prdId}`;
        initDisplay({ verbose: options.verbose });

        const configOverrides = buildConfigOverrides(options);

        const engine = await EforgeEngine.create({
          onClarification: createClarificationHandler(options.auto ?? false),
          onApproval: createApprovalHandler(options.auto ?? false),
          ...(configOverrides && { config: configOverrides }),
          ...(options.profile && { profileOverride: options.profile }),
        }).catch((err: unknown) => {
          console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
          process.exit(QueueExecExitCode.Failed);
        }) as EforgeEngine;

        const { loadQueue } = await import('@eforge-build/engine/prd-queue');
        const prds = await loadQueue(engine.resolvedConfig.prdQueue.dir, process.cwd());
        const prd = prds.find((p) => p.id === prdId);
        if (!prd) {
          console.error(chalk.red(`PRD not found in queue: ${prdId}`));
          process.exit(QueueExecExitCode.NotFound);
        }

        const exitCode = await withMonitor(options.monitor === false, async (monitor) => {
          const buildEvents = engine.buildSinglePrd(prd, {
            auto: options.auto,
            verbose: options.verbose,
            abortController,
            ...(options.landingAction && { landingAction: options.landingAction as 'pr' | 'merge' | 'leave' }),
            ...(resolvedLandingAutoMerge !== undefined && { landingAutoMerge: resolvedLandingAutoMerge }),
          }, options.sessionId);

          const wrapped = wrapEvents(buildEvents, {
            monitor,
            hooks: engine.resolvedConfig.hooks,
            native: {
              registry: engine.nativeExtensionRegistry,
              timeoutMs: engine.resolvedConfig.extensions.eventHookTimeoutMs,
              configDir: engine.nativeExtensionConfigDir,
            },
          });

          let completionStatus: 'completed' | 'failed' | 'skipped' | undefined;
          let skipReason: string | undefined;
          for await (const event of wrapped) {
            renderEvent(event);
            // Narrow via event.type rather than raw `as` casts — the
            // EforgeEvent union already carries these fields.
            if (event.type === 'queue:prd:complete') {
              completionStatus = event.status;
            } else if (event.type === 'queue:prd:skip') {
              skipReason = event.reason;
            }
          }

          return queueExecExitCode(completionStatus, skipReason);
        });

        // Exit *after* withMonitor's finally has torn down the monitor /
        // spinners / hooks. Calling process.exit inside the callback would
        // leak the monitor subprocess when --no-monitor is omitted.
        process.exit(exitCode);
      },
    );

  const extension = program
    .command('extension')
    .description('Manage native eforge extensions');

  extension
    .command('list')
    .description('List discovered native extensions')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      try {
        const { data } = await apiListExtensions({ cwd: process.cwd() });
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          renderExtensionTable(data.extensions);
          for (const diagnostic of data.diagnostics) {
            const color = diagnostic.severity === 'error' ? chalk.red : chalk.yellow;
            process.stderr.write(color(`${diagnostic.code}: ${diagnostic.message}\n`));
          }
        }
      } catch (err) {
        const { message, exitCode } = formatCliError(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(exitCode);
      }
    });

  extension
    .command('show <name>')
    .description('Show one native extension by name')
    .option('--json', 'Output JSON')
    .action(async (name: string, options: { json?: boolean }) => {
      try {
        const { data } = await apiShowExtension({ cwd: process.cwd(), name });
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          renderExtensionDetail(data.extension);
        }
      } catch (err) {
        const { message, exitCode } = formatCliError(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(exitCode);
      }
    });

  extension
    .command('validate [nameOrPath]')
    .description('Validate configured native extensions, or a single extension name/path')
    .option('--json', 'Output JSON')
    .action(async (nameOrPath: string | undefined, options: { json?: boolean }) => {
      try {
        const request = nameOrPath
          ? isExtensionPathArg(nameOrPath)
            ? { cwd: process.cwd(), path: nameOrPath }
            : { cwd: process.cwd(), name: nameOrPath }
          : { cwd: process.cwd() };
        const { data } = await apiValidateExtensions(request);
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else if (data.valid) {
          console.log(chalk.green('✔') + ' Extensions valid');
        } else {
          console.error(chalk.red('✘') + ' Extensions invalid:');
          for (const diagnostic of data.diagnostics) {
            console.error(chalk.red(`  - ${diagnostic.code}: ${diagnostic.message}`));
          }
        }
        if (!data.valid) process.exit(1);
      } catch (err) {
        const { message, exitCode } = formatCliError(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(exitCode);
      }
    });

  extension
    .command('test [nameOrPath]')
    .description('Dry-run native extension event hooks against fixture or monitor events')
    .option('--run <run>', 'Replay monitor DB events: latest or a session/run id')
    .option('--event <type>', 'Filter replay input by exact event type')
    .option('--fixture <path>', 'Replay project-local fixture events from a JSON or JSONL file')
    .option('--json', 'Output JSON')
    .action(async (nameOrPath: string | undefined, options: { run?: string; event?: string; fixture?: string; json?: boolean }) => {
      try {
        const body: ExtensionTestRequest = {};
        if (nameOrPath) {
          if (isExtensionPathArg(nameOrPath)) body.path = nameOrPath;
          else body.name = nameOrPath;
        }
        if (options.fixture !== undefined) body.fixture = options.fixture;
        if (options.run !== undefined) body.run = options.run;
        if (options.event !== undefined) body.event = options.event;
        const { data } = await apiTestExtension({ cwd: process.cwd(), body });
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          renderExtensionTestResult(data);
        }
        if (!data.valid) process.exit(1);
      } catch (err) {
        const { message, exitCode } = formatCliError(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(exitCode);
      }
    });

  extension
    .command('new <name>')
    .description('Scaffold a native eforge extension')
    .option('--scope <scope>', 'Extension scope: local, project, or user')
    .option('--template <template>', 'Scaffold template')
    .option('--force', 'Overwrite an existing extension file')
    .option('--json', 'Output JSON')
    .action(async (name: string, options: { scope?: string; template?: string; force?: boolean; json?: boolean }) => {
      try {
        const body: ExtensionNewRequest = { name };
        if (options.scope !== undefined) {
          if (!['local', 'project', 'user'].includes(options.scope)) {
            throw new Error('--scope must be one of: local, project, user');
          }
          body.scope = options.scope as ExtensionNewRequest['scope'];
        }
        if (options.template !== undefined) body.template = options.template as ExtensionNewRequest['template'];
        if (options.force !== undefined) body.force = options.force;
        const { data } = await apiNewExtension({ cwd: process.cwd(), body });
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(chalk.green('✔') + ` Extension ${data.name} scaffolded`);
          console.log(`  Path:       ${data.path}`);
          console.log(`  Scope:      ${data.scope}`);
          console.log(`  Template:   ${data.template}`);
          console.log(`  Overwritten:${data.overwritten ? ' yes' : ' no'}`);
          console.log(chalk.dim(`Next: eforge extension validate ${data.name}`));
          console.log(chalk.dim('Next: eforge extension reload'));
        }
      } catch (err) {
        const { message, exitCode } = formatCliError(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(exitCode);
      }
    });

  extension
    .command('reload')
    .description('Reload native extension discovery and restart the daemon watcher when running')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      try {
        const { data } = await apiReloadExtensions({ cwd: process.cwd() });
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(chalk.green('✔') + ' Extensions reloaded');
          console.log(`  Watcher was running: ${data.watcher.wasRunning}`);
          console.log(`  Watcher restarted:   ${data.watcher.restarted}`);
          console.log(`  Watcher running:     ${data.watcher.running}`);
          console.log(`  Diagnostics:         ${data.diagnostics.length}`);
          console.log(`  Message:             ${data.watcher.message}`);
        }
      } catch (err) {
        const { message, exitCode } = formatCliError(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(exitCode);
      }
    });

  extension
    .command('trust <nameOrPath>')
    .description('Trust a project-team native extension by name or path')
    .option('--trusted-by <identity>', 'Optional annotation identifying who is trusting the extension')
    .option('--json', 'Output JSON')
    .action(async (nameOrPath: string, options: { trustedBy?: string; json?: boolean }) => {
      try {
        const body: { name?: string; path?: string; trustedBy?: string } = isExtensionPathArg(nameOrPath)
          ? { path: nameOrPath }
          : { name: nameOrPath };
        if (options.trustedBy) body.trustedBy = options.trustedBy;
        const { data } = await apiTrustExtension({ cwd: process.cwd(), body });
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(chalk.green('✔') + ` Extension ${data.extension.name} trusted`);
          if (data.extension.currentHash) console.log(`  Hash:    ${data.extension.currentHash}`);
          if (data.extension.trustedAt) console.log(`  At:      ${data.extension.trustedAt}`);
          if (data.extension.trustedBy) console.log(`  By:      ${data.extension.trustedBy}`);
          console.log(chalk.dim(data.message));
        }
      } catch (err) {
        const { message, exitCode } = formatCliError(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(exitCode);
      }
    });

  extension
    .command('untrust <nameOrPath>')
    .description('Remove trust for a project-team native extension by name or path')
    .option('--json', 'Output JSON')
    .action(async (nameOrPath: string, options: { json?: boolean }) => {
      try {
        const body: { name?: string; path?: string } = isExtensionPathArg(nameOrPath)
          ? { path: nameOrPath }
          : { name: nameOrPath };
        const { data } = await apiUntrustExtension({ cwd: process.cwd(), body });
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(chalk.green('✔') + ` Extension ${data.extension.name} untrusted`);
          if (data.extension.currentHash) console.log(`  Hash:    ${data.extension.currentHash}`);
          console.log(chalk.dim(data.message));
        }
      } catch (err) {
        const { message, exitCode } = formatCliError(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(exitCode);
      }
    });

  extension
    .command('install <source>')
    .description('Install a native extension package from an npm package, local path, or tarball')
    .option('--scope <scope>', 'Extension scope: local, project, or user')
    .option('--name <name>', 'Logical extension name override')
    .option('--force', 'Overwrite an existing extension at the target scope')
    .option('--trust', 'Trust the extension after install (project-team scope only)')
    .option('--trusted-by <identity>', 'Optional annotation identifying who is trusting the extension')
    .option('--json', 'Output JSON')
    .action(async (source: string, options: { scope?: string; name?: string; force?: boolean; trust?: boolean; trustedBy?: string; json?: boolean }) => {
      try {
        if (options.scope !== undefined && !['local', 'project', 'user'].includes(options.scope)) {
          throw new Error('--scope must be one of: local, project, user');
        }
        const body: ExtensionInstallRequest = { source };
        if (options.scope !== undefined) body.scope = options.scope as ExtensionInstallRequest['scope'];
        if (options.name !== undefined) body.name = options.name;
        if (options.force !== undefined) body.force = options.force;
        if (options.trust !== undefined) body.trust = options.trust;
        if (options.trustedBy !== undefined) body.trustedBy = options.trustedBy;
        const { data }: { data: ExtensionInstallResponse } = await apiInstallExtension({ cwd: process.cwd(), body });
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(chalk.green('✔') + ` Extension ${data.extension.name} installed`);
          console.log(`  Scope:  ${data.extension.scope}`);
          console.log(`  Path:   ${data.extension.path}`);
          if (data.extension.install?.sourceKind) console.log(`  From:   ${data.extension.install.sourceKind}:${data.extension.install.sourceSpec ?? ''}`);
          console.log(chalk.dim(data.message));
          renderInstallNextSteps(data.extension);
        }
      } catch (err) {
        const { message, exitCode } = formatCliError(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(exitCode);
      }
    });

  extension
    .command('update <name>')
    .description('Update an installed extension package to the latest version')
    .option('--version <specifier>', 'Version specifier or dist-tag for npm-installed extensions')
    .option('--trust', 'Trust the extension after update (project-team scope only)')
    .option('--trusted-by <identity>', 'Optional annotation identifying who is trusting the extension')
    .option('--json', 'Output JSON')
    .action(async (name: string, options: { version?: string; trust?: boolean; trustedBy?: string; json?: boolean }) => {
      try {
        const body: ExtensionUpdateRequest = { name };
        if (options.version !== undefined) body.version = options.version;
        if (options.trust !== undefined) body.trust = options.trust;
        if (options.trustedBy !== undefined) body.trustedBy = options.trustedBy;
        const { data }: { data: ExtensionUpdateResponse } = await apiUpdateExtension({ cwd: process.cwd(), body });
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(chalk.green('✔') + ` Extension ${data.extension.name} updated`);
          if (data.previousVersion) console.log(`  Previous version: ${data.previousVersion}`);
          if (data.extension.install?.sourceKind) console.log(`  From:   ${data.extension.install.sourceKind}:${data.extension.install.sourceSpec ?? ''}`);
          console.log(chalk.dim(data.message));
          renderInstallNextSteps(data.extension);
        }
      } catch (err) {
        const { message, exitCode } = formatCliError(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(exitCode);
      }
    });

  extension
    .command('remove <name>')
    .description('Remove an installed extension package')
    .option('--force', 'Remove without confirmation')
    .option('--json', 'Output JSON')
    .action(async (name: string, options: { force?: boolean; json?: boolean }) => {
      try {
        const body: { name: string; force?: boolean } = { name };
        if (options.force !== undefined) body.force = options.force;
        const { data }: { data: ExtensionRemoveResponse } = await apiRemoveExtension({ cwd: process.cwd(), body });
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(chalk.green('✔') + ' Extension removed');
          console.log(chalk.dim(data.message));
          console.log(chalk.dim('Next: eforge extension reload'));
        }
      } catch (err) {
        const { message, exitCode } = formatCliError(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(exitCode);
      }
    });

  extension
    .command('promote <name>')
    .description('Promote a project-local extension to project-team scope')
    .option('--force', 'Overwrite an existing extension at project-team scope')
    .option('--trust', 'Trust the extension after promotion')
    .option('--trusted-by <identity>', 'Optional annotation identifying who is trusting the extension')
    .option('--json', 'Output JSON')
    .action(async (name: string, options: { force?: boolean; trust?: boolean; trustedBy?: string; json?: boolean }) => {
      try {
        const body: { name: string; force?: boolean; trust?: boolean; trustedBy?: string } = { name };
        if (options.force !== undefined) body.force = options.force;
        if (options.trust !== undefined) body.trust = options.trust;
        if (options.trustedBy !== undefined) body.trustedBy = options.trustedBy;
        const { data }: { data: ExtensionPromoteResponse } = await apiPromoteExtension({ cwd: process.cwd(), body });
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(chalk.green('✔') + ` Extension ${data.extension.name} promoted to project-team`);
          console.log(`  Scope:  ${data.extension.scope}`);
          console.log(`  Path:   ${data.extension.path}`);
          console.log(chalk.dim(data.message));
          renderInstallNextSteps(data.extension);
        }
      } catch (err) {
        const { message, exitCode } = formatCliError(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(exitCode);
      }
    });

  extension
    .command('demote <name>')
    .description('Demote a project-team extension to project-local scope')
    .option('--force', 'Overwrite an existing extension at project-local scope')
    .option('--json', 'Output JSON')
    .action(async (name: string, options: { force?: boolean; json?: boolean }) => {
      try {
        const body: { name: string; force?: boolean } = { name };
        if (options.force !== undefined) body.force = options.force;
        const { data }: { data: ExtensionDemoteResponse } = await apiDemoteExtension({ cwd: process.cwd(), body });
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
        } else {
          console.log(chalk.green('✔') + ` Extension ${data.extension.name} demoted to project-local`);
          console.log(`  Scope:  ${data.extension.scope}`);
          console.log(`  Path:   ${data.extension.path}`);
          console.log(chalk.dim(data.message));
          console.log(chalk.dim(`Next: eforge extension validate ${data.extension.name}`));
          console.log(chalk.dim('Next: eforge extension reload'));
        }
      } catch (err) {
        const { message, exitCode } = formatCliError(err);
        console.error(chalk.red(`Error: ${message}`));
        process.exit(exitCode);
      }
    });

  registerExtensionContributionCommands(extension);

  // Config commands
  const config = program
    .command('config')
    .description('Manage eforge configuration');

  config
    .command('validate')
    .description('Validate eforge/config.yaml configuration')
    .action(async () => {
      const { validateConfigFile } = await import('@eforge-build/engine/config');
      const result = await validateConfigFile();
      if (result.valid) {
        console.log(chalk.green('✔') + ' Config valid');
      } else {
        console.error(chalk.red('✘') + ' Config invalid:');
        for (const err of result.errors) {
          console.error(chalk.red(`  - ${err}`));
        }
        process.exit(1);
      }
    });

  config
    .command('show')
    .description('Show resolved eforge configuration')
    .action(async () => {
      const { loadConfig } = await import('@eforge-build/engine/config');
      const { stringify } = await import('yaml');
      const { config: resolved, warnings: configWarnings } = await loadConfig();
      for (const warning of configWarnings) {
        process.stderr.write(`${warning}\n`);
      }
      console.log(stringify(resolved));
    });

  // Diagnostic commands
  registerDebugComposerCommand(program);

  // Daemon commands
  const daemon = program
    .command('daemon')
    .description('Manage persistent daemon server');

  // --- eforge:region daemon-lifecycle-commands ---
  setDaemonStartAction(addDaemonStartOptions(daemon
    .command('start')
    .description('Start the persistent daemon server')));

  setDaemonStopAction(addDaemonStopOptions(daemon
    .command('stop')
    .description('Stop the persistent daemon server')));

  setDaemonRestartAction(addDaemonStopOptions(daemon
    .command('restart')
    .description('Restart the persistent daemon server')));

  setDaemonStartAction(addDaemonStartOptions(program
    .command('ignite')
    .description('Playful alias for `eforge daemon start`')));

  setDaemonStopAction(addDaemonStopOptions(program
    .command('douse')
    .description('Playful alias for `eforge daemon stop`')));

  setDaemonRestartAction(addDaemonStopOptions(program
    .command('reignite')
    .description('Playful alias for `eforge daemon restart`')));
  // --- eforge:endregion daemon-lifecycle-commands ---

  daemon
    .command('status')
    .description('Show daemon status')
    .action(async () => {
      const cwd = process.cwd();
      const lock = readLockfile(cwd);

      if (!lock) {
        console.log(chalk.dim('Daemon is not running'));
        process.exit(0);
      }

      const alive = await isServerAlive(lock);
      if (!alive) {
        removeLockfile(cwd);
        console.log(chalk.yellow('Daemon is not running (stale lockfile removed)'));
        process.exit(0);
      }

      const startedAt = new Date(lock.startedAt);
      const uptimeMs = Date.now() - startedAt.getTime();
      const uptimeSec = Math.floor(uptimeMs / 1000);
      const uptimeMin = Math.floor(uptimeSec / 60);
      const uptimeHr = Math.floor(uptimeMin / 60);

      let uptimeStr: string;
      if (uptimeHr > 0) {
        uptimeStr = `${uptimeHr}h ${uptimeMin % 60}m`;
      } else if (uptimeMin > 0) {
        uptimeStr = `${uptimeMin}m ${uptimeSec % 60}s`;
      } else {
        uptimeStr = `${uptimeSec}s`;
      }

      // Check running builds via DB
      let runningCount = 0;
      try {
        const { openDatabase } = await import('@eforge-build/monitor/db');
        const dbPath = resolve(cwd, '.eforge', 'monitor.db');
        const db = openDatabase(dbPath);
        runningCount = db.getRunningRuns().length;
        db.close();
      } catch {
        // DB may not exist
      }

      console.log(chalk.bold('Daemon Status'));
      console.log(`  Port:    ${lock.port}`);
      console.log(`  PID:     ${lock.pid}`);
      console.log(`  URL:     http://localhost:${lock.port}`);
      console.log(`  Uptime:  ${uptimeStr}`);
      console.log(`  Builds:  ${runningCount} running`);
    });

  daemon
    .command('kill')
    .description('Force-kill the daemon (SIGKILL)')
    .action(async () => {
      const cwd = process.cwd();
      const lock = readLockfile(cwd);

      if (!lock) {
        console.log(chalk.yellow('No daemon tracked for this repo'));
        console.log(chalk.dim('Hint: ps aux | grep eforge'));
        process.exit(0);
      }

      const killed: string[] = [];

      // SIGKILL daemon PID — kills the in-process watcher with it
      if (killPidIfAlive(lock.pid, 'SIGKILL')) {
        killed.push(`daemon (PID ${lock.pid})`);
      }

      removeLockfile(cwd);

      if (killed.length > 0) {
        console.log(chalk.green(`Killed: ${killed.join(', ')}`));
      } else {
        console.log(chalk.yellow('No running processes found (lockfile removed)'));
      }
    });

  program
    .command('recover <setName> <prdId>')
    .description('Analyse a failed build and write recovery sidecar files')
    .option('--cwd <cwd>', 'Working directory override')
    .option('--verbose', 'Stream agent output')
    .option('--no-monitor', 'Disable web monitor')
    .action(
      async (
        setName: string,
        prdId: string,
        options: {
          cwd?: string;
          verbose?: boolean;
          monitor?: boolean;
        },
      ) => {
        initDisplay({ verbose: options.verbose });

        const cwd = options.cwd ? resolve(options.cwd) : undefined;

        const engine = await EforgeEngine.create({ ...(cwd && { cwd }) });

        try {
          await withMonitor(options.monitor === false, async (monitor) => {
            const sessionId = randomUUID();

            const recoverEvents = engine.recover(setName, prdId, {
              verbose: options.verbose,
              abortController,
              ...(cwd && { cwd }),
            });

            await consumeEvents(
              wrapEvents(runSession(recoverEvents, sessionId), {
                monitor,
                hooks: engine.resolvedConfig.hooks,
                native: {
                  registry: engine.nativeExtensionRegistry,
                  timeoutMs: engine.resolvedConfig.extensions.eventHookTimeoutMs,
                  configDir: engine.nativeExtensionConfigDir,
                  ...(cwd && { cwd }),
                },
              }),
            );
          });
        } catch (err) {
          const { message, exitCode } = formatCliError(err);
          console.error(chalk.red(`Error: ${message}`));
          process.exit(exitCode);
        }
      },
    );

  program
    .command('apply-recovery <prdId>')
    .description('Apply the recovery verdict for a failed build plan (retry from scratch, continue-and-repair, abandon, or manual)')
    .option('--cwd <cwd>', 'Working directory override')
    .option('--no-monitor', 'Disable web monitor')
    .action(
      async (
        prdId: string,
        options: {
          cwd?: string;
          monitor?: boolean;
        },
      ) => {
        initDisplay({});

        const cwd = options.cwd ? resolve(options.cwd) : undefined;

        const engine = await EforgeEngine.create({ ...(cwd && { cwd }) });

        try {
          await withMonitor(options.monitor === false, async (monitor) => {
            const sessionId = randomUUID();

            const applyEvents = engine.applyRecovery(prdId);

            await consumeEvents(
              wrapEvents(runSession(applyEvents, sessionId), {
                monitor,
                hooks: engine.resolvedConfig.hooks,
                native: {
                  registry: engine.nativeExtensionRegistry,
                  timeoutMs: engine.resolvedConfig.extensions.eventHookTimeoutMs,
                  configDir: engine.nativeExtensionConfigDir,
                  ...(cwd && { cwd }),
                },
              }),
            );
          });
        } catch (err) {
          const { message, exitCode } = formatCliError(err);
          console.error(chalk.red(`Error: ${message}`));
          process.exit(exitCode);
        }
      },
    );

  program
    .command('continue-repair <prdId>')
    .description('Continue and repair build from preserved compiled artifacts')
    .option('--set-name <setName>', 'Override the set name; when omitted, resolved from recovery sidecar or derived from the prdId')
    .option('--profile <name>', 'Override active profile for this continue-and-repair build')
    .option('--cwd <cwd>', 'Working directory override')
    .option('--verbose', 'Print additional queued metadata')
    .action(
      async (
        prdId: string,
        options: {
          setName?: string;
          profile?: string;
          cwd?: string;
          verbose?: boolean;
        },
      ) => {
        initDisplay({ verbose: options.verbose });

        const cwd = options.cwd ? resolve(options.cwd) : process.cwd();

        let monitor: Monitor | undefined;
        try {
          monitor = await ensureMonitor(cwd, { noServer: false });
          activeMonitor = monitor;
          const body: ContinueRepairRequest = { prdId };
          if (options.setName !== undefined) body.setName = options.setName;
          if (options.profile !== undefined) body.profile = options.profile;
          const { data } = await apiContinueRepair({ cwd, body });
          console.log(chalk.green(`Continue and repair build queued: ${data.prdId}`));
          console.log(`Set: ${data.setName}`);
          console.log(`Feature branch: ${data.featureBranch}`);
          console.log(`Base branch: ${data.baseBranch}`);
          if (data.profile) console.log(`Profile: ${data.profile}`);
          if (data.movedDescendantIds.length > 0 || options.verbose) {
            console.log(`Moved descendants: ${data.movedDescendantIds.length > 0 ? data.movedDescendantIds.join(', ') : 'none'}`);
          }
          if (data.status === 'already-queued') console.log(chalk.yellow(data.detail ?? 'Continue-and-repair build was already queued.'));
        } catch (err) {
          const { message, exitCode } = formatCliError(err);
          console.error(chalk.red(`Error: ${message}`));
          process.exitCode = exitCode;
          return;
        } finally {
          if (monitor) {
            try {
              monitor.stop();
            } finally {
              if (activeMonitor === monitor) activeMonitor = undefined;
            }
          }
        }
      },
    );


  // MCP proxy command — runs the stdio MCP server that bridges to the daemon
  program
    .command('mcp-proxy')
    .description('Run the MCP stdio proxy server (used by Claude Code plugin)')
    .action(async () => {
      process.title = 'eforge-mcp';
      const { runMcpProxy } = await import('./mcp-proxy.js');
      await runMcpProxy(process.cwd());
    });

  {
    const stackCmd = program.command('stack').description('Stack management commands');

    stackCmd
      .command('sync')
      .description('Sync the git-spice stack with remote and restack eligible branches')
      .option('--dry-run', 'Show what commands would run without executing them')
      .option('--cwd <cwd>', 'Working directory override')
      .action(async (options: { dryRun?: boolean; cwd?: string }) => {
        const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
        const dryRun = options.dryRun === true;
        const inWorktree = isAgentWorktreeCwd(cwd);

        try {
          // Wet sync always requires the daemon — never run local mutation
          // from agent worktrees, and auto-start the daemon for normal roots.
          if (!dryRun) {
            if (inWorktree) {
              // Agent worktree: discover project-root daemon via git common dir.
              const worktreeResult = await daemonRequestFromWorktree<StackSyncResponse>(
                cwd,
                'POST',
                API_ROUTES.stackSync,
                { trigger: 'manual' },
              );
              if (worktreeResult !== null) {
                renderStackSyncReport(worktreeResult.data, dryRun);
                const { outcome } = worktreeResult.data;
                process.exit(outcome === 'failed' || outcome === 'conflict' ? 1 : 0);
                return;
              }
              // No discoverable daemon for this worktree
              throw new DaemonNotDiscoverableError(
                cwd,
                'no running daemon found at the project root; start eforge daemon from the project root first',
              );
            } else {
              // Normal project root: auto-start daemon and run through it.
              const daemonResult = await apiStackSync({ cwd, body: { trigger: 'manual' } });
              renderStackSyncReport(daemonResult.data, dryRun);
              const { outcome } = daemonResult.data;
              process.exit(outcome === 'failed' || outcome === 'conflict' ? 1 : 0);
              return;
            }
          }

          // Dry-run path: prefer live daemon, fall back to local (without
          // active-build knowledge when daemon is not running).
          const daemonResult = await (inWorktree
            ? daemonRequestFromWorktree<StackSyncResponse>(cwd, 'POST', API_ROUTES.stackSync, { dryRun: true })
            : apiStackSyncIfRunning({ cwd, body: { dryRun: true } }));

          if (daemonResult !== null) {
            renderStackSyncReport(daemonResult.data, dryRun);
            process.exit(daemonResult.data.outcome === 'failed' || daemonResult.data.outcome === 'conflict' ? 1 : 0);
            return;
          }

          if (inWorktree) {
            // Agent worktree with no daemon: dry-run is safe locally but lacks active-build knowledge.
            console.log(chalk.yellow('Note: running dry-run locally (no daemon found via git common dir) — active-build exclusions are not available.'));
          }

          // Local in-process dry-run fallback (non-worktree or worktree with no daemon).
          const { loadConfig } = await import('@eforge-build/engine/config');
          const { config } = await loadConfig(cwd);

          if (!config.stacking.enabled) {
            const skippedReport: StackSyncResponse = {
              outcome: 'skipped',
              reason: 'Stacking is not enabled. Set stacking.enabled: true in eforge/config.yaml to activate.',
              stackingActive: false,
              dryRun,
              activeBuildSkips: [],
              providerCommands: [],
              restackCandidates: [],
            };
            renderStackSyncReport(skippedReport, dryRun);
            return;
          }

          const { performStackSync } = await import('@eforge-build/engine/stacking/sync');
          const report = await performStackSync(config, { cwd, dryRun });
          const fullReport: StackSyncResponse = { ...report, activeBuildSkips: [] };
          renderStackSyncReport(fullReport, dryRun);
          process.exit(report.outcome === 'failed' || report.outcome === 'conflict' ? 1 : 0);
        } catch (err) {
          if (err instanceof DaemonNotDiscoverableError) {
            console.error(chalk.red(`Error: ${err.message}`));
            process.exit(1);
            return;
          }
          const { message, exitCode } = formatCliError(err);
          console.error(chalk.red(`Error: ${message}`));
          process.exit(exitCode);
        }
      });
  }

  return program;
}

export async function run(): Promise<void> {
  const abortController = setupSignalHandlers();
  const program = createProgram(abortController);
  await program.parseAsync();
}

/**
 * Factory function for the eforge Commander program tree.
 * Exported for programmatic use (docs-gen, testing) — builds the full command
 * hierarchy without executing or parsing args. An optional `version` override
 * can be supplied when the caller does not have access to the baked-in
 * EFORGE_VERSION define constant.
 */
export function buildEforgeCommand(options?: { version?: string }): Command {
  return createProgram(undefined, options?.version);
}
