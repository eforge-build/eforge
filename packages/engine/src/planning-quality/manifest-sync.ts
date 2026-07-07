/**
 * Deterministic re-derivation of the architecture manifest's dependency edges
 * from orchestration.yaml after quality-review fixes are applied.
 *
 * The manifest fence in architecture.md is machine-managed: reviewer fixes may
 * change orchestration `depends_on` edges but can never edit the fence
 * (preserveArchitectureManifestFence discards such edits). Once the review
 * cycle can mutate orchestration, orchestration is the source of truth for
 * dependency edges, so the manifest's `dependsOnPlanIds` must be re-derived
 * before cohesion validation compares the two. `contracts`, `fileOwnership`,
 * and `conflicts` are compiler provenance and intentionally not re-derived.
 * Plan-presence mismatches are also intentionally untouched: entries are never
 * added or removed, so validatePlanAgreement stays fail-closed on those.
 */
import { posix, resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { parseOrchestrationConfig } from '../plan.js';
import {
  parseArchitectureManifest,
  replaceArchitectureManifestFence,
} from '../planner-compiler/architecture-manifest-contracts.js';

const MAX_DEPENDS_ON_PLAN_IDS = 32;

export interface SyncArchitectureManifestDependenciesOptions {
  cwd: string;
  outputDir: string;
  planSetName: string;
}

export interface SyncArchitectureManifestDependenciesResult {
  changed: boolean;
  /** Repo-relative posix path of the rewritten architecture.md, set when changed. */
  relPath?: string;
}

/**
 * Rewrite the manifest fence in architecture.md so each plan's
 * `dependsOnPlanIds` matches the (transitively reduced) `depends_on` edges in
 * orchestration.yaml. Missing artifacts or unparseable inputs are a no-op:
 * downstream validation owns those failures and must report them
 * authoritatively. Does NOT run git add; staging is the caller's job.
 */
export async function syncArchitectureManifestDependencies(
  options: SyncArchitectureManifestDependenciesOptions,
): Promise<SyncArchitectureManifestDependenciesResult> {
  const { cwd, outputDir, planSetName } = options;
  const architecturePath = resolve(cwd, outputDir, planSetName, 'architecture.md');

  let markdown: string;
  try {
    markdown = await readFile(architecturePath, 'utf-8');
  } catch {
    return { changed: false };
  }

  const parsed = parseArchitectureManifest(markdown);
  if (!parsed.manifest) return { changed: false };

  let depsById: Map<string, string[]>;
  try {
    const orchestration = await parseOrchestrationConfig(resolve(cwd, outputDir, planSetName, 'orchestration.yaml'));
    depsById = new Map(orchestration.plans.map((plan) => [plan.id, plan.dependsOn ?? []]));
  } catch {
    return { changed: false };
  }

  // Reduced edges beyond the manifest schema cap cannot be represented in the
  // fence; truncating would silently drop edges, so no-op and let downstream
  // cohesion validation report the mismatch authoritatively.
  for (const plan of parsed.manifest.plans) {
    const deps = depsById.get(plan.planId);
    if (deps && deps.length > MAX_DEPENDS_ON_PLAN_IDS) return { changed: false };
  }

  // parseOrchestrationConfig already transitively reduces edges; sorting
  // matches architecture synthesis so the fence stays in canonical form.
  const plans = parsed.manifest.plans.map((plan) => {
    const orchestrationDeps = depsById.get(plan.planId);
    if (!orchestrationDeps) return plan;
    return { ...plan, dependsOnPlanIds: [...orchestrationDeps].sort() };
  });

  if (JSON.stringify(plans) === JSON.stringify(parsed.manifest.plans)) return { changed: false };

  const updated = replaceArchitectureManifestFence(markdown, { ...parsed.manifest, plans });
  await writeFile(architecturePath, updated, 'utf-8');
  return { changed: true, relPath: posix.join(outputDir, planSetName, 'architecture.md') };
}
