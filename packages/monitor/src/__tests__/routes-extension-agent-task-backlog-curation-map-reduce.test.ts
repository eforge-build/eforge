import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EforgeEvent } from '@eforge-build/client';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import type { AgentRole } from '@eforge-build/engine/events';
import {
  BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
  BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES,
  type BacklogCurationMapReduceFinding,
  type BacklogCurationMapReduceItemPacket,
  type BacklogCurationMapReduceSourceBundle,
} from '@eforge-build/client';
import { runBacklogCurationMapReduceTask } from '../routes/extensions/backlog-curation-map-reduce-runner.js';

const SHA = '1'.repeat(64);
const BODY_SHA = '2'.repeat(64);

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
    expect(progress).toEqual(expect.arrayContaining(['Preparing curation source', 'Built 1 item packets', 'Cache hits 0, misses 1', 'Audited 1/1 items', 'Reducing 1 item outcomes', 'Validating curation draft']));
  });

  it('uses cache-hit outcomes without invoking an item audit agent', async () => {
    const harness = new MapReduceHarness();
    const cachedFinding = finding();
    const result = await runBacklogCurationMapReduceTask(baseOptions({
      harness,
      providerHooks: {
        readBacklogCurationItemAuditCache: async () => ({ hit: true, finding: cachedFinding }),
        buildBacklogCurationReducerInput: (globalContext, outcomes) => ({ schemaVersion: 1, sourceFingerprint: globalContext.sourceFingerprint, globalContext, outcomes: [...outcomes], diagnostics: [] }),
      },
    }));

    expect(result).toMatchObject({ backlogCurationDraft: { sourceFingerprint: SHA } });
    expect(harness.itemAuditCalls).toBe(0);
    expect(harness.reducerInputs.at(0)?.outcomes).toEqual([expect.objectContaining({ outcome: 'cache-hit', finding: cachedFinding })]);
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
    const harness = new MapReduceHarness({ reducerResult: { summary: 'Invalid reducer output.', assumptionsOpenQuestions: [] } });
    const result = await runBacklogCurationMapReduceTask(baseOptions({
      harness,
      providerHooks: {
        readBacklogCurationItemAuditCache: async () => ({ hit: false }),
        buildBacklogCurationReducerInput: (globalContext, outcomes) => ({ schemaVersion: 1, sourceFingerprint: globalContext.sourceFingerprint, globalContext, outcomes: [...outcomes], diagnostics: [] }),
        validateBacklogCurationPlanningDraftResult: () => Array.from({ length: 30 }, (_, index) => `validation error ${index} ${'x'.repeat(1000)}`),
      },
    }));

    expect(harness.reducerCalls).toBe(2);
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

function baseOptions(overrides: { harness: MapReduceHarness; progress?: string[]; providerHooks?: RunnerOptions['providerHooks']; sourceBundle?: BacklogCurationMapReduceSourceBundle; abortController?: AbortController; itemAuditConcurrency?: number }): RunnerOptions {
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
    ...(overrides.itemAuditConcurrency !== undefined && { itemAuditConcurrency: overrides.itemAuditConcurrency }),
    abortController: overrides.abortController ?? new AbortController(),
    progress: async (message) => { overrides.progress?.push(message); },
    sectionProgress: async () => {},
  };
}

class MapReduceHarness implements AgentHarness {
  itemAuditCalls = 0;
  reducerCalls = 0;
  reducerInputs: Array<{ outcomes?: unknown[] }> = [];
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

function extractReducerInput(prompt: string): { outcomes?: unknown[] } {
  const match = /```json\n([\s\S]*?)\n```/.exec(prompt);
  if (match === null) return {};
  return JSON.parse(match[1]!) as { outcomes?: unknown[] };
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
