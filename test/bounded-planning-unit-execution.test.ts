import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runBoundedPlanningUnit } from '@eforge-build/engine/agents/bounded-planning-unit';
import { CompileScopeContextError } from '@eforge-build/engine/compile-resilience/context-guard';
import {
  formatBoundedHandoffContext,
  formatBoundedPlanningPromptContext,
} from '@eforge-build/engine/compile-resilience/bounded-planning-context';
import type { PlanningDecompositionUnit, PlanningUnitOutput } from '@eforge-build/engine/compile-resilience/planning-decomposition';
import type { EforgeEvent, PlanningUnitBudget } from '@eforge-build/engine/events';
import type { ArchitectureSubmission, PlanSetSubmission } from '@eforge-build/engine/schemas';

import { StubHarness, type StubScriptedEvent } from './stub-harness.js';
import { useTempDir } from './test-tmpdir.js';

const makeTempDir = useTempDir('eforge-bounded-planning-unit-');

function budget(overrides: Partial<PlanningUnitBudget> = {}): PlanningUnitBudget {
  return { maxRecursiveDepth: 2, maxPromptSourceBytes: 20_000, maxPromptBytes: 80_000, maxObservedInputTokens: 10_000, maxObservedTurns: 20, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 5, maxCriteriaPerUnit: 10, maxSubsystemsPerUnit: 5, maxSplitAttemptsPerUnit: 2, ...overrides };
}

function unit(budgets = budget()): PlanningDecompositionUnit {
  return { unitId: 'unit-engine-contracts', parentId: 'root-planning-unit', depth: 1, title: 'Engine contracts', sourceSlices: [{ kind: 'prd', sourceHash: 'a'.repeat(64), headingPath: ['Acceptance Criteria'], criteriaIds: ['ac-001', 'ac-002'], byteLength: 80 }], criteriaIds: ['ac-001', 'ac-002'], subsystemHints: ['engine', 'client'], dependsOn: ['unit-client-events'], interfaceConstraints: ['keep client-owned events'], sharedFileConstraints: ['avoid compile-stages strategy edits'], budgets, status: 'queued' };
}

function planSet(overrides: Partial<PlanSetSubmission> = {}): PlanSetSubmission {
  return { description: 'Bounded plan set', plans: [{ frontmatter: { id: 'plan-01-bounded', name: 'Bounded' }, body: '# Bounded\n\nImplement bounded capture.' }], orchestration: { validate: [], plans: [{ id: 'plan-01-bounded', dependsOn: [] }] }, ...overrides };
}

function architectureSubmission(): ArchitectureSubmission {
  return {
    architecture: '# Bounded Architecture\n\nUse bounded module contracts.',
    modules: [{ id: 'engine-contracts', description: 'Engine contract changes', dependsOn: [] }],
    index: { name: 'bounded', description: 'Bounded expedition', mode: 'expedition', validate: [], modules: { 'engine-contracts': { description: 'Engine contract changes', depends_on: [] } } },
  };
}

function usage(input: number, numTurns = 1): StubScriptedEvent {
  return { kind: 'usage', usage: { input, total: input, output: 1 }, numTurns, final: false };
}

async function run(overrides: { harness?: StubHarness; budgets?: PlanningUnitBudget; source?: string; pipelineScope?: 'excursion' | 'expedition'; agentMode?: 'planner' | 'module-planner'; upstreamOutputs?: PlanningUnitOutput[] } = {}) {
  const cwd = makeTempDir();
  const artifactDir = resolve(cwd, '.decomposition/units/unit-engine-contracts');
  await mkdir(artifactDir, { recursive: true });
  const events: EforgeEvent[] = [];
  const budgets = overrides.budgets ?? budget();
  const output = await runBoundedPlanningUnit({
    unit: unit(budgets),
    unitSourceContent: overrides.source ?? 'Unit-only source for ac-001 and ac-002.',
    sourceHash: 'b'.repeat(64),
    upstreamOutputs: overrides.upstreamOutputs ?? [],
    upstreamCompactHandoffRefs: [],
    budgets,
    artifactDir,
    cwd,
    planSetName: 'bounded',
    pipelineScope: overrides.pipelineScope ?? 'excursion',
    outputDir: 'eforge/plans',
    harness: overrides.harness ?? new StubHarness([{ events: [{ kind: 'tool_call', tool: 'submit_plan_set', toolUseId: 'submit-1', input: planSet(), output: '' }], text: 'submitted' }]),
    agentMode: overrides.agentMode ?? 'planner',
    agentOptions: { maxTurns: 3 },
    auto: true,
    emit: event => { events.push(event); },
  });
  return { output, events, cwd, artifactDir };
}

