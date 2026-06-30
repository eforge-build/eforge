import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import type { AgentRole, EforgeEvent } from '@eforge-build/engine/events';
import { buildPlanningAtomTasks, derivePlanningAtomGraph, deriveSourceInventory, runBoundedPlannerCompiler, type PlanningAtomOutput, type PlanningAtomTask } from '@eforge-build/engine/planner-compiler';
import { StubHarness } from './stub-harness.js';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 2, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function prd(criteria: string[]): string {
  return ['# Compiler Runner', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

describe('bounded planner compiler runner', () => {
  it('runs the canonical inventory, graph, evidence, map, reduce, and residue pipeline', async () => {
    const cwd = await workspace({ 'packages/engine/src/a.ts': 'export const sourceEvidence = true;\n' });
    const content = prd(['engine updates `packages/engine/src/a.ts` using repo-grounded evidence.']);
    const [task] = expectedTasks(content);
    const mapOutput = completedOutput(task);
    const harness = new StubHarness([
      { resultText: JSON.stringify(mapOutput) },
      { resultText: JSON.stringify(completedReduceOutput(mapOutput)) },
    ]);

    const result = await runBoundedPlannerCompiler({ sourceContent: content, sourcePath: 'compiler.md', sourceHash: hash(content), cwd, harness, limits, agentOptions: { maxTurns: 3 } });

    expect(result.status).toBe('complete');
    expect(result.validationErrors).toEqual([]);
    expect(result.sourceInventory.summary.criterionCount).toBe(1);
    expect(result.atomGraph.atoms).toHaveLength(1);
    expect(result.sourceEvidenceBundle.records[0]).toMatchObject({ path: 'packages/engine/src/a.ts', status: 'materialized' });
    expect(result.map.mapComplete).toBe(true);
    expect(result.reduce.reduceComplete).toBe(true);
    expect(result.residue.candidates).toEqual([]);
    expect(harness.calls.every((call) => call.tools === 'none' && call.maxTurns === 3)).toBe(true);
    expect(harness.prompts[0]).toContain('## Source evidence');
    expect(harness.prompts[0]).toContain('export const sourceEvidence = true');
  });

  it('returns complete-with-residue when bounded source evidence or atom planning leaves represented work', async () => {
    const cwd = await workspace({});
    const content = prd(['engine updates `packages/engine/src/missing.ts` using repo-grounded evidence.']);
    const [task] = expectedTasks(content);
    const harness = new StubHarness([{ resultText: JSON.stringify({ atomId: task.atomId, status: 'failed', aspectUpdates: [], error: 'missing source evidence' }) }]);

    const result = await runBoundedPlannerCompiler({ sourceContent: content, sourcePath: 'compiler.md', sourceHash: hash(content), cwd, harness, limits });

    expect(result.status).toBe('complete-with-residue');
    expect(result.map.mapComplete).toBe(false);
    expect(result.reduce.reduceComplete).toBe(false);
    expect(result.sourceEvidenceBundle.records[0]).toMatchObject({ path: 'packages/engine/src/missing.ts', status: 'missing' });
    expect(result.residue.candidates.map((candidate) => candidate.reason)).toContain('pending-aspect');
    expect(result.residue.candidates.map((candidate) => candidate.reason)).toContain('source-evidence-missing');
  });

  it('streams agent events through onEvent before the compiler promise resolves', async () => {
    const cwd = await workspace({ 'packages/engine/src/a.ts': 'export const sourceEvidence = true;\n' });
    const content = prd(['engine updates `packages/engine/src/a.ts` using repo-grounded evidence.']);
    const [task] = expectedTasks(content);
    const mapOutput = completedOutput(task);
    const harness = new BlockingFirstHarness(JSON.stringify(mapOutput), JSON.stringify(completedReduceOutput(mapOutput)));
    const streamed: EforgeEvent[] = [];
    let settled = false;

    const promise = runBoundedPlannerCompiler({ sourceContent: content, sourcePath: 'compiler.md', sourceHash: hash(content), cwd, harness, limits, onEvent: (event) => streamed.push(event) }).finally(() => { settled = true; });
    await harness.firstStarted;

    expect(streamed.some((event) => event.type === 'agent:start' && event.planId === task.atomId)).toBe(true);
    expect(settled).toBe(false);

    harness.releaseFirst();
    await expect(promise).resolves.toMatchObject({ status: 'complete' });
  });

  it('propagates aborts from the canonical map phase', async () => {
    const cwd = await workspace({ 'packages/engine/src/a.ts': 'export const sourceEvidence = true;\n' });
    const content = prd(['engine updates `packages/engine/src/a.ts`.']);
    const abortError = new Error('cancelled');
    abortError.name = 'AbortError';
    const harness = new StubHarness([{ error: abortError }]);

    await expect(runBoundedPlannerCompiler({ sourceContent: content, sourcePath: 'compiler.md', sourceHash: hash(content), cwd, harness, limits })).rejects.toMatchObject({ name: 'AbortError', message: 'cancelled' });
  });
});

function expectedTasks(content: string): PlanningAtomTask[] {
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'compiler.md' });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'compiler.md', limits, inventory });
  return buildPlanningAtomTasks({ graph, inventory });
}

