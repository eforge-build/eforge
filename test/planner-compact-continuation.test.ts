import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runPlanner } from '@eforge-build/engine/agents/planner';
import { derivePlannerInspectionBudget } from '@eforge-build/engine/compile-resilience/planner-inspection';
import { CompileScopeContextError } from '@eforge-build/engine/compile-resilience/context-guard';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { PlanSetSubmission } from '@eforge-build/engine/schemas';

import { StubHarness, type StubScriptedEvent } from './stub-harness.js';
import { collectEvents, filterEvents, findEvent } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';

const makeTempDir = useTempDir('eforge-planner-compact-continuation-');

function validPlanSetPayload(): PlanSetSubmission {
  return {
    description: 'Compact planner continuation plan set',
    plans: [{
      frontmatter: { id: 'plan-01-compact', name: 'Compact Continuation' },
      body: '# Compact Continuation\n\n## Implementation\n\nUse compact inspection evidence to finish planning.',
    }],
    orchestration: { validate: [], plans: [{ id: 'plan-01-compact', dependsOn: [] }] },
  };
}

function submitResponse(): { events: StubScriptedEvent[]; text: string } {
  return {
    events: [{ kind: 'tool_call', tool: 'submit_plan_set', toolUseId: 'submit-1', input: validPlanSetPayload(), output: '' }],
    text: 'Submitted from compact synthesis.',
  };
}

function usage(input: number, numTurns: number): StubScriptedEvent {
  return { kind: 'usage', usage: { input, total: input, output: 20 }, numTurns, final: false };
}

function readTool(id: string, filePath: string, output: string): StubScriptedEvent[] {
  return [
    { kind: 'tool_call', tool: 'Read', toolUseId: id, input: { file_path: filePath }, output },
  ];
}

