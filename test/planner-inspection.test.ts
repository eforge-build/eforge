import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { EforgeEvent, AgentRole, CompileContextGuardDiagnostics } from '@eforge-build/engine/events';
import {
  buildPlannerInspectionHandoff,
  compactPlannerInspectionHandoffToBudget,
  createPlannerInspectionObserver,
  derivePlannerInspectionBudget,
  formatPlannerInspectionHandoffMarkdown,
  plannerInspectionHandoffByteLength,
  writePlannerInspectionHandoffArtifact,
  type PlannerInspectionHandoff,
} from '@eforge-build/engine/compile-resilience/planner-inspection';

const USAGE = { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 };

describe('planner inspection budget and handoff foundation', () => {
  it('derives soft input-token budgets below hard defaults and model-aware hard limits', () => {
    const defaults = derivePlannerInspectionBudget();
    expect(defaults.softInputTokenThreshold).toBeGreaterThan(0);
    expect(defaults.softInputTokenThreshold).toBeLessThan(defaults.hardLimits.maxObservedInputTokens);

    const diagnostics: CompileContextGuardDiagnostics = {
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      metadataSource: 'registry',
      contextWindow: 1_000_000,
      outputReserveTokens: 64_000,
      overheadReserveTokens: 8_192,
      safetyMargin: 0.9,
      limits: { maxPromptBytes: 1_500_000, maxObservedInputTokens: 90_000, maxExplanationBytes: 1_500 },
    };
    const modelAware = derivePlannerInspectionBudget({ guardDiagnostics: diagnostics });
    expect(modelAware.hardLimits.maxObservedInputTokens).toBe(90_000);
    expect(modelAware.softInputTokenThreshold).toBeLessThan(90_000);
    expect(modelAware.diagnostics.guardDiagnostics?.modelId).toBe('claude-sonnet-4-5');
  });

  it('derives an inspection turn budget lower than an 80-turn planner maxTurns value', () => {
    const budget = derivePlannerInspectionBudget({ plannerMaxTurns: 80 });
    expect(budget.inspectionTurnBudget).toBeGreaterThan(0);
    expect(budget.inspectionTurnBudget).toBeLessThan(80);
  });

  it('observer uses shared usage accounting and trips soft thresholds without throwing', () => {
    const budget = derivePlannerInspectionBudget({ hardLimits: { maxObservedInputTokens: 100 }, plannerMaxTurns: 80 });
    const observer = createPlannerInspectionObserver({ budget });
    const status = observer.observe(usageEvent('planner', { input: budget.softInputTokenThreshold, total: budget.softInputTokenThreshold }, false));

    expect(status.shouldHandoff).toBe(true);
    expect(status.reason).toBe('soft-input-tokens');
    expect(observer.observed.inputTokens).toBe(budget.softInputTokenThreshold);
  });

  it('builds compact summaries with required fields and extracted paths', () => {
    const budget = derivePlannerInspectionBudget({ hardLimits: { maxObservedInputTokens: 100 }, plannerMaxTurns: 80 });
    const handoff = buildPlannerInspectionHandoff({
      events: [
        toolUse('Read', 'tu-1', { file_path: 'packages/engine/src/compile-resilience/context-guard.ts' }),
        toolResult('Read', 'tu-1', 'export function createCompileContextGuard() {}'),
        toolUse('Grep', 'tu-2', { pattern: 'compileContextGuardOptions', path: 'packages/engine/src' }),
        toolResult('Grep', 'tu-2', 'packages/engine/src/pipeline/stages/compile-stages.ts: uses compileContextGuardOptions'),
        message('Need to inspect planner continuation? unresolved question remains.'),
        usageEvent('planner', { input: 30, total: 30 }, false, 3),
      ],
      budget,
      source: { sourceId: 'prd-1', sourceName: 'Inspection', sourcePath: 'docs/prd.md', buildId: 'build-1', planSetName: 'set-a' },
      sourceBuildContext: { sourceSummary: 'Add planner inspection handoff.', buildGoal: 'Ship bounded evidence extraction.' },
      incompleteReason: 'soft-input-tokens',
    });

    expect(handoff.source).toMatchObject({ sourceId: 'prd-1', buildId: 'build-1', planSetName: 'set-a' });
    expect(handoff.relevantFiles).toContain('packages/engine/src/compile-resilience/context-guard.ts');
    expect(handoff.relevantFiles).toContain('packages/engine/src/pipeline/stages/compile-stages.ts');
    expect(handoff.observedFacts.length).toBeGreaterThan(0);
    expect(handoff.importantFindings.join('\n')).toContain('createCompileContextGuard');
    expect(handoff.inferredImplementationAreas).toContain('packages/engine/src/compile-resilience');
    expect(handoff.unresolvedQuestions.join('\n')).toContain('unresolved question');
    expect(handoff.sourceBuildContext.buildGoal).toContain('bounded evidence');
    expect(handoff.budgetDiagnostics.observed.inputTokens).toBe(30);
    expect(handoff.caveats.join('\n')).toContain('Inspection is incomplete');
  });

  it('caps summary arrays and records omitted-count diagnostics', () => {
    const events: EforgeEvent[] = [];
    for (let i = 0; i < 8; i++) {
      events.push(toolUse('Read', `tu-${i}`, { file_path: `src/file-${i}.ts` }));
      events.push(toolResult('Read', `tu-${i}`, `src/file-${i}.ts contains fact ${i}`));
      events.push(message(`message fact ${i}?`));
    }
    const handoff = buildPlannerInspectionHandoff({
      events,
      budget: derivePlannerInspectionBudget({ toolUseCaps: { maxRelevantFiles: 3, maxObservedFacts: 4, maxImportantFindings: 2, maxUnresolvedQuestions: 2, maxImplementationAreas: 1, maxToolUses: 3, maxToolResults: 3 } }),
      source: { sourceId: 'prd-caps', buildId: 'build-caps' },
      incompleteReason: 'tool-use-cap',
    });

    expect(handoff.relevantFiles).toHaveLength(3);
    expect(handoff.observedFacts).toHaveLength(4);
    expect(handoff.importantFindings).toHaveLength(2);
    expect(handoff.unresolvedQuestions).toHaveLength(2);
    expect(handoff.inferredImplementationAreas).toHaveLength(1);
    expect(handoff.relevantFiles).not.toContain('src/file-7.ts');
    expect(handoff.omittedCounts).toMatchObject({ observedFacts: expect.any(Number), importantFindings: 1, unresolvedQuestions: 6, toolUses: 5, toolResults: 5 });
    expect(handoff.omittedCounts.relevantFiles).toBeUndefined();
    expect(handoff.caveats.join('\n')).toContain('omitted');
  });

  it('formats compact snippets and excludes raw oversized tool-result bodies', () => {
    const hugeBody = `START-${'x'.repeat(5_000)}-RAW-END`;
    const handoff = buildPlannerInspectionHandoff({
      events: [toolUse('Read', 'tu-long', { file_path: 'src/huge.ts' }), toolResult('Read', 'tu-long', hugeBody)],
      budget: derivePlannerInspectionBudget(),
      source: { sourceId: 'prd-format', buildId: 'build-format' },
      incompleteReason: 'soft-input-tokens',
    });
    const markdown = formatPlannerInspectionHandoffMarkdown(handoff);

    expect(markdown).toContain('Planner Inspection Handoff');
    expect(markdown).toContain('START-');
    expect(markdown).not.toContain('-RAW-END');
    expect(markdown).toContain('intentionally excludes raw full transcripts');
    expect(handoff.omittedCounts.toolResultSnippetBytes).toBeGreaterThan(0);
  });

  it('caps source/build context text fields and records omitted bytes', () => {
    const longSourceSummary = `summary-${'a'.repeat(4_000)}-raw-end`;
    const longBuildGoal = `goal-${'b'.repeat(4_000)}-raw-end`;
    const longPromptSnippet = `prompt-${'c'.repeat(4_000)}-raw-end`;
    const longSourceId = `source-${'d'.repeat(1_000)}-raw-end`;
    const handoff = buildPlannerInspectionHandoff({
      events: [toolUse('Grep', 'tu-long-pattern', { pattern: `pattern-${'e'.repeat(1_000)}-raw-end`, path: `src/${'f'.repeat(1_000)}.ts` })],
      budget: derivePlannerInspectionBudget(),
      source: { sourceId: longSourceId, buildId: 'build-source-context' },
      sourceBuildContext: { sourceSummary: longSourceSummary, buildGoal: longBuildGoal, promptSourceSnippet: longPromptSnippet },
      incompleteReason: `reason-${'g'.repeat(2_000)}-raw-end`,
    });
    const markdown = formatPlannerInspectionHandoffMarkdown(handoff);

    expect(markdown).toContain('summary-');
    expect(markdown).toContain('goal-');
    expect(markdown).toContain('prompt-');
    expect(markdown).not.toContain('-raw-end');
    expect(handoff.omittedCounts.sourceSummaryBytes).toBeGreaterThan(0);
    expect(handoff.omittedCounts.buildGoalBytes).toBeGreaterThan(0);
    expect(handoff.omittedCounts.promptSourceSnippetBytes).toBeGreaterThan(0);
    expect(handoff.omittedCounts.sourceIdBytes).toBeGreaterThan(0);
    expect(handoff.omittedCounts.toolUseSummaryBytes).toBeGreaterThan(0);
    expect(handoff.omittedCounts.relevantFileBytes).toBeGreaterThan(0);
    expect(handoff.omittedCounts.caveatBytes).toBeGreaterThan(0);
  });

  it('compacts handoffs to byte budget and preserves dropped-evidence omission counts', () => {
    const handoff = largePlannerInspectionHandoff();
    const targetBytes = 2_000;
    const compacted = compactPlannerInspectionHandoffToBudget(handoff, targetBytes);

    expect(plannerInspectionHandoffByteLength(handoff)).toBeGreaterThan(targetBytes);
    expect(plannerInspectionHandoffByteLength(compacted)).toBeLessThanOrEqual(targetBytes);
    expect(compacted.importantFindings).toHaveLength(0);
    expect(compacted.observedFacts).toHaveLength(0);
    expect(compacted.sourceBuildContext).toEqual({});
    expect(compacted.omittedCounts.importantFindings).toBeGreaterThan(0);
    expect(compacted.omittedCounts.importantFindingBytes).toBeGreaterThan(0);
    expect(compacted.omittedCounts.observedFacts).toBeGreaterThan(0);
    expect(compacted.omittedCounts.sourceSummaryBytes).toBeGreaterThan(0);
  });

  it('throws an explicit error when even the minimum handoff cannot fit the byte budget', () => {
    expect(() => compactPlannerInspectionHandoffToBudget(largePlannerInspectionHandoff(), 32)).toThrow(/minimum byte length .* maxCompactHandoffBytes 32/);
  });

  it('writes the compact JSON artifact under the plan-set output directory', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-planner-inspection-'));
    try {
      const handoff = buildPlannerInspectionHandoff({ events: [], budget: derivePlannerInspectionBudget(), source: { sourceId: 'prd-artifact' } });
      const artifactPath = await writePlannerInspectionHandoffArtifact({ cwd, outputDir: 'eforge/plans', planSetName: 'set-a', handoff });
      expect(artifactPath).toContain(join('eforge', 'plans', 'set-a', 'planner-inspection-handoff.json'));
      const parsed = JSON.parse(await readFile(artifactPath, 'utf8')) as { kind: string; source: { sourceId?: string } };
      expect(parsed.kind).toBe('planner-inspection-handoff');
      expect(parsed.source.sourceId).toBe('prd-artifact');
      await expect(writePlannerInspectionHandoffArtifact({ cwd, outputDir: 'eforge/plans', planSetName: '..', handoff })).rejects.toThrow(/safe relative path component/);
      await expect(writePlannerInspectionHandoffArtifact({ cwd, outputDir: 'eforge/plans', planSetName: 'set-a', fileName: '../escape.json', handoff })).rejects.toThrow(/safe relative path component/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

function largePlannerInspectionHandoff(): PlannerInspectionHandoff {
  const long = (label: string, index: number) => `${label}-${index}-${'x'.repeat(240)}`;
  return {
    kind: 'planner-inspection-handoff',
    version: 1,
    source: { sourceId: 'prd-large', sourceName: 'Large planner inspection', buildId: 'build-large', planSetName: 'set-large' },
    relevantFiles: Array.from({ length: 12 }, (_, index) => `packages/engine/src/feature-${index}/implementation.ts`),
    observedFacts: Array.from({ length: 8 }, (_, index) => long('observed fact', index)),
    importantFindings: Array.from({ length: 6 }, (_, index) => long('important finding', index)),
    inferredImplementationAreas: Array.from({ length: 8 }, (_, index) => `packages/engine/src/feature-${index}`),
    unresolvedQuestions: Array.from({ length: 4 }, (_, index) => long('unresolved question?', index)),
    sourceBuildContext: {
      sourceSummary: long('source summary', 1),
      buildGoal: long('build goal', 1),
      promptSourceSnippet: long('prompt snippet', 1),
    },
    budgetDiagnostics: {
      maxObservedInputTokens: 100,
      softInputTokenThreshold: 72,
      plannerMaxTurns: 80,
      inspectionTurnBudget: 60,
      softInputTokenRatio: 0.72,
      softTurnRatio: 0.75,
      observed: { inputTokens: 72, outputTokens: 0, turns: 4, promptBytes: 1_200 },
      toolUseCount: 8,
      toolResultCount: 8,
    },
    caveats: Array.from({ length: 4 }, (_, index) => long('caveat', index)),
    omittedCounts: {},
  };
}

function usageEvent(agent: AgentRole, usage: { input: number; total: number }, final: boolean, numTurns = 1): EforgeEvent {
  return {
    type: 'agent:usage',
    agentId: 'agent-1',
    agent,
    usage: { ...USAGE, ...usage },
    costUsd: 0,
    numTurns,
    final,
    timestamp: new Date().toISOString(),
  };
}

function toolUse(tool: string, toolUseId: string, input: unknown): EforgeEvent {
  return { type: 'agent:tool_use', agentId: 'agent-1', agent: 'planner', tool, toolUseId, input, timestamp: new Date().toISOString() };
}

function toolResult(tool: string, toolUseId: string, output: string): EforgeEvent {
  return { type: 'agent:tool_result', agentId: 'agent-1', agent: 'planner', tool, toolUseId, output, timestamp: new Date().toISOString() };
}

function message(content: string): EforgeEvent {
  return { type: 'agent:message', agentId: 'agent-1', agent: 'planner', content, timestamp: new Date().toISOString() };
}
