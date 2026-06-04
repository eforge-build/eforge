/**
 * Split static wiring tests for native extension tooling surfaces.
 */

import { describe, it, expect } from 'vitest';
import { API_ROUTES, EFORGE_EXTENSION_ACTIONS, dispatchEforgeExtensionAction, type EforgeExtensionAction, type EforgeExtensionActionHelpers, type EforgeExtensionActionParams } from '@eforge-build/client';
import { createProgram } from '../packages/eforge/src/cli/index.js';
import { escapeRegExp, readRepoFile } from './extension-tooling-wiring-helpers.js';
describe('CLI enqueue preprocessing wiring', () => {
  const cliIndexSource = readRepoFile('packages/eforge/src/cli/index.ts');

  function preprocessAndEnqueueBlock(): string {
    const blockStart = cliIndexSource.indexOf('async function* preprocessAndEnqueue');
    const blockEnd = cliIndexSource.indexOf('\n          await consumeEvents(', blockStart);
    expect(blockStart).toBeGreaterThanOrEqual(0);
    expect(blockEnd).toBeGreaterThan(blockStart);
    return cliIndexSource.slice(blockStart, blockEnd);
  }

  it('imports preprocessBuildSource and FatalPreprocessingError from @eforge-build/input', () => {
    expect(cliIndexSource).toContain("from '@eforge-build/input'");
    expect(cliIndexSource).toContain('preprocessBuildSource');
    expect(cliIndexSource).toContain('FatalPreprocessingError');
  });

  it('calls preprocessBuildSource with registry inputSources and prdEnrichers', () => {
    expect(cliIndexSource).toContain('nativeExtensionRegistry.inputSources');
    expect(cliIndexSource).toContain('nativeExtensionRegistry.prdEnrichers');
  });

  it('yields provenance events before yielding from engine.enqueue', () => {
    // The preprocessing wrapper function must yield events before delegating to engine.enqueue
    const preprocessBlock = preprocessAndEnqueueBlock();
    expect(preprocessBlock).toContain('preprocessResult.events');
    expect(preprocessBlock).toContain('yield { ...event, timestamp }');
    expect(preprocessBlock).toContain('engine.enqueue(normalizedSource');
    // Events must come before engine.enqueue in the code
    const eventsIdx = preprocessBlock.indexOf('preprocessResult.events');
    const enqueueIdx = preprocessBlock.indexOf('engine.enqueue(normalizedSource');
    expect(eventsIdx).toBeLessThan(enqueueIdx);
  });

  it('on FatalPreprocessingError yields diagnostic event and enqueue:failed without calling engine', () => {
    const preprocessBlock = preprocessAndEnqueueBlock();
    expect(preprocessBlock).toContain('FatalPreprocessingError');
    expect(preprocessBlock).toContain("'enqueue:failed'");
    expect(preprocessBlock).toContain('err.diagnosticEvent');
    expect(preprocessBlock).toContain('return;');
  });
});

