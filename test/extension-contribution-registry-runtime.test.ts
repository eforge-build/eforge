import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { getScopeDirectory, type ScopeResolverOpts } from '@eforge-build/scopes';
import {
  buildExtensionContributionManifest,
  dispatchExtensionAction,
  loadNativeExtensions,
  projectExtensionRegistry,
} from '@eforge-build/engine/extensions';

import { useTempDir } from './test-tmpdir.js';

// --- eforge:region plan-02-engine-registry-runtime ---
async function makeTree(root: string): Promise<ScopeResolverOpts> {
  process.env.XDG_CONFIG_HOME = resolve(root, 'xdg-config');
  const opts = { cwd: root, configDir: resolve(root, 'eforge') };
  await mkdir(resolve(getScopeDirectory('project-local', opts), 'extensions'), { recursive: true });
  await writeFile(resolve(root, 'package.json'), '{"type":"module"}\n', 'utf-8');
  return opts;
}

async function writeModule(path: string, body: string): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, body, 'utf-8');
}

async function loadFixture(root: string, modules: Record<string, string>) {
  const opts = await makeTree(root);
  const extensions = resolve(getScopeDirectory('project-local', opts), 'extensions');
  for (const [name, body] of Object.entries(modules)) await writeModule(resolve(extensions, name), body);
  return loadNativeExtensions({ cwd: opts.cwd, configDir: opts.configDir, config: { enabled: true, trustProjectExtensions: false } });
}

