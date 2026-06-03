export interface EventWireParityFixture {
  label: string;
  payload: unknown;
}

const ts = '2025-06-01T12:00:00.000Z';

export const stackSyncLifecycleValidPayloads: EventWireParityFixture[] = [
  { label: 'stack:sync:start with required fields only', payload: { type: 'stack:sync:start', timestamp: ts, syncId: 'sync-abc', dryRun: false } },
  { label: 'stack:sync:start with optional trigger field', payload: { type: 'stack:sync:start', timestamp: ts, syncId: 'sync-def', trigger: 'after-build', dryRun: true } },
  { label: 'stack:sync:start with retry-deferred trigger', payload: { type: 'stack:sync:start', timestamp: ts, syncId: 'sync-retry', trigger: 'retry-deferred', dryRun: false } },
  { label: 'stack:sync:complete with all fields', payload: { type: 'stack:sync:complete', timestamp: ts, syncId: 'sync-abc', trigger: 'manual', dryRun: false, restackCandidates: ['eforge/feat-a'], excludedCandidates: [], localTrunkSha: 'abc1234', originTrunkSha: 'abc1234', fastForward: true, reason: 'sync complete' } },
  { label: 'stack:sync:complete with only required fields', payload: { type: 'stack:sync:complete', timestamp: ts, syncId: 'sync-xyz', dryRun: false, restackCandidates: [], excludedCandidates: [] } },
  { label: 'stack:sync:failed with outcome: failed', payload: { type: 'stack:sync:failed', timestamp: ts, syncId: 'sync-001', dryRun: false, outcome: 'failed', reason: 'repo sync failed', error: 'exit code 1' } },
  { label: 'stack:sync:failed with outcome: conflict', payload: { type: 'stack:sync:failed', timestamp: ts, syncId: 'sync-002', dryRun: false, outcome: 'conflict', reason: 'merge conflict during restack' } },
  { label: 'stack:sync:deferred with excludedCandidates', payload: { type: 'stack:sync:deferred', timestamp: ts, syncId: 'sync-003', trigger: 'after-build', reason: 'Active builds overlap with stack candidates', excludedCandidates: ['eforge/feat-a'] } },
  { label: 'stack:sync:skipped with candidates', payload: { type: 'stack:sync:skipped', timestamp: ts, syncId: 'sync-004', trigger: 'manual', dryRun: false, reason: 'No eligible stack branches', restackCandidates: ['eforge/feat-a'], excludedCandidates: ['eforge/feat-b'] } },
];

export const stackSyncRoundTripPayloads: EventWireParityFixture[] = [
  { label: 'stack:sync:start through JSON', payload: { type: 'stack:sync:start', timestamp: ts, syncId: 'sync-roundtrip', trigger: 'scheduled', dryRun: false } },
  { label: 'stack:sync:deferred through JSON', payload: { type: 'stack:sync:deferred', timestamp: ts, syncId: 'sync-roundtrip-deferred', reason: 'builds running', excludedCandidates: ['eforge/feat-x', 'eforge/feat-y'] } },
  { label: 'stack:sync:skipped through JSON', payload: { type: 'stack:sync:skipped', timestamp: ts, syncId: 'sync-roundtrip-skipped', trigger: 'scheduled', dryRun: true, reason: 'dry run skipped restack', restackCandidates: [], excludedCandidates: [] } },
];

export const stackSyncInvalidPayloads: EventWireParityFixture[] = [
  { label: 'stack:sync:start with dryRun as string', payload: { type: 'stack:sync:start', timestamp: ts, syncId: 'sync-001', dryRun: 'yes' } },
  { label: 'stack:sync:failed with outcome: skipped (wrong event type for that value)', payload: { type: 'stack:sync:failed', timestamp: ts, syncId: 'sync-001', dryRun: false, outcome: 'skipped', reason: 'wrong outcome for this event type' } },
];