describe('extension tooling route constants and helpers', () => {
  it('declares extension route constants', () => {
    expect(API_ROUTES.extensionList).toBe('/api/extensions/list');
    expect(API_ROUTES.extensionShow).toBe('/api/extensions/show');
    expect(API_ROUTES.extensionValidate).toBe('/api/extensions/validate');
    expect(API_ROUTES.extensionTest).toBe('/api/extensions/test');
    expect(API_ROUTES.extensionNew).toBe('/api/extensions/new');
    expect(API_ROUTES.extensionReload).toBe('/api/extensions/reload');
    expect(API_ROUTES.extensionTrust).toBe('/api/extensions/trust');
    expect(API_ROUTES.extensionUntrust).toBe('/api/extensions/untrust');
  });

  it('client helpers call shared extension route constants', () => {
    const source = readRepoFile('packages/client/src/api/extensions.ts');
    expect(source).toContain('API_ROUTES.extensionList');
    expect(source).toContain('API_ROUTES.extensionShow');
    expect(source).toContain('API_ROUTES.extensionValidate');
    expect(source).toContain('API_ROUTES.extensionTest');
    expect(source).toContain('API_ROUTES.extensionNew');
    expect(source).toContain('API_ROUTES.extensionReload');
    expect(source).toContain('API_ROUTES.extensionTrust');
    expect(source).toContain('API_ROUTES.extensionUntrust');
    expect(source).not.toContain("'/api/extensions/");
    expect(source).not.toContain('"/api/extensions/');
    expect(source).toContain('apiNewExtension');
    expect(source).toContain('apiReloadExtensions');
    expect(source).toContain('apiTestExtension');
    expect(source).toContain('apiTrustExtension');
    expect(source).toContain('apiUntrustExtension');
  });

  it('declares package-operation route constants without inline path literals', () => {
    expect(API_ROUTES.extensionInstall).toBe('/api/extensions/install');
    expect(API_ROUTES.extensionUpdate).toBe('/api/extensions/update');
    expect(API_ROUTES.extensionRemove).toBe('/api/extensions/remove');
    expect(API_ROUTES.extensionPromote).toBe('/api/extensions/promote');
    expect(API_ROUTES.extensionDemote).toBe('/api/extensions/demote');
  });

  it('client helpers call package-operation route constants and not inline literals', () => {
    const source = readRepoFile('packages/client/src/api/extensions.ts');
    expect(source).toContain('API_ROUTES.extensionInstall');
    expect(source).toContain('API_ROUTES.extensionUpdate');
    expect(source).toContain('API_ROUTES.extensionRemove');
    expect(source).toContain('API_ROUTES.extensionPromote');
    expect(source).toContain('API_ROUTES.extensionDemote');
    // No inline path literals allowed.
    expect(source).not.toContain("'/api/extensions/");
    expect(source).not.toContain('"/api/extensions/');
    expect(source).toContain('apiInstallExtension');
    expect(source).toContain('apiUpdateExtension');
    expect(source).toContain('apiRemoveExtension');
    expect(source).toContain('apiPromoteExtension');
    expect(source).toContain('apiDemoteExtension');
    expect(source).toContain('apiInstallExtensionIfRunning');
    expect(source).toContain('apiUpdateExtensionIfRunning');
    expect(source).toContain('apiRemoveExtensionIfRunning');
    expect(source).toContain('apiPromoteExtensionIfRunning');
    expect(source).toContain('apiDemoteExtensionIfRunning');
  });

  it('client index exports package-operation helpers and request/response types', async () => {
    const client = await import('@eforge-build/client');
    const source = readRepoFile('packages/client/src/index.ts');
    for (const name of [
      'apiInstallExtension', 'apiUpdateExtension', 'apiRemoveExtension',
      'apiPromoteExtension', 'apiDemoteExtension',
      'apiInstallExtensionIfRunning', 'apiUpdateExtensionIfRunning',
      'apiRemoveExtensionIfRunning', 'apiPromoteExtensionIfRunning',
      'apiDemoteExtensionIfRunning',
    ] as const) {
      expect(client[name], name).toBeTypeOf('function');
      expect(source, name).toContain(name);
    }
    for (const name of [
      'ExtensionPackageProvenance', 'ExtensionInstallProvenance',
      'ExtensionInstallRequest', 'ExtensionInstallResponse',
      'ExtensionUpdateRequest', 'ExtensionUpdateResponse',
      'ExtensionRemoveRequest', 'ExtensionRemoveResponse',
      'ExtensionPromoteRequest', 'ExtensionPromoteResponse',
      'ExtensionDemoteRequest', 'ExtensionDemoteResponse',
    ]) {
      expect(source, name).toContain(name);
    }
  });

  it('client browser entrypoint exports provenance and operation wire types but no helpers', () => {
    const source = readRepoFile('packages/client/src/browser.ts');
    for (const name of [
      'ExtensionPackageProvenance', 'ExtensionInstallProvenance',
      'ExtensionInstallRequest', 'ExtensionInstallResponse',
      'ExtensionUpdateRequest', 'ExtensionUpdateResponse',
      'ExtensionRemoveRequest', 'ExtensionRemoveResponse',
      'ExtensionPromoteRequest', 'ExtensionPromoteResponse',
      'ExtensionDemoteRequest', 'ExtensionDemoteResponse',
    ]) {
      expect(source, name).toContain(name);
    }
    // Browser entrypoint must not export Node.js client helpers.
    expect(source).not.toContain('apiInstallExtension');
    expect(source).not.toContain('daemonRequest');
  });

  it('install request types carry typed trust and trustedBy fields', () => {
    const source = readRepoFile('packages/client/src/types.ts');
    // Verify trust/trustedBy are actual typed fields on install and update request types.
    const installIdx = source.indexOf('ExtensionInstallRequest');
    const updateIdx = source.indexOf('ExtensionUpdateRequest');
    const installBlock = source.slice(installIdx, source.indexOf('ExtensionInstallResponse', installIdx));
    const updateBlock = source.slice(updateIdx, source.indexOf('ExtensionUpdateResponse', updateIdx));
    expect(installBlock).toMatch(/\btrust\?: boolean;/);
    expect(installBlock).toMatch(/\btrustedBy\?: string;/);
    expect(updateBlock).toMatch(/\btrust\?: boolean;/);
    expect(updateBlock).toMatch(/\btrustedBy\?: string;/);
  });

  it('extension response projectors map provenance into ExtensionEntry package and install fields', () => {
    const monitorSource = readRepoFile('packages/monitor/src/routes/extensions/discovery-service.ts');
    const loadResponseStart = monitorSource.indexOf('function candidateToEntry');
    const loadResponseEnd = monitorSource.indexOf('export async function loadExtensionResponse', loadResponseStart);
    const loadResponseBlock = monitorSource.slice(loadResponseStart, loadResponseEnd);
    expect(loadResponseBlock).toMatch(/package:\s*\{\s*\.\.\.candidate\.packageProvenance\s*\}/);
    expect(loadResponseBlock).toMatch(/install:\s*\{\s*\.\.\.candidate\.installProvenance\s*\}/);

    const replaySource = readRepoFile('packages/engine/src/extensions/replay.ts');
    const projectExtensionsBlock = replaySource.slice(
      replaySource.indexOf('function projectExtensions'),
      replaySource.indexOf('function summarizeDeferredRegistrations'),
    );
    expect(projectExtensionsBlock).toMatch(/package:\s*\{\s*\.\.\.candidate\.packageProvenance\s*\}/);
    expect(projectExtensionsBlock).toMatch(/install:\s*\{\s*\.\.\.candidate\.installProvenance\s*\}/);
  });
});