describe('extension contribution registry runtime', () => {
  const makeTempDir = useTempDir('extension-contribution-runtime-');
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  });

  it('records new contribution families, projects safe manifests, and dispatches actions', async () => {
    const result = await loadFixture(makeTempDir(), {
      'contrib.js': `import { Type } from '@eforge-build/extension-sdk';
      export default function extension(eforge) {
        eforge.registerAction({ id: 'hello', title: 'Hello', inputSchema: Type.Object({ name: Type.String() }), outputSchema: Type.Object({ greeting: Type.String() }), sideEffects: ['none'], handler: (input) => ({ greeting: 'hi ' + input.name }) });
        eforge.registerConsoleContribution({ id: 'panel', title: 'Panel', blocks: [{ rendererId: 'action-button', content: 'Run', action: { actionId: 'hello', inputDefaults: { name: 'Ada' } } }] });
        eforge.registerIntegrationCommand({ id: 'say-hi', label: 'Say hi', action: { actionId: 'hello', inputDefaults: { name: 'Grace' } } });
        eforge.registerDeepLink({ id: 'open-hi', label: 'Open hi', urlTemplate: 'eforge://hi/{name}', action: { actionId: 'hello' } });
      }`,
    });

    expect(result.registry.actions[0]).toMatchObject({ localId: 'hello', id: 'contrib:hello' });
    expect(result.registry.consoleContributions[0]).toMatchObject({ localId: 'panel', id: 'contrib:panel' });
    expect(result.registry.integrationCommands[0]).toMatchObject({ localId: 'say-hi', id: 'contrib:say-hi' });
    expect(result.registry.deepLinks[0]).toMatchObject({ localId: 'open-hi', id: 'contrib:open-hi' });
    expect(result.registry.extensions[0]?.registrations).toMatchObject({ actions: 1, consoleContributions: 1, integrationCommands: 1, deepLinks: 1 });

    const manifest = buildExtensionContributionManifest(result.registry);
    expect(manifest.schemaVersion).toBe(1);
    expect(Date.parse(manifest.generatedAt)).not.toBeNaN();
    expect(manifest.consoleContributions[0]?.blocks[0]).toMatchObject({ action: { actionId: 'contrib:hello' } });
    expect(JSON.stringify(manifest)).not.toContain('handler');

    const projection = projectExtensionRegistry(result.registry);
    expect(projection.totals).toMatchObject({ actions: 1, consoleContributions: 1, integrationCommands: 1, deepLinks: 1 });
    expect(projection.extensions[0]).toMatchObject({ actionDetails: [{ id: 'contrib:hello' }], consoleContributionDetails: [{ id: 'contrib:panel' }] });

    const dispatched = await dispatchExtensionAction(result.registry, {
      actionId: 'contrib:hello',
      input: { name: 'Lin' },
      requestedBy: { host: 'cli' },
      cwd: makeTempDir(),
      timeoutMs: 1000,
      invocationId: 'invocation-1',
    });
    expect(dispatched).toMatchObject({ kind: 'success', output: { greeting: 'hi Lin' } });
  });

  it('emits invalid and duplicate diagnostics for unsafe contribution registrations', async () => {
    const result = await loadFixture(makeTempDir(), {
      'first.js': `export default function extension(eforge) {
        eforge.registerAction({ id: 'dup', title: 'First', inputSchema: { type: 'object', properties: {} }, handler: () => ({ ok: true }) });
        eforge.registerAction({ id: 'dup', title: 'Second', inputSchema: { type: 'object', properties: {} }, handler: () => ({ ok: true }) });
      }`,
      'bad.js': `export default function extension(eforge) {
        eforge.registerAction({ id: 'bad-schema', title: 'Bad', inputSchema: { type: 'string' }, handler: () => ({}) });
        eforge.registerConsoleContribution({ id: 'bad-panel', blocks: [{ rendererId: 'action-button', content: 'Run' }] });
        eforge.registerIntegrationCommand({ id: 'bad-command', label: 'Bad', action: { actionId: 'missing' } });
        eforge.registerDeepLink({ id: 'bad-link', label: 'Bad' });
      }`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'extension:invalid-registration').length).toBeGreaterThanOrEqual(4);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'extension:duplicate-registration', name: 'first:dup' }));
    expect(result.registry.actions.map((action) => action.id)).toEqual(['first:dup']);
  });

  it('separates symbol-keyed user data rejection from TypeBox schema metadata tolerance', async () => {
    const result = await loadFixture(makeTempDir(), {
      'symbols.js': `import { Type } from '@eforge-build/extension-sdk';
      export default function extension(eforge) {
        const symbolDefaults = { visible: true };
        symbolDefaults[Symbol('secret')] = 'hidden';
        const symbolArrayDefaults = { values: ['visible'] };
        symbolArrayDefaults.values[Symbol('secret')] = 'hidden';
        const symbolArrayOutput = ['visible'];
        symbolArrayOutput[Symbol('secret')] = 'hidden';
        eforge.registerAction({ id: 'typed', title: 'Typed', inputSchema: Type.Readonly(Type.Object({ value: Type.Optional(Type.String()) })), handler: () => ({ ok: true }) });
        eforge.registerConsoleContribution({ id: 'unsafe', title: 'Unsafe', blocks: [{ rendererId: 'action-button', content: 'Run', action: { actionId: 'typed', inputDefaults: symbolDefaults } }] });
        eforge.registerConsoleContribution({ id: 'unsafe-array', title: 'Unsafe array', blocks: [{ rendererId: 'action-button', content: 'Run', action: { actionId: 'typed', inputDefaults: symbolArrayDefaults } }] });
        eforge.registerAction({ id: 'bad-output', title: 'Bad output', inputSchema: Type.Object({}), handler: () => symbolDefaults });
        eforge.registerAction({ id: 'bad-array-output', title: 'Bad array output', inputSchema: Type.Object({}), handler: () => symbolArrayOutput });
      }`,
    });

    expect(result.registry.actions.map((action) => action.id).sort()).toEqual(['symbols:bad-array-output', 'symbols:bad-output', 'symbols:typed']);
    expect(result.registry.consoleContributions).toHaveLength(0);
    const dispatched = await dispatchExtensionAction(result.registry, { actionId: 'symbols:bad-output', input: {}, requestedBy: { host: 'cli' }, cwd: makeTempDir(), timeoutMs: 1000 });
    expect(dispatched).toMatchObject({ kind: 'invalid-output' });
    const arrayDispatched = await dispatchExtensionAction(result.registry, { actionId: 'symbols:bad-array-output', input: {}, requestedBy: { host: 'cli' }, cwd: makeTempDir(), timeoutMs: 1000 });
    expect(arrayDispatched).toMatchObject({ kind: 'invalid-output' });
  });

  it('keeps first registrations and emits duplicate diagnostics for all contribution families', async () => {
    const result = await loadFixture(makeTempDir(), {
      'dupes.js': `export default function extension(eforge) {
        eforge.registerAction({ id: 'action-one', title: 'First action', inputSchema: { type: 'object', properties: {} }, handler: () => ({ winner: 'first' }) });
        eforge.registerAction({ id: 'action-one', title: 'Second action', inputSchema: { type: 'object', properties: {} }, handler: () => ({ winner: 'second' }) });
        eforge.registerConsoleContribution({ id: 'panel-one', title: 'First panel', blocks: [{ rendererId: 'text', content: 'first' }] });
        eforge.registerConsoleContribution({ id: 'panel-one', title: 'Second panel', blocks: [{ rendererId: 'text', content: 'second' }] });
        eforge.registerIntegrationCommand({ id: 'command-one', label: 'First command', action: { actionId: 'action-one' } });
        eforge.registerIntegrationCommand({ id: 'command-one', label: 'Second command', action: { actionId: 'action-one' } });
        eforge.registerDeepLink({ id: 'link-one', label: 'First link', urlTemplate: 'eforge://first', action: { actionId: 'action-one' } });
        eforge.registerDeepLink({ id: 'link-one', label: 'Second link', urlTemplate: 'eforge://second', action: { actionId: 'action-one' } });
      }`,
    });

    const duplicateDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === 'extension:duplicate-registration');
    expect(duplicateDiagnostics.map((diagnostic) => diagnostic.name).sort()).toEqual([
      'dupes:action-one',
      'dupes:command-one',
      'dupes:link-one',
      'dupes:panel-one',
    ]);
    expect(result.registry.actions).toHaveLength(1);
    expect(result.registry.consoleContributions).toHaveLength(1);
    expect(result.registry.integrationCommands).toHaveLength(1);
    expect(result.registry.deepLinks).toHaveLength(1);
    expect(buildExtensionContributionManifest(result.registry).deepLinks[0]).toMatchObject({ urlTemplate: 'eforge://first' });
  });

  it('rejects invalid registration shapes and unknown action bindings without crashing loading', async () => {
    const result = await loadFixture(makeTempDir(), {
      'invalids.js': `export default function extension(eforge) {
        eforge.registerAction(null);
        eforge.registerAction({ id: '1bad', title: 'Bad id', inputSchema: { type: 'object' }, handler: () => ({}) });
        eforge.registerAction({ id: 'no-title', title: '   ', inputSchema: { type: 'object' }, handler: () => ({}) });
        eforge.registerAction({ id: 'bad-side-effects', title: 'Bad side effects', inputSchema: { type: 'object' }, sideEffects: ['teleport'], handler: () => ({}) });
        eforge.registerAction({ id: 'no-handler', title: 'No handler', inputSchema: { type: 'object' } });
        eforge.registerAction({ id: 'valid', title: 'Valid', inputSchema: { type: 'object' }, handler: () => ({ ok: true }) });
        eforge.registerConsoleContribution({ id: 'bad-renderer', title: 'Bad renderer', blocks: [{ rendererId: 'iframe', content: 'no' }] });
        eforge.registerConsoleContribution({ id: 'missing-action', title: 'Missing action', blocks: [{ rendererId: 'action-form', content: 'Run' }] });
        eforge.registerConsoleContribution({ id: 'unknown-action', title: 'Unknown action', blocks: [{ rendererId: 'action-button', content: 'Run', action: { actionId: 'missing' } }] });
        eforge.registerIntegrationCommand({ id: 'bad-command-schema', label: 'Bad command schema', inputSchema: { type: 'string' }, action: { actionId: 'valid' } });
        eforge.registerIntegrationCommand({ id: 'no-command-action', label: 'No command action' });
        eforge.registerDeepLink({ id: 'no-target', label: 'No target' });
        eforge.registerDeepLink({ id: 'empty-url', label: 'Empty URL', urlTemplate: '' });
      }`,
    });

    expect(result.registry.actions.map((action) => action.id)).toEqual(['invalids:valid']);
    expect(result.registry.consoleContributions).toHaveLength(0);
    expect(result.registry.integrationCommands).toHaveLength(0);
    expect(result.registry.deepLinks).toHaveLength(0);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'extension:invalid-registration').length).toBeGreaterThanOrEqual(12);
  });

  it('rejects non-JSON-safe schema documents during registration', async () => {
    const result = await loadFixture(makeTempDir(), {
      'schema-docs.js': `export default function extension(eforge) {
        eforge.registerAction({ id: 'valid', title: 'Valid', inputSchema: { type: 'object', properties: {} }, handler: () => ({ ok: true }) });
        eforge.registerAction({ id: 'date-schema', title: 'Date schema', inputSchema: { type: 'object', properties: { created: new Date() } }, handler: () => ({}) });
        eforge.registerAction({ id: 'function-output-schema', title: 'Function output schema', inputSchema: { type: 'object' }, outputSchema: { type: 'object', properties: { value: () => 'no' } }, handler: () => ({}) });
        eforge.registerIntegrationCommand({ id: 'map-command-schema', label: 'Map command schema', inputSchema: { type: 'object', properties: { value: new Map() } }, action: { actionId: 'valid' } });
      }`,
    });

    expect(result.registry.actions.map((action) => action.id)).toEqual(['schema-docs:valid']);
    expect(result.registry.integrationCommands).toHaveLength(0);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'extension:invalid-registration')).toHaveLength(3);
  });

  it('rejects Console blocks that do not match closed renderer shapes', async () => {
    const result = await loadFixture(makeTempDir(), {
      'blocks.js': `export default function extension(eforge) {
        eforge.registerAction({ id: 'run', title: 'Run', inputSchema: { type: 'object' }, handler: () => ({ ok: true }) });
        eforge.registerConsoleContribution({ id: 'valid', title: 'Valid', blocks: [{ rendererId: 'link', content: 'Docs', href: 'https://example.test' }] });
        eforge.registerConsoleContribution({ id: 'console-relative', title: 'Console relative', blocks: [{ rendererId: 'link', content: 'System', href: '/console/system' }] });
        eforge.registerConsoleContribution({ id: 'extra-field', title: 'Extra', blocks: [{ rendererId: 'text', content: 'Hi', href: 'https://example.test' }] });
        eforge.registerConsoleContribution({ id: 'unsupported-action', title: 'Action', blocks: [{ rendererId: 'markdown', content: 'Hi', action: { actionId: 'run' } }] });
      }`,
    });

    expect(result.registry.consoleContributions.map((entry) => entry.id)).toEqual(['blocks:valid', 'blocks:console-relative']);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'extension:invalid-registration')).toHaveLength(2);
  });

  it('returns every daemon-safe action dispatch failure outcome without leaking raw input or output', async () => {
    const result = await loadFixture(makeTempDir(), {
      'runtime.js': `import { Type } from '@eforge-build/extension-sdk';
      export default function extension(eforge) {
        const objectSchema = Type.Object({ name: Type.String() });
        const emptySchema = Type.Object({});
        eforge.registerAction({ id: 'echo', title: 'Echo', inputSchema: objectSchema, handler: (input) => ({ greeting: input.name }) });
        eforge.registerAction({ id: 'throws', title: 'Throws', inputSchema: emptySchema, handler: () => { throw new Error('handler secret must not include raw payload'); } });
        eforge.registerAction({ id: 'slow', title: 'Slow', inputSchema: emptySchema, handler: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 50)) });
        eforge.registerAction({ id: 'schema-output', title: 'Schema output', inputSchema: emptySchema, outputSchema: Type.Object({ ok: Type.Boolean() }), handler: () => ({ ok: 'nope' }) });
        eforge.registerAction({ id: 'undefined-output', title: 'Undefined output', inputSchema: emptySchema, handler: () => undefined });
        eforge.registerAction({ id: 'function-output', title: 'Function output', inputSchema: emptySchema, handler: () => ({ value: () => 'secret-output' }) });
        eforge.registerAction({ id: 'bigint-output', title: 'BigInt output', inputSchema: emptySchema, handler: () => BigInt(1) });
        eforge.registerAction({ id: 'infinite-output', title: 'Infinite output', inputSchema: emptySchema, handler: () => ({ value: Infinity }) });
        eforge.registerAction({ id: 'date-output', title: 'Date output', inputSchema: emptySchema, handler: () => new Date() });
        eforge.registerAction({ id: 'map-output', title: 'Map output', inputSchema: emptySchema, handler: () => new Map([['secret-output', true]]) });
        eforge.registerAction({ id: 'set-output', title: 'Set output', inputSchema: emptySchema, handler: () => new Set(['secret-output']) });
        eforge.registerAction({ id: 'class-output', title: 'Class output', inputSchema: emptySchema, handler: () => new (class SecretOutput { value = 'secret-output' })() });
        eforge.registerAction({ id: 'circular-output', title: 'Circular output', inputSchema: emptySchema, handler: () => { const value = { ok: true }; value.self = value; return value; } });
      }`,
    });

    const base = { requestedBy: { host: 'cli' as const }, cwd: makeTempDir(), timeoutMs: 1000 };
    await expect(dispatchExtensionAction(result.registry, { ...base, actionId: 'runtime:missing', input: {} })).resolves.toMatchObject({ kind: 'unknown-action' });
    await expect(dispatchExtensionAction(result.registry, { ...base, actionId: 'runtime:echo', input: { name: 42, rawSecret: 'raw-input-secret' } })).resolves.toMatchObject({ kind: 'invalid-input' });
    await expect(dispatchExtensionAction(result.registry, { ...base, actionId: 'runtime:throws', input: { rawSecret: 'raw-input-secret' } })).resolves.toMatchObject({ kind: 'handler-error' });
    await expect(dispatchExtensionAction(result.registry, { ...base, actionId: 'runtime:slow', input: {}, timeoutMs: 1 })).resolves.toMatchObject({ kind: 'timeout', timeoutMs: 1 });
    await expect(dispatchExtensionAction(result.registry, { ...base, actionId: 'runtime:schema-output', input: {} })).resolves.toMatchObject({ kind: 'output-schema-failed' });

    for (const actionId of ['undefined-output', 'function-output', 'bigint-output', 'infinite-output', 'date-output', 'map-output', 'set-output', 'class-output', 'circular-output']) {
      const outcome = await dispatchExtensionAction(result.registry, { ...base, actionId: `runtime:${actionId}`, input: { rawSecret: 'raw-input-secret' } });
      expect(outcome).toMatchObject({ kind: 'invalid-output' });
      expect(JSON.stringify(outcome)).not.toContain('raw-input-secret');
      expect(JSON.stringify(outcome)).not.toContain('secret-output');
      expect(outcome).not.toHaveProperty('input');
      expect(outcome).not.toHaveProperty('output');
    }
  });

  it('keeps engine contribution helpers inside the engine/client boundary', async () => {
    const [runtimeSource, manifestSource, discoveryServiceSource] = await Promise.all([
      readFile('packages/engine/src/extensions/action-runtime.ts', 'utf8'),
      readFile('packages/engine/src/extensions/manifest.ts', 'utf8'),
      readFile('packages/monitor/src/routes/extensions/discovery-service.ts', 'utf8'),
    ]);

    expect(runtimeSource).not.toContain('@eforge-build/extension-sdk');
    expect(manifestSource).toContain('@eforge-build/client');
    expect(manifestSource).not.toMatch(/['"]\/api\//);
    expect(discoveryServiceSource).not.toContain('ExtensionActionInvoke');
    expect(discoveryServiceSource).not.toContain('extensionActionInvoke');
    expect(discoveryServiceSource).not.toContain('extensionContributionManifest');
  });

  it('projects manifest diagnostics with code and name while omitting handlers and module objects', async () => {
    const result = await loadFixture(makeTempDir(), {
      'diagnostic.js': `import { Type } from '@eforge-build/extension-sdk';
      export default function extension(eforge) {
        eforge.registerAction({ id: 'safe', title: 'Safe', inputSchema: Type.Object({}), handler: () => ({ ok: true }) });
        eforge.registerAction({ id: 'bad', title: 'Bad', inputSchema: { type: 'string' }, handler: () => ({ ok: true }) });
      }`,
    });

    const manifest = buildExtensionContributionManifest(result.registry);
    expect(manifest.diagnostics).toContainEqual(expect.objectContaining({
      code: 'extension:invalid-registration',
      name: 'bad',
      extensionName: 'diagnostic',
      extensionPath: expect.stringContaining('diagnostic.js'),
    }));
    expect(JSON.stringify(manifest)).not.toContain('handler');
    expect(JSON.stringify(manifest)).not.toContain('module');
    expect(JSON.stringify(manifest)).not.toContain('function extension');
  });
});
// --- eforge:endregion plan-02-engine-registry-runtime ---
