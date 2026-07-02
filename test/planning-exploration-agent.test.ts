import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
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
import { StubHarness, type StubScriptedEvent } from './stub-harness.js';

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
  it('skips exploration when the dominant share of literal needs resolve with high confidence', () => {
    const decision = decideExplorationSkip(bundleWith([
      literal('need-a', 'resolved', 'high'),
      literal('need-b', 'resolved', 'high'),
      { needId: 'need-c', kind: 'directory', status: 'resolved', confidence: 'high' },
      literal('need-d', 'unresolved', 'low'),
    ]));

    expect(decision).toMatchObject({ skip: true, literalNeedCount: 4, highConfidenceCount: 3 });
    expect(decision.share).toBeGreaterThanOrEqual(EXPLORATION_SKIP_HIGH_CONFIDENCE_SHARE);
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
      projectHints: [
        { kind: 'literal-path', query: 'engine owner', paths: ['packages/engine/src/a.ts'], criterionIds: ['ac-001'] },
        { kind: 'keyword', query: 'grounded flag', paths: ['/etc/passwd'], keywords: ['grounded'] },
      ],
    });

    expect(result.hints?.projectHints).toHaveLength(2);
    expect(result.hints?.projectHints?.[0].paths).toEqual(['packages/engine/src/a.ts']);
    expect(result.hints?.projectHints?.[1].paths).toEqual([]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error' && diagnostic.path === '/etc/passwd')).toBe(true);
  });

  it('degrades to no hints when every entry is invalid', () => {
    const result = explorationHintsFromSubmission({ projectHints: [{ kind: 'not-a-kind' as never, query: 'bad' }] });

    expect(result.hints).toBeUndefined();
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
  });
});

describe('repository exploration agent', () => {
  const explorationFixture = () => {
    const content = ['# Vague PRD', '', '## Acceptance Criteria', '- Improve the grounded behavior of the engine flag handling.'].join('\n');
    const inventory = deriveSourceInventory({ content, hash: hash(content) });
    const graph = derivePlanningAtomGraph({ content, hash: hash(content), limits, inventory });
    return { content, inventory, graph };
  };

  const emptyWorkspace = () => mkdtemp(path.join(os.tmpdir(), 'eforge-exploration-empty-'));

  const submission = (paths: string[]) => ({
    projectHints: [{ kind: 'literal-path', query: 'grounded flag owner', paths, criterionIds: ['ac-001'] }],
  });

  it('runs read-only, keeps the prompt harness-agnostic, and returns validated hints', async () => {
    const cwd = await emptyWorkspace();
    const { inventory, graph } = explorationFixture();
    const baselineBundle = await deriveSourceLocalization({ cwd, inventory, graph });
    const harness = new StubHarness([
      { toolCalls: [{ tool: 'submit_exploration_hints', toolUseId: 'submit-1', input: submission(['packages/engine/src/vague-owner.ts']), output: 'ok' }] },
    ]);

    const result = await runRepositoryExplorationAgent({ cwd, harness, inventory, baselineBundle, maxToolUses: 8 });

    expect(result.status).toBe('completed');
    expect(result.hints?.projectHints?.[0].paths).toEqual(['packages/engine/src/vague-owner.ts']);
    expect(harness.calls[0].tools).toBe('read-only');
    expect(harness.calls[0].maxTurns).toBeGreaterThan(1);
    for (const toolName of ['Bash', 'Write(', 'Read tool', 'Grep tool', 'Glob tool']) expect(harness.prompts[0]).not.toContain(toolName);
    expect(harness.prompts[0]).toContain('submit_exploration_hints');
    expect(harness.prompts[0]).toContain('ac-001');
    expect(result.events.some((event) => event.type === 'agent:start' && event.planId === REPOSITORY_EXPLORATION_PLAN_ID)).toBe(true);
  });

  it('degrades without throwing when the submission is schema-invalid', async () => {
    const cwd = await emptyWorkspace();
    const { inventory, graph } = explorationFixture();
    const baselineBundle = await deriveSourceLocalization({ cwd, inventory, graph });
    const harness = new StubHarness([
      { toolCalls: [{ tool: 'submit_exploration_hints', toolUseId: 'submit-1', input: { projectHints: [{ kind: 'not-a-kind', query: 'bad' }] }, output: 'ok' }] },
    ]);

    const result = await runRepositoryExplorationAgent({ cwd, harness, inventory, baselineBundle, maxToolUses: 8 });

    expect(result.status).toBe('degraded');
    expect(result.hints).toBeUndefined();
  });

  it('degrades without throwing when the harness errors mid-run', async () => {
    const cwd = await emptyWorkspace();
    const { inventory, graph } = explorationFixture();
    const baselineBundle = await deriveSourceLocalization({ cwd, inventory, graph });
    const harness = new StubHarness([{ error: new Error('backend exploded') }]);

    const result = await runRepositoryExplorationAgent({ cwd, harness, inventory, baselineBundle, maxToolUses: 8 });

    expect(result.status).toBe('degraded');
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('backend exploded'))).toBe(true);
  });

  it('counts tool uses and degrades when the budget is exhausted without a submission', async () => {
    const cwd = await emptyWorkspace();
    const { inventory, graph } = explorationFixture();
    const baselineBundle = await deriveSourceLocalization({ cwd, inventory, graph });
    const maxToolUses = 3;
    const events: StubScriptedEvent[] = Array.from({ length: maxToolUses + 2 }, (_, index) => ({ kind: 'tool_call' as const, tool: 'inspect_repository', toolUseId: `inspect-${index}`, input: {}, output: 'listing' }));
    const harness = new StubHarness([{ events }]);

    const result = await runRepositoryExplorationAgent({ cwd, harness, inventory, baselineBundle, maxToolUses });

    expect(result.status).toBe('degraded');
    expect(result.toolUses).toBeGreaterThan(maxToolUses);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('budget') || diagnostic.message.includes('did not call'))).toBe(true);
  });

  it('produces localization records with concrete owner paths when hints feed deriveSourceLocalization', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-exploration-'));
    await mkdir(path.join(cwd, 'packages/engine/src'), { recursive: true });
    await writeFile(path.join(cwd, 'packages/engine/src/vague-owner.ts'), 'export const grounded = true;\n', 'utf8');
    const { inventory, graph } = explorationFixture();
    const baselineBundle = await deriveSourceLocalization({ cwd, inventory, graph });
    expect(decideExplorationSkip(baselineBundle).skip).toBe(false);
    const harness = new StubHarness([
      { toolCalls: [{ tool: 'submit_exploration_hints', toolUseId: 'submit-1', input: submission(['packages/engine/src/vague-owner.ts']), output: 'ok' }] },
    ]);

    const exploration = await runRepositoryExplorationAgent({ cwd, harness, inventory, baselineBundle, maxToolUses: 8 });
    const hinted = await deriveSourceLocalization({ cwd, inventory, graph, hints: exploration.hints });

    const hintedRecord = hinted.records.find((record) => record.candidateFiles.some((candidate) => candidate.path === 'packages/engine/src/vague-owner.ts'));
    expect(hintedRecord).toBeDefined();
    expect(hintedRecord?.status).toBe('resolved');
    expect(hintedRecord?.confidence).toBe('high');
    expect(hinted.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  });
});
