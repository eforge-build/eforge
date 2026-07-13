import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import {
  classifyCollapsedRootDiversity,
  derivePlanningAtomGraph,
  deriveSourceInventory,
  directivesFromJudgmentGroups,
  runAdaptiveExplorationRescope,
  runDecompositionJudgment,
} from '@eforge-build/engine/planner-compiler';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { StubHarness, type StubResponse } from './stub-harness.js';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 4_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 24, maxCriteriaPerUnit: 20, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function prd(criteria: string[]): string {
  return ['# Decomposition Judgment', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

// Three concrete subsystems (engine, client, monitor) against maxSubsystemsPerUnit=2.
const diverseContent = prd([
  'engine updates `packages/engine/src/alpha-owner.ts` for grounded flag handling.',
  'client updates `packages/client/src/beta-consumer.ts` for grounded flag handling.',
  'monitor updates `packages/monitor/src/gamma-view.ts` for grounded flag handling.',
]);
const diverseInventory = () => deriveSourceInventory({ content: diverseContent, hash: hash(diverseContent) });

const judgmentSubmit = (input: unknown): StubResponse => ({ toolCalls: [{ tool: 'submit_decomposition_judgment', toolUseId: 'judge-1', input, output: '' }] });

describe('collapsed root diversity screen', () => {
  it('flags a collapsed root spanning more concrete subsystems than one unit allows', () => {
    const result = classifyCollapsedRootDiversity(diverseInventory(), limits, 1);
    expect(result.diverse).toBe(true);
    expect(result.concreteSubsystemCount).toBeGreaterThan(limits.maxSubsystemsPerUnit);
  });

  it('is not diverse for already-decomposed graphs, within-envelope roots, or generic-only hints', () => {
    const inventory = diverseInventory();
    expect(classifyCollapsedRootDiversity(inventory, limits, 2)).toEqual({ diverse: false, concreteSubsystemCount: 0 });
    expect(classifyCollapsedRootDiversity(inventory, { ...limits, maxSubsystemsPerUnit: 8 }, 1).diverse).toBe(false);
    const generic = { ...inventory, criteria: inventory.criteria.map((criterion) => ({ ...criterion, subsystemHints: ['general', 'test'] })) };
    expect(classifyCollapsedRootDiversity(generic, limits, 1)).toEqual({ diverse: false, concreteSubsystemCount: 0 });
  });
});

describe('judgment group validation', () => {
  const groups = (entries: Array<{ groupKey: string; criterionIds: string[] }>) => entries.map((entry) => ({ ...entry, rationale: 'stands alone' }));

  it('maps valid groups to risk-split directives with sorted criterion ids', () => {
    const result = directivesFromJudgmentGroups(diverseInventory(), groups([
      { groupKey: 'engine-work', criterionIds: ['ac-001'] },
      { groupKey: 'ui-work', criterionIds: ['ac-003', 'ac-002'] },
    ]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.directives.map((directive) => directive.directiveId)).toEqual(['risk-engine-work', 'risk-ui-work']);
    expect(result.directives[1]).toMatchObject({ criterionIds: ['ac-002', 'ac-003'], origin: 'risk-split' });
    expect(result.directives[0].rationale).toContain('risk split (agent)');
  });

  it('disambiguates colliding group-key slugs', () => {
    const result = directivesFromJudgmentGroups(diverseInventory(), groups([
      { groupKey: 'api/v1', criterionIds: ['ac-001'] },
      { groupKey: 'api.v1', criterionIds: ['ac-002', 'ac-003'] },
    ]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.directives.map((directive) => directive.directiveId)).toEqual(['risk-api-v1', 'risk-api-v1-2']);
  });

  it('keeps directive ids unique when a slug collides with another slug-plus-suffix', () => {
    const result = directivesFromJudgmentGroups(diverseInventory(), groups([
      { groupKey: 'api v1', criterionIds: ['ac-001'] },
      { groupKey: 'api.v1', criterionIds: ['ac-002'] },
      { groupKey: 'api-v1-2', criterionIds: ['ac-003'] },
    ]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.directives.map((directive) => directive.directiveId);
    expect(new Set(ids).size).toBe(3);
  });

  it('dedupes a criterion repeated within a single group instead of rejecting', () => {
    const result = directivesFromJudgmentGroups(diverseInventory(), groups([
      { groupKey: 'engine-work', criterionIds: ['ac-001', 'ac-001'] },
      { groupKey: 'ui-work', criterionIds: ['ac-002', 'ac-003'] },
    ]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.directives[0].criterionIds).toEqual(['ac-001']);
  });

  it('rejects unknown ids, double assignment, missing coverage, and single groups', () => {
    const inventory = diverseInventory();
    const unknown = directivesFromJudgmentGroups(inventory, groups([{ groupKey: 'a', criterionIds: ['ac-001', 'ac-999'] }, { groupKey: 'b', criterionIds: ['ac-002', 'ac-003'] }]));
    expect(unknown).toMatchObject({ ok: false });
    if (!unknown.ok) expect(unknown.problems.join(' ')).toContain('unknown criterion id ac-999');
    const doubled = directivesFromJudgmentGroups(inventory, groups([{ groupKey: 'a', criterionIds: ['ac-001', 'ac-002'] }, { groupKey: 'b', criterionIds: ['ac-002', 'ac-003'] }]));
    if (!doubled.ok) expect(doubled.problems.join(' ')).toContain('assigned to both');
    const uncovered = directivesFromJudgmentGroups(inventory, groups([{ groupKey: 'a', criterionIds: ['ac-001'] }, { groupKey: 'b', criterionIds: ['ac-002'] }]));
    if (!uncovered.ok) expect(uncovered.problems.join(' ')).toContain('ac-003 is not assigned');
    const single = directivesFromJudgmentGroups(inventory, groups([{ groupKey: 'a', criterionIds: ['ac-001', 'ac-002', 'ac-003'] }]));
    if (!single.ok) expect(single.problems.join(' ')).toContain('at least 2');
    expect([unknown.ok, doubled.ok, uncovered.ok, single.ok]).toEqual([false, false, false, false]);
  });
});

describe('decomposition judgment agent', () => {
  const runJudgment = (responses: StubResponse[]) => runDecompositionJudgment({
    cwd: '/tmp', harness: new StubHarness(responses), inventory: diverseInventory(), concreteSubsystemCount: 3,
  });

  it('returns cohesive verdicts as-is', async () => {
    const result = await runJudgment([judgmentSubmit({ decision: 'cohesive', rationale: 'One trust boundary; splitting forces constant coordination.' })]);
    expect(result).toMatchObject({ verdict: 'cohesive', rationale: expect.stringContaining('trust boundary') });
  });

  it('maps valid split groups to agent-sourced directives', async () => {
    const result = await runJudgment([judgmentSubmit({ decision: 'split', rationale: 'Three independent surfaces.', groups: [
      { groupKey: 'engine-work', criterionIds: ['ac-001'], rationale: 'engine only' },
      { groupKey: 'ui-work', criterionIds: ['ac-002', 'ac-003'], rationale: 'client+monitor rendering' },
    ] })]);
    expect(result).toMatchObject({ verdict: 'split', source: 'agent' });
    if (result.verdict === 'split' && result.directives) expect(result.directives).toHaveLength(2);
  });

  it('reports invalid split groups for deterministic fallback', async () => {
    const result = await runJudgment([judgmentSubmit({ decision: 'split', rationale: 'Split it.', groups: [
      { groupKey: 'a', criterionIds: ['ac-001', 'ac-999'], rationale: 'bad id' },
      { groupKey: 'b', criterionIds: ['ac-002', 'ac-003'], rationale: 'rest' },
    ] })]);
    expect(result).toMatchObject({ verdict: 'split', source: 'invalid-groups' });
    if (result.verdict === 'split' && result.source === 'invalid-groups') expect(result.problems.join(' ')).toContain('ac-999');
  });

  it('fails open to unavailable when the agent never submits', async () => {
    const result = await runJudgment([{ text: 'I think it should be split but I will not call the tool.' }]);
    expect(result.verdict).toBe('unavailable');
  });
});

describe('risk-split atoms and rescope loop integration', () => {
  it('labels atoms from risk-split directives with the risk-split reason', () => {
    const inventory = diverseInventory();
    const validation = directivesFromJudgmentGroups(inventory, [
      { groupKey: 'engine-work', criterionIds: ['ac-001'], rationale: 'engine only' },
      { groupKey: 'ui-work', criterionIds: ['ac-002', 'ac-003'], rationale: 'rendering' },
    ]);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    const graph = derivePlanningAtomGraph({ content: diverseContent, hash: hash(diverseContent), limits, inventory, rescopeDirectives: validation.directives });
    expect(graph.atoms.length).toBeGreaterThan(1);
    expect(new Set(graph.atoms.map((atom) => atom.reason))).toEqual(new Set(['risk-split']));
  });

  async function repoWithAllOwners(): Promise<string> {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-decomp-judgment-'));
    for (const file of ['packages/engine/src/alpha-owner.ts', 'packages/client/src/beta-consumer.ts', 'packages/monitor/src/gamma-view.ts']) {
      await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
      await writeFile(path.join(cwd, file), 'export const grounded = true;\n', 'utf8');
    }
    return cwd;
  }

  it('splits a diverse collapsed root on the exploration-skip path and records the decision', async () => {
    const cwd = await repoWithAllOwners();
    const events: EforgeEvent[] = [];
    const result = await runAdaptiveExplorationRescope({
      cwd, harness: new StubHarness([judgmentSubmit({ decision: 'split', rationale: 'Independent workstreams.', groups: [
        { groupKey: 'engine-work', criterionIds: ['ac-001'], rationale: 'engine only' },
        { groupKey: 'ui-work', criterionIds: ['ac-002', 'ac-003'], rationale: 'rendering' },
      ] })]),
      sourceContent: diverseContent, inventory: diverseInventory(), limits,
      onEvent: (event) => events.push(event),
    });
    expect(result.rescopeDirectives?.map((directive) => directive.directiveId)).toEqual(['risk-engine-work', 'risk-ui-work']);
    expect(result.diagnostics.decomposition).toMatchObject({ verdict: 'split', source: 'agent', groupCount: 2 });
    expect(result.diagnostics.decomposition?.concreteSubsystemCount).toBeGreaterThanOrEqual(3);
    const decision = events.find((event) => event.type === 'planning:decision');
    expect(decision).toMatchObject({ decision: { kind: 'root-decomposition', verdict: 'split', source: 'agent' } });
  });

  it('keeps the collapse when the judgment says cohesive, recording the decision', async () => {
    const cwd = await repoWithAllOwners();
    const events: EforgeEvent[] = [];
    const result = await runAdaptiveExplorationRescope({
      cwd, harness: new StubHarness([judgmentSubmit({ decision: 'cohesive', rationale: 'One coherent flag-handling change.' })]),
      sourceContent: diverseContent, inventory: diverseInventory(), limits,
      onEvent: (event) => events.push(event),
    });
    expect(result.rescopeDirectives).toBeUndefined();
    expect(result.diagnostics.decomposition).toMatchObject({ verdict: 'cohesive', source: 'agent' });
    expect(events.find((event) => event.type === 'planning:decision')).toMatchObject({ decision: { verdict: 'cohesive' } });
  });

  it('falls back to deterministic grouping when the agent groups are invalid', async () => {
    const cwd = await repoWithAllOwners();
    const result = await runAdaptiveExplorationRescope({
      cwd, harness: new StubHarness([judgmentSubmit({ decision: 'split', rationale: 'Split it.', groups: [
        { groupKey: 'only-group', criterionIds: ['ac-001', 'ac-002', 'ac-003'], rationale: 'everything' },
      ] })]),
      sourceContent: diverseContent, inventory: diverseInventory(), limits,
    });
    expect(result.diagnostics.decomposition).toMatchObject({ verdict: 'split', source: 'deterministic-fallback' });
    expect(result.rescopeDirectives?.length).toBeGreaterThanOrEqual(2);
    expect(new Set(result.rescopeDirectives?.map((directive) => directive.origin))).toEqual(new Set(['risk-split']));
  });

  it('fails open to the collapse when the judgment agent never submits', async () => {
    const cwd = await repoWithAllOwners();
    const result = await runAdaptiveExplorationRescope({
      cwd, harness: new StubHarness([{ text: 'no submission' }]),
      sourceContent: diverseContent, inventory: diverseInventory(), limits,
    });
    expect(result.rescopeDirectives).toBeUndefined();
    expect(result.diagnostics.decomposition).toMatchObject({ verdict: 'unavailable' });
  });

  it('uses agent grouping for the degraded pre-split when exploration is required', async () => {
    // No owner files exist, so literal needs stay unresolved: exploration is
    // required and the root is risky - the incident shape that previously
    // produced a purely lexical pre-split.
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-decomp-degraded-'));
    const explorationSubmit = (toolUseId: string) => ({ toolCalls: [{ tool: 'submit_exploration_outcome', toolUseId, input: { status: 'budget-exhausted', reasons: ['tool-budget'] }, output: 'ok' }] });
    const result = await runAdaptiveExplorationRescope({
      cwd, harness: new StubHarness([
        judgmentSubmit({ decision: 'split', rationale: 'Two independent workstreams.', groups: [
          { groupKey: 'engine-work', criterionIds: ['ac-001'], rationale: 'engine only' },
          { groupKey: 'ui-work', criterionIds: ['ac-002', 'ac-003'], rationale: 'rendering' },
        ] }),
        explorationSubmit('scope-1'),
        explorationSubmit('scope-2'),
      ]),
      sourceContent: diverseContent, inventory: diverseInventory(), limits,
    });
    expect(result.rescopeDirectives?.map((directive) => directive.directiveId).sort()).toEqual(['risk-engine-work', 'risk-ui-work']);
    expect(result.diagnostics.decomposition).toMatchObject({ verdict: 'split', source: 'agent', groupCount: 2 });
  });

  it('skips the degraded pre-split when the judgment says cohesive, proceeding to broad exploration first', async () => {
    // A cohesive verdict suppresses the PRE-split. If exploration then stays
    // degraded, the attempt loop may still rescope lexically as a
    // localization remedy - that override is intentional and fail-closed.
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-decomp-degraded-cohesive-'));
    const explorationSubmit = (toolUseId: string) => ({ toolCalls: [{ tool: 'submit_exploration_outcome', toolUseId, input: { status: 'budget-exhausted', reasons: ['tool-budget'] }, output: 'ok' }] });
    const events: EforgeEvent[] = [];
    const result = await runAdaptiveExplorationRescope({
      cwd, harness: new StubHarness([
        judgmentSubmit({ decision: 'cohesive', rationale: 'One coherent change.' }),
        explorationSubmit('broad'),
        explorationSubmit('scope-1'),
        explorationSubmit('scope-2'),
      ]),
      sourceContent: diverseContent, inventory: diverseInventory(), limits,
      onEvent: (event) => events.push(event),
    });
    expect(result.diagnostics.decomposition).toMatchObject({ verdict: 'cohesive', source: 'agent', overriddenByLocalizationRescope: true });
    expect(events.some((event) => event.type === 'planning:progress' && (event as { message: string }).message.includes('Adaptive rescope pre-split'))).toBe(false);
    expect(events.some((event) => event.type === 'planning:warning' && (event as { message: string }).message.includes('overrides the decomposition judgment'))).toBe(true);
  });
});
