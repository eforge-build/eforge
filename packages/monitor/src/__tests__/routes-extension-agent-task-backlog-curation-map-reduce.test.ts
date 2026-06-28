import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EforgeEvent } from '@eforge-build/client';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import type { AgentRole } from '@eforge-build/engine/events';
import {
  BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
  BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES,
  BacklogCurationMapReduceFindingSchema,
  BacklogCurationMapReduceItemPacketSchema,
  BacklogCurationMapReduceReducerInputSchema,
  BacklogCurationMapReduceRuntimeIdentitySchema,
  EforgePlanPlanningDraftResultSchema,
  type BacklogCurationMapReduceFinding,
  type BacklogCurationMapReduceItemPacket,
  type BacklogCurationMapReduceReducerInput,
  type BacklogCurationMapReduceSourceBundle,
} from '@eforge-build/client';
import { runBacklogCurationMapReduceTask } from '../routes/extensions/backlog-curation-map-reduce-runner.js';

const SHA = '1'.repeat(64);
const BODY_SHA = '2'.repeat(64);
const TypeBoxKind = Symbol.for('TypeBox.Kind');
const StringSchema = { type: 'string', [TypeBoxKind]: 'String' } as never;
const EmptyObjectSchema = { type: 'object', additionalProperties: true, properties: {}, [TypeBoxKind]: 'Object' } as never;

const packet: BacklogCurationMapReduceItemPacket = {
  schemaVersion: 1,
  kind: 'item',
  sourceFingerprint: SHA,
  itemId: 'item-1',
  itemTitle: 'Item 1',
  metadata: {},
  precondition: { kind: 'item', id: 'item-1', bodySha256: BODY_SHA, sourceFingerprint: SHA, recordSha256: BODY_SHA },
  bodySha256: BODY_SHA,
  recordSha256: BODY_SHA,
  sectionSummaries: [],
  dependencyFacts: [],
  currentSourceCitations: [],
  historicalHints: [],
  recommendationSignals: [],
  diagnostics: [],
};

const bundle: BacklogCurationMapReduceSourceBundle = {
  schemaVersion: 1,
  sourceFingerprint: SHA,
  globalContext: {
    schemaVersion: 1,
    purpose: 'backlog-curation-map-reduce',
    sourceFingerprint: SHA,
    curationGuidance: ['Curate safely.'],
    caps: {},
    itemCount: 1,
    openItemIds: ['item-1'],
    roadmapSummaries: [],
    dependencySummaries: [],
    recommendationSummaries: [],
    diagnostics: [],
  },
  packets: [packet],
  degradedOutcomes: [],
  reducerInput: {
    schemaVersion: 1,
    sourceFingerprint: SHA,
    globalContext: {
      schemaVersion: 1,
      purpose: 'backlog-curation-map-reduce',
      sourceFingerprint: SHA,
      curationGuidance: ['Curate safely.'],
      caps: {},
      itemCount: 1,
      openItemIds: ['item-1'],
      roadmapSummaries: [],
      dependencySummaries: [],
      recommendationSummaries: [],
      diagnostics: [],
    },
    outcomes: [],
    diagnostics: [],
  },
};

