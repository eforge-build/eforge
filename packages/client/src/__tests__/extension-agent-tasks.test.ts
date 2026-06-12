import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_ROUTES, buildPath } from '../routes.js';
import {
  DAEMON_API_VERSION,
  assertExtensionAgentTaskId,
  parseEforgePlanPlanningDraftResult,
  safeParseEforgePlanPlanningDraftResult,
  safeParseExtensionAgentTaskCancelRequest,
  safeParseExtensionAgentTaskGetRequest,
  safeParseExtensionAgentTaskRecord,
  safeParseExtensionAgentTaskStartRequest,
  type ExtensionAgentTaskRecord,
} from '../index.js';

const validResult = {
  summary: 'Drafted a focused implementation plan.',
  assumptionsOpenQuestions: ['Assume the existing session plan is authoritative.'],
  planDrafts: [{ title: 'Implement the feature', body: '# Plan\n\nDo the work.' }],
};

function taskRecord(overrides: Record<string, unknown> = {}): ExtensionAgentTaskRecord {
  return {
    taskId: 'task-1',
    kind: 'eforge-plan.planning-draft',
    status: 'completed',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:01.000Z',
    completedAt: '2025-01-01T00:00:01.000Z',
    metadata: { summary: 'done', outputSectionCount: 1 },
    result: validResult,
    ...overrides,
  } as ExtensionAgentTaskRecord;
}

