/**
 * Architecture manifest dependency sync — deterministic re-derivation of the
 * machine-managed manifest fence from orchestration.yaml.
 *
 * Quality-review fixes may change orchestration `depends_on` edges but can
 * never edit the manifest fence, so the evaluator re-derives
 * `dependsOnPlanIds` from orchestration before committing. The sync must be
 * canonical (sorted, transitively reduced), idempotent, prose-preserving, and
 * a strict no-op when either artifact is missing or unparseable. It must never
 * add or remove manifest plan entries: plan-presence mismatches stay
 * fail-closed in cohesion validation.
 */
import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { DEFAULT_REVIEW } from '@eforge-build/engine/config';
import type { PipelineComposition } from '@eforge-build/engine/schemas';
import { syncArchitectureManifestDependencies } from '@eforge-build/engine/planning-quality/manifest-sync';
import {
  parseArchitectureManifest,
  renderArchitectureManifestFence,
  type PlanningArchitectureManifest,
} from '@eforge-build/engine/planner-compiler';
import { useTempDir } from './test-tmpdir.js';

const PLAN_SET = 'demo-set';
const BUILD = ['implement'];
const PIPELINE: PipelineComposition = { scope: 'excursion', compile: ['planner'], defaultBuild: BUILD, defaultReview: DEFAULT_REVIEW, rationale: 'manifest sync test' };

describe('architecture manifest dependency sync', () => {
  const tempDir = useTempDir('eforge-manifest-sync-');

  it('re-derives manifest dependencies from orchestration and preserves prose', async () => {
    const dir = tempDir();
    await writeArtifacts(dir, {
      manifest: manifestFor([
        { planId: 'client-contracts-routes', dependsOnPlanIds: [] },
        { planId: 'core-policy-config', dependsOnPlanIds: [] },
        { planId: 'console-recovery-ui', dependsOnPlanIds: ['client-contracts-routes', 'core-policy-config'] },
      ]),
      orchestrationPlans: [
        { id: 'client-contracts-routes', dependsOn: [] },
        { id: 'core-policy-config', dependsOn: ['client-contracts-routes'] },
        { id: 'console-recovery-ui', dependsOn: ['core-policy-config'] },
      ],
    });
    const before = await readArchitecture(dir);

    const result = await syncArchitectureManifestDependencies(syncOptions(dir));

    expect(result).toEqual({ changed: true, relPath: `eforge/plans/${PLAN_SET}/architecture.md` });
    const after = await readArchitecture(dir);
    expect(manifestDeps(after)).toEqual({
      'client-contracts-routes': [],
      'core-policy-config': ['client-contracts-routes'],
      'console-recovery-ui': ['core-policy-config'],
    });
    // Everything outside the fence is untouched.
    expect(proseAroundFence(after)).toEqual(proseAroundFence(before));
  });

  it('writes the transitively reduced canonical form and is idempotent', async () => {
    const dir = tempDir();
    await writeArtifacts(dir, {
      manifest: manifestFor([
        { planId: 'module-a', dependsOnPlanIds: [] },
        { planId: 'module-b', dependsOnPlanIds: ['module-a'] },
        { planId: 'module-c', dependsOnPlanIds: ['module-a', 'module-b'] },
      ]),
      // The literal module-a edge on module-c is redundant (reachable via
      // module-b); parseOrchestrationConfig reduces it at read time.
      orchestrationPlans: [
        { id: 'module-a', dependsOn: [] },
        { id: 'module-b', dependsOn: ['module-a'] },
        { id: 'module-c', dependsOn: ['module-a', 'module-b'] },
      ],
    });

    const first = await syncArchitectureManifestDependencies(syncOptions(dir));
    expect(first.changed).toBe(true);
    expect(manifestDeps(await readArchitecture(dir))['module-c']).toEqual(['module-b']);

    const second = await syncArchitectureManifestDependencies(syncOptions(dir));
    expect(second).toEqual({ changed: false });
  });

  it('is a no-op when manifest and orchestration already agree', async () => {
    const dir = tempDir();
    await writeArtifacts(dir, {
      manifest: manifestFor([
        { planId: 'module-a', dependsOnPlanIds: [] },
        { planId: 'module-b', dependsOnPlanIds: ['module-a'] },
      ]),
      orchestrationPlans: [
        { id: 'module-a', dependsOn: [] },
        { id: 'module-b', dependsOn: ['module-a'] },
      ],
    });
    const before = await readArchitecture(dir);

    const result = await syncArchitectureManifestDependencies(syncOptions(dir));

    expect(result).toEqual({ changed: false });
    expect(await readArchitecture(dir)).toEqual(before);
  });

  it('is a no-op when architecture.md has no manifest fence', async () => {
    const dir = tempDir();
    const planDir = join(dir, 'eforge/plans', PLAN_SET);
    await mkdir(planDir, { recursive: true });
    await writeFile(join(planDir, 'architecture.md'), '# Architecture\n\nProse only, no fence.\n', 'utf-8');
    await writeOrchestration(dir, [{ id: 'module-a', dependsOn: [] }]);

    const result = await syncArchitectureManifestDependencies(syncOptions(dir));

    expect(result).toEqual({ changed: false });
    expect(await readArchitecture(dir)).toBe('# Architecture\n\nProse only, no fence.\n');
  });

  it('is a no-op when orchestration.yaml is missing or unparseable', async () => {
    const missingDir = tempDir();
    await writeArtifacts(missingDir, {
      manifest: manifestFor([{ planId: 'module-a', dependsOnPlanIds: ['module-b'] }]),
    });
    await expect(syncArchitectureManifestDependencies(syncOptions(missingDir))).resolves.toEqual({ changed: false });

    const invalidDir = tempDir();
    await writeArtifacts(invalidDir, {
      manifest: manifestFor([{ planId: 'module-a', dependsOnPlanIds: ['module-b'] }]),
    });
    // Missing required 'name' field: parseOrchestrationConfig throws.
    await writeFile(join(invalidDir, 'eforge/plans', PLAN_SET, 'orchestration.yaml'), stringifyYaml({ plans: [] }), 'utf-8');
    await expect(syncArchitectureManifestDependencies(syncOptions(invalidDir))).resolves.toEqual({ changed: false });
  });

  it('is a no-op when reduced orchestration edges exceed the manifest schema cap', async () => {
    const dir = tempDir();
    // 33 independent leaves survive transitive reduction intact, exceeding the
    // 32-item dependsOnPlanIds cap; truncating would silently drop edges.
    const leafIds = Array.from({ length: 33 }, (_, i) => `leaf-${String(i).padStart(2, '0')}`);
    await writeArtifacts(dir, {
      manifest: manifestFor([{ planId: 'hub', dependsOnPlanIds: [] }]),
      orchestrationPlans: [
        ...leafIds.map((id) => ({ id, dependsOn: [] })),
        { id: 'hub', dependsOn: leafIds },
      ],
    });
    const before = await readArchitecture(dir);

    const result = await syncArchitectureManifestDependencies(syncOptions(dir));

    expect(result).toEqual({ changed: false });
    expect(await readArchitecture(dir)).toBe(before);
  });

  it('never adds or removes manifest plan entries on presence asymmetry', async () => {
    const dir = tempDir();
    await writeArtifacts(dir, {
      manifest: manifestFor([
        { planId: 'module-a', dependsOnPlanIds: [] },
        { planId: 'module-b', dependsOnPlanIds: [] },
        // Present in the manifest only: must be left untouched for
        // fail-closed presence validation.
        { planId: 'module-ghost', dependsOnPlanIds: ['module-a'] },
      ]),
      orchestrationPlans: [
        { id: 'module-a', dependsOn: [] },
        { id: 'module-b', dependsOn: ['module-a'] },
        // Present in orchestration only: must not be added to the manifest.
        { id: 'module-extra', dependsOn: [] },
      ],
    });

    const result = await syncArchitectureManifestDependencies(syncOptions(dir));

    expect(result.changed).toBe(true);
    expect(manifestDeps(await readArchitecture(dir))).toEqual({
      'module-a': [],
      'module-b': ['module-a'],
      'module-ghost': ['module-a'],
    });
  });
});

