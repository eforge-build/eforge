import { expect } from 'vitest';
import type { EforgeEvent } from '../events.schemas.js';

export function expectEventAccepted(result: { success: boolean }, label: string): void {
  expect(result.success, `${label} should be accepted`).toBe(true);
}

export function expectEventRejected(result: { success: boolean }, label: string): void {
  expect(result.success, `${label} should be rejected`).toBe(false);
}

export function expectJsonRoundTrip<T>(value: T): void {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
}

export const newVariants: EforgeEvent[] = [
  // plan:status:change — plan moves to running
  {
    type: 'plan:status:change',
    timestamp: '2025-01-01T00:00:01.000Z',
    planId: 'plan-01-foundation',
    status: 'running',
  },

  // plan:status:change — plan completes
  {
    type: 'plan:status:change',
    timestamp: '2025-01-01T00:10:00.000Z',
    planId: 'plan-01-foundation',
    status: 'completed',
  },

  // plan:error:set
  {
    type: 'plan:error:set',
    timestamp: '2025-01-01T00:05:00.000Z',
    planId: 'plan-02-mutate-state',
    error: 'Agent exceeded max turns',
  },

  // plan:error:clear
  {
    type: 'plan:error:clear',
    timestamp: '2025-01-01T00:06:00.000Z',
    planId: 'plan-02-mutate-state',
  },

  // merge:worktree:set
  {
    type: 'merge:worktree:set',
    timestamp: '2025-01-01T01:00:00.000Z',
    path: '/project/.worktrees/merge-worktree-abc123',
  },

  // merge:worktree:clear
  {
    type: 'merge:worktree:clear',
    timestamp: '2025-01-01T01:30:00.000Z',
  },
];

export const NEW_VARIANT_TYPES = new Set([
  'plan:status:change',
  'plan:error:set',
  'plan:error:clear',
  'merge:worktree:set',
  'merge:worktree:clear',
]);

export const extensionAgentTaskVariants: EforgeEvent[] = [
  {
    type: 'extension:agent-task:start',
    timestamp: '2025-01-01T00:00:00.000Z',
    taskId: 'task-1',
    taskKind: 'eforge-plan.planning-draft',
    extensionName: 'planning-extension',
    status: 'running',
    metadata: { label: 'Draft planning for Demo' },
  },
  {
    type: 'extension:agent-task:progress',
    timestamp: '2025-01-01T00:00:01.000Z',
    taskId: 'task-1',
    taskKind: 'eforge-plan.planning-draft',
    extensionName: 'planning-extension',
    status: 'running',
    message: 'Inspecting project context',
    metadata: { progressMessage: 'Inspecting project context' },
  },
  {
    type: 'extension:agent-task:complete',
    timestamp: '2025-01-01T00:00:02.000Z',
    taskId: 'task-1',
    taskKind: 'eforge-plan.planning-draft',
    extensionName: 'planning-extension',
    status: 'completed',
    durationMs: 1200,
    metadata: { summary: 'Created a focused plan draft', outputSectionCount: 1 },
  },
  {
    type: 'extension:agent-task:failed',
    timestamp: '2025-01-01T00:00:03.000Z',
    taskId: 'task-2',
    taskKind: 'eforge-plan.planning-draft',
    extensionName: 'planning-extension',
    status: 'failed',
    durationMs: 500,
    errorCode: 'agent-error',
    message: 'Planner failed',
    metadata: { label: 'Draft planning for Broken' },
  },
  {
    type: 'extension:agent-task:cancelled',
    timestamp: '2025-01-01T00:00:04.000Z',
    taskId: 'task-3',
    taskKind: 'eforge-plan.planning-draft',
    extensionName: 'planning-extension',
    status: 'cancelled',
    reason: 'User cancelled',
    metadata: { label: 'Cancelled draft' },
  },
];

