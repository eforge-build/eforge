import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
  BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES,
  type BacklogCurationMapReduceItemPacket,
  type BacklogCurationMapReduceSourceBundle,
  type EforgeEvent,
} from '@eforge-build/client';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import type { AgentRole } from '@eforge-build/engine/events';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import { createMonitorContext } from '../context.js';
import { openDatabase } from '../db.js';
import { ExtensionAgentTaskService } from '../routes/extensions/agent-task-service.js';

const SOURCE_FINGERPRINT = '3'.repeat(64);
const BODY_SHA = '4'.repeat(64);
const RAW_GIT_DELTA_SENTINEL = 'RAW_GIT_DELTA_SENTINEL_DO_NOT_PROMPT';
const RAW_FULL_AUDIT_SENTINEL = 'RAW_FULL_IMPLEMENTATION_AUDIT_SENTINEL_DO_NOT_PROMPT';

const packets: BacklogCurationMapReduceItemPacket[] = ['item-1', 'item-2'].map((itemId) => ({
  schemaVersion: 1,
  kind: 'item',
  sourceFingerprint: SOURCE_FINGERPRINT,
  itemId,
  itemTitle: itemId,
  metadata: {},
  precondition: { kind: 'item', id: itemId, bodySha256: BODY_SHA, sourceFingerprint: SOURCE_FINGERPRINT, recordSha256: BODY_SHA },
  bodySha256: BODY_SHA,
  recordSha256: BODY_SHA,
  sectionSummaries: [],
  dependencyFacts: [],
  currentSourceCitations: [],
  historicalHints: [],
  recommendationSignals: [],
  diagnostics: [],
}));

const bundle: BacklogCurationMapReduceSourceBundle = {
  schemaVersion: 1,
  sourceFingerprint: SOURCE_FINGERPRINT,
  globalContext: {
    schemaVersion: 1,
    purpose: 'backlog-curation-map-reduce',
    sourceFingerprint: SOURCE_FINGERPRINT,
    curationGuidance: ['Curate safely.'],
    caps: {},
    itemCount: packets.length,
    openItemIds: packets.map((packet) => packet.itemId),
    roadmapSummaries: [],
    dependencySummaries: [],
    recommendationSummaries: [],
    diagnostics: [],
  },
  packets,
  degradedOutcomes: [],
  reducerInput: {
    schemaVersion: 1,
    sourceFingerprint: SOURCE_FINGERPRINT,
    globalContext: {
      schemaVersion: 1,
      purpose: 'backlog-curation-map-reduce',
      sourceFingerprint: SOURCE_FINGERPRINT,
      curationGuidance: ['Curate safely.'],
      caps: {},
      itemCount: packets.length,
      openItemIds: packets.map((packet) => packet.itemId),
      roadmapSummaries: [],
      dependencySummaries: [],
      recommendationSummaries: [],
      diagnostics: [],
    },
    outcomes: [],
    diagnostics: [],
  },
};

