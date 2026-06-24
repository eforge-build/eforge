import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { getScopeDirectory, type ScopeResolverOpts } from '@eforge-build/scopes';
import {
  buildExtensionContributionManifest,
  loadNativeExtensions,
  projectExtensionRegistry,
} from '@eforge-build/engine/extensions';

import { useTempDir } from './test-tmpdir.js';

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
  return loadNativeExtensions({ cwd: opts.cwd, configDir: opts.configDir, config: { enabled: true } });
}

describe('extension agent task contribution registration', () => {
  const makeTempDir = useTempDir('extension-agent-task-contributions-');
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  });

  it('records valid registrations and projects safe manifest metadata', async () => {
    const result = await loadFixture(makeTempDir(), {
      'tasks.js': `import { Type, defineExtensionAgentTaskContribution } from '@eforge-build/extension-sdk';
      export default function extension(eforge) {
        const task = defineExtensionAgentTaskContribution({
          id: 'planning-draft',
          title: 'Planning draft',
          description: 'Drafts a plan.',
          inputSchema: Type.Object({ topic: Type.String() }),
          outputSchema: Type.Object({ summary: Type.String() }),
          prompt: { kind: 'asset', asset: 'prompts/planning-draft.md' },
          resolvePrompt: () => ({ prompt: 'raw prompt text' }),
        });
        eforge.registerAgentTask(task);
      }`,
    });

    expect(result.registry.agentTasks).toHaveLength(1);
    expect(result.registry.agentTasks[0]).toMatchObject({ localId: 'planning-draft', id: 'tasks:planning-draft' });
    expect(result.registry.extensions[0]?.registrations).toMatchObject({ agentTasks: 1 });

    const manifest = buildExtensionContributionManifest(result.registry);
    expect(manifest.agentTasks?.[0]).toMatchObject({
      id: 'tasks:planning-draft',
      localId: 'planning-draft',
      extensionName: 'tasks',
      inputSchema: expect.objectContaining({ type: 'object' }),
      prompt: { kind: 'asset', asset: 'prompts/planning-draft.md' },
    });
    expect(JSON.stringify(manifest)).not.toContain('raw prompt text');
    expect(JSON.stringify(manifest)).not.toContain('resolvePrompt');

    const projection = projectExtensionRegistry(result.registry);
    expect(projection.totals).toMatchObject({ agentTasks: 1 });
    expect(projection.extensions[0]?.agentTaskDetails?.[0]).toMatchObject({ id: 'tasks:planning-draft' });
  });

  it('keeps the first duplicate local id and emits one duplicate diagnostic', async () => {
    const result = await loadFixture(makeTempDir(), {
      'dupes.js': `import { Type } from '@eforge-build/extension-sdk';
      export default function extension(eforge) {
        eforge.registerAgentTask({ id: 'planning-draft', title: 'First', inputSchema: Type.Object({}), prompt: { kind: 'asset', asset: 'prompts/first.md' } });
        eforge.registerAgentTask({ id: 'planning-draft', title: 'Second', inputSchema: Type.Object({}), prompt: { kind: 'asset', asset: 'prompts/second.md' } });
      }`,
    });

    expect(result.registry.agentTasks).toHaveLength(1);
    expect(result.registry.agentTasks[0]?.value.title).toBe('First');
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'extension:duplicate-registration' && diagnostic.name === 'dupes:planning-draft')).toHaveLength(1);
  });

  it('rejects bad input schemas and unsafe prompt asset paths', async () => {
    const result = await loadFixture(makeTempDir(), {
      'bad.js': `import { Type } from '@eforge-build/extension-sdk';
      export default function extension(eforge) {
        eforge.registerAgentTask({ id: 'bad-schema', title: 'Bad schema', inputSchema: Type.String(), prompt: { kind: 'asset', asset: 'prompts/good.md' } });
        eforge.registerAgentTask({ id: 'absolute', title: 'Absolute', inputSchema: Type.Object({}), prompt: { kind: 'asset', asset: '/prompts/x.md' } });
        eforge.registerAgentTask({ id: 'parent', title: 'Parent', inputSchema: Type.Object({}), prompt: { kind: 'asset', asset: '../x.md' } });
        eforge.registerAgentTask({ id: 'empty', title: 'Empty', inputSchema: Type.Object({}), prompt: { kind: 'asset', asset: '' } });
        eforge.registerAgentTask({ id: 'valid', title: 'Valid', inputSchema: Type.Object({}), prompt: { kind: 'asset', asset: 'prompts/valid.md' } });
      }`,
    });

    expect(result.registry.agentTasks.map((task) => task.id)).toEqual(['bad:valid']);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'extension:invalid-registration')).toHaveLength(4);
  });

  it('records export prompt sources without exposing functions', async () => {
    const result = await loadFixture(makeTempDir(), {
      'export-source.js': `import { Type } from '@eforge-build/extension-sdk';
      export default function extension(eforge) {
        eforge.registerAgentTask({
          id: 'from-export',
          title: 'From export',
          inputSchema: Type.Object({}),
          prompt: { kind: 'export', module: './task-prompts.js', exportName: 'buildPrompt' },
        });
      }`,
    });

    const manifest = buildExtensionContributionManifest(result.registry);
    expect(manifest.agentTasks?.[0]).toMatchObject({
      prompt: { kind: 'export', module: './task-prompts.js', exportName: 'buildPrompt' },
    });
    expect(JSON.stringify(manifest)).not.toContain('function');
  });
});
