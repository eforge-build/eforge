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

  it('keeps demoted or dropped evidence available to materialization', async () => {
    const { graph, brief } = await deriveFixtureBrief();

    const bundle = await materializePlanningSourceEvidence({ cwd: FIXTURE_REPO, graph, sharedBrief: brief });

    const materialized = bundle.records.filter((record) => record.status === 'materialized');
    expect(materialized.length).toBeGreaterThan(0);
    expect(bundle.validationErrors).toEqual([]);
  });

  it('records budget diagnostics instead of failing when fan-out exceeds budgets', async () => {
    const { brief } = await deriveFixtureBrief();

    expect(brief.evidenceOwnership.length).toBeGreaterThan(0);
    // Realistic fan-out exceeds at least one budget for this fixture; the
    // overflow must surface as diagnostics, never as a compile failure.
    expect(brief.budgetDiagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of brief.budgetDiagnostics) expect(diagnostic.sectionId).toBeTruthy();
  });
});
