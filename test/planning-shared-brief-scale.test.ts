import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { derivePlanningAtomGraph, deriveSharedPlanningBrief, deriveSourceInventory, deriveSourceLocalization, materializePlanningSourceEvidence, validateSharedPlanningBrief } from '@eforge-build/engine/planner-compiler';

// Regression for the eval failure where a 24-line health-check PRD against a
// small real repository blew the shared-brief budgets (total bytes, per-atom
// section count, and per-section bytes via a truncation off-by-two) and the
// compile failed closed. The brief must fit its DEFAULT budgets by
// construction against realistic localization fan-out, never by throwing.

const FIXTURE_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/todo-api-repo');

// Production defaults from DEFAULT_PLANNING_DECOMPOSITION_CONFIG - the tiny
// limits used elsewhere in tests would mask the scale behavior under test.
const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 40_000, maxPromptBytes: 80_000, maxObservedInputTokens: 120_000, maxCompactHandoffBytes: 12_000, maxLocalExplorationToolUses: 24, maxCriteriaPerUnit: 20, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };

// Reconstruction of the normalizer's canonical source for the fixture's
// docs/add-health-check.md PRD: prose requirements become checkbox criteria.
const NORMALIZED_HEALTH_CHECK_PRD = [
  '# Add health check endpoint',
  '',
  '## Overview',
  '',
  'Expose a lightweight health check endpoint so deployment tooling can verify the API process is alive.',
  '',
  '## Acceptance Criteria',
  '',
  '- [ ] A `GET /health` route returns HTTP 200.',
  '- [ ] The health route responds with a JSON body of `{ "status": "ok" }`.',
  '- [ ] The route is mounted at the app level, not under the todos router.',
  '- [ ] The endpoint works without any todo state or configuration.',
  '- [ ] A test verifies the endpoint returns 200 with the expected JSON body.',
  '- [ ] Existing todos route tests continue to pass.',
].join('\n');

const hash = `h${NORMALIZED_HEALTH_CHECK_PRD.length}`.padEnd(64, '0');

async function deriveFixtureBrief() {
  const inventory = deriveSourceInventory({ content: NORMALIZED_HEALTH_CHECK_PRD, hash, path: 'docs/add-health-check.md' });
  const graph = derivePlanningAtomGraph({ content: NORMALIZED_HEALTH_CHECK_PRD, hash, path: 'docs/add-health-check.md', limits, inventory });
  const localization = await deriveSourceLocalization({ cwd: FIXTURE_REPO, inventory, graph });
  const brief = deriveSharedPlanningBrief({ graph, sourceLocalizationBundle: localization });
  return { inventory, graph, localization, brief };
}

describe('planning shared brief at realistic scale (todo-api eval regression)', () => {
  it('fits default budgets by construction against real repository localization', async () => {
    const { graph, brief } = await deriveFixtureBrief();

    expect(validateSharedPlanningBrief(brief, graph)).toEqual({ ok: true, errors: [] });
    expect(brief.byteLength).toBeLessThanOrEqual(brief.limits.maxTotalBriefBytes);
    for (const section of brief.sections) expect(section.byteLength).toBeLessThanOrEqual(brief.limits.maxSectionBytes);
    for (const atomBrief of brief.atomBriefs) expect(atomBrief.sectionIds.length).toBeLessThanOrEqual(brief.limits.maxSectionsPerAtom);
  });

  it('collapses the small PRD to a single root atom so budgets never bind', async () => {
    const { graph, brief, localization } = await deriveFixtureBrief();

    // Single-unit collapse: six criteria fit one planning unit, so the graph
    // must not fragment into foundation/subsystem atoms (which defeated the
    // single-atom reduce passthrough and multiplied shared sections).
    expect(graph.atoms.map((atom) => atom.atomId)).toEqual(['atom-root']);
    // Surface-kind localization is capped, so no need sweeps in the whole repo.
    const surfaceCap = localization.limits.maxSurfaceCandidatesPerNeed;
    for (const record of localization.records.filter((item) => ['manifest', 'entrypoint', 'docs', 'test', 'config', 'command', 'route', 'api', 'ui', 'extension', 'consumer-surface'].includes(item.kind))) {
      expect(record.candidateFiles.length, record.needId).toBeLessThanOrEqual(surfaceCap);
    }
    // With the shrunken fan-out the default budgets no longer bind at all.
    expect(brief.budgetDiagnostics).toEqual([]);
  });

  it('keeps demoted or dropped evidence available to materialization', async () => {
    const { graph, brief } = await deriveFixtureBrief();

    const bundle = await materializePlanningSourceEvidence({ cwd: FIXTURE_REPO, graph, sharedBrief: brief });

    const materialized = bundle.records.filter((record) => record.status === 'materialized');
    expect(materialized.length).toBeGreaterThan(0);
    expect(bundle.validationErrors).toEqual([]);
  });

  it('spends binding per-atom file budgets on ranked evidence, not path order', async () => {
    // Regression: with a single root atom every path funnels into one per-atom
    // file budget; path-ordered materialization starved src/test files (which
    // sort late) in favor of alphabetically-early sweep-ins, and the planner
    // then failed the compile via an unrepairable evidence gap.
    const { graph, brief } = await deriveFixtureBrief();

    const bundle = await materializePlanningSourceEvidence({ cwd: FIXTURE_REPO, graph, sharedBrief: brief, limits: { maxFilesPerAtom: 5 } });
    const statuses = new Map(bundle.records.map((record) => [record.path, record.status]));

    expect(statuses.get('test/todos.test.ts')).toBe('materialized');
    expect(statuses.get('.pi/extensions/marker/index.ts')).toBe('budget-exceeded');
  });

  it('records budget diagnostics instead of failing when budgets bind', async () => {
    // Reproduce the pre-collapse fragmentation shape (multiple atoms sharing
    // evidence) with a tight total budget so the degradation path stays
    // covered now that default budgets comfortably fit this fixture.
    const fragmented = { ...limits, maxCriteriaPerUnit: 2 };
    const inventory = deriveSourceInventory({ content: NORMALIZED_HEALTH_CHECK_PRD, hash, path: 'docs/add-health-check.md' });
    const graph = derivePlanningAtomGraph({ content: NORMALIZED_HEALTH_CHECK_PRD, hash, path: 'docs/add-health-check.md', limits: fragmented, inventory });
    const localization = await deriveSourceLocalization({ cwd: FIXTURE_REPO, inventory, graph });
    const brief = deriveSharedPlanningBrief({ graph, sourceLocalizationBundle: localization, limits: { maxTotalBriefBytes: 600 } });

    expect(graph.atoms.length).toBeGreaterThan(1);
    expect(brief.evidenceOwnership.length).toBeGreaterThan(0);
    expect(brief.budgetDiagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of brief.budgetDiagnostics) expect(diagnostic.sectionId).toBeTruthy();
    expect(validateSharedPlanningBrief(brief, graph)).toEqual({ ok: true, errors: [] });
    expect(brief.byteLength).toBeLessThanOrEqual(600);
  });
});
