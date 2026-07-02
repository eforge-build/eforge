import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { writePlanSet } from '@eforge-build/engine/plan';
import type { PlanSetSubmission, ArchitectureSubmission } from '@eforge-build/engine/schemas';
import { planSetSubmissionSchema } from '@eforge-build/engine/schemas';
import { safeParseWithSchema } from '@eforge-build/client';

describe('writePlanSet', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'eforge-test-'));
  });

  const payload: PlanSetSubmission = {
    description: 'Test plan set',
    plans: [
      {
        frontmatter: {
          id: 'plan-01-auth',
          name: 'Auth Plan',
        },
        body: '# Auth Plan\n\nImplement authentication.',
      },
      {
        frontmatter: {
          id: 'plan-02-api',
          name: 'API Plan',
          migrations: [{ timestamp: '20260415120000', description: 'add users table' }],
        },
        body: '# API Plan\n\nImplement API layer.',
      },
    ],
    orchestration: {
      validate: [],
      plans: [
        { id: 'plan-01-auth', dependsOn: [] },
        { id: 'plan-02-api', dependsOn: ['plan-01-auth'] },
      ],
    },
  };

  it('creates plan markdown files with YAML frontmatter', async () => {
    await writePlanSet({ cwd: tempDir, outputDir: 'eforge/plans', planSetName: 'test-set', payload, baseBranch: 'main' });

    const plan1Content = await readFile(join(tempDir, 'eforge/plans/test-set/plan-01-auth.md'), 'utf-8');
    expect(plan1Content).toMatch(/^---\n/);
    expect(plan1Content).toMatch(/\n---\n\n/);
    expect(plan1Content).toContain('id: plan-01-auth');
    expect(plan1Content).toContain('name: Auth Plan');
    expect(plan1Content).not.toContain('depends_on:');
    expect(plan1Content).toContain('# Auth Plan');
    expect(plan1Content).toContain('Implement authentication.');

    const plan2Content = await readFile(join(tempDir, 'eforge/plans/test-set/plan-02-api.md'), 'utf-8');
    expect(plan2Content).toContain('id: plan-02-api');
    expect(plan2Content).not.toContain('depends_on:');
    expect(plan2Content).toContain('migrations:');
  });

  it('creates orchestration.yaml with correct structure', async () => {
    await writePlanSet({ cwd: tempDir, outputDir: 'eforge/plans', planSetName: 'test-set', payload, baseBranch: 'main' });

    const orchContent = await readFile(join(tempDir, 'eforge/plans/test-set/orchestration.yaml'), 'utf-8');
    const orch = parseYaml(orchContent) as Record<string, unknown>;

    expect(orch.name).toBe('test-set');
    expect(orch.description).toBe('Test plan set');
    expect(orch.base_branch).toBe('main');

    const plans = orch.plans as Array<Record<string, unknown>>;
    expect(plans).toHaveLength(2);
    expect(plans[0].id).toBe('plan-01-auth');
    expect(plans[1].id).toBe('plan-02-api');
    expect(plans[1].depends_on).toEqual(['plan-01-auth']);
  });

  it('YAML frontmatter matches input data', async () => {
    await writePlanSet({ cwd: tempDir, outputDir: 'eforge/plans', planSetName: 'test-set', payload, baseBranch: 'main' });

    const plan1Content = await readFile(join(tempDir, 'eforge/plans/test-set/plan-01-auth.md'), 'utf-8');
    const match = plan1Content.match(/^---\n([\s\S]*?)\n---/);
    expect(match).toBeTruthy();
    const frontmatter = parseYaml(match![1]) as Record<string, unknown>;
    expect(frontmatter.id).toBe('plan-01-auth');
    expect(frontmatter.name).toBe('Auth Plan');
    expect(frontmatter.depends_on).toBeUndefined();
    expect(frontmatter.branch).toBe('test-set/plan-01-auth');
  });

  it('derives name, base_branch, and per-plan branch from engine options, not payload', async () => {
    await writePlanSet({
      cwd: tempDir,
      outputDir: 'eforge/plans',
      planSetName: 'my-feature',
      payload,
      baseBranch: 'develop',
    });

    const orchContent = await readFile(join(tempDir, 'eforge/plans/my-feature/orchestration.yaml'), 'utf-8');
    const orch = parseYaml(orchContent) as Record<string, unknown>;

    // Root fields from engine options
    expect(orch.name).toBe('my-feature');
    expect(orch.base_branch).toBe('develop');

    // Per-plan branch derived from planSetName/plan.id
    const plans = orch.plans as Array<Record<string, unknown>>;
    expect(plans[0].branch).toBe('my-feature/plan-01-auth');
    expect(plans[1].branch).toBe('my-feature/plan-02-api');

    // Plan names looked up from payload.plans[].frontmatter.name by id
    expect(plans[0].name).toBe('Auth Plan');
    expect(plans[1].name).toBe('API Plan');

    // Plan file frontmatter branch also engine-derived
    const planContent = await readFile(join(tempDir, 'eforge/plans/my-feature/plan-01-auth.md'), 'utf-8');
    expect(planContent).toContain('branch: my-feature/plan-01-auth');
  });
});

describe('planSetSubmissionSchema: extra fields are accepted (TypeBox does not strip unknowns)', () => {
  // TypeBox does not strip unknown fields from objects (unlike Zod's default behavior).
  // These tests verify that submissions with extra fields are accepted, not rejected.
  // The extra fields remain in result.data at runtime but are ignored by downstream code.

  it('accepts root name field as extra', () => {
    const result = safeParseWithSchema(planSetSubmissionSchema, {
      name: 'my-plan-set',
      description: 'A plan set',
      plans: [{ frontmatter: { id: 'plan-01-a', name: 'A' }, body: '# A' }],
      orchestration: { validate: [], plans: [{ id: 'plan-01-a', dependsOn: [] }] },
    });
    // TypeBox passes validation with extra fields
    expect(result.success).toBe(true);
  });

  it('accepts root mode field as extra', () => {
    const result = safeParseWithSchema(planSetSubmissionSchema, {
      mode: 'excursion',
      description: 'A plan set',
      plans: [{ frontmatter: { id: 'plan-01-a', name: 'A' }, body: '# A' }],
      orchestration: { validate: [], plans: [{ id: 'plan-01-a', dependsOn: [] }] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts root baseBranch field as extra', () => {
    const result = safeParseWithSchema(planSetSubmissionSchema, {
      baseBranch: 'main',
      description: 'A plan set',
      plans: [{ frontmatter: { id: 'plan-01-a', name: 'A' }, body: '# A' }],
      orchestration: { validate: [], plans: [{ id: 'plan-01-a', dependsOn: [] }] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts branch in plan frontmatter as extra', () => {
    const result = safeParseWithSchema(planSetSubmissionSchema, {
      description: 'A plan set',
      plans: [{ frontmatter: { id: 'plan-01-a', name: 'A', branch: 'my-set/plan-01-a' }, body: '# A' }],
      orchestration: { validate: [], plans: [{ id: 'plan-01-a', dependsOn: [] }] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts name and branch in orchestration plan entry as extra', () => {
    const result = safeParseWithSchema(planSetSubmissionSchema, {
      description: 'A plan set',
      plans: [{ frontmatter: { id: 'plan-01-a', name: 'A' }, body: '# A' }],
      orchestration: {
        validate: [],
        plans: [{ id: 'plan-01-a', name: 'A', dependsOn: [], branch: 'my-set/plan-01-a' }],
      },
    });
    expect(result.success).toBe(true);
  });
});

