import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeParseEforgeEvent, type PlanningDecompositionLimits } from '@eforge-build/client';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';
import { derivePlanningDecompositionGraph, selectReadyPlanningBatch, type PlanningUnitOutput } from '@eforge-build/engine/compile-resilience/planning-decomposition';
import { assertPersistedJsonOmitsForbiddenFields, initializeDecompositionArtifacts, writeUnitOutputArtifact } from '@eforge-build/engine/compile-resilience/context-managed-planning/artifacts';
import { decompositionStartEvent, scheduleEvent, synthesisCompleteEvent, unitQueuedEvent, unitSkippedEvent } from '@eforge-build/engine/compile-resilience/context-managed-planning/events';
import { makePipelineCtx } from './pipeline-helpers.js';
import { useTempDir } from './test-tmpdir.js';

const makeTempDir = useTempDir('eforge-context-managed-artifacts-');
const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 2, maxPromptSourceBytes: 500, maxPromptBytes: 1000, maxObservedInputTokens: 1000, maxObservedTurns: 3, maxCompactHandoffBytes: 200, maxLocalExplorationToolUses: 4, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 1, maxSplitAttemptsPerUnit: 1 };
const hash = (content: string) => createHash('sha256').update(content).digest('hex');

function source(): string {
  return '# PRD\n\n## Acceptance Criteria\n- engine implements scheduling\n- client implements event schema\n- console renders progress';
}

function graph() {
  const content = source();
  return derivePlanningDecompositionGraph({ source: { content, hash: hash(content), path: 'prd.md' }, limits });
}

describe('context-managed planning events and artifacts', () => {
  it('maps decomposition lifecycle data to client-schema-valid events', () => {
    const g = graph();
    const unit = g.units[0];
    const decision = selectReadyPlanningBatch({ graph: g, parallelism: 2 });
    const events = [
      decompositionStartEvent({ graph: g, runId: 'run-1', riskEvidence: { level: 'overflow-risk', score: 90, sourceBytes: 1000, promptSourceBytes: 900, acceptanceCriteriaCount: 3, subsystemSummaries: ['engine'], recommendationAction: 'bounded-decomposition', selectedScope: 'excursion' } }),
      unitQueuedEvent(unit),
      scheduleEvent(decision),
      unitSkippedEvent(unit, 'recursive split scheduled smaller bounded planning units'),
      synthesisCompleteEvent({ graph: g, artifactPaths: ['orchestration.yaml', 'plan-unit-01.md'], unitIds: [unit.unitId] }),
    ];

    for (const event of events) {
      expect(safeParseEforgeEvent(event).success, `${event.type} should satisfy EforgeEventSchema`).toBe(true);
    }
    expect(events[2]).toMatchObject({ type: 'planning:decomposition:schedule', decision: { parallelism: 2 } });
  });

  it('persists graph and unit output evidence under .decomposition without raw source, prompts, or transcripts', async () => {
    const cwd = makeTempDir();
    const ctx = makePipelineCtx({ cwd, config: { ...DEFAULT_CONFIG, plan: { ...DEFAULT_CONFIG.plan, outputDir: 'plans' } } });
    const g = graph();
    const dir = await initializeDecompositionArtifacts(ctx, g);
    const output: PlanningUnitOutput = {
      unitId: g.units[0].unitId,
      status: 'completed',
      coveredCriteria: g.units[0].criteriaIds,
      discoveredFiles: ['packages/engine/src/example.ts'],
      sharedContractNotes: ['event contract'],
      moduleSuggestions: [],
      planSuggestions: [],
      unresolvedRequirements: [],
      compactHandoffRef: '.decomposition/units/unit-01/handoff.md',
      synthesisNotes: ['bounded unit completed'],
      observedBudget: { promptSourceBytes: 250, promptBytes: 700, observedInputTokens: 120, triggeredLimitKeys: [] },
    };
    const outputPath = await writeUnitOutputArtifact(ctx, output);

    expect(dir).toBe(join(cwd, 'plans', ctx.planSetName, '.decomposition'));
    const graphPath = join(dir, 'graph.json');
    await expect(assertPersistedJsonOmitsForbiddenFields(graphPath)).resolves.toBeUndefined();
    await expect(assertPersistedJsonOmitsForbiddenFields(outputPath)).resolves.toBeUndefined();
    const persistedOutput = JSON.parse(await readFile(outputPath, 'utf8'));
    expect(persistedOutput).toMatchObject({ unitId: output.unitId, status: 'completed', coveredCriteria: output.coveredCriteria, synthesisNotes: output.synthesisNotes, observedBudget: output.observedBudget });
    const serialized = `${await readFile(graphPath, 'utf8')}\n${await readFile(outputPath, 'utf8')}`;
    expect(serialized).not.toMatch(/"(?:sourceContent|rawSource|prompt|transcript|rawTranscript)"/);
  });

  it('rejects persisted evidence objects that contain forbidden raw fields', async () => {
    const cwd = makeTempDir();
    const ctx = makePipelineCtx({ cwd, config: { ...DEFAULT_CONFIG, plan: { ...DEFAULT_CONFIG.plan, outputDir: 'plans' } } });
    await expect(writeUnitOutputArtifact(ctx, { unitId: 'unit-raw', status: 'completed', coveredCriteria: [], discoveredFiles: [], sharedContractNotes: [], moduleSuggestions: [], planSuggestions: [], unresolvedRequirements: [], synthesisNotes: [], rawTranscript: 'do not persist' } as unknown as PlanningUnitOutput)).rejects.toThrow(/Forbidden raw field/);
  });
});