function eventTypes(events: EforgeEvent[]): string[] {
  return events.map(event => event.type);
}

describe('bounded planning context formatting', () => {
  it('includes bounded unit facts, upstream summaries, budgets, and excludes absent root source', () => {
    const text = formatBoundedPlanningPromptContext({
      unit: unit(),
      unitSourceContent: 'Only the unit source is available.',
      sourceHash: 'b'.repeat(64),
      upstreamOutputs: [{ unitId: 'unit-client-events', status: 'completed', coveredCriteria: ['ac-upstream'], sharedContractNotes: ['event schema remains client-owned'], unresolvedRequirements: [{ criterionId: 'ac-later', reason: 'needs sibling', evidence: 'upstream summary' }], compactHandoffRef: 'handoff.md' }],
      upstreamCompactHandoffRefs: ['handoff.md'],
      budgets: budget({ maxCompactHandoffBytes: 1234 }),
      artifactDir: '.decomposition/units/unit-engine-contracts',
    });

    expect(text).toContain('Unit ID: unit-engine-contracts');
    expect(text).toContain('Parent ID: root-planning-unit');
    expect(text).toContain('Dependencies: unit-client-events');
    expect(text).toContain('Covered criteria IDs: ac-001, ac-002');
    expect(text).toContain('engine');
    expect(text).toContain('keep client-owned events');
    expect(text).toContain('avoid compile-stages strategy edits');
    expect(text).toContain('maxCompactHandoffBytes: 1234');
    expect(text).toContain('event schema remains client-owned');
    expect(text).toContain('handoff.md');
    expect(text).toContain('Full root source and full root transcript are unavailable by design');
    expect(text).not.toContain('ROOT-SOURCE-SHOULD-NOT-APPEAR');
  });

  it('rejects raw upstream source and transcript fields from bounded prompt fragments', () => {
    expect(() => formatBoundedPlanningPromptContext({
      unit: unit(),
      unitSourceContent: 'safe unit source',
      sourceHash: 'b'.repeat(64),
      upstreamOutputs: [{ unitId: 'unit-upstream', sourceContent: 'ROOT-SOURCE-SHOULD-NOT-APPEAR' } as unknown as PlanningUnitOutput],
      upstreamCompactHandoffRefs: [],
      budgets: budget(),
      artifactDir: '.decomposition/units/unit-engine-contracts',
    })).toThrow(/Forbidden raw upstream field/);
  });

  it('caps included upstream handoff markdown while keeping each handoff reference visible', async () => {
    const cwd = makeTempDir();
    const handoffPath = resolve(cwd, 'handoff.md');
    await writeFile(handoffPath, `# Planner Inspection Handoff\n\n${'large handoff '.repeat(100)}`);

    const result = await formatBoundedHandoffContext([handoffPath, resolve(cwd, 'missing.md')], 80);

    expect(result.markdown).toContain(handoffPath);
    expect(result.markdown).toContain('missing.md');
    expect(result.inclusions[0].byteLength).toBeLessThanOrEqual(80);
    expect(result.inclusions[0].omittedBytes).toBeGreaterThan(0);
    expect(result.markdown).not.toContain('large handoff '.repeat(20));
  });
});

