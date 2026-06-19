import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { getScopeDirectory, type ScopeResolverOpts } from '@eforge-build/scopes';
import {
  buildExtensionContributionManifest,
  dispatchExtensionAction,
  discoverNativeExtensions,
  loadNativeExtensions,
  upsertTrustRecord,
} from '@eforge-build/engine/extensions';

import { useTempDir } from './test-tmpdir.js';

async function makeTree(root: string): Promise<ScopeResolverOpts> {
  process.env.XDG_CONFIG_HOME = resolve(root, 'xdg-config');
  const opts = { cwd: root, configDir: resolve(root, 'eforge') };
  await mkdir(resolve(getScopeDirectory('project-local', opts), 'extensions'), { recursive: true });
  await mkdir(resolve(getScopeDirectory('project-team', opts), 'extensions'), { recursive: true });
  await mkdir(resolve(getScopeDirectory('user', opts), 'extensions'), { recursive: true });
  await writeFile(resolve(root, 'package.json'), '{"type":"module"}\n', 'utf-8');
  return opts;
}

async function writeExtension(dir: string, manifest: Record<string, unknown>, body: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, 'package.json'), JSON.stringify({ type: 'module', version: '1.0.0', ...manifest }, null, 2), 'utf-8');
  await writeFile(resolve(dir, 'index.js'), body, 'utf-8');
}

function extensionManifest(extension: Record<string, unknown>): Record<string, unknown> {
  return { eforge: { extension } };
}