describe('backlog curation map/reduce runner', () => {
  it('audits cache misses one packet at a time before reducing the bounded outcomes', async () => {
    const harness = new MapReduceHarness();
    const progress: string[] = [];
    const result = await runBacklogCurationMapReduceTask(baseOptions({ harness, progress }));

    expect(result).toMatchObject({ summary: 'Reduced curation outcomes.', backlogCurationDraft: { sourceFingerprint: SHA } });
    expect(harness.itemAuditCalls).toBe(1);
    expect(harness.reducerCalls).toBe(1);
    expect(progress).toEqual(expect.arrayContaining([
      'Preparing map/reduce packets',
      'Preparing curation source',
      'Built 1 item packets',
      'Scanning item audit cache',
      'Item audit cache scan complete: 0 hits, 1 misses',
      'Cache hits 0, misses 1',
      'Cache hit aggregate: 0',
      'Cache miss aggregate: 1',
      'Auditing 1 item packets',
      'Audited 1/1 items',
      'Reducing 1 item outcomes',
      'Running backlog curation reducer',
      'Validating curation draft',
      'Validating reducer draft',
    ]));
  });

  it('reports structured item-agent progress for backlog curation', async () => {
    const harness = new MapReduceHarness();
    const curationProgress: Array<Parameters<NonNullable<RunnerOptions['backlogCurationProgress']>>[0]> = [];
    await runBacklogCurationMapReduceTask(baseOptions({ harness, curationProgress }));

    expect(curationProgress.length).toBeGreaterThan(0);
    expect(curationProgress.at(0)).toMatchObject({ total: 1, completed: 0, remaining: 1, items: [expect.objectContaining({ itemId: 'item-1', title: 'Item 1', status: 'pending' })] });
    expect(curationProgress).toEqual(expect.arrayContaining([expect.objectContaining({ running: 1, items: [expect.objectContaining({ itemId: 'item-1', status: 'running' })] })]));
    expect(curationProgress.at(-1)).toMatchObject({ total: 1, completed: 1, remaining: 0, items: [expect.objectContaining({ itemId: 'item-1', status: 'completed', verdict: 'still-needed' })] });
  });

  it('uses cache-hit outcomes without invoking an item audit agent', async () => {
    const harness = new MapReduceHarness();
    const progress: string[] = [];
    const cachedFinding = finding();
    const result = await runBacklogCurationMapReduceTask(baseOptions({
      harness,
      progress,
      providerHooks: {
        readBacklogCurationItemAuditCache: async () => ({ hit: true, finding: cachedFinding }),
        buildBacklogCurationReducerInput: (globalContext, outcomes) => ({ schemaVersion: 1, sourceFingerprint: globalContext.sourceFingerprint, globalContext, outcomes: [...outcomes], diagnostics: [] }),
      },
    }));

    expect(result).toMatchObject({ backlogCurationDraft: { sourceFingerprint: SHA } });
    expect(harness.itemAuditCalls).toBe(0);
    expect(progress).toEqual(expect.arrayContaining(['Scanning item audit cache', 'Item audit cache scan complete: 1 hits, 0 misses', 'Cache hit aggregate: 1', 'Cache miss aggregate: 0', 'Auditing 0 item packets', 'Running backlog curation reducer']));
    // The reducer prompt JSON is compacted before prompting, so it carries the
    // finding's stable identity/verdict fields rather than the verbatim record.
    expect(harness.reducerInputs.at(0)?.outcomes).toEqual([expect.objectContaining({
      outcome: 'cache-hit',
      finding: expect.objectContaining({ itemId: cachedFinding.itemId, disposition: cachedFinding.disposition, verdict: cachedFinding.verdict, summary: cachedFinding.summary }),
    })]);
  });

  it('degrades an item audit failure into a bounded outcome and still reduces', async () => {
    const harness = new MapReduceHarness({ itemFailure: new Error('agent exploded\nwith noisy details') });
    await runBacklogCurationMapReduceTask(baseOptions({ harness }));

    expect(harness.itemAuditCalls).toBe(1);
    expect(harness.reducerCalls).toBe(1);
    expect(harness.reducerInputs.at(0)?.outcomes).toEqual([expect.objectContaining({
      outcome: 'item-agent-failure',
      itemId: 'item-1',
      error: 'agent exploded with noisy details',
    })]);
  });

  it('bounds validation repair and returns needs-input when reducer output remains invalid', async () => {
    const harness = new MapReduceHarness({ reducerResult: validReducerResult({ summary: 'Invalid reducer output.' }) });
    const progress: string[] = [];
    const result = await runBacklogCurationMapReduceTask(baseOptions({
      harness,
      progress,
      providerHooks: {
        readBacklogCurationItemAuditCache: async () => ({ hit: false }),
        buildBacklogCurationReducerInput: (globalContext, outcomes) => ({ schemaVersion: 1, sourceFingerprint: globalContext.sourceFingerprint, globalContext, outcomes: [...outcomes], diagnostics: [] }),
        validateBacklogCurationPlanningDraftResult: () => Array.from({ length: 30 }, (_, index) => `validation error ${index} ${'x'.repeat(1000)}`),
      },
    }));

    expect(harness.reducerCalls).toBe(2);
    expect(progress).toEqual(expect.arrayContaining(['Running backlog curation reducer', 'Validating reducer draft', 'Running reducer repair attempt', 'Validating repaired reducer draft']));
    expect(result).toMatchObject({ decision: 'needs-input' });
    expect(result.assumptionsOpenQuestions?.length).toBeLessThanOrEqual(12);
    expect(JSON.stringify(result).length).toBeLessThan(10_000);
  });

  it('passes capped reducer input to the reducer prompt', async () => {
    const harness = new MapReduceHarness();
    await runBacklogCurationMapReduceTask(baseOptions({ harness }));

    const reducerPrompt = harness.reducerPrompts.at(0) ?? '';
    expect(Buffer.byteLength(reducerPrompt, 'utf-8')).toBeLessThanOrEqual(BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES * 2);
    expect(reducerPrompt).toContain('"outcome": "audited-finding"');
  });

  it('passes protected terminal findings to the reducer under byte pressure', async () => {
    const harness = new MapReduceHarness();
    const sourceBundle = multiPacketBundle(220);
    await runBacklogCurationMapReduceTask(baseOptions({
      harness,
      sourceBundle,
      providerHooks: mapReduceProviderHooksForCachedFindings((itemId) => terminalAwareFinding(itemId, itemId === 'item-220' ? 'shipped' : 'still-needed')),
    }));

    const retained = harness.reducerInputs.at(0)?.outcomes?.find((outcome) => isRecordValue(outcome) && outcome.itemId === 'item-220') as { finding?: { verdict?: string } } | undefined;
    expect(retained?.finding?.verdict).toBe('shipped');
  });

  it('makes omitted protected terminal diagnostics visible as draft needs-input rows', async () => {
    const harness = new MapReduceHarness();
    const sourceBundle = multiPacketBundle(40);
    const result = await runBacklogCurationMapReduceTask(baseOptions({
      harness,
      sourceBundle,
      providerHooks: mapReduceProviderHooksForCachedFindings((itemId) => terminalAwareFinding(itemId, Number(itemId.replace('item-', '')) % 2 === 0 ? 'shipped' : 'superseded')),
    }));

    const reducerInput = harness.reducerInputs.at(0);
    const omissions = terminalOmissionDiagnosticsForTest(reducerInput?.diagnostics);
    const curationResult = result as { backlogCurationDraft?: { needsInput: unknown[] } };

    expect(omissions.length).toBeGreaterThan(0);
    for (const omission of omissions) {
      expect(curationResult.backlogCurationDraft?.needsInput).toContainEqual(expect.objectContaining({
        kind: 'item',
        id: omission.itemId,
        question: expect.stringContaining(omission.verdict),
        reason: expect.stringContaining(`Protected terminal ${omission.verdict}`),
      }));
    }
  });

  it('derives named needs-input from full outcomes when legacy aggregate omission diagnostics appear', async () => {
    const harness = new MapReduceHarness();
    const result = await runBacklogCurationMapReduceTask(baseOptions({
      harness,
      providerHooks: {
        readBacklogCurationItemAuditCache: async (input) => ({ hit: true, finding: terminalAwareFinding(String(input.itemId), 'shipped') }),
        buildBacklogCurationReducerInput: (globalContext) => ({
          schemaVersion: 1,
          sourceFingerprint: globalContext.sourceFingerprint,
          globalContext,
          outcomes: [],
          diagnostics: [{ code: 'reducer-input-protected-terminal-omitted-too-many', severity: 'warning', message: 'Legacy aggregate omission diagnostic.', path: 'outcomes/protected-terminal-omissions-too-many' }],
        }),
      },
    }));

    expect(JSON.stringify(result)).toContain('item-1');
    expect(JSON.stringify(result)).toContain('shipped');
    expect(JSON.stringify(result)).not.toContain('without complete item names');
  });

  it('fails closed with top-level needs-input naming all omitted terminal candidates when no draft rows can be appended', async () => {
    const harness = new MapReduceHarness({ reducerResult: { summary: 'No draft.', assumptionsOpenQuestions: [], decision: 'draft', rationale: 'Missing backlog curation draft.' } });
    const sourceBundle = multiPacketBundle(60);
    const result = await runBacklogCurationMapReduceTask(baseOptions({
      harness,
      sourceBundle,
      providerHooks: mapReduceProviderHooksForCachedFindings((itemId) => terminalAwareFinding(itemId, Number(itemId.replace('item-', '')) % 2 === 0 ? 'shipped' : 'superseded')),
    }));

    const omissions = terminalOmissionDiagnosticsForTest(harness.reducerInputs.at(0)?.diagnostics);
    const resultText = JSON.stringify(result);
    expect(omissions.length).toBeGreaterThan(12);
    expect(result).toMatchObject({ decision: 'needs-input' });
    for (const omission of omissions) {
      expect(resultText).toContain(omission.itemId);
      expect(resultText).toContain(omission.verdict);
    }
  });

  it('cancels active item audits without starting queued work or invoking the reducer', async () => {
    const controller = new AbortController();
    const harness = new MapReduceHarness({ blockItemAudits: true });
    const sourceBundle = multiPacketBundle(4);
    const run = runBacklogCurationMapReduceTask(baseOptions({ harness, sourceBundle, abortController: controller, itemAuditConcurrency: 2 }));

    await waitFor(() => harness.itemAuditCalls === 2);
    controller.abort();
    await expect(run).rejects.toThrow(/aborted|cancel/i);

    expect(harness.itemAuditCalls).toBe(2);
    expect(harness.observedAborted).toEqual([true, true]);
    expect(harness.reducerCalls).toBe(0);
  });
});