function syncOptions(cwd: string): { cwd: string; outputDir: string; planSetName: string } {
  return { cwd, outputDir: 'eforge/plans', planSetName: PLAN_SET };
}

function manifestFor(plans: Array<{ planId: string; dependsOnPlanIds: string[] }>): PlanningArchitectureManifest {
  return {
    version: 1,
    plans: plans.map((plan) => ({
      planId: plan.planId,
      title: `Plan ${plan.planId}`,
      residue: false,
      criterionIds: [],
      aspectIds: [],
      dependsOnPlanIds: plan.dependsOnPlanIds,
    })),
    fileOwnership: [],
    contracts: [],
    conflicts: [],
  };
}

async function writeArtifacts(
  cwd: string,
  options: { manifest: PlanningArchitectureManifest; orchestrationPlans?: Array<{ id: string; dependsOn: string[] }> },
): Promise<void> {
  const planDir = join(cwd, 'eforge/plans', PLAN_SET);
  await mkdir(planDir, { recursive: true });
  const markdown = [
    '# Architecture',
    '',
    'Prose describing the design.',
    '',
    '## Machine-readable manifest',
    '',
    renderArchitectureManifestFence(options.manifest),
    '',
    '## Trailing prose',
    '',
    'Notes after the fence.',
    '',
  ].join('\n');
  await writeFile(join(planDir, 'architecture.md'), markdown, 'utf-8');
  if (options.orchestrationPlans) await writeOrchestration(cwd, options.orchestrationPlans);
}

async function writeOrchestration(cwd: string, plans: Array<{ id: string; dependsOn: string[] }>): Promise<void> {
  const planDir = join(cwd, 'eforge/plans', PLAN_SET);
  await mkdir(planDir, { recursive: true });
  await writeFile(
    join(planDir, 'orchestration.yaml'),
    stringifyYaml({
      name: PLAN_SET,
      base_branch: 'main',
      pipeline: PIPELINE,
      plans: plans.map((plan) => ({
        id: plan.id,
        name: `Plan ${plan.id}`,
        depends_on: plan.dependsOn,
        branch: `${PLAN_SET}/${plan.id}`,
        build: BUILD,
        review: DEFAULT_REVIEW,
      })),
    }),
    'utf-8',
  );
}

async function readArchitecture(cwd: string): Promise<string> {
  return readFile(join(cwd, 'eforge/plans', PLAN_SET, 'architecture.md'), 'utf-8');
}

function manifestDeps(markdown: string): Record<string, string[]> {
  const parsed = parseArchitectureManifest(markdown);
  if (!parsed.manifest) throw new Error(`manifest missing: ${parsed.errors.join('; ')}`);
  return Object.fromEntries(parsed.manifest.plans.map((plan) => [plan.planId, plan.dependsOnPlanIds]));
}

function proseAroundFence(markdown: string): { before: string; after: string } {
  const start = markdown.indexOf('```json');
  const end = markdown.indexOf('```', start + 1);
  if (start === -1 || end === -1) throw new Error('fence not found');
  return { before: markdown.slice(0, start), after: markdown.slice(end + 3) };
}