describe('bounded planning unit execution', () => {
  it('captures a planner plan-set submission without writing root orchestration', async () => {
    const harness = new StubHarness([{ events: [{ kind: 'tool_call', tool: 'submit_plan_set', toolUseId: 'submit-1', input: planSet(), output: '' }], text: 'submitted' }]);
    const { output, events, cwd } = await run({ harness, source: 'Unit-only source for ac-001 and ac-002.' });

    expect(output.status).toBe('completed');
    expect(output.coveredCriteria).toEqual(['ac-001', 'ac-002']);
    expect(output.planSuggestions?.[0]?.id).toBe('plan-01-bounded');
    expect(output.synthesisNotes?.join('\n')).toContain('captured plan-set submission');
    expect(harness.prompts[0]).toContain('Unit ID: unit-engine-contracts');
    expect(harness.prompts[0]).toContain('Full root source and full root transcript are unavailable by design');
    expect(harness.prompts[0]).not.toContain('ROOT-SOURCE-SHOULD-NOT-APPEAR');
    expect(harness.calls[0].tools).toBe('read-only');
    expect(eventTypes(events)).toContain('planning:decomposition:unit:completed');
    expect(eventTypes(events)).not.toContain('planning:complete');
    await expect(stat(resolve(cwd, 'eforge/plans/bounded/orchestration.yaml'))).rejects.toThrow();
  });

  it('captures an expedition architecture submission as module suggestions without writing architecture.md', async () => {
    const harness = new StubHarness([{ events: [{ kind: 'tool_call', tool: 'submit_architecture', toolUseId: 'submit-architecture-1', input: architectureSubmission(), output: '' }], text: 'architecture submitted' }]);
    const { output, cwd } = await run({ harness, pipelineScope: 'expedition' });

    expect(output.status).toBe('completed');
    expect(output.moduleSuggestions).toHaveLength(1);
    expect(output.moduleSuggestions?.[0]).toMatchObject({ id: 'engine-contracts', description: 'Engine contract changes', dependsOn: [] });
    expect(output.synthesisNotes?.join('\n')).toContain('captured architecture submission');
    await expect(stat(resolve(cwd, 'eforge/plans/bounded/architecture.md'))).rejects.toThrow();
  });

  it('injects submit_module_plan and captures bounded module markdown without requiring a module file', async () => {
    const harness = new StubHarness([{ events: [{ kind: 'tool_call', tool: 'submit_module_plan', toolUseId: 'submit-module-1', input: { markdown: '# Module\n\nDo work.', buildConfigBlock: 'build: [test]' }, output: '' }], text: 'module submitted' }]);
    const { output, cwd } = await run({ harness, source: 'Module unit source', pipelineScope: 'expedition', agentMode: 'module-planner' });

    expect(harness.customToolSets[0]?.map(tool => tool.name)).toContain('submit_module_plan');
    expect(harness.calls[0].tools).toBe('read-only');
    expect(harness.prompts[0]).toContain('submit_module_plan');
    expect(output.planSuggestions?.[0]).toMatchObject({ id: 'unit-engine-contracts', markdown: expect.stringContaining('# Module'), buildConfigBlock: 'build: [test]' });
    await expect(stat(resolve(cwd, 'eforge/plans/bounded/modules/unit-engine-contracts.md'))).rejects.toThrow();
  });

  it('emits lifecycle events without forwarding raw agent events', async () => {
    const { events } = await run();
    const types = eventTypes(events);

    expect(types[0]).toBe('planning:decomposition:unit:running');
    expect(types).not.toContain('agent:start');
    expect(types).not.toContain('agent:tool_use');
    expect(types).not.toContain('agent:tool_result');
    expect(types.indexOf('planning:decomposition:unit:completed')).toBeGreaterThan(types.indexOf('planning:decomposition:unit:running'));
    expect(types).toContain('planning:decomposition:unit:progress');
    expect(types).toContain('planning:decomposition:budget');
  });

  it('returns failed bounded-unit evidence on live input-token budget pressure', async () => {
    const budgets = budget({ maxObservedInputTokens: 50 });
    const harness = new StubHarness([{ events: [usage(75), { kind: 'tool_call', tool: 'submit_plan_set', toolUseId: 'submit-1', input: planSet(), output: '' }], text: 'submitted' }]);

    const { output, events } = await run({ harness, budgets });

    expect(output.status).toBe('failed');
    expect(output.observedBudget?.triggeredLimitKeys).toContain('maxObservedInputTokens');
    expect(eventTypes(events)).toContain('planning:decomposition:unit:failed');
  });

  it('throws before harness invocation when the bounded unit prompt exceeds its prompt budget', async () => {
    const harness = new StubHarness([{ text: 'not reached' }]);
    const budgets = budget({ maxPromptBytes: 10 });

    await expect(run({ harness, budgets })).rejects.toBeInstanceOf(CompileScopeContextError);
    expect(harness.calls).toHaveLength(0);
  });

  it('throws before harness invocation when the bounded unit source exceeds its source budget', async () => {
    const harness = new StubHarness([{ text: 'not reached' }]);
    const budgets = budget({ maxPromptSourceBytes: 5 });

    await expect(run({ harness, budgets, source: 'source longer than five bytes' })).rejects.toBeInstanceOf(CompileScopeContextError);
    expect(harness.calls).toHaveLength(0);
  });

  it('fails bounded module planner output when no module plan submission is captured', async () => {
    const harness = new StubHarness([{ text: 'I forgot to submit the module plan.' }]);
    const { output, events } = await run({ harness, agentMode: 'module-planner' });

    expect(output.status).toBe('failed');
    expect(output.planSuggestions).toEqual([]);
    expect(events.some(event => event.type === 'planning:decomposition:unit:failed')).toBe(true);
  });

  it('returns failed unit evidence when capture-only planner submission fails validation', async () => {
    const invalid = planSet({ orchestration: { validate: [], plans: [{ id: 'plan-01-bounded', dependsOn: ['missing-plan'] }] } });
    const harness = new StubHarness([{ events: [{ kind: 'tool_call', tool: 'submit_plan_set', toolUseId: 'submit-invalid', input: invalid, output: '' }], text: 'submitted invalid payload' }]);
    const { output, events } = await run({ harness });

    expect(output.status).toBe('failed');
    expect(output.unitId).toBe('unit-engine-contracts');
    expect(output.unresolvedRequirements?.[0]?.evidence).toContain('unit-engine-contracts');
    expect(eventTypes(events)).toContain('planning:decomposition:unit:failed');
  });

  it('creates a unit-local compact handoff and restarts synthesis without raw tool transcripts', async () => {
    const rawSentinel = `RAW-TRANSCRIPT-SHOULD-NOT-APPEAR-${'x'.repeat(2_000)}`;
    const harness = new StubHarness([
      { events: [{ kind: 'tool_call', tool: 'Read', toolUseId: 'read-1', input: { file_path: 'packages/engine/src/contracts.ts' }, output: rawSentinel }, usage(90, 2)], text: 'inspection only' },
      { events: [{ kind: 'tool_call', tool: 'submit_plan_set', toolUseId: 'submit-1', input: planSet(), output: '' }], text: 'submitted from compact handoff' },
    ]);
    const budgets = budget({ maxLocalExplorationToolUses: 1, maxObservedInputTokens: 10_000 });
    const { output, events, artifactDir } = await run({ harness, budgets, source: 'Unit source for compact continuation.' });

    expect(harness.calls).toHaveLength(2);
    expect(harness.calls[0].tools).toBe('read-only');
    expect(harness.calls[1].tools).toBe('read-only');
    expect(output.compactHandoffRef).toContain(artifactDir);
    expect(eventTypes(events)).toContain('planning:decomposition:compact-handoff');
    const compactEvent = events.find((event): event is Extract<EforgeEvent, { type: 'planning:decomposition:compact-handoff' }> => event.type === 'planning:decomposition:compact-handoff');
    expect(compactEvent?.artifactPath).toContain('/.decomposition/units/unit-engine-contracts/');
    expect(compactEvent?.byteLength).toBeGreaterThan(0);
    expect(compactEvent?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(harness.prompts[1]).toContain('Planner Inspection Handoff');
    expect(harness.prompts[1]).toContain('Unit source for compact continuation.');
    expect(harness.prompts[1]).not.toContain('RAW-TRANSCRIPT-SHOULD-NOT-APPEAR');
    await expect(readFile(output.compactHandoffRef!, 'utf8')).resolves.toContain('unit-engine-contracts');
  });
});