type RunnerOptions = Parameters<typeof runBacklogCurationMapReduceTask>[0];

function baseOptions(overrides: { harness: MapReduceHarness; progress?: string[]; curationProgress?: Array<Parameters<NonNullable<RunnerOptions['backlogCurationProgress']>>[0]>; providerHooks?: RunnerOptions['providerHooks']; sourceBundle?: BacklogCurationMapReduceSourceBundle; abortController?: AbortController; itemAuditConcurrency?: number }): RunnerOptions {
  const contributions = curationContributionHandles();
  return {
    cwd: process.cwd(),
    taskId: 'task-map-reduce',
    input: { topic: 'curate', requestedOutputSections: ['backlogCurationDraft', 'recommendations'] },
    harness: overrides.harness,
    sourceBundle: overrides.sourceBundle ?? bundle,
    providerHooks: overrides.providerHooks ?? {
      readBacklogCurationItemAuditCache: async () => ({ hit: false }),
      buildBacklogCurationReducerInput: (globalContext, outcomes) => ({ schemaVersion: 1, sourceFingerprint: globalContext.sourceFingerprint, globalContext, outcomes: [...outcomes], diagnostics: [] }),
    },
    runtimeIdentity: { provider: 'stub', modelId: 'stub-model' },
    itemAuditContribution: contributions.itemAuditContribution,
    reducerContribution: contributions.reducerContribution,
    ...(overrides.itemAuditConcurrency !== undefined && { itemAuditConcurrency: overrides.itemAuditConcurrency }),
    abortController: overrides.abortController ?? new AbortController(),
    progress: async (message) => { overrides.progress?.push(message); },
    backlogCurationProgress: async (progress) => { overrides.curationProgress?.push(progress); },
    sectionProgress: async () => {},
  };
}

