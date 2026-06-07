import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_ROUTES, buildPath } from '../routes.js';
import {
  DAEMON_API_VERSION,
  assertExtensionAgentTaskId,
  parseEforgePlanPlanningDraftResult,
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
    expect(() => parseEforgePlanPlanningDraftResult({
      summary: 'No output sections',
      assumptionsOpenQuestions: [],
    })).toThrow();
  });

  it('defines task routes and builds parameterized paths through buildPath', () => {
    expect(API_ROUTES.extensionAgentTaskStart).toBe('/api/extensions/agent-tasks');
    expect(buildPath(API_ROUTES.extensionAgentTaskGet, { taskId: 'task/1' })).toBe('/api/extensions/agent-tasks/task%2F1');
    expect(buildPath(API_ROUTES.extensionAgentTaskCancel, { taskId: 'task/1' })).toBe('/api/extensions/agent-tasks/task%2F1/cancel');
    expect(() => assertExtensionAgentTaskId('')).toThrow();
    expect(() => assertExtensionAgentTaskId('   ')).toThrow();
  });

  it('Node helpers use API_ROUTES and buildPath for all task routes', () => {
    const source = readFileSync(new URL('../api/extension-agent-tasks.ts', import.meta.url), 'utf8');
    expect(source).toContain('API_ROUTES.extensionAgentTaskStart');
    expect(source).toContain('buildPath(API_ROUTES.extensionAgentTaskGet');
    expect(source).toContain('buildPath(API_ROUTES.extensionAgentTaskCancel');
  });

  it('bumps the daemon API version for extension agent task routes and events', () => {
    expect(DAEMON_API_VERSION).toBe(61);
    const source = readFileSync(new URL('../api-version-const.ts', import.meta.url), 'utf8');
    expect(source).toContain('extension agent task routes');
    expect(source).toContain('lifecycle events');
  });
});
