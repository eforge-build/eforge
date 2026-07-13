import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import type { AgentRole, EforgeEvent } from '@eforge-build/engine/events';
import {
  decideExplorationSkip,
  derivePlanningAtomGraph,
  deriveSourceInventory,
  deriveSourceLocalization,
  EXPLORATION_SKIP_HIGH_CONFIDENCE_SHARE,
  explorationHintsFromSubmission,
  REPOSITORY_EXPLORATION_PLAN_ID,
  runRepositoryExplorationAgent,
  type SourceLocalizationBundle,
  type SourceLocalizationRecord,
} from '@eforge-build/engine/planner-compiler';
import { StubHarness } from './stub-harness.js';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 4_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 2, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function bundleWith(records: Array<Partial<SourceLocalizationRecord> & Pick<SourceLocalizationRecord, 'needId' | 'kind' | 'status' | 'confidence'>>): SourceLocalizationBundle {
  return {
    records: records.map((record) => ({ query: record.needId, candidateFiles: [], reason: 'test', linkedCriterionIds: [], linkedAspectIds: [], assignedAtomIds: [], diagnostics: [], budgetNotes: [], ...record })),
    byAtomId: {},
    diagnostics: [],
    limits: { maxIndexedFiles: 10_000, maxCandidateFilesPerNeed: 12, maxDirectoryExpansionFiles: 20, maxBytesPerScannedFile: 64_000, maxTotalScannedBytes: 2_000_000 },
    indexDiagnostics: [],
  };
}

function literal(needId: string, status: SourceLocalizationRecord['status'], confidence: SourceLocalizationRecord['confidence']) {
  return { needId, kind: 'literal-path' as const, status, confidence };
}

describe('exploration skip decision', () => {
  it('requires exploration for an unresolved authoritative owner despite a passing literal share', () => {
    const decision = decideExplorationSkip(bundleWith([
      literal('need-a', 'resolved', 'high'),
      literal('need-b', 'resolved', 'high'),
      { needId: 'need-c', kind: 'directory', status: 'resolved', confidence: 'high' },
      literal('need-d', 'unresolved', 'low'),
    ]), 1, ['need-a', 'need-d']);

    expect(decision).toMatchObject({ skip: false, literalNeedCount: 4, highConfidenceCount: 3, authoritativeOwnerCount: 2, unresolvedAuthoritativeOwnerCount: 1 });
    expect(decision.share).toBeGreaterThanOrEqual(EXPLORATION_SKIP_HIGH_CONFIDENCE_SHARE);
    expect(decision.reason).toContain('unresolved authoritative owner');
  });

  it('does not let an unresolved non-authoritative literal block skipping', () => {
    const decision = decideExplorationSkip(bundleWith([
      literal('need-owner', 'resolved', 'high'),
      literal('need-peer-a', 'resolved', 'high'),
      literal('need-peer-b', 'resolved', 'high'),
      literal('need-unrelated', 'unresolved', 'low'),
    ]), 1, ['need-owner']);

    expect(decision).toMatchObject({ skip: true, authoritativeOwnerCount: 1, unresolvedAuthoritativeOwnerCount: 0 });
    expect(decision.reason).toContain('exploration skipped');
  });

  it('explores when the source yields no literal path or directory needs', () => {
    const decision = decideExplorationSkip(bundleWith([
      { needId: 'need-subsystem', kind: 'subsystem', status: 'resolved', confidence: 'medium' },
      { needId: 'need-keyword', kind: 'keyword', status: 'partial', confidence: 'low' },
    ]));

    expect(decision).toMatchObject({ skip: false, literalNeedCount: 0, highConfidenceCount: 0, share: 0 });
    expect(decision.reason).toContain('exploration required');
  });

  it('explores when the high-confidence share falls below the threshold', () => {
    const decision = decideExplorationSkip(bundleWith([
      literal('need-a', 'resolved', 'high'),
      literal('need-b', 'unresolved', 'low'),
    ]));

    expect(decision.skip).toBe(false);
    expect(decision.share).toBeLessThan(EXPLORATION_SKIP_HIGH_CONFIDENCE_SHARE);
  });

  it('skips exploration when the source has no acceptance criteria to key hints to', () => {
    const decision = decideExplorationSkip(bundleWith([
      { needId: 'need-dir', kind: 'directory', status: 'unresolved', confidence: 'low' },
    ]), 0);

    expect(decision.skip).toBe(true);
    expect(decision.reason).toContain('no acceptance criteria');
  });

  it('ignores medium-confidence subsystem records when computing the share', () => {
    const decision = decideExplorationSkip(bundleWith([
      literal('need-a', 'resolved', 'high'),
      { needId: 'need-subsystem', kind: 'subsystem', status: 'resolved', confidence: 'medium' },
      { needId: 'need-interface', kind: 'interface', status: 'partial', confidence: 'medium' },
    ]));

    expect(decision).toMatchObject({ skip: true, literalNeedCount: 1, highConfidenceCount: 1, share: 1 });
  });
});