function mapReduceProviderHooksForCachedFindings(findingForItem: (itemId: string) => BacklogCurationMapReduceFinding): RunnerOptions['providerHooks'] {
  return {
    readBacklogCurationItemAuditCache: async (input) => ({ hit: true, finding: findingForItem(String(input.itemId)) }),
    buildBacklogCurationReducerInput: cappedReducerInputForTest,
  };
}

function cappedReducerInputForTest(globalContext: BacklogCurationMapReduceSourceBundle['globalContext'], outcomes: readonly BacklogCurationMapReduceSourceBundle['degradedOutcomes'][number][], generatedAt?: string): BacklogCurationMapReduceReducerInput {
  const prioritized = [...outcomes].sort((left, right) => Number(!isProtectedTerminalOutcomeForTest(left)) - Number(!isProtectedTerminalOutcomeForTest(right)) || left.itemId.localeCompare(right.itemId));
  const retained = prioritized.slice(0, 24);
  const retainedIds = new Set(retained.map((outcome) => outcome.itemId));
  const diagnostics = prioritized.filter((outcome) => isProtectedTerminalOutcomeForTest(outcome) && !retainedIds.has(outcome.itemId)).map((outcome) => {
    const verdict = outcome.outcome === 'cache-hit' || outcome.outcome === 'audited-finding' ? outcome.finding.verdict : 'shipped';
    return { code: 'reducer-input-protected-terminal-omitted', severity: 'warning' as const, message: `Protected terminal ${verdict} finding for ${outcome.itemId} was omitted by reducer byte caps.`, path: `outcomes/${outcome.itemId}/${verdict}` };
  });
  return { schemaVersion: 1, sourceFingerprint: globalContext.sourceFingerprint, ...(generatedAt !== undefined && { generatedAt }), globalContext, outcomes: retained, diagnostics };
}

