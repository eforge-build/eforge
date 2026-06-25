import { describe, expect, it } from 'vitest';
import {
  BACKLOG_CURATION_ITEM_AUDIT_PROMPT_VERSION,
  BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES,
  type BacklogCurationMapReduceFinding,
  type BacklogCurationMapReduceItemPacket,
  type BacklogCurationMapReduceReducerInput,
} from '@eforge-build/client';
import {
  resolveBacklogItemAuditAgentTask,
  resolveBacklogReducerAgentTask,
  sha256Json,
} from '../eforge/extensions/eforge-plan/backlog-curation-agent-tasks.js';

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
      dependencySummaries: [],
      recommendationSummaries: [],
      redraftSummary: { gitDelta: { raw: 'RAW_GIT_DELTA_SENTINEL' }, fullImplementationAudit: { raw: 'RAW_FULL_IMPLEMENTATION_AUDIT_SENTINEL' }, fullBody: 'UNRELATED_FULL_ITEM_BODY_SENTINEL' },
      diagnostics: [],
    },
    outcomes: [{ schemaVersion: 1, outcome: 'audited-finding', itemId: 'item-one', sourceFingerprint: SHA, packetSha256: sha256Json(inputPacket), bodySha256: BODY_SHA, diagnostics: [], finding: finding(inputPacket) }],
    diagnostics: [],
  };
}

describe('backlog curation map/reduce agent task contributions', () => {
  it('runs item audits with read-only tools plus submit/progress custom tools', async () => {
    const inputPacket = packet();
    const resolved = resolveBacklogItemAuditAgentTask({ input: { packet: inputPacket }, extensionName: 'eforge-plan', extensionPath: process.cwd(), signal: new AbortController().signal, effectiveCustomToolName: (name) => name });
    expect(resolved.run.toolsPreset).toBe('read-only');
    expect(resolved.run.tools.map((tool) => tool.name)).toEqual(['submit_eforge_plan_backlog_item_finding', 'report_eforge_plan_planning_progress']);
    await resolved.run.tools[0]!.handler(finding(inputPacket));
    expect(resolved.getResult()?.itemId).toBe('item-one');
    expect(resolved.variables.packetJson).toContain('TARGET_ITEM_BODY_ONLY');
  });

  it('rejects invalid item findings without accepting a result', async () => {
    const inputPacket = packet();
    const resolved = resolveBacklogItemAuditAgentTask({ input: { packet: inputPacket }, extensionName: 'eforge-plan', extensionPath: process.cwd(), signal: new AbortController().signal, effectiveCustomToolName: (name) => name });
    const output = await resolved.run.tools[0]!.handler({ ...finding(inputPacket), packetSha256: OTHER_SHA });
    expect(output).toContain('Submission rejected:');
    expect(resolved.getResult()).toBeUndefined();
  });

  it('compacts reducer prompt input and runs with no repository tools', async () => {
    const resolved = resolveBacklogReducerAgentTask({ input: { reducerInput: reducerInput() }, extensionName: 'eforge-plan', extensionPath: process.cwd(), signal: new AbortController().signal, effectiveCustomToolName: (name) => name });
    expect(resolved.run.toolsPreset).toBe('none');
    expect(resolved.run.tools.map((tool) => tool.name)).toEqual(['submit_eforge_plan_planning_result', 'report_eforge_plan_planning_progress']);
    expect(Buffer.byteLength(resolved.variables.reducerInputJson, 'utf-8')).toBeLessThanOrEqual(BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES);
    expect(resolved.variables.reducerInputJson).not.toContain('RAW_GIT_DELTA_SENTINEL');
    expect(resolved.variables.reducerInputJson).not.toContain('RAW_FULL_IMPLEMENTATION_AUDIT_SENTINEL');
    expect(resolved.variables.reducerInputJson).not.toContain('UNRELATED_FULL_ITEM_BODY_SENTINEL');
  });
});