function completedOutput(task: PlanningAtomTask): PlanningAtomOutput {
  return {
    atomId: task.atomId,
    status: 'completed',
    aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [task.atomId] })),
    compactHandoff: `completed ${task.atomId}`,
    planFragments: [{ fragmentId: `fragment-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, markdown: `Plan ${task.title}.` }],
    moduleCandidates: [{ moduleId: `module-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: `Implement ${task.title}.`, validationExpectation: 'Relevant checks pass.' }],
  };
}

function completedReduceOutput(output: PlanningAtomOutput) {
  return {
    nodeId: 'reduce-000-001',
    status: 'completed',
    compactSummary: 'Reduced one atom output into a canonical compiler synthesis.',
    planFragments: output.planFragments,
    moduleCandidates: output.moduleCandidates,
    validationStrategy: 'Run relevant checks for linked module candidates.',
  };
}

class BlockingFirstHarness implements AgentHarness {
  readonly firstStarted: Promise<void>;
  private readonly markFirstStarted: () => void;
  private readonly firstRelease: Promise<void>;
  private readonly markFirstReleased: () => void;
  private calls = 0;

  constructor(private readonly firstResultText: string, private readonly laterResultText: string) {
    let started!: () => void;
    let released!: () => void;
    this.firstStarted = new Promise<void>((resolve) => { started = resolve; });
    this.firstRelease = new Promise<void>((resolve) => { released = resolve; });
    this.markFirstStarted = started;
    this.markFirstReleased = released;
  }

  effectiveCustomToolName(name: string): string { return name; }
  releaseFirst(): void { this.markFirstReleased(); }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    const callIndex = this.calls++;
    const agentId = `blocking-${callIndex}`;
    yield { type: 'agent:start', planId, agentId, agent, model: options.model?.id ?? 'stub-model', harness: options.harness ?? 'pi', harnessSource: options.harnessSource ?? 'tier', tier: options.tier ?? 'stub', tierSource: options.tierSource ?? 'tier', timestamp: new Date().toISOString() };
    if (callIndex === 0) {
      this.markFirstStarted();
      await this.firstRelease;
    }
    yield { type: 'agent:result', planId, agent, result: { durationMs: 1, durationApiMs: 1, numTurns: 1, totalCostUsd: 0, usage: { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 }, modelUsage: {}, resultText: callIndex === 0 ? this.firstResultText : this.laterResultText } };
    yield { type: 'agent:stop', planId, agent, agentId, timestamp: new Date().toISOString() };
  }
}

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eforge-planner-compiler-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }
  return root;
}