function isProtectedTerminalOutcomeForTest(outcome: BacklogCurationMapReduceSourceBundle['degradedOutcomes'][number]): boolean {
  if (outcome.outcome !== 'cache-hit' && outcome.outcome !== 'audited-finding') return false;
  return outcome.finding.disposition === 'change' && (outcome.finding.verdict === 'shipped' || outcome.finding.verdict === 'superseded');
}

function terminalAwareFinding(itemId: string, verdict: 'shipped' | 'superseded' | 'still-needed'): BacklogCurationMapReduceFinding {
  const terminal = verdict === 'shipped' || verdict === 'superseded';
  return {
    schemaVersion: 1,
    itemId,
    sourceFingerprint: SHA,
    packetSha256: sha256Json({ itemId, packet: true }),
    bodySha256: BODY_SHA,
    promptVersion: BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
    runtimeIdentity: { provider: 'stub', modelId: 'stub-model' },
    disposition: terminal ? 'change' : 'recheck',
    verdict,
    closureEvidenceRoles: verdict === 'superseded' ? ['replacement', 'product-surface', 'supporting'] : ['implementation', 'product-surface', 'supporting'],
    checkedPaths: [{ path: `src/${itemId}.ts`, reason: 'current source inspected ' + 'x'.repeat(180) }],
    summary: `${itemId} ${verdict} summary. ${'s'.repeat(1_600)}`,
    rationale: `${itemId} ${verdict} rationale. ${'r'.repeat(2_600)}`,
    citations: [
      { kind: 'implementation', source: 'current-source', confidence: 'high', path: `src/${itemId}.ts`, excerpt: 'implementation '.repeat(50), matchedBy: ['implementation'] },
      { kind: 'product-surface', source: 'current-source', confidence: 'high', path: `docs/${itemId}.md`, excerpt: 'product surface '.repeat(50), matchedBy: ['product-surface'] },
      { kind: 'supporting', source: 'current-source', confidence: 'medium', path: `test/${itemId}.test.ts`, excerpt: 'supporting '.repeat(50), matchedBy: ['supporting'] },
    ],
    recommendationSignals: [{ source: 'recommendation', signal: 'Recommendation detail. '.repeat(20) }],
    diagnostics: [],
  };
}