describe('extension agent task contracts', () => {
  it('accepts valid start payloads and rejects promptTemplate', () => {
    const valid = {
      kind: 'eforge-plan.planning-draft',
      input: { topic: 'Demo', session: 'demo-session', requestedOutputSections: ['planDrafts'] },
      requestedBy: { host: 'console', surface: 'workstation:eforge-plan' },
    };
    expect(safeParseExtensionAgentTaskStartRequest(valid).success).toBe(true);
    expect(safeParseExtensionAgentTaskStartRequest({ ...valid, input: { topic: 'Demo', requestedOutputSections: ['recommendations', 'handoffDrafts'] } }).success).toBe(true);
    expect(safeParseExtensionAgentTaskStartRequest({ ...valid, input: { topic: '', requestedOutputSections: ['planDrafts'] } }).success).toBe(false);
    expect(safeParseExtensionAgentTaskStartRequest({ ...valid, input: { topic: '   ', requestedOutputSections: ['planDrafts'] } }).success).toBe(false);
    expect(safeParseExtensionAgentTaskStartRequest({ ...valid, input: { topic: 'Demo', requestedOutputSections: ['unsupported'] } }).success).toBe(false);
    expect(safeParseExtensionAgentTaskStartRequest({ ...valid, promptTemplate: 'custom' }).success).toBe(false);
  });

  it('accepts valid get and cancel payloads', () => {
    expect(safeParseExtensionAgentTaskGetRequest({ taskId: 'task-1' }).success).toBe(true);
    expect(safeParseExtensionAgentTaskGetRequest({ taskId: '' }).success).toBe(false);
    expect(safeParseExtensionAgentTaskGetRequest({ taskId: '   ' }).success).toBe(false);
    expect(safeParseExtensionAgentTaskGetRequest({ taskId: 'task-1', extra: true }).success).toBe(false);

    expect(safeParseExtensionAgentTaskCancelRequest({ reason: 'user requested' }).success).toBe(true);
    expect(safeParseExtensionAgentTaskCancelRequest({ taskId: 'task-1', prompt: 'cancel it' }).success).toBe(false);
  });

  it('accepts task record-shaped responses', () => {
    expect(safeParseExtensionAgentTaskRecord(taskRecord()).success).toBe(true);
    expect(safeParseExtensionAgentTaskRecord(taskRecord({ taskId: '' })).success).toBe(false);
    expect(safeParseExtensionAgentTaskRecord({
      taskId: 'task-1',
      kind: 'eforge-plan.planning-draft',
      status: 'running',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:01.000Z',
      startedAt: '2025-01-01T00:00:01.000Z',
    }).success).toBe(true);
    expect(safeParseExtensionAgentTaskRecord({
      taskId: 'task-1',
      kind: 'eforge-plan.planning-draft',
      status: 'cancelled',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:02.000Z',
      cancelledAt: '2025-01-01T00:00:02.000Z',
    }).success).toBe(true);
    expect(safeParseExtensionAgentTaskRecord(taskRecord({ result: undefined })).success).toBe(false);
    expect(safeParseExtensionAgentTaskRecord(taskRecord({ status: 'running' })).success).toBe(false);
  });

  it('requires planning results to include an applicable output section', () => {
    expect(parseEforgePlanPlanningDraftResult(validResult).summary).toContain('Drafted');
    expect(safeParseExtensionAgentTaskRecord(taskRecord({ result: {
      summary: 'Generated recommendations and handoffs.',
      assumptionsOpenQuestions: [],
      recommendations: { schemaVersion: 1, activeWork: [], readyCandidates: [{ itemId: 'item-one' }], recommendedNextSequence: [], safeParallelizableGroups: [], blockedChains: [], rationaleAndAssumptions: [] },
      handoffDrafts: [{ selection: { itemIds: ['item-one'], status: 'active' }, session: 'handoff-one' }],
    } })).success).toBe(true);
    const sessionPlanOnly = {
      summary: 'Generated session-plan sections.',
      assumptionsOpenQuestions: [],
      sessionPlanPatch: { sections: [{ dimension: 'scope', content: 'Generated scope.' }] },
    };
    expect((parseEforgePlanPlanningDraftResult(sessionPlanOnly) as { sessionPlanPatch?: { sections: unknown[] } }).sessionPlanPatch?.sections).toHaveLength(1);
    expect(safeParseExtensionAgentTaskRecord(taskRecord({ result: sessionPlanOnly })).success).toBe(true);
    expect(() => parseEforgePlanPlanningDraftResult({
      summary: 'No output sections',
      assumptionsOpenQuestions: [],
    })).toThrow();
  });

  it('accepts session-plan creation drafts, needs-input decisions, and section-progress metadata', () => {
    expect(safeParseExtensionAgentTaskStartRequest({
      kind: 'eforge-plan.planning-draft',
      input: { topic: 'Demo', requestedOutputSections: ['sessionPlanCreationDraft'] },
    }).success).toBe(true);

    const readyResult = {
      summary: 'Created a session plan draft.',
      assumptionsOpenQuestions: [],
      decision: 'ready',
      sessionPlanCreationDraft: {
        session: 'demo-session',
        topic: 'Demo',
        planningType: 'feature',
        planningDepth: 'focused',
        profile: 'excursion',
        agentProfile: 'some-profile',
        sections: [{ dimension: 'scope', content: 'Generated scope.' }],
      },
    };
    const parsedReady = parseEforgePlanPlanningDraftResult(readyResult);
    expect(parsedReady.summary).toContain('session plan');
    expect((parsedReady as typeof readyResult).sessionPlanCreationDraft.profile).toBe('excursion');
    expect((parsedReady as typeof readyResult).sessionPlanCreationDraft.agentProfile).toBe('some-profile');
    expect(safeParseExtensionAgentTaskRecord(taskRecord({ result: readyResult })).success).toBe(true);

    const needsInputResult = {
      summary: 'Cannot draft a ready session plan yet.',
      assumptionsOpenQuestions: [],
      decision: 'needs-input',
      clarificationQuestions: [{ question: 'Which milestone?' }],
      rationale: 'Milestone is unspecified.',
    };
    expect(safeParseExtensionAgentTaskRecord(taskRecord({ result: needsInputResult })).success).toBe(true);

    expect(safeParseEforgePlanPlanningDraftResult({
      summary: 'Invalid creation draft',
      assumptionsOpenQuestions: [],
      decision: 'ready',
      sessionPlanCreationDraft: { session: 's', topic: 't', planningType: 'p', planningDepth: 'd', sections: [] },
    }).success).toBe(false);

    expect(safeParseExtensionAgentTaskRecord({
      taskId: 'task-1',
      kind: 'eforge-plan.planning-draft',
      status: 'running',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:01.000Z',
      startedAt: '2025-01-01T00:00:01.000Z',
      metadata: { sectionProgress: { currentSection: 'scope', coveredSections: ['summary'], remainingSections: ['risks'] } },
    }).success).toBe(true);
  });

  it('rejects oversized section-progress metadata beyond the daemon sanitizer bounds', () => {
    const runningRecord = (sectionProgress: unknown) => ({
      taskId: 'task-1',
      kind: 'eforge-plan.planning-draft',
      status: 'running',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:01.000Z',
      startedAt: '2025-01-01T00:00:01.000Z',
      metadata: { sectionProgress },
    });

    // Within bounds: max-length strings and max-count arrays are accepted.
    expect(safeParseExtensionAgentTaskRecord(runningRecord({
      currentSection: 'x'.repeat(500),
      coveredSections: Array.from({ length: 50 }, (_, i) => `section-${i}`),
      remainingSections: Array.from({ length: 50 }, (_, i) => `remaining-${i}`),
    })).success).toBe(true);

    // currentSection longer than the 500-char cap is rejected.
    expect(safeParseExtensionAgentTaskRecord(runningRecord({ currentSection: 'x'.repeat(501) })).success).toBe(false);
    // A single oversized entry inside coveredSections is rejected.
    expect(safeParseExtensionAgentTaskRecord(runningRecord({ coveredSections: ['ok', 'y'.repeat(501)] })).success).toBe(false);
    // More than 50 covered sections is rejected.
    expect(safeParseExtensionAgentTaskRecord(runningRecord({ coveredSections: Array.from({ length: 51 }, (_, i) => `section-${i}`) })).success).toBe(false);
    // More than 50 remaining sections is rejected.
    expect(safeParseExtensionAgentTaskRecord(runningRecord({ remainingSections: Array.from({ length: 51 }, (_, i) => `remaining-${i}`) })).success).toBe(false);
  });

  it('defines task routes and builds parameterized paths through buildPath', () => {
    expect(API_ROUTES.extensionAgentTaskStart).toBe('/api/extensions/agent-tasks');
    expect(buildPath(API_ROUTES.extensionAgentTaskGet, { taskId: 'task-1' })).toBe('/api/extensions/agent-tasks/task-1');
    expect(buildPath(API_ROUTES.extensionAgentTaskCancel, { taskId: 'task-1' })).toBe('/api/extensions/agent-tasks/task-1/cancel');
    expect(() => assertExtensionAgentTaskId('')).toThrow();
    expect(() => assertExtensionAgentTaskId('   ')).toThrow();
    expect(() => assertExtensionAgentTaskId('task/1')).toThrow();
  });

  it('Node helpers use API_ROUTES and buildPath for all task routes', () => {
    const source = readFileSync(new URL('../api/extension-agent-tasks.ts', import.meta.url), 'utf8');
    expect(source).toContain('API_ROUTES.extensionAgentTaskStart');
    expect(source).toContain('buildPath(API_ROUTES.extensionAgentTaskGet');
    expect(source).toContain('buildPath(API_ROUTES.extensionAgentTaskCancel');
  });

  it('bumps the daemon API version for the plan revision turn and backlog curation draft contracts', () => {
    expect(DAEMON_API_VERSION).toBe(65);
    const source = readFileSync(new URL('../api-version-const.ts', import.meta.url), 'utf8');
    expect(source).toContain('planRevisionTurn');
    expect(source).toContain('backlogCurationDraft');
    expect(source).toContain('non-empty rationale');
    expect(source).toContain('requested output section');
    expect(source).toContain('result field');
    expect(source).toContain('first-party workstation');
    expect(source).toContain('sessionPlanCreationDraft');
    expect(source).toContain('needs-input decision');
    expect(source).toContain('sectionProgress metadata');
  });
});