describe('runPlanner compact inspection continuation', () => {
  it('emits a compact inspection summary before the hard guard and completes from synthesis', async () => {
    const cwd = makeTempDir();
    const backend = new StubHarness([
      {
        events: [
          ...readTool('read-1', 'packages/engine/src/queue/scheduler.ts', 'Queue cleanup removes completed rows.'),
          usage(72, 4),
        ],
        text: 'Inspection should be compacted before hard context failure.',
      },
      submitResponse(),
    ]);

    const events = await collectEvents(runPlanner('Build compact planner continuation', {
      harness: backend,
      cwd,
      auto: true,
      scope: 'excursion',
      maxTurns: 10,
      contextGuard: { stage: 'planner', limits: { maxObservedInputTokens: 100 } },
    }));

    expect(findEvent(events, 'planning:inspection-summary')).toBeDefined();
    expect(findEvent(events, 'planning:continuation')?.reason).toBe('compact_inspection');
    expect(events.some((event) => event.type === 'planning:complete')).toBe(true);
    const plannerStarts = filterEvents(events, 'agent:start').filter((event) => event.agent === 'planner');
    const plannerStops = filterEvents(events, 'agent:stop').filter((event) => event.agent === 'planner');
    expect(plannerStarts).toHaveLength(2);
    expect(plannerStops.map((event) => event.agentId)).toEqual(plannerStarts.map((event) => event.agentId));
    expect(events.findIndex((event) => event.type === 'agent:stop' && event.agentId === plannerStarts[0].agentId)).toBeLessThan(events.findIndex((event) => event.type === 'planning:continuation'));
    const planContent = await readFile(resolve(cwd, 'eforge/plans/build-compact-planner-continuation/plan-01-compact.md'), 'utf8');
    expect(planContent).toContain('id: plan-01-compact');
    expect(planContent).toContain('Use compact inspection evidence to finish planning.');
    expect(backend.calls[0].tools).toBe('coding');
    expect(backend.calls[1].tools).toBe('none');
    expect(backend.customToolSets[1]?.map((tool) => tool.name)).toContain('submit_plan_set');
    expect(backend.calls[1].maxTurns).toBeLessThan(backend.calls[0].maxTurns);
  });

  it('captures required compact evidence fields and writes the handoff artifact', async () => {
    const cwd = makeTempDir();
    const backend = new StubHarness([
      {
        events: [
          ...readTool('read-1', 'packages/engine/src/queue/scheduler.ts', 'Important finding: queue cleanup coverage is missing.'),
          { kind: 'message', content: 'Observed facts include queue cleanup. Unresolved question?' },
          usage(72, 5),
        ],
      },
      submitResponse(),
    ]);

    const events = await collectEvents(runPlanner('# Queue cleanup\n\nRestore queue coverage cleanup.', {
      harness: backend,
      cwd,
      auto: true,
      scope: 'excursion',
      maxTurns: 10,
      contextGuard: { stage: 'planner', limits: { maxObservedInputTokens: 100 } },
      runId: 'run-compact-test',
    }));

    const summaryEvent = findEvent(events, 'planning:inspection-summary');
    expect(summaryEvent).toBeDefined();
    const summary = summaryEvent!.summary;
    expect(summary.relevantFiles).toContain('packages/engine/src/queue/scheduler.ts');
    expect(summary.observedFacts.join('\n')).toContain('queue cleanup');
    expect(summary.importantFindings.join('\n')).toContain('Important finding');
    expect(summary.inferredImplementationAreas).toContain('packages/engine/src/queue');
    expect(summary.unresolvedQuestions.join('\n')).toContain('Unresolved question');
    expect(summary.source.sourcePath).toBeUndefined();
    expect(summary.sourceBuildContext.buildGoal).toContain('Queue cleanup');
    expect(summary.budgetDiagnostics.observed.inputTokens).toBe(72);
    expect(summary.caveats.join('\n')).toContain('Inspection is incomplete');
    expect(summaryEvent!.artifactPath).toContain('planner-inspection-handoff.json');
  });

  it('resumes with original source plus compact summary without replaying oversized transcript text', async () => {
    const cwd = makeTempDir();
    const sentinel = `START-${'x'.repeat(2_000)}-RAW-END`;
    const source = '# Original normalized source\n\nImplement queue cleanup coverage.';
    const backend = new StubHarness([
      { events: [...readTool('read-1', 'packages/engine/src/queue/scheduler.ts', sentinel), usage(72, 3)] },
      submitResponse(),
    ]);

    await collectEvents(runPlanner(source, {
      harness: backend,
      cwd,
      auto: true,
      scope: 'excursion',
      maxTurns: 10,
      contextGuard: { stage: 'planner', limits: { maxObservedInputTokens: 100 } },
    }));

    expect(backend.prompts).toHaveLength(2);
    const synthesisPrompt = backend.prompts[1];
    expect(synthesisPrompt).toContain('Original normalized source');
    expect(synthesisPrompt).toContain('Compact Inspection Continuation');
    expect(synthesisPrompt).toContain('Planner Inspection Handoff');
    expect(synthesisPrompt).not.toContain('RAW-END');
    expect(synthesisPrompt).toContain('submit_plan_set');
  });

  it('captures a compact summary when turn/tool budgets are exceeded below the soft input-token threshold', async () => {
    const cwd = makeTempDir();
    const budget = derivePlannerInspectionBudget({
      hardLimits: { maxObservedInputTokens: 10_000 },
      plannerMaxTurns: 8,
      toolUseCaps: { maxToolUses: 2, maxToolResults: 2 },
    });
    const backend = new StubHarness([
      {
        events: [
          ...readTool('read-1', 'packages/engine/src/a.ts', 'fact a'),
          ...readTool('read-2', 'packages/engine/src/b.ts', 'fact b'),
        ],
      },
      submitResponse(),
    ]);

    const events = await collectEvents(runPlanner('Build queue cleanup coverage', {
      harness: backend,
      cwd,
      auto: true,
      scope: 'excursion',
      maxTurns: 8,
      contextGuard: { stage: 'planner', limits: { maxObservedInputTokens: 10_000 } },
      plannerInspectionBudget: budget,
    }));

    const summary = findEvent(events, 'planning:inspection-summary')?.summary;
    expect(summary).toBeDefined();
    expect(summary!.budgetDiagnostics.observed.inputTokens).toBeLessThan(budget.softInputTokenThreshold);
    expect(summary!.budgetDiagnostics.toolUseCount).toBe(2);
    expect(findEvent(events, 'planning:complete')).toBeDefined();
  });

  it('does not attempt compact inspection for genuinely oversized initial prompts', async () => {
    const cwd = makeTempDir();
    const backend = new StubHarness([{ text: 'should not run' }]);

    await expect(collectEvents(runPlanner('Oversized prompt', {
      harness: backend,
      cwd,
      auto: true,
      contextGuard: { stage: 'planner', limits: { maxPromptBytes: 1 } },
    }))).rejects.toBeInstanceOf(CompileScopeContextError);

    expect(backend.calls).toHaveLength(0);
  });

  it('uses the Fix Removed Queue Coverage Cleanup fixture with bounded synthetic pressure only', async () => {
    const cwd = makeTempDir();
    const fixturePath = resolve('test/fixtures/planner/fix-removed-queue-coverage-cleanup.md');
    await readFile(fixturePath, 'utf8');
    const backend = new StubHarness([
      { events: [...readTool('read-1', 'packages/engine/src/queue/scheduler.ts', 'fixture-shaped queue cleanup evidence'), usage(72, 4)] },
      submitResponse(),
    ]);

    const events: EforgeEvent[] = await collectEvents(runPlanner(fixturePath, {
      harness: backend,
      cwd,
      auto: true,
      scope: 'excursion',
      maxTurns: 10,
      contextGuard: { stage: 'planner', limits: { maxObservedInputTokens: 100 } },
    }));

    const summary = findEvent(events, 'planning:inspection-summary')?.summary;
    expect(summary?.source.sourcePath).toBe(fixturePath);
    expect(filterEvents(events, 'planning:inspection-summary')).toHaveLength(1);
    expect(backend.calls).toHaveLength(2);
  });
});