function curationContributionHandles(): Pick<RunnerOptions, 'itemAuditContribution' | 'reducerContribution'> {
  const extensionRoot = join(process.cwd(), 'eforge/extensions/eforge-plan');
  const owner = { extensionName: 'eforge-plan', extensionPath: extensionRoot };
  const itemPrompt = 'prompts/eforge-plan-backlog-curation-item-audit.md';
  const reducerPrompt = 'prompts/eforge-plan-backlog-curation-reducer.md';
  const itemAuditContribution = {
    contribution: {
      kind: 'agentTask' as const,
      extensionName: owner.extensionName,
      extensionPath: owner.extensionPath,
      localId: 'backlog-item-audit',
      id: 'eforge-plan:backlog-item-audit',
      value: {
        id: 'backlog-item-audit',
        title: 'Backlog item audit',
        inputSchema: { type: 'object', additionalProperties: false, required: ['packet'], properties: { packet: BacklogCurationMapReduceItemPacketSchema, runtimeIdentity: BacklogCurationMapReduceRuntimeIdentitySchema, promptVersion: StringSchema }, [TypeBoxKind]: 'Object' } as never,
        outputSchema: BacklogCurationMapReduceFindingSchema,
        prompt: { kind: 'asset' as const, asset: itemPrompt },
        resolvePrompt(ctx: { input: { packet: BacklogCurationMapReduceItemPacket; runtimeIdentity?: unknown; promptVersion?: string }; effectiveCustomToolName?: (name: string) => string }) {
          let submitted: unknown;
          const packetSha256 = sha256Json(ctx.input.packet);
          return {
            variables: { itemId: ctx.input.packet.itemId, sourceFingerprint: ctx.input.packet.sourceFingerprint, packetSha256, promptVersion: ctx.input.promptVersion ?? BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION, runtimeIdentityJson: JSON.stringify(ctx.input.runtimeIdentity ?? null), runtimeIdentityInstruction: 'Runtime identity is server-owned; do not submit this field.', packetJson: JSON.stringify(ctx.input.packet, null, 2), submitTool: ctx.effectiveCustomToolName?.('submit_eforge_plan_backlog_item_finding') ?? 'submit_eforge_plan_backlog_item_finding', progressTool: 'report_eforge_plan_planning_progress' },
            run: { role: 'planner', toolsPreset: 'read-only', tools: [{ name: 'submit_eforge_plan_backlog_item_finding', description: 'submit', inputSchema: BacklogCurationMapReduceFindingSchema, handler: async (input: unknown) => { submitted = input; return 'submitted'; } }, { name: 'report_eforge_plan_planning_progress', description: 'progress', inputSchema: EmptyObjectSchema, handler: async () => 'progress' }] },
            getResult: () => submitted,
            missingResultMessage: 'missing item finding',
          };
        },
      },
    },
    owner,
    promptTemplate: readFileSync(join(extensionRoot, itemPrompt), 'utf-8'),
  };
  const reducerContribution = {
    contribution: {
      kind: 'agentTask' as const,
      extensionName: owner.extensionName,
      extensionPath: owner.extensionPath,
      localId: 'backlog-reducer',
      id: 'eforge-plan:backlog-reducer',
      value: {
        id: 'backlog-reducer',
        title: 'Backlog reducer',
        inputSchema: { type: 'object', additionalProperties: false, required: ['reducerInput'], properties: { reducerInput: BacklogCurationMapReduceReducerInputSchema, requestedOutputSections: { type: 'array', items: StringSchema, [TypeBoxKind]: 'Array' }, validationErrors: { type: 'array', items: StringSchema, [TypeBoxKind]: 'Array' } }, [TypeBoxKind]: 'Object' } as never,
        outputSchema: EforgePlanPlanningDraftResultSchema,
        prompt: { kind: 'asset' as const, asset: reducerPrompt },
        resolvePrompt(ctx: { input: { reducerInput: unknown; requestedOutputSections?: string[]; validationErrors?: string[] }; effectiveCustomToolName?: (name: string) => string }) {
          let submitted: unknown;
          const reducerInputJson = JSON.stringify(ctx.input.reducerInput, null, 2).replace(/RAW_GIT_DELTA_SENTINEL|RAW_FULL_IMPLEMENTATION_AUDIT_SENTINEL|UNRELATED_FULL_ITEM_BODY_SENTINEL/g, 'stripped');
          return {
            variables: { reducerInputJson, requestedOutputSections: ctx.input.requestedOutputSections?.join(', ') ?? 'backlogCurationDraft, recommendations', validationErrors: JSON.stringify(ctx.input.validationErrors ?? []), submitTool: ctx.effectiveCustomToolName?.('submit_eforge_plan_planning_result') ?? 'submit_eforge_plan_planning_result', progressTool: 'report_eforge_plan_planning_progress', resultSchema: 'type: object' },
            run: { role: 'planner', toolsPreset: 'none', tools: [{ name: 'submit_eforge_plan_planning_result', description: 'submit', inputSchema: EforgePlanPlanningDraftResultSchema, handler: async (input: unknown) => { submitted = input; return 'submitted'; } }, { name: 'report_eforge_plan_planning_progress', description: 'progress', inputSchema: EmptyObjectSchema, handler: async () => 'progress' }] },
            getResult: () => submitted,
            missingResultMessage: 'missing reducer result',
          };
        },
      },
    },
    owner,
    promptTemplate: readFileSync(join(extensionRoot, reducerPrompt), 'utf-8'),
  };
  return { itemAuditContribution, reducerContribution } as Pick<RunnerOptions, 'itemAuditContribution' | 'reducerContribution'>;
}

class MapReduceHarness implements AgentHarness {
  itemAuditCalls = 0;
  reducerCalls = 0;
  reducerInputs: Array<{ outcomes?: unknown[]; diagnostics?: unknown[] }> = [];
  reducerPrompts: string[] = [];
  observedAborted: boolean[] = [];

  constructor(private readonly behavior: { itemFailure?: Error; reducerResult?: Record<string, unknown>; blockItemAudits?: boolean } = {}) {}

