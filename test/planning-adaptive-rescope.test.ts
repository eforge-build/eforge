import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { DEFAULT_ADAPTIVE_RESCOPE_LIMITS, resolveAdaptiveRescopeLimits } from '@eforge-build/engine/config';
import {
  AdaptiveRescopeFailClosedError,
  classifyRescopeRisk,
  criticalUnresolvedNeedIds,
  derivePlanningAtomGraph,
  deriveExplorationMaxTurns,
  deriveExplorationToolBudget,
  deriveRescopeDirectives,
  deriveSourceInventory,
  deriveSourceLocalization,
  partitionCriticalUnresolvedNeeds,
  runAdaptiveExplorationRescope,
  type SourceLocalizationBundle,
  type SourceLocalizationRecord,
} from '@eforge-build/engine/planner-compiler';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { StubHarness } from './stub-harness.js';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 4_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 24, maxCriteriaPerUnit: 20, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');
const rescopeLimits = resolveAdaptiveRescopeLimits();

function prd(criteria: string[]): string {
  return ['# Adaptive Rescope', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

function bundleWith(records: Array<Partial<SourceLocalizationRecord> & Pick<SourceLocalizationRecord, 'needId' | 'kind' | 'status' | 'confidence'>>): SourceLocalizationBundle {
  return {
    records: records.map((record) => ({ query: record.needId, candidateFiles: [], reason: 'test', linkedCriterionIds: [], linkedAspectIds: [], assignedAtomIds: [], diagnostics: [], budgetNotes: [], ...record })),
    byAtomId: {},
    diagnostics: [],
    limits: { maxIndexedFiles: 10_000, maxCandidateFilesPerNeed: 12, maxDirectoryExpansionFiles: 20, maxBytesPerScannedFile: 64_000, maxTotalScannedBytes: 2_000_000 },
    indexDiagnostics: [],
  };
}

describe('adaptive rescope budget derivation', () => {
  it('scales the per-scope tool budget with unresolved-need count under the configured clamp', () => {
    expect(deriveExplorationToolBudget(0, rescopeLimits, 24)).toBe(DEFAULT_ADAPTIVE_RESCOPE_LIMITS.explorationBudgetBaseToolUses);
    expect(deriveExplorationToolBudget(3, rescopeLimits, 24)).toBe(14);
    expect(deriveExplorationToolBudget(5, rescopeLimits, 24)).toBeGreaterThan(deriveExplorationToolBudget(2, rescopeLimits, 24));
    expect(deriveExplorationToolBudget(50, rescopeLimits, 24)).toBe(24);
    expect(deriveExplorationToolBudget(50, rescopeLimits, 256)).toBe(108);
  });

  it('scales the turn ceiling with the derived budget and never drops below the exploration default', () => {
    expect(deriveExplorationMaxTurns(8)).toBe(12);
    expect(deriveExplorationMaxTurns(24)).toBe(14);
    expect(deriveExplorationMaxTurns(100)).toBe(52);
  });

  it('clamps rescope limit overrides to the documented maxima', () => {
    const clamped = resolveAdaptiveRescopeLimits({ maxRescopeAttempts: 99, explorationBudgetBaseToolUses: 1_000, explorationBudgetToolUsesPerNeed: 99, explorationTotalBudgetMultiplier: 99 });
    expect(clamped).toEqual({ maxRescopeAttempts: 4, explorationBudgetBaseToolUses: 64, explorationBudgetToolUsesPerNeed: 16, explorationTotalBudgetMultiplier: 8 });
  });
});

describe('rescope risk classification and directives', () => {
  const crossCutting = () => {
    const content = prd([
      'engine updates `packages/engine/src/rescope-owner.ts` for grounded flag handling.',
      'client updates `packages/client/src/rescope-consumer.ts` for grounded flag handling.',
    ]);
    const inventory = deriveSourceInventory({ content, hash: hash(content) });
    const graph = derivePlanningAtomGraph({ content, hash: hash(content), limits, inventory });
    return { content, inventory, graph };
  };

  it('classifies a degraded outcome as risky when the high-confidence share is low', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-rescope-risk-'));
    const { inventory, graph } = crossCutting();
    const bundle = await deriveSourceLocalization({ cwd, inventory, graph });
    const risk = classifyRescopeRisk({ bundle, inventory, graph, limits });
    expect(risk.risky).toBe(true);
    expect(risk.reasons.join(' ')).toContain('low-confidence-share');
  });

  it('does not classify as risky when literal needs resolve high-confidence within one subsystem envelope', () => {
    const content = prd(['engine updates `packages/engine/src/one.ts` for grounded flag handling.']);
    const inventory = deriveSourceInventory({ content, hash: hash(content) });
    const roomyLimits = { ...limits, maxSubsystemsPerUnit: 8 };
    const graph = derivePlanningAtomGraph({ content, hash: hash(content), limits: roomyLimits, inventory });
    const bundle = bundleWith([
      { needId: 'need-1', kind: 'literal-path', status: 'resolved', confidence: 'high' },
      { needId: 'need-2', kind: 'literal-path', status: 'resolved', confidence: 'high' },
    ]);
    expect(classifyRescopeRisk({ bundle, inventory, graph, limits: roomyLimits }).risky).toBe(false);
  });

  it('classifies a collapsed subsystem-diverse root atom as risky even with a passing share', () => {
    const { inventory, graph } = crossCutting();
    const bundle = bundleWith([
      { needId: 'need-1', kind: 'literal-path', status: 'resolved', confidence: 'high' },
      { needId: 'need-2', kind: 'literal-path', status: 'resolved', confidence: 'high' },
    ]);
    const risk = classifyRescopeRisk({ bundle, inventory, graph, limits });
    expect(risk.risky).toBe(true);
    expect(risk.reasons.join(' ')).toContain('subsystem-diverse-root');
  });

  it('marks unresolved entrypoint needs and explicit project-hint interfaces as critical', () => {
    const { inventory } = crossCutting();
    const bundle = bundleWith([
      { needId: 'need-generic-iface', kind: 'interface', status: 'unresolved', confidence: 'low', source: 'criterion', linkedCriterionIds: ['ac-001'], interfaceKeys: ['schema-contract'] },
      { needId: 'need-inventory-iface', kind: 'interface', status: 'unresolved', confidence: 'low', source: 'inventory', linkedCriterionIds: ['ac-001'], interfaceKeys: ['route-api'] },
      { needId: 'need-explicit-iface', kind: 'interface', status: 'unresolved', confidence: 'low', source: 'project-hint', linkedCriterionIds: ['ac-001'], interfaceKeys: ['WidgetContract'] },
      { needId: 'need-entry', kind: 'entrypoint', status: 'partial', confidence: 'medium' },
      { needId: 'need-ok', kind: 'keyword', status: 'resolved', confidence: 'high' },
      { needId: 'need-keyword', kind: 'keyword', status: 'unresolved', confidence: 'low' },
    ]);
    expect(criticalUnresolvedNeedIds(bundle, inventory)).toEqual(['need-entry', 'need-explicit-iface']);
  });

  it('treats generic interface wording as a rescope signal but not a fail-closed blocker', () => {
    const { inventory } = crossCutting();
    const bundle = bundleWith([
      { needId: 'need-generic-linked', kind: 'interface', status: 'unresolved', confidence: 'low', source: 'criterion', linkedCriterionIds: ['ac-001'], interfaceKeys: ['schema-contract'] },
      { needId: 'need-unlinked', kind: 'interface', status: 'unresolved', confidence: 'low', source: 'inventory', interfaceKeys: ['route-api'] },
    ]);
    expect(partitionCriticalUnresolvedNeeds(bundle, inventory)).toEqual({ rescopable: [], unrescopable: [] });
  });

  it('derives deterministic split directives keyed by subsystem and returns none for a single group', () => {
    const { inventory } = crossCutting();
    const bundle = bundleWith([]);
    const directives = deriveRescopeDirectives(inventory, bundle);
    expect(directives.map((directive) => directive.groupKey)).toEqual(['client', 'engine']);
    expect(directives.map((directive) => directive.criterionIds)).toEqual([['ac-002'], ['ac-001']]);
    expect(deriveRescopeDirectives(inventory, bundle)).toEqual(directives);

    const single = prd(['engine updates `packages/engine/src/one.ts` for grounded flag handling.']);
    const singleInventory = deriveSourceInventory({ content: single, hash: hash(single) });
    expect(deriveRescopeDirectives(singleInventory, bundle)).toEqual([]);
  });

  it('disambiguates directive and atom ids when distinct group keys slug identically', () => {
    const { inventory } = crossCutting();
    // 'api/v1' and 'api.v1' both slug to 'api-v1'.
    const patched = { ...inventory, criteria: inventory.criteria.map((criterion, index) => ({ ...criterion, subsystemHints: [index === 0 ? 'api/v1' : 'api.v1'], interfaceKeys: [] })) };
    const directives = deriveRescopeDirectives(patched, bundleWith([]));
    expect(directives.map((directive) => directive.directiveId).sort()).toEqual(['rescope-api-v1', 'rescope-api-v1-2']);
    const graph = derivePlanningAtomGraph({ content: prd(['a', 'b']), hash: hash('ab'), limits, inventory: patched, rescopeDirectives: directives });
    expect(new Set(graph.atoms.map((atom) => atom.atomId)).size).toBe(graph.atoms.length);
  });
});

describe('adaptive rescope loop', () => {
  const outcome = (status: string, extra: Record<string, unknown> = {}) => ({ status, ...extra });
  const submit = (toolUseId: string, input: unknown) => ({ toolCalls: [{ tool: 'submit_exploration_outcome', toolUseId, input, output: 'ok' }] });

  it('reruns only unresolved scopes, preserves resolved scopes, and merges scoped hints', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-rescope-loop-'));
    // The client-side owner exists (its literal need resolves high-confidence);
    // the engine-side owner is missing, so only the engine scope needs a rerun.
    await mkdir(path.join(cwd, 'packages/client/src'), { recursive: true });
    await writeFile(path.join(cwd, 'packages/client/src/rescope-consumer.ts'), 'export const consumer = true;\n', 'utf8');
    const content = prd([
      'engine updates `packages/engine/src/rescope-owner.ts` for grounded flag handling.',
      'client updates `packages/client/src/rescope-consumer.ts` for grounded flag handling.',
    ]);
    const inventory = deriveSourceInventory({ content, hash: hash(content) });
    const harness = new StubHarness([
      submit('submit-engine', outcome('completed', { projectHints: [{ kind: 'literal-path', query: 'engine owner', paths: ['packages/client/src/rescope-consumer.ts'], criterionIds: ['ac-001'] }] })),
    ]);
    const events: EforgeEvent[] = [];

    const result = await runAdaptiveExplorationRescope({ cwd, harness, sourceContent: content, inventory, limits, onEvent: (event) => events.push(event) });

    expect(result.diagnostics.status).toBe('rescoped');
    expect(result.diagnostics.attempts).toBe(1);
    expect(result.rescopeDirectives?.map((directive) => directive.groupKey)).toEqual(['engine', 'client']);
    expect(result.diagnostics.rerunScopeKeys).toEqual(['engine']);
    expect(result.diagnostics.preservedScopeKeys).toEqual(['client']);
    expect(harness.calls).toHaveLength(1);
    // The scoped rerun prompt lists only the engine scope's unresolved needs
    // (the inventory summary still shows all criteria; the compact needs JSON
    // is what gets scope-filtered).
    expect(harness.prompts[0]).toContain('"query":"packages/engine/src/rescope-owner.ts"');
    expect(harness.prompts[0]).not.toContain('"query":"packages/client/src/rescope-consumer.ts"');
    expect(result.hints?.projectHints).toHaveLength(1);
    expect(result.diagnostics.revisedAtomCount).toBeGreaterThan(result.diagnostics.originalAtomCount);
    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes('Adaptive rescope attempt 1/'))).toBe(true);
  });

  it('fails closed when rescope attempts are exhausted with explicit entrypoint ownership unresolved', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-rescope-failclosed-'));
    const content = prd([
      'engine updates the package entrypoint in `packages/engine/src/rescope-main.ts`.',
      'client updates the package entrypoint in `packages/client/src/rescope-main.ts`.',
    ]);
    const inventory = deriveSourceInventory({ content, hash: hash(content) });
    const harness = new StubHarness([
      submit('submit-initial', outcome('budget-exhausted', { reasons: ['tool-budget'] })),
      submit('submit-scope-1', outcome('budget-exhausted', { reasons: ['tool-budget'] })),
      submit('submit-scope-2', outcome('budget-exhausted', { reasons: ['tool-budget'] })),
    ]);

    const attempt = runAdaptiveExplorationRescope({ cwd, harness, sourceContent: content, inventory, limits });
    await expect(attempt).rejects.toThrow(AdaptiveRescopeFailClosedError);
    await expect(attempt).rejects.toThrow(/critical source need/);
  });

  it('proceeds degraded when generic route and schema interface signals remain unresolved after scoped reruns', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-rescope-generic-interface-'));
    const content = prd([
      'The route API and schema contract tests emit a user-visible stop reason when the attempt budget is exhausted.',
      'Queue/run/auto-build projections expose policy enabled/disabled state.',
      'Typed event/schema parity tests cover the new variants.',
      'Console clearly distinguishes auto-resume decisions from user-confirmed actions.',
    ]);
    const inventory = deriveSourceInventory({ content, hash: hash(content) });
    const harness = new StubHarness(Array.from({ length: 8 }, (_, index) => submit(`submit-generic-${index}`, outcome('budget-exhausted', { reasons: ['tool-budget'] }))));

    const result = await runAdaptiveExplorationRescope({ cwd, harness, sourceContent: content, inventory, limits });

    expect(result.diagnostics.status).toBe('exhausted-proceeded');
    expect(result.diagnostics.unresolvedCriticalNeedIds).toEqual([]);
    expect(result.outcome?.status).toBe('budget-exhausted');
    expect(result.diagnostics.riskReasons.join(' ')).toContain('unresolved-interface-signals');
  });

  it('does not let a later budget-skipped scope mask critical needs that remained after a rerun', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-rescope-rerun-critical-'));
    const content = prd([
      'engine updates the package entrypoint in `packages/engine/src/rescope-main.ts`.',
      'client updates the package entrypoint in `packages/client/src/rescope-main.ts`.',
    ]);
    const inventory = deriveSourceInventory({ content, hash: hash(content) });
    const harness = new StubHarness([{ toolCalls: [
      { tool: 'read', toolUseId: 'read-critical-1', input: { path: 'packages/engine/src/rescope-api.ts' }, output: 'missing' },
      { tool: 'grep', toolUseId: 'grep-critical-1', input: { pattern: 'rescope-api' }, output: 'no matches' },
      { tool: 'submit_exploration_outcome', toolUseId: 'submit-critical-rerun', input: outcome('budget-exhausted', { reasons: ['tool-budget'] }), output: 'ok' },
    ] }]);
    const events: EforgeEvent[] = [];

    await expect(runAdaptiveExplorationRescope({
      cwd, harness, sourceContent: content, inventory, limits,
      rescopeLimits: { maxRescopeAttempts: 1, explorationTotalBudgetMultiplier: 1, explorationBudgetBaseToolUses: 1, explorationBudgetToolUsesPerNeed: 0 },
      onEvent: (event) => events.push(event),
    })).rejects.toThrow(AdaptiveRescopeFailClosedError);

    expect(events.some((event) => event.type === 'planning:warning' && event.message.includes('not masking them behind'))).toBe(true);
  });

  it('proceeds with a warning instead of rescoping when the degraded source has no split signal', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-rescope-nosplit-'));
    const content = prd(['engine updates `packages/engine/src/solo-owner.ts` for grounded flag handling.']);
    const inventory = deriveSourceInventory({ content, hash: hash(content) });
    const harness = new StubHarness([submit('submit-initial', outcome('needs-rescope', { reasons: ['too-broad'] }))]);
    const events: EforgeEvent[] = [];

    const result = await runAdaptiveExplorationRescope({ cwd, harness, sourceContent: content, inventory, limits, onEvent: (event) => events.push(event) });

    expect(result.diagnostics.status).toBe('warning-only');
    expect(result.rescopeDirectives).toBeUndefined();
    expect(harness.calls).toHaveLength(1);
    expect(events.some((event) => event.type === 'planning:warning' && event.message.includes('no split signal'))).toBe(true);
  });

  it('caps scoped reruns with the cross-run tool-use ledger', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-rescope-ledger-'));
    const content = prd([
      'engine updates `packages/engine/src/ledger-owner.ts` for grounded flag handling.',
      'client updates `packages/client/src/ledger-consumer.ts` for grounded flag handling.',
    ]);
    const inventory = deriveSourceInventory({ content, hash: hash(content) });
    // Pre-split budgeting reserves a shallow slot for each scope even when
    // the configured per-need budget is tiny.
    const harness = new StubHarness([
      submit('submit-engine', outcome('budget-exhausted', { reasons: ['tool-budget'] })),
      submit('submit-client', outcome('budget-exhausted', { reasons: ['tool-budget'] })),
    ]);
    const events: EforgeEvent[] = [];

    const result = await runAdaptiveExplorationRescope({
      cwd, harness, sourceContent: content, inventory, limits,
      rescopeLimits: { explorationTotalBudgetMultiplier: 1, explorationBudgetBaseToolUses: 1, explorationBudgetToolUsesPerNeed: 0 },
      onEvent: (event) => events.push(event),
    });

    expect(result.diagnostics.ledger.totalToolUseBudget).toBe(2);
    expect(result.diagnostics.ledger.usedToolUses).toBe(2);
    expect(result.diagnostics.rerunScopeKeys.sort()).toEqual(['client', 'engine']);
    expect(result.diagnostics.status).toBe('exhausted-proceeded');
    expect(harness.calls).toHaveLength(2);
    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes('Adaptive rescope pre-split'))).toBe(true);
  });

  it('merges scoped rerun outcomes so a completed scope does not mask a budget-exhausted sibling', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-rescope-merge-'));
    const content = prd([
      'engine updates `packages/engine/src/merge-owner.ts` for grounded flag handling.',
      'client updates `packages/client/src/merge-consumer.ts` for grounded flag handling.',
    ]);
    const inventory = deriveSourceInventory({ content, hash: hash(content) });
    // Directive order is sorted by group key when priority is tied: the client
    // scope reruns first (budget-exhausted), then the engine scope (completed
    // with a hint).
    const harness = new StubHarness([
      submit('submit-client', outcome('budget-exhausted', { reasons: ['tool-budget'] })),
      submit('submit-engine', outcome('completed', { projectHints: [{ kind: 'literal-path', query: 'engine owner', paths: ['packages/engine/src/merge-owner.ts'], criterionIds: ['ac-001'] }] })),
    ]);

    const result = await runAdaptiveExplorationRescope({ cwd, harness, sourceContent: content, inventory, limits });

    expect(result.diagnostics.status).toBe('exhausted-proceeded');
    expect(result.diagnostics.rerunScopeKeys).toEqual(['client', 'engine']);
    expect(result.outcome?.status).toBe('budget-exhausted');
    expect(result.outcome?.reasons).toContain('tool-budget');
    expect(result.hints?.projectHints).toHaveLength(1);
  });
});
