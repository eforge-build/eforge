import { describe, expect, it } from 'vitest';
import {
  BACKLOG_CURATION_FINDING_MAX_BYTES,
  BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
  BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES,
  type BacklogCurationMapReduceFinding,
  type BacklogCurationMapReduceItemPacket,
  type BacklogCurationMapReduceReducerInput,
} from '@eforge-build/client';
import {
  runBacklogCurationItemAuditTask,
  runBacklogCurationReducerTask,
  sha256Json,
} from '@eforge-build/engine/agents/backlog-curation-map-reduce';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { buildBacklogCurationMapReduceSourceBundle, computeBacklogCurationPacketSha256 } from '../eforge/extensions/eforge-plan/backlog-curation-packets.js';
import { StubHarness } from './stub-harness.js';

async function collect<T>(iter: AsyncGenerator<EforgeEvent, T>): Promise<{ events: EforgeEvent[]; result: T }> {
  const events: EforgeEvent[] = [];
  while (true) {
    const next = await iter.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
}

const SHA = '1'.repeat(64);
const OTHER_SHA = '2'.repeat(64);
const BODY_SHA = '3'.repeat(64);

function packet(): BacklogCurationMapReduceItemPacket {
  return {
    schemaVersion: 1,
    kind: 'item',
    sourceFingerprint: SHA,
    itemId: 'item-one',
    itemTitle: 'Target item one',
    metadata: { status: 'active' },
    precondition: { kind: 'item', id: 'item-one', bodySha256: BODY_SHA, sourceFingerprint: SHA, recordSha256: OTHER_SHA },
    bodySha256: BODY_SHA,
    recordSha256: OTHER_SHA,
    sectionSummaries: [{ heading: 'Summary', text: 'TARGET_ITEM_BODY_ONLY' }],
    dependencyFacts: [],
    currentSourceCitations: [{ kind: 'current-source', source: 'src/target.ts', excerpt: 'current source evidence' }],
    historicalHints: [],
    recommendationSignals: [],
    diagnostics: [],
  };
}

function finding(inputPacket = packet()): BacklogCurationMapReduceFinding {
  return {
    schemaVersion: 1,
    itemId: inputPacket.itemId,
    sourceFingerprint: inputPacket.sourceFingerprint,
    packetSha256: sha256Json(inputPacket),
    bodySha256: inputPacket.bodySha256,
    promptVersion: BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
    runtimeIdentity: { provider: 'stub', modelId: 'stub-model' },
    disposition: 'recheck',
    verdict: 'still-needed',
    closureEvidenceRoles: ['supporting'],
    checkedPaths: [{ path: 'src/target.ts', reason: 'current source citation from packet' }],
    summary: 'Item remains open and fresh.',
    rationale: 'Supplied current-source citation is relevant but does not prove closure.',
    citations: inputPacket.currentSourceCitations,
    recommendationSignals: [],
    diagnostics: [],
  };
}

function reducerInput(): BacklogCurationMapReduceReducerInput {
  const inputPacket = packet();
  return {
    schemaVersion: 1,
    sourceFingerprint: SHA,
    generatedAt: '2026-01-01T00:00:00.000Z',
    globalContext: {
      schemaVersion: 1,
      purpose: 'backlog-curation-map-reduce',
      sourceFingerprint: SHA,
      generatedAt: '2026-01-01T00:00:00.000Z',
      curationGuidance: ['Use current source as closure authority.'],
      caps: {},
      itemCount: 1,
      openItemIds: ['item-one'],
      roadmapSummaries: [],
      dependencySummaries: [{ id: 'dep-one', summary: 'Dependency summary only.' }],
      recommendationSummaries: [{ id: 'rec-one', summary: 'Recommendation summary only.' }],
      redraftSummary: {
        gitDelta: { raw: 'RAW_GIT_DELTA_SENTINEL' },
        fullImplementationAudit: { raw: 'RAW_FULL_IMPLEMENTATION_AUDIT_SENTINEL' },
        fullBody: 'UNRELATED_FULL_ITEM_BODY_SENTINEL',
      },
      diagnostics: [],
    },
    outcomes: [{ schemaVersion: 1, outcome: 'audited-finding', itemId: 'item-one', sourceFingerprint: SHA, packetSha256: sha256Json(inputPacket), bodySha256: BODY_SHA, diagnostics: [], finding: finding(inputPacket) }],
    diagnostics: [],
  };
}

const validReducerSubmission = {
  summary: 'Reduced curation findings.',
  assumptionsOpenQuestions: [],
  backlogCurationDraft: {
    schemaVersion: 1,
    sourceFingerprint: SHA,
    summary: ['No material changes required.'],
    itemChanges: [],
    epicChanges: [],
    noOpRechecks: [],
    skipped: [],
    needsInput: [],
  },
};

function promptJsonBlock(prompt: string, heading: string): string {
  return prompt.split(heading)[1]?.split('```json')[1]?.split('```')[0]?.trim() ?? '';
}

describe('backlog curation map/reduce agent runners', () => {
  it('prompts item audit with one packet and no unrelated body sentinel', async () => {
    const bundle = buildBacklogCurationMapReduceSourceBundle({
      sourceFingerprint: SHA,
      openItems: [
        { id: 'item-one', title: 'Target item one', precondition: { bodySha256: BODY_SHA, recordSha256: OTHER_SHA }, sections: { Summary: 'TARGET_ITEM_BODY_ONLY' } },
        { id: 'item-two', title: 'Unrelated item two', precondition: { bodySha256: '4'.repeat(64), recordSha256: '5'.repeat(64) }, sections: { Summary: 'UNRELATED_ITEM_BODY_SENTINEL' }, evidence_notes: 'UNRELATED_ITEM_EVIDENCE_SENTINEL' },
      ],
    });
    const inputPacket = bundle.packets[0]!;
    expect(bundle.packets[1]).toEqual(expect.objectContaining({ itemId: 'item-two' }));
    expect(JSON.stringify(bundle.packets[1])).toContain('UNRELATED_ITEM_BODY_SENTINEL');
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit_eforge_plan_backlog_item_finding', toolUseId: 'tool-1', input: finding(inputPacket), output: '' }] }]);

    const { result } = await collect(runBacklogCurationItemAuditTask({ harness, cwd: '/tmp', packet: inputPacket }));

    expect(result.itemId).toBe('item-one');
    expect(harness.prompts[0]).toContain('item-one');
    expect(harness.prompts[0]).toContain('TARGET_ITEM_BODY_ONLY');
    expect(harness.prompts[0]).not.toContain('UNRELATED_ITEM_BODY_SENTINEL');
    expect(harness.prompts[0]).not.toContain('UNRELATED_ITEM_EVIDENCE_SENTINEL');
  });

  it('runs item audits with read-only repository tools plus submit/progress custom tools', async () => {
    const inputPacket = packet();
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit_eforge_plan_backlog_item_finding', toolUseId: 'tool-1', input: finding(inputPacket), output: '' }] }]);

    await collect(runBacklogCurationItemAuditTask({ harness, cwd: '/tmp', packet: inputPacket }));

    expect(harness.calls[0]?.tools).toBe('read-only');
    expect(harness.customToolSets[0]?.map((tool) => tool.name)).toEqual(['submit_eforge_plan_backlog_item_finding', 'report_eforge_plan_planning_progress']);
  });

  it('accepts item findings with packet hashes computed by the source packet builder', async () => {
    const inputPacket = packet();
    const externalPacketSha256 = computeBacklogCurationPacketSha256(inputPacket);
    expect(externalPacketSha256).toBe(sha256Json(inputPacket));
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit_eforge_plan_backlog_item_finding', toolUseId: 'tool-1', input: { ...finding(inputPacket), packetSha256: externalPacketSha256 }, output: '' }] }]);

    const { result } = await collect(runBacklogCurationItemAuditTask({ harness, cwd: '/tmp', packet: inputPacket }));

    expect(result.packetSha256).toBe(externalPacketSha256);
  });

  it.each([
    ['sourceFingerprint mismatch', (base: BacklogCurationMapReduceFinding) => ({ ...base, sourceFingerprint: OTHER_SHA })],
    ['packetSha256 mismatch', (base: BacklogCurationMapReduceFinding) => ({ ...base, packetSha256: OTHER_SHA })],
    ['bodySha256 mismatch', (base: BacklogCurationMapReduceFinding) => ({ ...base, bodySha256: OTHER_SHA })],
    ['promptVersion mismatch', (base: BacklogCurationMapReduceFinding) => ({ ...base, promptVersion: 'other-prompt' })],
    ['itemId mismatch', (base: BacklogCurationMapReduceFinding) => ({ ...base, itemId: 'other-item' })],
    ['missing verdict', (base: BacklogCurationMapReduceFinding) => ({ ...base, verdict: undefined })],
    ['missing checked paths', (base: BacklogCurationMapReduceFinding) => ({ ...base, checkedPaths: [] })],
    ['shipped without closure roles', (base: BacklogCurationMapReduceFinding) => ({ ...base, disposition: 'change' as const, verdict: 'shipped' as const, closureEvidenceRoles: ['supporting'] })],
    ['oversized JSON', (base: BacklogCurationMapReduceFinding) => ({ ...base, rationale: 'r'.repeat(BACKLOG_CURATION_FINDING_MAX_BYTES) })],
    ['excessive arrays', (base: BacklogCurationMapReduceFinding) => ({ ...base, citations: Array.from({ length: 20 }, () => ({ kind: 'current-source' as const, source: 'src' })) })],
    ['unknown properties', (base: BacklogCurationMapReduceFinding) => ({ ...base, unknown: true })],
  ])('rejects invalid item findings for %s without accepting a result', async (_name, mutate) => {
    const inputPacket = packet();
    const invalidFinding = mutate(finding(inputPacket));
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit_eforge_plan_backlog_item_finding', toolUseId: 'tool-1', input: invalidFinding, output: '' }] }]);

    await expect(collect(runBacklogCurationItemAuditTask({ harness, cwd: '/tmp', packet: inputPacket }))).rejects.toThrow('submit_eforge_plan_backlog_item_finding');
    const output = harness.calls[0] === undefined ? '' : await harness.customToolSets[0]![0].handler(invalidFinding);
    expect(output).toContain('Submission rejected:');
  });

  it('rejects duplicate item finding submissions and keeps the first accepted result', async () => {
    const inputPacket = packet();
    const first = finding(inputPacket);
    const second = { ...finding(inputPacket), summary: 'Second submission should not replace the first.' };
    const harness = new StubHarness([{ toolCalls: [
      { tool: 'submit_eforge_plan_backlog_item_finding', toolUseId: 'tool-1', input: first, output: '' },
      { tool: 'submit_eforge_plan_backlog_item_finding', toolUseId: 'tool-2', input: second, output: '' },
    ] }]);

    const { events, result } = await collect(runBacklogCurationItemAuditTask({ harness, cwd: '/tmp', packet: inputPacket }));

    expect(result.summary).toBe(first.summary);
    expect(events.find((event) => event.type === 'agent:tool_result' && event.toolUseId === 'tool-2')?.output).toContain('already been accepted');
  });

  it('keeps reducer prompt input capped and excludes raw source bundle fields', async () => {
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: validReducerSubmission, output: '' }] }]);

    await collect(runBacklogCurationReducerTask({ harness, cwd: '/tmp', reducerInput: reducerInput() }));

    const prompt = harness.prompts[0] ?? '';
    const reducerJson = promptJsonBlock(prompt, '## Reducer input JSON');
    expect(reducerJson.trim()).not.toBe('');
    const parsedReducerJson = JSON.parse(reducerJson) as BacklogCurationMapReduceReducerInput;
    expect(parsedReducerJson.sourceFingerprint).toBe(SHA);
    expect(Buffer.byteLength(reducerJson, 'utf-8')).toBeLessThanOrEqual(BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES);
    expect(prompt).not.toContain('RAW_GIT_DELTA_SENTINEL');
    expect(prompt).not.toContain('RAW_FULL_IMPLEMENTATION_AUDIT_SENTINEL');
    expect(prompt).not.toContain('UNRELATED_FULL_ITEM_BODY_SENTINEL');
  });

  it('runs reducer attempts with no repository tools and only submit/progress custom tools', async () => {
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: validReducerSubmission, output: '' }] }]);

    await collect(runBacklogCurationReducerTask({ harness, cwd: '/tmp', reducerInput: reducerInput() }));

    expect(harness.calls[0]?.tools).toBe('none');
    expect(harness.customToolSets[0]?.map((tool) => tool.name)).toEqual(['submit_eforge_plan_planning_result', 'report_eforge_plan_planning_progress']);
  });

  it('passes abort signals to item audit runs', async () => {
    const inputPacket = packet();
    const abortController = new AbortController();
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit_eforge_plan_backlog_item_finding', toolUseId: 'tool-1', input: finding(inputPacket), output: '' }] }]);

    await collect(runBacklogCurationItemAuditTask({ harness, cwd: '/tmp', packet: inputPacket, abortController }));

    expect(harness.calls[0]?.abortSignal).toBe(abortController.signal);
  });

  it('repairs once after invalid reducer submissions and then returns bounded needs-input', async () => {
    const invalidSubmission = { summary: 'Invalid', assumptionsOpenQuestions: [] };
    const abortController = new AbortController();
    const harness = new StubHarness([
      { toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: invalidSubmission, output: '' }] },
      { toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-2', input: invalidSubmission, output: '' }] },
    ]);

    const { result } = await collect(runBacklogCurationReducerTask({ harness, cwd: '/tmp', reducerInput: reducerInput(), abortController }));

    expect(harness.calls).toHaveLength(2);
    expect(harness.calls.every((call) => call.abortSignal === abortController.signal)).toBe(true);
    expect(result).toMatchObject({ decision: 'needs-input' });
    expect(result.summary).toContain('needs input');
  });

  it('bounds needs-input validation errors, clarification text, and rationale after failed repair', async () => {
    const hugeErrors = Array.from({ length: 40 }, (_, index) => `validation-error-${index}: ${'x'.repeat(1_000)}`);
    const harness = new StubHarness([
      { toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: validReducerSubmission, output: '' }] },
      { toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-2', input: validReducerSubmission, output: '' }] },
    ]);

    const { result } = await collect(runBacklogCurationReducerTask({
      harness,
      cwd: '/tmp',
      reducerInput: reducerInput(),
      validateResult: () => hugeErrors,
      repair: { maxErrors: 6, maxErrorBytes: 600 },
    }));

    const initialReducerJson = promptJsonBlock(harness.prompts[0] ?? '', '## Reducer input JSON');
    const repairPrompt = harness.prompts[1] ?? '';
    const repairErrors = JSON.parse(promptJsonBlock(repairPrompt, '## Prior validation errors for this repair attempt')) as string[];
    const repairReducerJson = promptJsonBlock(repairPrompt, '## Reducer input JSON');
    const initialReducerInput = JSON.parse(initialReducerJson) as BacklogCurationMapReduceReducerInput;
    const repairReducerInput = JSON.parse(repairReducerJson) as BacklogCurationMapReduceReducerInput;

    expect(repairErrors.length).toBeGreaterThan(0);
    expect(repairErrors.length).toBeLessThanOrEqual(6);
    expect(Buffer.byteLength(repairErrors.join(''), 'utf-8')).toBeLessThanOrEqual(600);
    expect(repairReducerInput.sourceFingerprint).toBe(initialReducerInput.sourceFingerprint);
    expect(repairReducerInput.outcomes).toEqual(initialReducerInput.outcomes);
    expect(repairPrompt).not.toContain('RAW_GIT_DELTA_SENTINEL');
    expect(repairPrompt).not.toContain('RAW_FULL_IMPLEMENTATION_AUDIT_SENTINEL');
    expect(repairPrompt).not.toContain('UNRELATED_FULL_ITEM_BODY_SENTINEL');
    expect(result.decision).toBe('needs-input');
    expect(result.assumptionsOpenQuestions.length).toBeLessThanOrEqual(12);
    expect(result.assumptionsOpenQuestions.every((entry) => entry.length <= 2_000)).toBe(true);
    expect(result.clarificationQuestions?.[0]?.question.length).toBeLessThan(200);
    expect(result.clarificationQuestions?.[0]?.why.length).toBeLessThanOrEqual(600);
    expect(result.rationale.length).toBeLessThan(760);
  });

  it('propagates thrown reducer validation callback errors', async () => {
    const harness = new StubHarness([{ toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: validReducerSubmission, output: '' }] }]);

    await expect(collect(runBacklogCurationReducerTask({
      harness,
      cwd: '/tmp',
      reducerInput: reducerInput(),
      validateResult: () => { throw new Error('apply-preview storage crashed'); },
    }))).rejects.toThrow('apply-preview storage crashed');
  });

  it('repairs once after reducer validation callback errors and accepts the repaired result', async () => {
    const repairedSubmission = { ...validReducerSubmission, summary: 'Repaired reduced curation findings.' };
    const harness = new StubHarness([
      { toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-1', input: validReducerSubmission, output: '' }] },
      { toolCalls: [{ tool: 'submit_eforge_plan_planning_result', toolUseId: 'tool-2', input: repairedSubmission, output: '' }] },
    ]);

    const { result } = await collect(runBacklogCurationReducerTask({
      harness,
      cwd: '/tmp',
      reducerInput: reducerInput(),
      validateResult: (submission) => (submission.summary.startsWith('Repaired') ? undefined : ['apply-preview validation failed']),
    }));

    expect(harness.calls).toHaveLength(2);
    expect(harness.prompts[1]).toContain('apply-preview validation failed');
    expect(result.summary).toBe('Repaired reduced curation findings.');
  });
});