describe('exploration hints from submission', () => {
  it('normalizes valid hints and drops invalid entries individually with diagnostics', () => {
    const result = explorationHintsFromSubmission({
      status: 'completed',
      projectHints: [
        { kind: 'literal-path', query: 'engine owner', paths: ['packages/engine/src/a.ts'], criterionIds: ['ac-001'] },
        { kind: 'keyword', query: 'grounded flag', paths: ['/etc/passwd'], keywords: ['grounded'] },
      ],
    });

    expect(result.outcome.status).toBe('completed');
    expect(result.hints?.projectHints).toHaveLength(2);
    expect(result.hints?.projectHints?.[0].paths).toEqual(['packages/engine/src/a.ts']);
    expect(result.hints?.projectHints?.[1].paths).toEqual([]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error' && diagnostic.path === '/etc/passwd')).toBe(true);
  });

  it('degrades to no hints when every entry is invalid', () => {
    const result = explorationHintsFromSubmission({ status: 'completed', projectHints: [{ kind: 'not-a-kind' as never, query: 'bad' }] });

    expect(result.outcome.status).toBe('completed');
    expect(result.hints).toBeUndefined();
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
  });

  it('salvages validated hints from non-completed outcomes', () => {
    const result = explorationHintsFromSubmission({
      status: 'needs-rescope',
      projectHints: [{ kind: 'literal-path', query: 'engine owner', paths: ['packages/engine/src/a.ts'] }],
      reasons: ['too-broad'],
      notes: 'Source is too broad.',
    });

    expect(result.outcome.status).toBe('needs-rescope');
    expect(result.hints?.projectHints).toHaveLength(1);
    expect(result.hints?.projectHints?.[0].paths).toEqual(['packages/engine/src/a.ts']);
    expect(result.diagnostics).toEqual([]);
  });

  it('salvages hints from a budget-exhausted submission and keeps the validated needId', () => {
    const result = explorationHintsFromSubmission({
      status: 'budget-exhausted',
      projectHints: [
        { needId: 'need-valid', kind: 'interface', query: 'recommendation action api surfaces', paths: ['packages/engine/src/a.ts'] },
        { needId: 'need-unknown', kind: 'keyword', query: 'other lead', keywords: ['lead'] },
      ],
      reasons: ['tool-budget'],
      toolUseCount: 24,
    }, { allowedNeedIds: ['need-valid'] });

    expect(result.outcome.status).toBe('budget-exhausted');
    expect(result.hints?.projectHints).toHaveLength(2);
    expect(result.hints?.projectHints?.[0]).toMatchObject({ needId: 'need-valid', paths: ['packages/engine/src/a.ts'] });
    expect(result.hints?.projectHints?.[1]).not.toHaveProperty('needId');
    expect(result.unknownIdDrops).toEqual([{ field: 'needId', id: 'need-unknown', index: 1 }]);
  });

  it('drops unknown echoed ids with machine-readable diagnostics', () => {
    const result = explorationHintsFromSubmission({
      status: 'completed',
      projectHints: [
        { needId: 'need-valid', kind: 'literal-path', query: 'owner', paths: ['packages/engine/src/a.ts'], criterionIds: ['ac-valid', 'ac-missing'], aspectIds: ['aspect-valid', 'aspect-missing'] },
        { needId: 'need-missing', kind: 'keyword', query: 'unknown echoed need', keywords: ['owner'] },
      ],
      unresolvedNeedIds: ['need-valid', 'need-missing'],
      attemptedQueries: [{ needId: 'need-missing', query: 'bad need' }, { needId: 'need-valid', query: 'good need' }],
    }, { allowedNeedIds: ['need-valid'], allowedCriterionIds: ['ac-valid'], allowedAspectIds: ['aspect-valid'] });

    expect(result.outcome.projectHints?.[0]).toMatchObject({ needId: 'need-valid', criterionIds: ['ac-valid'], aspectIds: ['aspect-valid'] });
    expect(result.outcome.projectHints?.[1]).not.toHaveProperty('needId');
    expect(result.outcome.unresolvedNeedIds).toEqual(['need-valid']);
    expect(result.outcome.attemptedQueries).toEqual([{ query: 'bad need' }, { needId: 'need-valid', query: 'good need' }]);
    expect(result.unknownIdDrops).toEqual([
      { field: 'criterionIds', id: 'ac-missing', index: 0 },
      { field: 'aspectIds', id: 'aspect-missing', index: 0 },
      { field: 'needId', id: 'need-missing', index: 1 },
      { field: 'attemptedQueries.needId', id: 'need-missing', index: 0 },
      { field: 'unresolvedNeedIds', id: 'need-missing' },
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(Array(5).fill('exploration-unknown-id-dropped'));
  });
});


class AbortAwareExplorationHarness implements AgentHarness {
  readonly calls: AgentRunOptions[] = [];
  readonly prompts: string[] = [];

  constructor(private readonly readOnlyToolUses: number, private readonly graceSubmission: unknown) {}

  effectiveCustomToolName(name: string): string { return name; }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    this.calls.push(options);
    this.prompts.push(options.prompt);
    const agentId = `abort-aware-${this.calls.length}`;
    yield { type: 'agent:start', planId, agentId, agent, model: 'stub-model', harness: 'claude-sdk', harnessSource: 'tier', tier: 'stub', tierSource: 'tier', runtimeChoice: 'default', runtimeChoiceQualified: 'stub.default', runtimeChoiceSource: 'default', timestamp: new Date().toISOString() };
    if (options.tools === 'read-only') {
      for (let index = 0; index < this.readOnlyToolUses + 2; index += 1) {
        if (options.abortSignal?.aborted) throw abortError();
        yield { type: 'agent:tool_use', planId, agentId, agent, tool: 'inspect_repository', toolUseId: `inspect-${index}`, input: {} };
        if (options.abortSignal?.aborted) throw abortError();
        yield { type: 'agent:tool_result', planId, agentId, agent, tool: 'inspect_repository', toolUseId: `inspect-${index}`, output: 'listing' };
      }
    } else {
      const tool = options.customTools?.[0];
      yield { type: 'agent:tool_use', planId, agentId, agent, tool: 'submit_exploration_outcome', toolUseId: 'submit-grace', input: this.graceSubmission };
      const output = await tool?.handler(this.graceSubmission);
      yield { type: 'agent:tool_result', planId, agentId, agent, tool: 'submit_exploration_outcome', toolUseId: 'submit-grace', output: output ?? 'ok' };
    }
    yield { type: 'agent:result', planId, agent, result: { durationMs: 1, durationApiMs: 1, numTurns: 1, totalCostUsd: 0, usage: { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 }, modelUsage: {} } };
    yield { type: 'agent:stop', planId, agentId, agent, timestamp: new Date().toISOString() };
  }
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

describe('repository exploration agent', () => {
  const explorationFixture = () => {
    const content = ['# Vague PRD', '', '## Acceptance Criteria', '- Improve the grounded behavior of the engine flag handling.'].join('\n');
    const inventory = deriveSourceInventory({ content, hash: hash(content) });
    const graph = derivePlanningAtomGraph({ content, hash: hash(content), limits, inventory });
    return { content, inventory, graph };
  };

  const emptyWorkspace = () => mkdtemp(path.join(os.tmpdir(), 'eforge-exploration-empty-'));

  const submission = (paths: string[]) => ({
    status: 'completed',
    projectHints: [{ kind: 'literal-path', query: 'grounded flag owner', paths, criterionIds: ['ac-001'] }],
  });

  it('runs read-only, keeps the prompt harness-agnostic, and returns validated hints', async () => {
    const cwd = await emptyWorkspace();
    const { inventory, graph } = explorationFixture();
    const baselineBundle = await deriveSourceLocalization({ cwd, inventory, graph });
    const harness = new StubHarness([
      { toolCalls: [{ tool: 'submit_exploration_outcome', toolUseId: 'submit-1', input: submission(['packages/engine/src/vague-owner.ts']), output: 'ok' }] },
    ]);

    const result = await runRepositoryExplorationAgent({ cwd, harness, inventory, baselineBundle, graph, maxToolUses: 8 });

    expect(result.status).toBe('completed');
    expect(result.hints?.projectHints?.[0].paths).toEqual(['packages/engine/src/vague-owner.ts']);
    expect(harness.calls[0].tools).toBe('read-only');
    expect(harness.calls[0].maxTurns).toBeGreaterThan(1);
    for (const toolName of ['Bash', 'Write(', 'Read tool', 'Grep tool', 'Glob tool']) expect(harness.prompts[0]).not.toContain(toolName);
    expect(harness.prompts[0]).toContain('submit_exploration_outcome');
    expect(harness.prompts[0]).toContain('ac-001');
    expect(result.events.some((event) => event.type === 'agent:start' && event.planId === REPOSITORY_EXPLORATION_PLAN_ID)).toBe(true);
  });

  it('synthesizes a structured budget-exhausted outcome when the submission is schema-invalid', async () => {
    const cwd = await emptyWorkspace();
    const { inventory, graph } = explorationFixture();
    const baselineBundle = await deriveSourceLocalization({ cwd, inventory, graph });
    const harness = new StubHarness([
      { toolCalls: [{ tool: 'submit_exploration_outcome', toolUseId: 'submit-1', input: { status: 'completed', projectHints: [{ kind: 'not-a-kind', query: 'bad' }] }, output: 'ok' }] },
    ]);

    const result = await runRepositoryExplorationAgent({ cwd, harness, inventory, baselineBundle, graph, maxToolUses: 8 });

    expect(result.status).toBe('completed');
    expect(result.outcome.status).toBe('budget-exhausted');
    expect(result.hints).toBeUndefined();
  });

  it('synthesizes a structured budget-exhausted outcome when the harness errors mid-run', async () => {
    const cwd = await emptyWorkspace();
    const { inventory, graph } = explorationFixture();
    const baselineBundle = await deriveSourceLocalization({ cwd, inventory, graph });
    const harness = new StubHarness([{ error: new Error('backend exploded') }]);

    const result = await runRepositoryExplorationAgent({ cwd, harness, inventory, baselineBundle, graph, maxToolUses: 8 });

    expect(result.status).toBe('completed');
    expect(result.outcome.status).toBe('budget-exhausted');
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('backend exploded'))).toBe(true);
  });

  it('counts tool uses and synthesizes a structured outcome when the budget is exhausted without a submission', async () => {
    const cwd = await emptyWorkspace();
    const { inventory, graph } = explorationFixture();
    const baselineBundle = await deriveSourceLocalization({ cwd, inventory, graph });
    const maxToolUses = 3;
    const harness = new AbortAwareExplorationHarness(maxToolUses, {
      status: 'budget-exhausted',
      unresolvedNeedIds: baselineBundle.records.map((record) => record.needId),
      reasons: ['tool-budget'],
      attemptedQueries: [{ needId: baselineBundle.records[0]?.needId, query: 'inspected repository' }],
      candidatePaths: [],
      rescopeHints: [],
      toolUseCount: 999,
    });

    const result = await runRepositoryExplorationAgent({ cwd, harness, inventory, baselineBundle, graph, maxToolUses, agentOptions: { maxTurns: 9 } });

    expect(result.status).toBe('completed');
    expect(result.outcome.status).toBe('budget-exhausted');
    expect(result.toolUses).toBe(maxToolUses);
    expect(result.outcome.toolUseCount).toBe(maxToolUses);
    expect(result.outcome.reasons).toContain('tool-budget');
    expect(harness.calls).toHaveLength(2);
    expect(harness.calls[0].tools).toBe('read-only');
    expect(harness.calls[1].tools).toBe('none');
    expect(harness.calls[1].maxTurns).toBe(2);
    expect(harness.prompts[1]).toContain('Prior read-only observations');
    expect(harness.prompts[1]).toContain('listing');
  });

  it('produces localization records with concrete owner paths when hints feed deriveSourceLocalization', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-exploration-'));
    await mkdir(path.join(cwd, 'packages/engine/src'), { recursive: true });
    await writeFile(path.join(cwd, 'packages/engine/src/vague-owner.ts'), 'export const grounded = true;\n', 'utf8');
    const { inventory, graph } = explorationFixture();
    const baselineBundle = await deriveSourceLocalization({ cwd, inventory, graph });
    expect(decideExplorationSkip(baselineBundle).skip).toBe(false);
    const harness = new StubHarness([
      { toolCalls: [{ tool: 'submit_exploration_outcome', toolUseId: 'submit-1', input: submission(['packages/engine/src/vague-owner.ts']), output: 'ok' }] },
    ]);

    const exploration = await runRepositoryExplorationAgent({ cwd, harness, inventory, baselineBundle, graph, maxToolUses: 8 });
    const hinted = await deriveSourceLocalization({ cwd, inventory, graph, hints: exploration.hints });

    const hintedRecord = hinted.records.find((record) => record.candidateFiles.some((candidate) => candidate.path === 'packages/engine/src/vague-owner.ts'));
    expect(hintedRecord).toBeDefined();
    expect(hintedRecord?.status).toBe('resolved');
    expect(hintedRecord?.confidence).toBe('high');
    expect(hinted.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  });
});
