export interface InvalidEventWireParityFixture {
  label: string;
  payload: unknown;
  expectedErrorPath?: string;
  expectedErrorMessageFragment?: string;
}


export const missingRequiredFieldPayloads: InvalidEventWireParityFixture[] = [
  { label: 'session:start missing sessionId', payload: { type: 'session:start', timestamp: '2025-01-01T00:00:00.000Z' }, expectedErrorPath: '' },
  { label: 'plan:build:failed missing error field', payload: { type: 'plan:build:failed', timestamp: '2025-01-01T00:00:00.000Z', planId: 'plan-01' }, expectedErrorPath: '' },
  { label: 'enqueue:complete missing required planSet field', payload: { type: 'enqueue:complete', timestamp: '2025-01-01T00:00:00.000Z', id: 'prd-1', filePath: '.eforge/queue/prd-1.md', title: 'My PRD' }, expectedErrorPath: '' },
  { label: 'daemon:heartbeat missing uptime', payload: { type: 'daemon:heartbeat', timestamp: '2025-01-01T00:00:00.000Z', queueDepth: 0, runningBuilds: 1, autoBuild: { enabled: true, paused: false }, subscribers: 2 }, expectedErrorPath: '' },
  { label: 'gap_close:complete missing required passed field', payload: { type: 'gap_close:complete', timestamp: '2025-01-01T00:00:00.000Z' }, expectedErrorPath: '' },
  { label: 'extension:event-handler:failed missing extensionName', payload: { type: 'extension:event-handler:failed', timestamp: '2025-01-01T00:00:00.000Z', extensionPath: '/x.js', pattern: '*', triggeringEventType: 'plan:build:failed', message: 'boom' }, expectedErrorPath: '' },
  { label: 'extension:event-handler:timeout missing timeoutMs', payload: { type: 'extension:event-handler:timeout', timestamp: '2025-01-01T00:00:00.000Z', extensionName: 'x', extensionPath: '/x.js', pattern: '*', triggeringEventType: 'plan:build:failed' }, expectedErrorPath: '' },
  { label: 'any event missing timestamp (required envelope field)', payload: { type: 'session:start', sessionId: 'sess-1' }, expectedErrorPath: '' },
];

export const wrongLiteralPayloads: InvalidEventWireParityFixture[] = [
  { label: 'plan:status:change with invalid status literal', payload: { type: 'plan:status:change', timestamp: '2025-01-01T00:00:00.000Z', planId: 'plan-01', status: 'invalid-status' }, expectedErrorPath: '' },
  { label: 'session:end with invalid result status literal', payload: { type: 'session:end', timestamp: '2025-01-01T00:00:00.000Z', sessionId: 'sess-1', result: { status: 'unknown-status', summary: 'done' } }, expectedErrorPath: '' },
  { label: 'agent:start with invalid harness value', payload: { type: 'agent:start', timestamp: '2025-01-01T00:00:00.000Z', agentId: 'agent-1', agent: 'builder', model: 'claude-sonnet-4-5', harness: 'unknown-harness', harnessSource: 'tier', tier: 'standard', tierSource: 'tier' }, expectedErrorPath: '' },
  { label: 'queue:prd:complete with invalid status literal', payload: { type: 'queue:prd:complete', timestamp: '2025-01-01T00:00:00.000Z', prdId: 'prd-1', status: 'in-progress' }, expectedErrorPath: '' },
  { label: 'agent:activity missing required attribution field', payload: { type: 'agent:activity', timestamp: '2025-01-01T00:00:00.000Z', agentId: 'agt-abc', agent: 'builder', totals: { filesChanged: 1, additions: 5, deletions: 0 } }, expectedErrorPath: '' },
];

export const landingActionPayloads: InvalidEventWireParityFixture[] = [
  { label: 'landing:start with invalid action value', payload: { type: 'landing:start', timestamp: '2025-01-01T00:00:00.000Z', action: 'foo', featureBranch: 'eforge/my-set', baseBranch: 'main' }, expectedErrorPath: '' },
  { label: 'landing:complete missing required action field', payload: { type: 'landing:complete', timestamp: '2025-01-01T00:00:00.000Z', featureBranch: 'eforge/my-set', baseBranch: 'main' }, expectedErrorPath: '' },
  { label: 'landing:skipped with invalid action value', payload: { type: 'landing:skipped', timestamp: '2025-01-01T00:00:00.000Z', action: 'push-to-remote', featureBranch: 'eforge/my-set', baseBranch: 'main', reason: 'some reason' }, expectedErrorPath: '' },
];

export const stackEventPayloads: InvalidEventWireParityFixture[] = [
  { label: 'stack:landing:update with invalid status literal', payload: { type: 'stack:landing:update', timestamp: '2025-01-01T00:00:00.000Z', prdId: 'feat-a', stackId: 'stack-1', action: 'pr', branch: 'eforge/feat-a', status: 'in-progress' }, expectedErrorPath: '' },
  { label: 'stack:landing:update with invalid action literal', payload: { type: 'stack:landing:update', timestamp: '2025-01-01T00:00:00.000Z', prdId: 'feat-a', stackId: 'stack-1', action: 'push', branch: 'eforge/feat-a', status: 'complete' }, expectedErrorPath: '' },
  { label: 'stack:provider:command with invalid provider literal', payload: { type: 'stack:provider:command', timestamp: '2025-01-01T00:00:00.000Z', provider: 'github-stacking', command: 'gs', exitCode: 0 }, expectedErrorPath: '' },
  { label: 'stack:landing:update missing required prdId', payload: { type: 'stack:landing:update', timestamp: '2025-01-01T00:00:00.000Z', stackId: 'stack-1', action: 'pr', branch: 'eforge/feat-a', status: 'started' }, expectedErrorPath: '' },
  { label: 'stack landing recovery start missing required prdId', payload: { type: 'stack:landing:conflict:recovery:start', timestamp: '2025-01-01T00:00:00.000Z', stackId: 'stack-1', provider: 'git-spice', branch: 'eforge/feat-a', attempt: 1, maxAttempts: 3 }, expectedErrorPath: '' },
  { label: 'stack landing conflict detected with invalid operation literal', payload: { type: 'stack:landing:conflict:detected', timestamp: '2025-01-01T00:00:00.000Z', prdId: 'feat-a', stackId: 'stack-1', provider: 'git-spice', branch: 'eforge/feat-a', operation: 'submit', conflictKind: 'git-rebase', conflictedFiles: ['src/a.ts'] }, expectedErrorPath: '' },
];

export const unknownDiscriminantPayloads: InvalidEventWireParityFixture[] = [
  { label: 'event with a completely unknown type', payload: { type: 'completely:unknown:event:type', timestamp: '2025-01-01T00:00:00.000Z' }, expectedErrorPath: '' },
  { label: 'event with a near-miss type (extra suffix)', payload: { type: 'session:start:extra', timestamp: '2025-01-01T00:00:00.000Z', sessionId: 'sess-1' }, expectedErrorPath: '' },
  { label: 'non-object payload', payload: 'not-an-object', expectedErrorMessageFragment: 'Expected' },
  { label: 'null payload', payload: null, expectedErrorMessageFragment: 'Expected' },
  { label: 'empty object', payload: {}, expectedErrorPath: '' },
];