describe('CLI extension command registration', () => {
  const source = readRepoFile('packages/eforge/src/cli/index.ts');

  function extensionCommand(name: string) {
    const program = createProgram(undefined, 'test');
    const extension = program.commands.find((command) => command.name() === 'extension');
    const command = extension?.commands.find((candidate) => candidate.name() === name);
    expect(command, name).toBeDefined();
    return command!;
  }

  function extensionCommandBlock(command: string, nextCommand?: string): string {
    const start = source.indexOf(`.command('${command}`);
    expect(start, command).toBeGreaterThanOrEqual(0);
    const end = nextCommand === undefined ? source.indexOf('\n  // Config commands', start) : source.indexOf(`.command('${nextCommand}`, start);
    expect(end, command).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  function expectOptions(command: string, flags: string[]): void {
    const actual = extensionCommand(command).options.map((option) => option.flags);
    for (const flag of flags) {
      expect(actual, `${command} ${flag}`).toContain(flag);
    }
  }

  it('registers eforge extension management and contribution commands on the actual Commander program', () => {
    const program = createProgram(undefined, 'test');
    const extension = program.commands.find((command) => command.name() === 'extension');
    expect(extension).toBeDefined();
    expect(extension?.commands.map((command) => command.name()).sort()).toEqual(['contributions', 'demote', 'install', 'list', 'new', 'promote', 'reload', 'remove', 'show', 'test', 'trust', 'untrust', 'update', 'validate']);
  });

  it('declares the required show, validate, trust, untrust, install, update, remove, promote, and demote arguments', () => {
    expect(source).toContain(".command('show <name>')");
    expect(source).toContain(".command('validate [nameOrPath]')");
    expect(source).toContain(".command('test [nameOrPath]')");
    expect(source).toContain(".command('new <name>')");
    expect(source).toContain(".command('reload')");
    expect(source).toContain(".command('trust <nameOrPath>')");
    expect(source).toContain(".command('untrust <nameOrPath>')");
    expect(source).toContain(".command('install <source>')");
    expect(source).toContain(".command('update <name>')");
    expect(source).toContain(".command('remove <name>')");
    expect(source).toContain(".command('promote <name>')");
    expect(source).toContain(".command('demote <name>')");
  });

  it('declares replay and scaffold command options and forwards them to request bodies', () => {
    expectOptions('test', ['--run <run>', '--event <type>', '--fixture <path>', '--json']);
    const testBlock = extensionCommandBlock('test [nameOrPath]', 'new <name>');
    expect(testBlock).toContain('if (options.fixture !== undefined) body.fixture = options.fixture;');
    expect(testBlock).toContain('if (options.run !== undefined) body.run = options.run;');
    expect(testBlock).toContain('if (options.event !== undefined) body.event = options.event;');
    expect(testBlock).toContain('apiTestExtension({ cwd: process.cwd(), body })');

    expectOptions('new', ['--scope <scope>', '--template <template>', '--force', '--json']);
    const newBlock = extensionCommandBlock('new <name>', 'reload');
    expect(newBlock).toContain('body.scope = options.scope');
    expect(newBlock).toContain('body.template = options.template');
    expect(newBlock).toContain('body.force = options.force;');
    expect(newBlock).toContain('apiNewExtension({ cwd: process.cwd(), body })');
  });

  it('declares trust command options and forwards trustedBy to request bodies', () => {
    expectOptions('trust', ['--trusted-by <identity>', '--json']);
    const trustBlock = extensionCommandBlock('trust <nameOrPath>', 'untrust <nameOrPath>');
    expect(trustBlock).toContain('if (options.trustedBy) body.trustedBy = options.trustedBy;');
    expect(trustBlock).toContain('apiTrustExtension({ cwd: process.cwd(), body })');
  });

  it('declares package-management command options and forwards flags to request bodies', () => {
    expectOptions('install', ['--scope <scope>', '--name <name>', '--force', '--trust', '--trusted-by <identity>', '--json']);
    const installBlock = extensionCommandBlock('install <source>', 'update <name>');
    for (const field of ['scope', 'name', 'force', 'trust', 'trustedBy']) {
      expect(installBlock, `install ${field}`).toContain(`body.${field} = options.${field}`);
    }

    expectOptions('update', ['--trust', '--trusted-by <identity>', '--json']);
    const updateBlock = extensionCommandBlock('update <name>', 'remove <name>');
    expect(updateBlock).toContain('body.trust = options.trust;');
    expect(updateBlock).toContain('body.trustedBy = options.trustedBy;');

    expectOptions('remove', ['--force', '--json']);
    expect(extensionCommandBlock('remove <name>', 'promote <name>')).toContain('body.force = options.force;');

    expectOptions('promote', ['--force', '--trust', '--trusted-by <identity>', '--json']);
    const promoteBlock = extensionCommandBlock('promote <name>', 'demote <name>');
    for (const field of ['force', 'trust', 'trustedBy']) {
      expect(promoteBlock, `promote ${field}`).toContain(`body.${field} = options.${field}`);
    }

    expectOptions('demote', ['--force', '--json']);
    expect(extensionCommandBlock('demote <name>')).toContain('body.force = options.force;');
  });

  it('validate and test exit non-zero when the response is invalid', () => {
    expect(source).toContain('if (!data.valid) process.exit(1);');
    expect(source).toContain('apiTestExtension({ cwd: process.cwd(), body })');
  });
});

describe('CLI --after flag wiring', () => {
  it('eforge enqueue command declares --after <queue-id> option', () => {
    const cliIndexSource = readRepoFile('packages/eforge/src/cli/index.ts');
    // The enqueue command should register --after
    const enqueueBlock = cliIndexSource.slice(
      cliIndexSource.indexOf(".command('enqueue <source>')"),
      cliIndexSource.indexOf(".command('build [source]')"),
    );
    expect(enqueueBlock).toContain("--after <queue-id>");
    expect(enqueueBlock).toContain('afterQueueId: options.after');
  });

  it('eforge build command declares --after <queue-id> option', () => {
    const cliIndexSource = readRepoFile('packages/eforge/src/cli/index.ts');
    const buildBlock = cliIndexSource.slice(
      cliIndexSource.indexOf(".command('build [source]')"),
      cliIndexSource.indexOf(".command('monitor')"),
    );
    expect(buildBlock).toContain("--after <queue-id>");
    expect(buildBlock).toContain('afterQueueId: options.after');
  });

  it('run-or-delegate BuildRunOpts declares afterQueueId option', () => {
    const rodSource = readRepoFile('packages/eforge/src/cli/run-or-delegate.ts');
    expect(rodSource).toContain('afterQueueId?: string');
  });

  it('run-or-delegate daemon delegation path includes afterQueueId in apiEnqueue body', () => {
    const rodSource = readRepoFile('packages/eforge/src/cli/run-or-delegate.ts');
    expect(rodSource).toContain('afterQueueId: options.afterQueueId');
  });

  it('run-or-delegate in-process enqueue path passes afterQueueId to engine.enqueue', () => {
    const rodSource = readRepoFile('packages/eforge/src/cli/run-or-delegate.ts');
    // The afterQueueId spread must appear in the engine.enqueue call
    const enqueueCall = rodSource.slice(
      rodSource.indexOf('yield* engine.enqueue(normalizedSource,'),
      rodSource.indexOf('yield* engine.enqueue(normalizedSource,') + 800,
    );
    expect(enqueueCall).toContain('afterQueueId');
  });

  it('EnqueueRequest exposes optional afterQueueId field', () => {
    const routeCoreSource = readRepoFile('packages/client/src/routes/core.ts');
    expect(routeCoreSource).toContain('afterQueueId?: string');
    // Should be inside the EnqueueRequest interface
    const enqueueRequestBlock = routeCoreSource.slice(
      routeCoreSource.indexOf('export interface EnqueueRequest {'),
      routeCoreSource.indexOf('}', routeCoreSource.indexOf('export interface EnqueueRequest {')),
    );
    expect(enqueueRequestBlock).toContain('afterQueueId?: string');
  });

  it('EnqueueOptions exposes optional afterQueueId field', () => {
    const eventsSource = readRepoFile('packages/engine/src/events.ts');
    expect(eventsSource).toContain('afterQueueId?: string');
  });
});