describe('extension dependency and capability contracts', () => {
  const makeTempDir = useTempDir('extension-dependency-contracts-');
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  });

  it('skips a required dependent when the provider is missing', async () => {
    const root = makeTempDir();
    const opts = await makeTree(root);
    const dependentDir = resolve(getScopeDirectory('project-local', opts), 'extensions', 'dependent');
    await writeExtension(dependentDir, extensionManifest({ name: 'dependent', dependencies: { required: [{ name: 'missing-provider' }] } }), 'throw new Error("dependent must not import"); export default function extension() {}');

    const result = await loadNativeExtensions({ cwd: opts.cwd, configDir: opts.configDir, config: { enabled: true } });

    expect(result.candidates.find((candidate) => candidate.name === 'dependent')).toMatchObject({ status: 'skipped' });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'extension:dependency-missing', name: 'dependent', dependencyName: 'missing-provider' }));
    expect(result.registry.extensions.map((extension) => extension.name)).not.toContain('dependent');
  });

  it('skips untrusted project-team providers and their required dependents before import', async () => {
    const root = makeTempDir();
    const opts = await makeTree(root);
    await writeExtension(
      resolve(getScopeDirectory('project-team', opts), 'extensions', 'provider'),
      extensionManifest({ name: 'provider', capabilities: [{ name: 'demo.capability', version: '1.0.0' }] }),
      'throw new Error("provider must not import"); export default function extension() {}',
    );
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'dependent'),
      extensionManifest({ name: 'dependent', dependencies: { required: [{ name: 'provider', capabilities: [{ name: 'demo.capability' }] }] } }),
      'throw new Error("dependent must not import"); export default function extension() {}',
    );

    const result = await loadNativeExtensions({ cwd: opts.cwd, configDir: opts.configDir, config: { enabled: true } });

    expect(result.candidates.find((candidate) => candidate.name === 'provider')).toMatchObject({ status: 'skipped', trustState: 'untrusted' });
    expect(result.candidates.find((candidate) => candidate.name === 'dependent')).toMatchObject({ status: 'skipped' });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'extension:dependency-untrusted', name: 'dependent', providerName: 'provider' }));
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'extension:factory-error')).toBe(false);
  });

  it('reports changed provider hashes on required dependents', async () => {
    const root = makeTempDir();
    const opts = await makeTree(root);
    const providerDir = resolve(getScopeDirectory('project-team', opts), 'extensions', 'provider');
    await writeExtension(providerDir, extensionManifest({ name: 'provider' }), 'export default function extension() {}');
    const discovery = await discoverNativeExtensions({ cwd: opts.cwd, configDir: opts.configDir, config: { enabled: true } });
    const hash = discovery.candidates.find((candidate) => candidate.name === 'provider')?.currentHash;
    expect(hash).toBeDefined();
    await upsertTrustRecord(resolve(root, '.eforge'), 'provider', hash!);
    await writeFile(resolve(providerDir, 'index.js'), 'throw new Error("changed provider must not import"); export default function extension() {}', 'utf-8');
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'dependent'),
      extensionManifest({ name: 'dependent', dependencies: { required: [{ name: 'provider' }] } }),
      'throw new Error("dependent must not import"); export default function extension() {}',
    );

    const result = await loadNativeExtensions({ cwd: opts.cwd, configDir: opts.configDir, config: { enabled: true } });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'extension:dependency-changed',
      name: 'dependent',
      providerName: 'provider',
      trustedHash: hash,
      currentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  it('cascades provider factory errors to required dependents', async () => {
    const root = makeTempDir();
    const opts = await makeTree(root);
    await writeExtension(resolve(getScopeDirectory('project-local', opts), 'extensions', 'provider'), extensionManifest({ name: 'provider' }), 'export default function extension() { throw new Error("boom"); }');
    await writeExtension(resolve(getScopeDirectory('project-local', opts), 'extensions', 'dependent'), extensionManifest({ name: 'dependent', dependencies: { required: [{ name: 'provider' }] } }), 'throw new Error("dependent must not import"); export default function extension() {}');

    const result = await loadNativeExtensions({ cwd: opts.cwd, configDir: opts.configDir, config: { enabled: true } });

    expect(result.candidates.find((candidate) => candidate.name === 'provider')).toMatchObject({ status: 'error' });
    expect(result.candidates.find((candidate) => candidate.name === 'dependent')).toMatchObject({ status: 'skipped' });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'extension:dependency-error', name: 'dependent', providerName: 'provider' }));
  });

  it('accepts exact, comparator, and comma-separated AND version constraints', async () => {
    const root = makeTempDir();
    const opts = await makeTree(root);
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'provider'),
      { version: '1.5.0', ...extensionManifest({ name: 'provider', capabilities: [{ name: 'demo.capability', version: '1.2.0' }] }) },
      'export default function extension() {}',
    );
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'dependent'),
      extensionManifest({ name: 'dependent', dependencies: { required: [{ name: 'provider', version: '>=1.0.0, <2.0.0', capabilities: [{ name: 'demo.capability', version: '>=1.0.0, <2.0.0' }] }] } }),
      'export default function extension() {}',
    );

    const result = await loadNativeExtensions({ cwd: opts.cwd, configDir: opts.configDir, config: { enabled: true } });

    expect(result.candidates.find((candidate) => candidate.name === 'dependent')).toMatchObject({ status: 'loaded' });
    expect(result.diagnostics.some((diagnostic) => diagnostic.code.startsWith('extension:dependency-'))).toBe(false);
  });

  it('accepts prerelease versions with build metadata in capabilities and constraints', async () => {
    const root = makeTempDir();
    const opts = await makeTree(root);
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'provider'),
      extensionManifest({ name: 'provider', capabilities: [{ name: 'demo.capability', version: '1.0.0-alpha+001' }] }),
      'export default function extension() {}',
    );
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'dependent'),
      extensionManifest({ name: 'dependent', dependencies: { required: [{ capabilities: [{ name: 'demo.capability', version: '>=1.0.0-alpha+001' }] }] } }),
      'export default function extension() {}',
    );

    const result = await loadNativeExtensions({ cwd: opts.cwd, configDir: opts.configDir, config: { enabled: true } });

    expect(result.candidates.find((candidate) => candidate.name === 'provider')).toMatchObject({ status: 'loaded' });
    expect(result.candidates.find((candidate) => candidate.name === 'dependent')).toMatchObject({ status: 'loaded' });
  });

  it('emits manifest diagnostics for invalid dependency and capability constraint syntax', async () => {
    const root = makeTempDir();
    const opts = await makeTree(root);
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'bad-provider-version'),
      extensionManifest({ name: 'bad-provider-version', dependencies: { required: [{ name: 'provider', version: '=>1.0.0' }] } }),
      'export default function extension() {}',
    );
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'bad-capability-version'),
      extensionManifest({ name: 'bad-capability-version', dependencies: { required: [{ name: 'provider', capabilities: [{ name: 'demo.capability', version: '^1.0.0' }] }] } }),
      'export default function extension() {}',
    );
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'bad-provided-capability'),
      extensionManifest({ name: 'bad-provided-capability', capabilities: [{ name: 'demo.capability', version: '>=1.0.0' }] }),
      'export default function extension() {}',
    );
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'bad-capability-name'),
      extensionManifest({ name: 'bad-capability-name', capabilities: [{ name: 'demo.\u001b[31mcapability', version: '1.0.0' }] }),
      'export default function extension() {}',
    );

    const result = await discoverNativeExtensions({ cwd: opts.cwd, configDir: opts.configDir, config: { enabled: true } });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'extension:invalid-package-manifest', path: expect.stringContaining('bad-provider-version'), message: expect.stringContaining('eforge.extension.dependencies.required[0].version') }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'extension:invalid-package-manifest', path: expect.stringContaining('bad-capability-version'), message: expect.stringContaining('eforge.extension.dependencies.required[0].capabilities[0].version') }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'extension:invalid-package-manifest', path: expect.stringContaining('bad-provided-capability'), message: expect.stringContaining('eforge.extension.capabilities[0].version') }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'extension:invalid-package-manifest', path: expect.stringContaining('bad-capability-name'), message: expect.stringContaining('eforge.extension.capabilities[0].name') }));
    expect(result.candidates.filter((candidate) => candidate.status === 'error').map((candidate) => candidate.name).sort()).toEqual(['bad-capability-name', 'bad-capability-version', 'bad-provided-capability', 'bad-provider-version']);
  });

  it('diagnoses version, capability, and shadowed-provider incompatibilities', async () => {
    const root = makeTempDir();
    const opts = await makeTree(root);
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'provider'),
      { version: '1.0.0', ...extensionManifest({ name: 'provider', capabilities: [{ name: 'demo.capability', version: '1.0.0' }] }) },
      'export default function extension() {}',
    );
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'version-dependent'),
      extensionManifest({ name: 'version-dependent', dependencies: { required: [{ name: 'provider', version: '>=2.0.0' }] } }),
      'export default function extension() {}',
    );
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'capability-dependent'),
      extensionManifest({ name: 'capability-dependent', dependencies: { required: [{ name: 'provider', capabilities: [{ name: 'demo.capability', version: '>=2.0.0' }] }] } }),
      'export default function extension() {}',
    );
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'shadow-source'),
      extensionManifest({ name: 'shadow-source' }),
      'export default function extension() {}',
    );
    await writeExtension(
      resolve(getScopeDirectory('user', opts), 'extensions', 'shadow-source'),
      extensionManifest({ name: 'shadow-source', capabilities: [{ name: 'shadow.only', version: '1.0.0' }] }),
      'export default function extension() {}',
    );
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'shadow-dependent'),
      extensionManifest({ name: 'shadow-dependent', dependencies: { required: [{ name: 'shadow-source', capabilities: [{ name: 'shadow.only' }] }] } }),
      'export default function extension() {}',
    );

    const result = await loadNativeExtensions({ cwd: opts.cwd, configDir: opts.configDir, config: { enabled: true } });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'extension:dependency-version-incompatible', name: 'version-dependent' }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'extension:dependency-capability-incompatible', name: 'capability-dependent', capabilityName: 'demo.capability' }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'extension:dependency-shadowed', name: 'shadow-dependent', providerName: 'shadow-source' }));
  });

  it('prefers a trusted compatible provider over an untrusted capability-only provider', async () => {
    const root = makeTempDir();
    const opts = await makeTree(root);
    await writeExtension(
      resolve(getScopeDirectory('project-team', opts), 'extensions', 'untrusted-provider'),
      extensionManifest({ name: 'untrusted-provider', capabilities: [{ name: 'shared.capability', version: '1.0.0' }] }),
      'throw new Error("untrusted provider must not import"); export default function extension() {}',
    );
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'trusted-provider'),
      extensionManifest({ name: 'trusted-provider', capabilities: [{ name: 'shared.capability', version: '1.0.0' }] }),
      'export default function extension() {}',
    );
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'dependent'),
      extensionManifest({ name: 'dependent', dependencies: { required: [{ capabilities: [{ name: 'shared.capability' }] }] } }),
      'export default function extension() {}',
    );

    const result = await loadNativeExtensions({ cwd: opts.cwd, configDir: opts.configDir, config: { enabled: true } });

    expect(result.candidates.find((candidate) => candidate.name === 'dependent')).toMatchObject({ status: 'loaded' });
    expect(result.candidates.find((candidate) => candidate.name === 'dependent')?.resolvedDependencies?.required[0]).toMatchObject({ available: true, providerName: 'trusted-provider' });
  });

  it('keeps optional-dependency dependents loaded and marks unmet contribution capability requirements unavailable', async () => {
    const root = makeTempDir();
    const opts = await makeTree(root);
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'dependent'),
      extensionManifest({ name: 'dependent', dependencies: { optional: [{ name: 'missing-provider', capabilities: [{ name: 'missing.capability' }] }] } }),
      `import { Type } from '@eforge-build/extension-sdk';
       export default function extension(eforge) {
         eforge.registerAction({ id: 'optional-action', title: 'Optional action', inputSchema: Type.Object({}), requirements: { capabilities: [{ name: 'missing.capability' }] }, handler: () => ({ ok: true }) });
       }`,
    );

    const result = await loadNativeExtensions({ cwd: opts.cwd, configDir: opts.configDir, config: { enabled: true } });
    const manifest = buildExtensionContributionManifest(result.registry);
    const action = manifest.actions.find((entry) => entry.id === 'dependent:optional-action');

    expect(result.candidates.find((candidate) => candidate.name === 'dependent')).toMatchObject({ status: 'loaded' });
    expect(action?.availability).toMatchObject({ available: false, message: expect.stringContaining('missing.capability') });
    await expect(dispatchExtensionAction(result.registry, { actionId: 'dependent:optional-action', input: {}, requestedBy: { host: 'cli' }, cwd: root, configDir: opts.configDir, timeoutMs: 1000 })).resolves.toMatchObject({ kind: 'unavailable' });
  });

  it('marks commands and action-backed deep links unavailable when their bound action is unavailable', async () => {
    const root = makeTempDir();
    const opts = await makeTree(root);
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'dependent'),
      extensionManifest({ name: 'dependent' }),
      `import { Type } from '@eforge-build/extension-sdk';
       export default function extension(eforge) {
         eforge.registerAction({ id: 'optional-action', title: 'Optional action', inputSchema: Type.Object({}), requirements: { capabilities: [{ name: 'missing.capability' }] }, handler: () => ({ ok: true }) });
         eforge.registerIntegrationCommand({ id: 'optional-command', label: 'Optional command', action: { actionId: 'optional-action' } });
         eforge.registerDeepLink({ id: 'optional-link', label: 'Optional link', action: { actionId: 'optional-action' } });
       }`,
    );

    const result = await loadNativeExtensions({ cwd: opts.cwd, configDir: opts.configDir, config: { enabled: true } });
    const manifest = buildExtensionContributionManifest(result.registry);

    expect(manifest.integrationCommands.find((entry) => entry.id === 'dependent:optional-command')?.availability).toMatchObject({ available: false, message: expect.stringContaining('missing.capability') });
    expect(manifest.deepLinks.find((entry) => entry.id === 'dependent:optional-link')?.availability).toMatchObject({ available: false, message: expect.stringContaining('missing.capability') });
  });

  it('exposes immutable dependency and capability availability on action context', async () => {
    const root = makeTempDir();
    const opts = await makeTree(root);
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'provider'),
      extensionManifest({ name: 'provider', capabilities: [{ name: 'demo.capability', version: '1.0.0' }] }),
      'export default function extension() {}',
    );
    await writeExtension(
      resolve(getScopeDirectory('project-local', opts), 'extensions', 'dependent'),
      extensionManifest({ name: 'dependent', dependencies: { optional: [{ name: 'provider', capabilities: [{ name: 'demo.capability', version: '>=1.0.0' }] }] } }),
      `import { Type } from '@eforge-build/extension-sdk';
       export default function extension(eforge) {
         eforge.registerAction({ id: 'inspect', title: 'Inspect', inputSchema: Type.Object({}), handler: (_input, ctx) => {
           return {
             dependency: ctx.dependencies.get('provider').available,
             capability: ctx.capabilities.get('demo.capability', '>=1.0.0').available,
             providerCount: ctx.capabilities.get('demo.capability').providers.length,
           };
         } });
       }`,
    );

    const result = await loadNativeExtensions({ cwd: opts.cwd, configDir: opts.configDir, config: { enabled: true } });
    await expect(dispatchExtensionAction(result.registry, { actionId: 'dependent:inspect', input: {}, requestedBy: { host: 'cli' }, cwd: root, configDir: opts.configDir, timeoutMs: 1000 })).resolves.toMatchObject({
      kind: 'success',
      output: { dependency: true, capability: true, providerCount: 1 },
    });
  });
});