export const extensionActionVariants: EforgeEvent[] = [
  {
    type: 'extension:action:start',
    timestamp: '2025-01-01T00:00:00.000Z',
    invocationId: 'inv-1',
    actionId: 'tools.echo',
    extensionName: 'tools',
    extensionPath: '/project/.eforge/extensions/tools.js',
    requestedBy: { host: 'console', surface: 'actions', sessionId: 'sess-1' },
  },
  {
    type: 'extension:action:complete',
    timestamp: '2025-01-01T00:00:01.000Z',
    invocationId: 'inv-1',
    actionId: 'tools.echo',
    extensionName: 'tools',
    extensionPath: '/project/.eforge/extensions/tools.js',
    requestedBy: { host: 'console', surface: 'actions', sessionId: 'sess-1' },
    durationMs: 12,
  },
  {
    type: 'extension:action:failed',
    timestamp: '2025-01-01T00:00:02.000Z',
    invocationId: 'inv-2',
    actionId: 'tools.echo',
    extensionName: 'tools',
    extensionPath: '/project/.eforge/extensions/tools.js',
    requestedBy: { host: 'cli' },
    durationMs: 4,
    errorCode: 'invalid-input',
    message: 'Action input failed schema validation',
    validationErrors: [{ path: '/message', message: 'Expected string' }],
  },
  {
    type: 'extension:action:timeout',
    timestamp: '2025-01-01T00:00:03.000Z',
    invocationId: 'inv-3',
    actionId: 'tools.slow',
    extensionName: 'tools',
    extensionPath: '/project/.eforge/extensions/tools.js',
    requestedBy: { host: 'pi', surface: 'command' },
    durationMs: 5,
    timeoutMs: 5,
    message: 'Action handler timed out after 5ms',
  },
];

export const extensionDiagnosticVariants: EforgeEvent[] = [
  {
    type: 'extension:event-handler:failed',
    timestamp: '2025-01-01T00:00:00.000Z',
    sessionId: 'sess-1',
    runId: 'run-1',
    extensionName: 'audit-log',
    extensionPath: '/project/.eforge/extensions/audit-log.js',
    pattern: 'plan:build:*',
    triggeringEventType: 'plan:build:failed',
    message: 'boom',
    stack: 'Error: boom',
  },
  {
    type: 'extension:event-handler:failed',
    timestamp: '2025-01-01T00:00:01.000Z',
    extensionName: 'string-error-hook',
    extensionPath: '/project/.eforge/extensions/string-error-hook.js',
    pattern: 'queue:*',
    triggeringEventType: 'queue:complete',
    message: 'plain string failure',
  },
  {
    type: 'extension:event-handler:timeout',
    timestamp: '2025-01-01T00:00:02.000Z',
    extensionName: 'audit-log',
    extensionPath: '/project/.eforge/extensions/audit-log.js',
    pattern: '*',
    triggeringEventType: 'plan:build:complete',
    timeoutMs: 5000,
  },
];

export const extensionPolicyVariants: EforgeEvent[] = [
  {
    type: 'extension:policy:decision',
    timestamp: '2025-01-01T00:00:03.000Z',
    extensionName: 'guardrails',
    extensionPath: '/project/.eforge/extensions/guardrails.js',
    gateKind: 'plan-merge',
    method: 'beforePlanMerge',
    registrationIndex: 0,
    failurePolicy: 'fail-closed',
    planId: 'plan-01',
    decision: 'block',
    reason: 'protected paths changed',
  },
  {
    type: 'extension:policy:failed',
    timestamp: '2025-01-01T00:00:04.000Z',
    extensionName: 'guardrails',
    extensionPath: '/project/.eforge/extensions/guardrails.js',
    gateKind: 'queue-dispatch',
    method: 'beforeQueueDispatch',
    registrationIndex: 1,
    failurePolicy: 'fail-open',
    prdId: 'prd-123',
    prdTitle: 'Add feature',
    message: 'boom',
    stack: 'Error: boom',
  },
  {
    type: 'extension:policy:timeout',
    timestamp: '2025-01-01T00:00:05.000Z',
    extensionName: 'guardrails',
    extensionPath: '/project/.eforge/extensions/guardrails.js',
    gateKind: 'final-merge',
    method: 'beforeFinalMerge',
    registrationIndex: 2,
    failurePolicy: 'fail-closed',
    featureBranch: 'feature/prd-123',
    baseBranch: 'main',
    planIds: ['plan-01'],
    timeoutMs: 5000,
  },
];

