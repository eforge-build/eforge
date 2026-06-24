import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
  BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES,
  BacklogCurationMapReduceFindingSchema,
  BacklogCurationMapReduceItemPacketSchema,
  BacklogCurationMapReduceReducerInputSchema,
  BacklogCurationMapReduceRuntimeIdentitySchema,
  EforgePlanPlanningDraftResultSchema,
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
const RAW_ITEM_BODY_SENTINEL = 'RAW_ITEM_BODY_SENTINEL_DO_NOT_PROMPT';
const TypeBoxKind = Symbol.for('TypeBox.Kind');
const StringSchema = { type: 'string', [TypeBoxKind]: 'String' } as never;
const EmptyObjectSchema = { type: 'object', additionalProperties: true, properties: {}, [TypeBoxKind]: 'Object' } as never;

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
    await mkdir(join(extensionRoot, 'prompts'), { recursive: true });
    await copyPromptAssets(extensionRoot);
    const legacySourceText = JSON.stringify({
      sourceFingerprint: SOURCE_FINGERPRINT,
      gitDelta: `${RAW_GIT_DELTA_SENTINEL}:${'g'.repeat(120_000)}`,
      fullImplementationAudit: `${RAW_FULL_AUDIT_SENTINEL}:${'a'.repeat(120_000)}`,
      items: packets.map((packet) => ({ id: packet.itemId, body: `${RAW_ITEM_BODY_SENTINEL}:${packet.itemId}:${'b'.repeat(120_000)}` })),
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
        { owner: { extensionName: 'eforge-plan', extensionPath: extensionRoot }, registry: registryForExtensionRoot(extensionRoot) as never },
      );
      const completed = await waitForCompletedTask(service, started.task.taskId);

      expect(completed.result).toMatchObject({ backlogCurationDraft: { sourceFingerprint: SOURCE_FINGERPRINT } });
      expect(harness.itemAuditPrompts).toHaveLength(2);
      expect(harness.reducerPrompts).toHaveLength(1);
      expect(harness.genericPlanningPrompts).toHaveLength(0);
      for (const prompt of harness.prompts) {
        expect(prompt).not.toContain(RAW_GIT_DELTA_SENTINEL);
        expect(prompt).not.toContain(RAW_FULL_AUDIT_SENTINEL);
        expect(prompt).not.toContain(RAW_ITEM_BODY_SENTINEL);
        expect(prompt).not.toContain(legacySourceText);
      }
      expect(Buffer.byteLength(harness.reducerPrompts[0] ?? '', 'utf-8')).toBeLessThanOrEqual(BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES * 2);
    } finally {
      db.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

async function copyPromptAssets(extensionRoot: string): Promise<void> {
  for (const name of ['eforge-plan-planning-draft.md', 'eforge-plan-backlog-curation-item-audit.md', 'eforge-plan-backlog-curation-reducer.md']) {
    const source = await readFile(join(process.cwd(), 'eforge/extensions/eforge-plan/prompts', name), 'utf-8');
    await writeFile(join(extensionRoot, 'prompts', name), source);
  }
}

function registryForExtensionRoot(extensionRoot: string) {
  const owner = { extensionName: 'eforge-plan', extensionPath: extensionRoot };
  const tool = (name: string, schema: object) => ({ name, description: name, inputSchema: schema, handler: async () => 'submitted' });
  const itemTask = {
    kind: 'agentTask' as const,
    ...owner,
    localId: 'backlog-item-audit',
    id: 'eforge-plan:backlog-item-audit',
    value: {
      id: 'backlog-item-audit',
      title: 'Backlog item audit',
      inputSchema: { type: 'object', additionalProperties: false, required: ['packet'], properties: { packet: BacklogCurationMapReduceItemPacketSchema, runtimeIdentity: BacklogCurationMapReduceRuntimeIdentitySchema, promptVersion: StringSchema }, [TypeBoxKind]: 'Object' } as never,
      outputSchema: BacklogCurationMapReduceFindingSchema,
      prompt: { kind: 'asset' as const, asset: 'prompts/eforge-plan-backlog-curation-item-audit.md' },
      resolvePrompt(ctx: { input: { packet: BacklogCurationMapReduceItemPacket; runtimeIdentity?: unknown; promptVersion?: string }; effectiveCustomToolName?: (name: string) => string }) {
        let submitted: unknown;
        return {
          variables: { itemId: ctx.input.packet.itemId, sourceFingerprint: ctx.input.packet.sourceFingerprint, packetSha256: sha256Json(ctx.input.packet), promptVersion: ctx.input.promptVersion ?? BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION, runtimeIdentityJson: JSON.stringify(ctx.input.runtimeIdentity ?? null), runtimeIdentityInstruction: 'Runtime identity is server-owned; do not submit this field.', packetJson: JSON.stringify(ctx.input.packet, null, 2), submitTool: ctx.effectiveCustomToolName?.('submit_eforge_plan_backlog_item_finding') ?? 'submit_eforge_plan_backlog_item_finding', progressTool: 'report_eforge_plan_planning_progress' },
          run: { role: 'planner', toolsPreset: 'read-only', tools: [{ ...tool('submit_eforge_plan_backlog_item_finding', BacklogCurationMapReduceFindingSchema), handler: async (input: unknown) => { submitted = input; return 'submitted'; } }, tool('report_eforge_plan_planning_progress', EmptyObjectSchema)] },
          getResult: () => submitted,
          missingResultMessage: 'missing item finding',
        };
      },
    },
  };
  const reducerTask = {
    kind: 'agentTask' as const,
    ...owner,
    localId: 'backlog-reducer',
    id: 'eforge-plan:backlog-reducer',
    value: {
      id: 'backlog-reducer',
      title: 'Backlog reducer',
      inputSchema: { type: 'object', additionalProperties: false, required: ['reducerInput'], properties: { reducerInput: BacklogCurationMapReduceReducerInputSchema, requestedOutputSections: { type: 'array', items: StringSchema, [TypeBoxKind]: 'Array' }, validationErrors: { type: 'array', items: StringSchema, [TypeBoxKind]: 'Array' } }, [TypeBoxKind]: 'Object' } as never,
      outputSchema: EforgePlanPlanningDraftResultSchema,
      prompt: { kind: 'asset' as const, asset: 'prompts/eforge-plan-backlog-curation-reducer.md' },
      resolvePrompt(ctx: { input: { reducerInput: unknown; requestedOutputSections?: string[]; validationErrors?: string[] }; effectiveCustomToolName?: (name: string) => string }) {
        let submitted: unknown;
        return {
          variables: { reducerInputJson: JSON.stringify(ctx.input.reducerInput, null, 2), requestedOutputSections: ctx.input.requestedOutputSections?.join(', ') ?? 'backlogCurationDraft, recommendations', validationErrors: JSON.stringify(ctx.input.validationErrors ?? []), submitTool: ctx.effectiveCustomToolName?.('submit_eforge_plan_planning_result') ?? 'submit_eforge_plan_planning_result', progressTool: 'report_eforge_plan_planning_progress', resultSchema: 'type: object' },
          run: { role: 'planner', toolsPreset: 'none', tools: [{ ...tool('submit_eforge_plan_planning_result', EforgePlanPlanningDraftResultSchema), handler: async (input: unknown) => { submitted = input; return 'submitted'; } }, tool('report_eforge_plan_planning_progress', EmptyObjectSchema)] },
          getResult: () => submitted,
          missingResultMessage: 'missing reducer result',
        };
      },
    },
  };
  return { agentTasks: [itemTask, reducerTask], actions: [], tools: [], eventHooks: [], agentRunHooks: [], policyGates: [], profileRouters: [], inputSources: [], reviewerPerspectives: [], validationProviders: [], prdEnrichers: [], consoleContributions: [], consoleWorkstations: [], integrationCommands: [], deepLinks: [], diagnostics: [], extensions: [], candidates: [] };
}

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
        verdict: 'still-needed',
        closureEvidenceRoles: ['supporting'],
        checkedPaths: [{ path: 'src/item.ts', reason: 'searched current source' }],
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