  effectiveCustomToolName(name: string): string { return name; }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    yield { type: 'agent:start', agent, planId, agentId: 'agent', model: 'stub', harness: 'claude-sdk', harnessSource: 'tier', tier: 'planning', tierSource: 'tier', timestamp: new Date().toISOString() };
    const itemTool = options.customTools?.find((tool) => tool.name === 'submit_eforge_plan_backlog_item_finding');
    const reducerTool = options.customTools?.find((tool) => tool.name === 'submit_eforge_plan_planning_result');
    if (itemTool !== undefined) {
      this.itemAuditCalls += 1;
      if (this.behavior.blockItemAudits === true) {
        await waitForAbort(options.abortSignal);
        this.observedAborted.push(options.abortSignal?.aborted === true);
        throw new Error('item audit aborted');
      }
      if (this.behavior.itemFailure !== undefined) throw this.behavior.itemFailure;
      await itemTool.handler(finding());
    }
    if (reducerTool !== undefined) {
      this.reducerCalls += 1;
      this.reducerPrompts.push(options.prompt);
      this.reducerInputs.push(extractReducerInput(options.prompt));
      await reducerTool.handler(this.behavior.reducerResult ?? { summary: 'Reduced curation outcomes.', assumptionsOpenQuestions: [], backlogCurationDraft: { schemaVersion: 1, sourceFingerprint: SHA, summary: [], itemChanges: [], epicChanges: [], noOpRechecks: [], skipped: [], needsInput: [] } });
    }
    yield { type: 'agent:stop', agent, planId, agentId: 'agent', timestamp: new Date().toISOString() };
  }
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) return Promise.resolve();
  return new Promise((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
}

function multiPacketBundle(count: number): BacklogCurationMapReduceSourceBundle {
  const packets = Array.from({ length: count }, (_, index) => ({ ...packet, itemId: `item-${index + 1}`, itemTitle: `Item ${index + 1}`, precondition: { ...packet.precondition, id: `item-${index + 1}` } }));
  return { ...bundle, globalContext: { ...bundle.globalContext, itemCount: count, openItemIds: packets.map((entry) => entry.itemId) }, packets, reducerInput: { ...bundle.reducerInput, globalContext: { ...bundle.reducerInput.globalContext, itemCount: count, openItemIds: packets.map((entry) => entry.itemId) } } };
}

function terminalOmissionDiagnosticsForTest(diagnostics: unknown): Array<{ itemId: string; verdict: 'shipped' | 'superseded' }> {
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.flatMap((entry) => {
    if (!isRecordValue(entry) || entry.code !== 'reducer-input-protected-terminal-omitted') return [];
    if (typeof entry.message === 'string') {
      const fromMessage = (entry.message.match(/[A-Za-z0-9_.:-]+:(?:shipped|superseded)/g) ?? []).map((match) => {
        const separator = match.lastIndexOf(':');
        return { itemId: match.slice(0, separator), verdict: match.slice(separator + 1) as 'shipped' | 'superseded' };
      });
      if (fromMessage.length > 0) return fromMessage;
    }
    if (typeof entry.path !== 'string') return [];
    const parts = entry.path.split('/');
    const verdict = parts.at(-1);
    const itemId = parts.length >= 3 ? parts.slice(1, -1).join('/') : '';
    return (verdict === 'shipped' || verdict === 'superseded') && itemId.length > 0 ? [{ itemId, verdict }] : [];
  });
}

function extractReducerInput(prompt: string): { outcomes?: unknown[]; diagnostics?: unknown[] } {
  const match = /```json\n([\s\S]*?)\n```/.exec(prompt);
  if (match === null) return {};
  return JSON.parse(match[1]!) as { outcomes?: unknown[]; diagnostics?: unknown[] };
}

function validReducerResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summary: 'Reduced curation outcomes.',
    assumptionsOpenQuestions: [],
    backlogCurationDraft: { schemaVersion: 1, sourceFingerprint: SHA, summary: [], itemChanges: [], epicChanges: [], noOpRechecks: [], skipped: [], needsInput: [] },
    ...overrides,
  };
}

function finding(): BacklogCurationMapReduceFinding {
  return {
    schemaVersion: 1,
    itemId: 'item-1',
    sourceFingerprint: SHA,
    packetSha256: sha256Json(packet),
    bodySha256: BODY_SHA,
    promptVersion: BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
    runtimeIdentity: { provider: 'stub', modelId: 'stub-model' },
    disposition: 'recheck',
    verdict: 'still-needed',
    closureEvidenceRoles: ['supporting'],
    checkedPaths: [{ path: 'src/item.ts', reason: 'searched current source' }],
    summary: 'No change needed.',
    rationale: 'The packet contains no current-source closure evidence.',
    citations: [],
    recommendationSignals: [],
    diagnostics: [],
  };
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