describe('extension agent task backlog curation daemon map/reduce', () => {
  it('uses compact map/reduce prompts instead of large deferred legacy source text', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-agent-task-curation-daemon-'));
    const extensionRoot = join(cwd, '.eforge', 'extensions', 'eforge-plan');
    await mkdir(extensionRoot, { recursive: true });
    const legacySourceText = JSON.stringify({
      sourceFingerprint: SOURCE_FINGERPRINT,
      gitDelta: `${RAW_GIT_DELTA_SENTINEL}:${'g'.repeat(120_000)}`,
      fullImplementationAudit: `${RAW_FULL_AUDIT_SENTINEL}:${'a'.repeat(120_000)}`,
    });
    await writeFile(join(extensionRoot, 'source-provider.mjs'), `
      export function buildSource() { return { sourceText: ${JSON.stringify(legacySourceText)}, backlogCurationMapReduce: ${JSON.stringify(bundle)} }; }
      export function buildBacklogCurationReducerInput(globalContext, outcomes) { return { schemaVersion: 1, sourceFingerprint: globalContext.sourceFingerprint, globalContext, outcomes: [...outcomes], diagnostics: [] }; }
    `);
    const harness = new DaemonMapReduceHarness();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const context = await createMonitorContext(db, 0, { cwd, agentRuntimes: singletonRegistry(harness) });
    try {
      const service = new ExtensionAgentTaskService(context);
      const started = await service.start(
        { kind: 'eforge-plan.planning-draft', input: { topic: 'Analyze all backlog', requestedOutputSections: ['backlogCurationDraft', 'recommendations'], sourceProvider: { module: './source-provider.mjs', exportName: 'buildSource' } } },
        { owner: { extensionName: 'eforge-plan', extensionPath: extensionRoot } },
      );
      const completed = await waitForCompletedTask(service, started.task.taskId);

      expect(completed.result).toMatchObject({ backlogCurationDraft: { sourceFingerprint: SOURCE_FINGERPRINT } });
      expect(harness.itemAuditPrompts).toHaveLength(2);
      expect(harness.reducerPrompts).toHaveLength(1);
      expect(harness.genericPlanningPrompts).toHaveLength(0);
      for (const prompt of harness.prompts) {
        expect(prompt).not.toContain(RAW_GIT_DELTA_SENTINEL);
        expect(prompt).not.toContain(RAW_FULL_AUDIT_SENTINEL);
        expect(prompt).not.toContain(legacySourceText);
      }
      expect(Buffer.byteLength(harness.reducerPrompts[0] ?? '', 'utf-8')).toBeLessThanOrEqual(BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES * 2);
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

class DaemonMapReduceHarness implements AgentHarness {
  readonly prompts: string[] = [];
  readonly itemAuditPrompts: string[] = [];
  readonly reducerPrompts: string[] = [];
  readonly genericPlanningPrompts: string[] = [];

  effectiveCustomToolName(name: string): string { return name; }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    this.prompts.push(options.prompt);
    const itemTool = options.customTools?.find((tool) => tool.name === 'submit_eforge_plan_backlog_item_finding');
    const reducerTool = options.customTools?.find((tool) => tool.name === 'submit_eforge_plan_planning_result');
    if (itemTool !== undefined) this.itemAuditPrompts.push(options.prompt);
    else if (reducerTool !== undefined) this.reducerPrompts.push(options.prompt);
    else this.genericPlanningPrompts.push(options.prompt);

    yield { type: 'agent:start', agent, planId, agentId: 'agent', model: 'stub', harness: 'claude-sdk', harnessSource: 'tier', tier: 'planning', tierSource: 'tier', timestamp: new Date().toISOString() };
    if (itemTool !== undefined) {
      const packet = packets.find((entry) => options.prompt.includes(`\"itemId\": \"${entry.itemId}\"`)) ?? packets[0]!;
      await itemTool.handler({
        schemaVersion: 1,
        itemId: packet.itemId,
        sourceFingerprint: SOURCE_FINGERPRINT,
        packetSha256: sha256Json(packet),
        bodySha256: BODY_SHA,
        promptVersion: BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
        runtimeIdentity: { provider: 'stub', modelId: 'stub-model' },
        disposition: 'recheck',
        summary: 'No material changes.',
        rationale: 'Compact packet is sufficient.',
        citations: [],
        recommendationSignals: [],
        diagnostics: [],
      });
    }
    if (reducerTool !== undefined) {
      await reducerTool.handler({
        summary: 'Reduced curation outcomes.',
        assumptionsOpenQuestions: [],
        backlogCurationDraft: { schemaVersion: 1, sourceFingerprint: SOURCE_FINGERPRINT, summary: [], itemChanges: [], epicChanges: [], noOpRechecks: [], skipped: [], needsInput: [] },
      });
    }
    yield { type: 'agent:stop', agent, planId, agentId: 'agent', timestamp: new Date().toISOString() };
  }
}

async function waitForCompletedTask(service: ExtensionAgentTaskService, taskId: string): Promise<any> {
  for (let i = 0; i < 250; i += 1) {
    const { task } = await service.get(taskId);
    if (task.status === 'completed') return task;
    if (task.status === 'failed') throw new Error(task.errorMessage);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for completed curation task');
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