export const extensionPolicyGateMatrixVariants: EforgeEvent[] = [
  {
    type: 'extension:policy:decision', timestamp: '2025-01-01T00:00:10.000Z', extensionName: 'guardrails', extensionPath: '/project/.eforge/extensions/guardrails.js', gateKind: 'queue-dispatch', method: 'beforeQueueDispatch', registrationIndex: 0, failurePolicy: 'fail-open', prdId: 'prd-123', prdTitle: 'Add feature', decision: 'allow',
  },
  {
    type: 'extension:policy:failed', timestamp: '2025-01-01T00:00:11.000Z', extensionName: 'guardrails', extensionPath: '/project/.eforge/extensions/guardrails.js', gateKind: 'queue-dispatch', method: 'beforeQueueDispatch', registrationIndex: 1, failurePolicy: 'fail-open', prdId: 'prd-123', prdTitle: 'Add feature', message: 'boom',
  },
  {
    type: 'extension:policy:timeout', timestamp: '2025-01-01T00:00:12.000Z', extensionName: 'guardrails', extensionPath: '/project/.eforge/extensions/guardrails.js', gateKind: 'queue-dispatch', method: 'beforeQueueDispatch', registrationIndex: 2, failurePolicy: 'fail-closed', prdId: 'prd-123', prdTitle: 'Add feature', timeoutMs: 5000,
  },
  {
    type: 'extension:policy:decision', timestamp: '2025-01-01T00:00:13.000Z', extensionName: 'guardrails', extensionPath: '/project/.eforge/extensions/guardrails.js', gateKind: 'plan-merge', method: 'beforePlanMerge', registrationIndex: 0, failurePolicy: 'fail-closed', planId: 'plan-01', decision: 'block', reason: 'protected paths changed',
  },
  {
    type: 'extension:policy:failed', timestamp: '2025-01-01T00:00:14.000Z', extensionName: 'guardrails', extensionPath: '/project/.eforge/extensions/guardrails.js', gateKind: 'plan-merge', method: 'beforePlanMerge', registrationIndex: 1, failurePolicy: 'fail-open', planId: 'plan-01', message: 'boom',
  },
  {
    type: 'extension:policy:timeout', timestamp: '2025-01-01T00:00:15.000Z', extensionName: 'guardrails', extensionPath: '/project/.eforge/extensions/guardrails.js', gateKind: 'plan-merge', method: 'beforePlanMerge', registrationIndex: 2, failurePolicy: 'fail-closed', planId: 'plan-01', timeoutMs: 5000,
  },
  {
    type: 'extension:policy:decision', timestamp: '2025-01-01T00:00:16.000Z', extensionName: 'guardrails', extensionPath: '/project/.eforge/extensions/guardrails.js', gateKind: 'final-merge', method: 'beforeFinalMerge', registrationIndex: 0, failurePolicy: 'fail-closed', featureBranch: 'feature/prd-123', baseBranch: 'main', planIds: ['plan-01'], decision: 'require-approval', reason: 'approval required',
  },
  {
    type: 'extension:policy:failed', timestamp: '2025-01-01T00:00:17.000Z', extensionName: 'guardrails', extensionPath: '/project/.eforge/extensions/guardrails.js', gateKind: 'final-merge', method: 'beforeFinalMerge', registrationIndex: 1, failurePolicy: 'fail-open', featureBranch: 'feature/prd-123', baseBranch: 'main', planIds: ['plan-01'], message: 'boom',
  },
  {
    type: 'extension:policy:timeout', timestamp: '2025-01-01T00:00:18.000Z', extensionName: 'guardrails', extensionPath: '/project/.eforge/extensions/guardrails.js', gateKind: 'final-merge', method: 'beforeFinalMerge', registrationIndex: 2, failurePolicy: 'fail-closed', featureBranch: 'feature/prd-123', baseBranch: 'main', planIds: ['plan-01'], timeoutMs: 5000,
  },
];


export const inputSourceVariants: EforgeEvent[] = [
  {
    type: 'extension:input-source:fetched',
    timestamp: '2025-01-01T00:00:00.000Z',
    extensionPath: '/project/.eforge/extensions/my-ext.js',
    extensionName: 'my-ext',
    adapterName: 'my-ext:linear',
    sourceId: 'LIN-123',
    contentLength: 4200,
  },
  {
    type: 'extension:input-source:failed',
    timestamp: '2025-01-01T00:00:00.000Z',
    extensionPath: '/project/.eforge/extensions/my-ext.js',
    extensionName: 'my-ext',
    adapterName: 'my-ext:linear',
    sourceId: 'LIN-404',
    reason: 'not-found',
    message: 'Issue LIN-404 not found',
  },
];

export const prdEnricherVariants: EforgeEvent[] = [
  {
    type: 'extension:prd-enricher:applied',
    timestamp: '2025-01-01T00:00:00.000Z',
    extensionPath: '/project/.eforge/extensions/my-ext.js',
    extensionName: 'my-ext',
    enricherName: 'my-ext:context-injector',
    sourceId: 'LIN-123',
    changed: true,
    inputLength: 1200,
    outputLength: 1800,
  },
  {
    type: 'extension:prd-enricher:failed',
    timestamp: '2025-01-01T00:00:00.000Z',
    extensionPath: '/project/.eforge/extensions/my-ext.js',
    extensionName: 'my-ext',
    enricherName: 'my-ext:context-injector',
    sourceId: 'LIN-123',
    reason: 'error',
    message: 'Enricher threw an unexpected error',
    stack: 'Error: Enricher threw\n    at enrich (/ext.js:10:5)',
  },
];

