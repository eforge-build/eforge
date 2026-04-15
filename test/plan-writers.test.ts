import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { writePlanSet, writeArchitecture } from '@eforge-build/engine/plan';
import type { PlanSetSubmission, ArchitectureSubmission } from '@eforge-build/engine/schemas';

describe('writePlanSet', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'eforge-test-'));
  });

  const payload: PlanSetSubmission = {
    name: 'test-set',
    description: 'Test plan set',
    mode: 'excursion',
    baseBranch: 'main',
    plans: [
      {
        frontmatter: {
          id: 'plan-01-auth',
          name: 'Auth Plan',
          dependsOn: [],
          branch: 'auth/main',
        },
        body: '# Auth Plan\n\nImplement authentication.',
      },
      {
        frontmatter: {
          id: 'plan-02-api',
          name: 'API Plan',
          dependsOn: ['plan-01-auth'],
          branch: 'api/main',
          migrations: [{ timestamp: '20260415120000', description: 'add users table' }],
        },
        body: '# API Plan\n\nImplement API layer.',
      },
    ],
    orchestration: {
      validate: [],
      plans: [
        { id: 'plan-01-auth', name: 'Auth Plan', dependsOn: [], branch: 'auth/main' },
        { id: 'plan-02-api', name: 'API Plan', dependsOn: ['plan-01-auth'], branch: 'api/main' },
      ],
    },
  };

  it('creates plan markdown files with YAML frontmatter', async () => {
    await writePlanSet({ cwd: tempDir, outputDir: 'eforge/plans', planSetName: 'test-set', payload });

    const plan1Content = await readFile(join(tempDir, 'eforge/plans/test-set/plan-01-auth.md'), 'utf-8');
    expect(plan1Content).toMatch(/^---\n/);
    expect(plan1Content).toMatch(/\n---\n\n/);
    expect(plan1Content).toContain('id: plan-01-auth');
    expect(plan1Content).toContain('name: Auth Plan');
    expect(plan1Content).toContain('# Auth Plan');
    expect(plan1Content).toContain('Implement authentication.');

    const plan2Content = await readFile(join(tempDir, 'eforge/plans/test-set/plan-02-api.md'), 'utf-8');
    expect(plan2Content).toContain('id: plan-02-api');
    expect(plan2Content).toContain('depends_on:');
    expect(plan2Content).toContain('plan-01-auth');
    expect(plan2Content).toContain('migrations:');
  });

  it('creates orchestration.yaml with correct structure', async () => {
    await writePlanSet({ cwd: tempDir, outputDir: 'eforge/plans', planSetName: 'test-set', payload });

    const orchContent = await readFile(join(tempDir, 'eforge/plans/test-set/orchestration.yaml'), 'utf-8');
    const orch = parseYaml(orchContent) as Record<string, unknown>;

    expect(orch.name).toBe('test-set');
    expect(orch.description).toBe('Test plan set');
    expect(orch.base_branch).toBe('main');
    expect(orch.mode).toBe('excursion');

    const plans = orch.plans as Array<Record<string, unknown>>;
    expect(plans).toHaveLength(2);
    expect(plans[0].id).toBe('plan-01-auth');
    expect(plans[1].id).toBe('plan-02-api');
    expect(plans[1].depends_on).toEqual(['plan-01-auth']);
  });

  it('YAML frontmatter matches input data', async () => {
    await writePlanSet({ cwd: tempDir, outputDir: 'eforge/plans', planSetName: 'test-set', payload });

    const plan1Content = await readFile(join(tempDir, 'eforge/plans/test-set/plan-01-auth.md'), 'utf-8');
    const match = plan1Content.match(/^---\n([\s\S]*?)\n---/);
    expect(match).toBeTruthy();
    const frontmatter = parseYaml(match![1]) as Record<string, unknown>;
    expect(frontmatter.id).toBe('plan-01-auth');
    expect(frontmatter.name).toBe('Auth Plan');
    expect(frontmatter.depends_on).toEqual([]);
    expect(frontmatter.branch).toBe('auth/main');
  });
});

describe('writeArchitecture', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'eforge-test-'));
  });

  const payload: ArchitectureSubmission = {
    architecture: '# Architecture\n\nSystem design document.',
    modules: [
      { id: 'mod-auth', description: 'Auth module', dependsOn: [] },
      { id: 'mod-api', description: 'API module', dependsOn: ['mod-auth'] },
    ],
    index: {
      name: 'my-expedition',
      description: 'System design',
      mode: 'expedition',
      validate: [],
      modules: {
        'mod-auth': { description: 'Auth module', depends_on: [] },
        'mod-api': { description: 'API module', depends_on: ['mod-auth'] },
      },
    },
  };

  it('creates architecture.md with correct content', async () => {
    await writeArchitecture({ cwd: tempDir, outputDir: 'eforge/plans', planSetName: 'my-expedition', payload });

    const archContent = await readFile(join(tempDir, 'eforge/plans/my-expedition/architecture.md'), 'utf-8');
    expect(archContent).toBe('# Architecture\n\nSystem design document.');
  });

  it('creates index.yaml with modules matching input', async () => {
    await writeArchitecture({ cwd: tempDir, outputDir: 'eforge/plans', planSetName: 'my-expedition', payload });

    const indexContent = await readFile(join(tempDir, 'eforge/plans/my-expedition/index.yaml'), 'utf-8');
    const index = parseYaml(indexContent) as Record<string, unknown>;

    expect(index.name).toBe('my-expedition');
    expect(index.mode).toBe('expedition');

    const modules = index.modules as Record<string, Record<string, unknown>>;
    expect(modules['mod-auth']).toBeDefined();
    expect(modules['mod-auth'].description).toBe('Auth module');
    expect(modules['mod-auth'].depends_on).toEqual([]);
    expect(modules['mod-api'].depends_on).toEqual(['mod-auth']);
  });

  it('creates modules/ directory', async () => {
    await writeArchitecture({ cwd: tempDir, outputDir: 'eforge/plans', planSetName: 'my-expedition', payload });

    const modulesDir = await stat(join(tempDir, 'eforge/plans/my-expedition/modules'));
    expect(modulesDir.isDirectory()).toBe(true);
  });
});
