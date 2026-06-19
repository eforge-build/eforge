import { describe, it, expect } from 'vitest';
import { safeParseEforgeEvent, StackLayerWireSchema } from '../events.schemas.js';
import { DAEMON_EVENT_TYPES, eventRegistry, getEventSummary, isPersistedDaemonEventType } from '../event-registry.js';
import type { ProjectableState } from '../event-registry.js';
import type { EforgeEvent } from '../events.schemas.js';
import { Value } from '@sinclair/typebox/value';
import { DaemonQueueItemSchema } from '../events/snapshots.js';

// --- eforge:region event-schema-tests ---

describe('safeParseEforgeEvent — queue dispatch failures', () => {
  it('accepts all declared dispatch failure stages and rejects unknown stages', () => {
    for (const stage of ['stacking-validation', 'policy-gate', 'profile-routing', 'dispatch'] as const) {
      expect(safeParseEforgeEvent({ type: 'queue:prd:dispatch-failed', timestamp: '2025-01-01T00:00:00.000Z', prdId: 'prd-1', title: 'PRD 1', reason: 'blocked', stage }).success).toBe(true);
    }
    expect(safeParseEforgeEvent({ type: 'queue:prd:dispatch-failed', timestamp: '2025-01-01T00:00:00.000Z', prdId: 'prd-1', title: 'PRD 1', reason: 'blocked', stage: 'nope' }).success).toBe(false);
  });

  it('registers dispatch failures as persisted daemon events with useful summaries', () => {
    expect(eventRegistry['queue:prd:dispatch-failed']).toMatchObject({ scope: 'daemon', persist: true });
    expect(DAEMON_EVENT_TYPES).toContain('queue:prd:dispatch-failed');
    expect(isPersistedDaemonEventType('queue:prd:dispatch-failed')).toBe(true);
    expect(getEventSummary({ type: 'queue:prd:dispatch-failed', timestamp: '2025-01-01T00:00:00.000Z', prdId: 'prd-1', title: 'PRD 1', reason: 'blocked', stage: 'dispatch' })).toContain('prd-1');
  });

  it('projects dispatch failure metadata onto failed queue items and preserves it through failed completion', () => {
    const projectDispatchFailure = eventRegistry['queue:prd:dispatch-failed'].project!;
    const emptyState: ProjectableState = { runs: [], queue: [], autoBuild: null, latestHeartbeat: null, stackLayers: [] };
    const dispatchDelta = projectDispatchFailure({
      type: 'queue:prd:dispatch-failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-1',
      title: 'PRD 1',
      reason: 'stack_parent is required',
      stage: 'stacking-validation',
    }, emptyState);

    expect(dispatchDelta?.queue?.[0]).toEqual({
      id: 'prd-1',
      title: 'PRD 1',
      status: 'failed',
      dispatchFailure: {
        reason: 'stack_parent is required',
        stage: 'stacking-validation',
        timestamp: '2025-01-01T00:00:00.000Z',
      },
    });

    const completeDelta = eventRegistry['queue:prd:complete'].project!({
      type: 'queue:prd:complete',
      timestamp: '2025-01-01T00:00:01.000Z',
      prdId: 'prd-1',
      status: 'failed',
    }, { ...emptyState, queue: dispatchDelta?.queue ?? [] });
    expect(completeDelta?.queue?.[0]?.dispatchFailure).toEqual(dispatchDelta?.queue?.[0]?.dispatchFailure);
  });

  it('clears stale dispatch failure metadata when live discovery reintroduces the PRD', () => {
    const staleState: ProjectableState = {
      runs: [],
      queue: [{ id: 'prd-1', title: 'PRD 1', status: 'failed', dispatchFailure: { reason: 'old blocker', stage: 'dispatch', timestamp: '2025-01-01T00:00:00.000Z' } }],
      autoBuild: null,
      latestHeartbeat: null,
      stackLayers: [],
    };
    const delta = eventRegistry['queue:prd:discovered'].project!({
      type: 'queue:prd:discovered',
      timestamp: '2025-01-01T00:00:02.000Z',
      prdId: 'prd-1',
      title: 'PRD 1 requeued',
      dependsOn: ['parent'],
    }, staleState);

    expect(delta?.queue?.[0]).toEqual({ id: 'prd-1', title: 'PRD 1 requeued', status: 'pending', dependsOn: ['parent'] });
  });

  it('accepts daemon queue snapshot items with dispatch failure metadata', () => {
    expect(Value.Check(DaemonQueueItemSchema, {
      id: 'prd-1',
      title: 'PRD 1',
      status: 'failed',
      dispatchFailure: { reason: 'blocked', stage: 'policy-gate', timestamp: '2025-01-01T00:00:00.000Z' },
    })).toBe(true);
  });
});

describe('safeParseEforgeEvent — queue discovery dependencies', () => {
  it('accepts queue:prd:discovered with dependsOn metadata', () => {
    const result = safeParseEforgeEvent({
      type: 'queue:prd:discovered',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'child-prd',
      title: 'Child PRD',
      dependsOn: ['parent-prd'],
    });
    expect(result.success).toBe(true);
  });
});

describe('safeParseEforgeEvent — landing workflow literals', () => {
  it('accepts landing:start with feature-pr workflow literal (direct non-trunk PR)', () => {
    const result = safeParseEforgeEvent({
      type: 'landing:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      action: 'pr',
      featureBranch: 'eforge/my-set',
      baseBranch: 'feature/parent',
      trunkBranch: 'main',
      workflow: 'feature-pr',
    });
    expect(result.success).toBe(true);
  });

  it('rejects landing:start with removed feature-pr-after-local-merge literal', () => {
    const result = safeParseEforgeEvent({
      type: 'landing:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      action: 'pr',
      featureBranch: 'eforge/my-set',
      baseBranch: 'feature/parent',
      trunkBranch: 'main',
      workflow: 'feature-pr-after-local-merge',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid workflow literals in landing:start', () => {
    const workflows = ['trunk-pr', 'trunk-local-merge', 'feature-pr', 'feature-local-merge', 'leave-branch'] as const;
    for (const workflow of workflows) {
      const result = safeParseEforgeEvent({
        type: 'landing:start',
        timestamp: '2025-01-01T00:00:00.000Z',
        action: 'pr',
        featureBranch: 'eforge/my-set',
        baseBranch: 'main',
        workflow,
      });
      expect(result.success, `workflow '${workflow}' should be accepted`).toBe(true);
    }
  });
});

describe('safeParseEforgeEvent — landing:auto-merge:* events', () => {
  it('accepts landing:auto-merge:start with featureBranch and prUrl', () => {
    const result = safeParseEforgeEvent({
      type: 'landing:auto-merge:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      featureBranch: 'eforge/my-set',
      prUrl: 'https://github.com/owner/repo/pull/42',
    });
    expect(result.success).toBe(true);
  });

  it('accepts landing:auto-merge:complete with featureBranch and prUrl', () => {
    const result = safeParseEforgeEvent({
      type: 'landing:auto-merge:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      featureBranch: 'eforge/my-set',
      prUrl: 'https://github.com/owner/repo/pull/42',
    });
    expect(result.success).toBe(true);
  });

  it('accepts landing:auto-merge:skipped with prUrl and reason', () => {
    const result = safeParseEforgeEvent({
      type: 'landing:auto-merge:skipped',
      timestamp: '2025-01-01T00:00:00.000Z',
      featureBranch: 'eforge/my-set',
      prUrl: 'https://github.com/owner/repo/pull/42',
      reason: 'Auto-merge policy is "never"',
    });
    expect(result.success).toBe(true);
  });

  it('accepts landing:auto-merge:skipped without prUrl (optional)', () => {
    const result = safeParseEforgeEvent({
      type: 'landing:auto-merge:skipped',
      timestamp: '2025-01-01T00:00:00.000Z',
      featureBranch: 'eforge/my-set',
      reason: 'No PR URL discovered',
    });
    expect(result.success).toBe(true);
  });

  it('rejects landing:auto-merge:start missing featureBranch', () => {
    const result = safeParseEforgeEvent({
      type: 'landing:auto-merge:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      prUrl: 'https://github.com/owner/repo/pull/42',
    });
    expect(result.success).toBe(false);
  });

  it('rejects landing:auto-merge:complete missing prUrl', () => {
    const result = safeParseEforgeEvent({
      type: 'landing:auto-merge:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      featureBranch: 'eforge/my-set',
    });
    expect(result.success).toBe(false);
  });

  it('rejects landing:auto-merge:skipped missing reason', () => {
    const result = safeParseEforgeEvent({
      type: 'landing:auto-merge:skipped',
      timestamp: '2025-01-01T00:00:00.000Z',
      featureBranch: 'eforge/my-set',
    });
    expect(result.success).toBe(false);
  });
});

describe('safeParseEforgeEvent — queue:profile:* variants', () => {
  it('accepts queue:profile:selected with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'queue:profile:selected',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-feature-auth',
      profile: 'premium',
      baseProfile: 'standard',
      routerName: 'cost-aware-router',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
    });
    expect(result.success).toBe(true);
  });

  it('accepts queue:profile:selected with all optional fields', () => {
    const result = safeParseEforgeEvent({
      type: 'queue:profile:selected',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-feature-auth',
      prdTitle: 'Add OAuth support',
      profile: 'premium',
      baseProfile: 'standard',
      routerName: 'cost-aware-router',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      reason: 'high-priority build',
      confidence: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('accepts queue:profile:selected with baseProfile: null', () => {
    const result = safeParseEforgeEvent({
      type: 'queue:profile:selected',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-feature-auth',
      profile: 'default',
      baseProfile: null,
      routerName: 'fallback-router',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
    });
    expect(result.success).toBe(true);
  });

  it('rejects queue:profile:selected missing routerName', () => {
    const result = safeParseEforgeEvent({
      type: 'queue:profile:selected',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-feature-auth',
      profile: 'premium',
      baseProfile: 'standard',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
    });
    expect(result.success).toBe(false);
  });

  it('accepts queue:profile:router-failed with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'queue:profile:router-failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-feature-auth',
      routerName: 'cost-aware-router',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      message: 'Router threw an unexpected error',
    });
    expect(result.success).toBe(true);
  });

  it('accepts queue:profile:router-failed with optional stack', () => {
    const result = safeParseEforgeEvent({
      type: 'queue:profile:router-failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-feature-auth',
      routerName: 'cost-aware-router',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      message: 'Router threw an unexpected error',
      stack: 'Error: Router threw\n    at handler (/ext.ts:5:10)',
    });
    expect(result.success).toBe(true);
  });

  it('rejects queue:profile:router-failed missing message', () => {
    const result = safeParseEforgeEvent({
      type: 'queue:profile:router-failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-feature-auth',
      routerName: 'cost-aware-router',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
    });
    expect(result.success).toBe(false);
  });

  it('accepts queue:profile:router-timeout with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'queue:profile:router-timeout',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-feature-auth',
      routerName: 'slow-router',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      timeoutMs: 5000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects queue:profile:router-timeout with non-integer timeoutMs', () => {
    const result = safeParseEforgeEvent({
      type: 'queue:profile:router-timeout',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-feature-auth',
      routerName: 'slow-router',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      timeoutMs: '5000',
    });
    expect(result.success).toBe(false);
  });

  it('accepts queue:profile:invalid-selection with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'queue:profile:invalid-selection',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-feature-auth',
      routerName: 'misconfigured-router',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      requestedProfile: 'nonexistent-profile',
      reason: 'not-found',
      message: 'Profile "nonexistent-profile" was not found in the active configuration',
    });
    expect(result.success).toBe(true);
  });

  it('accepts queue:profile:invalid-selection with reason: load-error', () => {
    const result = safeParseEforgeEvent({
      type: 'queue:profile:invalid-selection',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-feature-auth',
      routerName: 'misconfigured-router',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      requestedProfile: 'bad-profile',
      reason: 'load-error',
      message: 'Profile "bad-profile" failed to load',
    });
    expect(result.success).toBe(true);
  });

  it('rejects queue:profile:invalid-selection with unknown reason literal', () => {
    const result = safeParseEforgeEvent({
      type: 'queue:profile:invalid-selection',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-feature-auth',
      routerName: 'misconfigured-router',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      requestedProfile: 'some-profile',
      reason: 'invalid-reason',
      message: 'something went wrong',
    });
    expect(result.success).toBe(false);
  });
});

describe('eventRegistry — queue:profile:* diagnostics', () => {
  it('registers all four profile router events as session-scoped, non-persistent events', () => {
    expect(eventRegistry['queue:profile:selected']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['queue:profile:router-failed']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['queue:profile:router-timeout']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['queue:profile:invalid-selection']).toMatchObject({ scope: 'session', persist: false });
  });

  it('summary for queue:profile:selected includes prdId, profile, extensionName, and routerName', () => {
    const event: EforgeEvent = {
      type: 'queue:profile:selected',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-auth',
      profile: 'premium',
      baseProfile: 'standard',
      routerName: 'cost-router',
      extensionName: 'billing-ext',
      extensionPath: '/ext.ts',
    };
    const summary = getEventSummary(event);
    expect(summary).toContain('prd-auth');
    expect(summary).toContain('premium');
    expect(summary).toContain('billing-ext');
    expect(summary).toContain('cost-router');
  });

  it('summary for queue:profile:selected includes reason when present', () => {
    const event: EforgeEvent = {
      type: 'queue:profile:selected',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-auth',
      profile: 'premium',
      baseProfile: null,
      routerName: 'cost-router',
      extensionName: 'billing-ext',
      extensionPath: '/ext.ts',
      reason: 'high priority task',
    };
    const summary = getEventSummary(event);
    expect(summary).toContain('high priority task');
  });

  it('safeParseEforgeEvent accepts queue:profile:selected and rejects one missing routerName', () => {
    const valid = safeParseEforgeEvent({
      type: 'queue:profile:selected',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-1',
      profile: 'default',
      baseProfile: null,
      routerName: 'my-router',
      extensionName: 'my-ext',
      extensionPath: '/ext.ts',
    });
    expect(valid.success).toBe(true);

    const invalid = safeParseEforgeEvent({
      type: 'queue:profile:selected',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-1',
      profile: 'default',
      baseProfile: null,
      // routerName intentionally omitted
      extensionName: 'my-ext',
      extensionPath: '/ext.ts',
    });
    expect(invalid.success).toBe(false);
  });
});


describe('StackLayerWireSchema — extended landing field', () => {
  it('accepts a layer without a landing field', () => {
    const now = new Date().toISOString();
    const result = Value.Check(StackLayerWireSchema, {
      prdId: 'feat-a',
      stackId: 'stack-1',
      provider: 'git-spice',
      branch: 'eforge/feat-a',
      status: 'built',
      recordedAt: now,
      updatedAt: now,
    });
    expect(result).toBe(true);
  });

  it('accepts a layer with a complete landing record including prUrl', () => {
    const now = new Date().toISOString();
    const result = Value.Check(StackLayerWireSchema, {
      prdId: 'feat-a',
      stackId: 'stack-1',
      provider: 'git-spice',
      branch: 'eforge/feat-a',
      status: 'landed',
      recordedAt: now,
      updatedAt: now,
      artifact: { branch: 'eforge/feat-a', commitSha: 'abc123' },
      landingAction: 'pr',
      landing: {
        action: 'pr',
        status: 'complete',
        prUrl: 'https://github.com/owner/repo/pull/42',
        startedAt: now,
        completedAt: now,
      },
    });
    expect(result).toBe(true);
  });

  it('accepts a layer with a failed landing record including reason', () => {
    const now = new Date().toISOString();
    const result = Value.Check(StackLayerWireSchema, {
      prdId: 'feat-a',
      stackId: 'stack-1',
      provider: 'git-spice',
      branch: 'eforge/feat-a',
      status: 'failed',
      recordedAt: now,
      updatedAt: now,
      landingAction: 'pr',
      landing: {
        action: 'pr',
        status: 'failed',
        reason: 'git-spice command failed',
        startedAt: now,
        completedAt: now,
      },
    });
    expect(result).toBe(true);
  });

  it('accepts a layer with a skipped landing record (no prUrl, no reason)', () => {
    const now = new Date().toISOString();
    const result = Value.Check(StackLayerWireSchema, {
      prdId: 'feat-a',
      stackId: 'stack-1',
      provider: 'git-spice',
      branch: 'eforge/feat-a',
      status: 'built',
      recordedAt: now,
      updatedAt: now,
      landing: {
        action: 'leave',
        status: 'skipped',
        startedAt: now,
      },
    });
    expect(result).toBe(true);
  });

  it('rejects a landing record with an invalid status', () => {
    const now = new Date().toISOString();
    const result = Value.Check(StackLayerWireSchema, {
      prdId: 'feat-a',
      stackId: 'stack-1',
      provider: 'git-spice',
      branch: 'eforge/feat-a',
      status: 'built',
      recordedAt: now,
      updatedAt: now,
      landing: {
        action: 'pr',
        status: 'in-progress',
        startedAt: now,
      },
    });
    expect(result).toBe(false);
  });

  it('rejects a landing record with an invalid action', () => {
    const now = new Date().toISOString();
    const result = Value.Check(StackLayerWireSchema, {
      prdId: 'feat-a',
      stackId: 'stack-1',
      provider: 'git-spice',
      branch: 'eforge/feat-a',
      status: 'built',
      recordedAt: now,
      updatedAt: now,
      landing: {
        action: 'push',
        status: 'complete',
        startedAt: now,
      },
    });
    expect(result).toBe(false);
  });
});

describe('stack landing conflict recovery event schema coverage', () => {
  const ts = '2025-06-01T12:00:00.000Z';
  const common = {
    timestamp: ts,
    prdId: 'prd-a',
    stackId: 'stack-a',
    provider: 'git-spice',
    branch: 'eforge/prd-a',
  };

  it('accepts all stack landing recovery lifecycle events', () => {
    const events = [
      {
        ...common,
        type: 'stack:landing:conflict:detected',
        operation: 'branch-restack',
        conflictKind: 'git-rebase',
        conflictedFiles: ['src/a.ts'],
      },
      { ...common, type: 'stack:landing:conflict:recovery:start', attempt: 1, maxAttempts: 3 },
      { ...common, type: 'stack:landing:conflict:recovery:complete', attempts: 1 },
      {
        ...common,
        type: 'stack:landing:conflict:recovery:failed',
        attempts: 1,
        reason: 'still conflicted',
        abortAttempted: true,
        abortSucceeded: false,
      },
    ];

    for (const event of events) {
      const result = safeParseEforgeEvent(event);
      expect(result.success, `${event.type} should parse`).toBe(true);
    }
  });

  it('rejects recovery start missing stack identifiers', () => {
    const result = safeParseEforgeEvent({
      type: 'stack:landing:conflict:recovery:start',
      timestamp: ts,
      provider: 'git-spice',
      branch: 'eforge/prd-a',
      attempt: 1,
      maxAttempts: 3,
    });
    expect(result.success).toBe(false);
  });

  it('rejects recovery start when attempt exceeds maxAttempts', () => {
    const result = safeParseEforgeEvent({
      ...common,
      type: 'stack:landing:conflict:recovery:start',
      attempt: 4,
      maxAttempts: 3,
    });
    expect(result.success).toBe(false);
  });

  it('rejects recovery failed when abort succeeded without an abort attempt', () => {
    const result = safeParseEforgeEvent({
      ...common,
      type: 'stack:landing:conflict:recovery:failed',
      attempts: 1,
      reason: 'still conflicted',
      abortAttempted: false,
      abortSucceeded: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('stack sync lifecycle event schema coverage', () => {
  const ts = '2025-06-01T12:00:00.000Z';

  const validStackSyncEvents = [
    {
      label: 'stack:sync:start — manual trigger, wet',
      payload: { type: 'stack:sync:start', timestamp: ts, syncId: 'sync-001', trigger: 'manual', dryRun: false },
    },
    {
      label: 'stack:sync:start — after-build trigger, dry run',
      payload: { type: 'stack:sync:start', timestamp: ts, syncId: 'sync-002', trigger: 'after-build', dryRun: true },
    },
    {
      label: 'stack:sync:start — retry-deferred trigger, wet',
      payload: { type: 'stack:sync:start', timestamp: ts, syncId: 'sync-003', trigger: 'retry-deferred', dryRun: false },
    },
    {
      label: 'stack:sync:start — no trigger (manual/default), wet',
      payload: { type: 'stack:sync:start', timestamp: ts, syncId: 'sync-004', dryRun: false },
    },
    {
      label: 'stack:sync:complete — all fields',
      payload: {
        type: 'stack:sync:complete',
        timestamp: ts,
        syncId: 'sync-001',
        trigger: 'manual',
        dryRun: false,
        restackCandidates: ['eforge/feat-a', 'eforge/feat-b'],
        excludedCandidates: [],
        localTrunkSha: 'abc1234',
        originTrunkSha: 'abc1234',
        fastForward: true,
      },
    },
    {
      label: 'stack:sync:complete — minimal (no optional fields)',
      payload: {
        type: 'stack:sync:complete',
        timestamp: ts,
        syncId: 'sync-002',
        dryRun: true,
        restackCandidates: [],
        excludedCandidates: [],
      },
    },
    {
      label: 'stack:sync:failed — failed outcome',
      payload: {
        type: 'stack:sync:failed',
        timestamp: ts,
        syncId: 'sync-003',
        trigger: 'after-build',
        dryRun: false,
        outcome: 'failed',
        reason: 'repo sync exited with code 128',
        error: 'fatal: remote disconnected',
      },
    },
    {
      label: 'stack:sync:failed — conflict outcome',
      payload: {
        type: 'stack:sync:failed',
        timestamp: ts,
        syncId: 'sync-004',
        dryRun: false,
        outcome: 'conflict',
        reason: 'restack conflict on eforge/feat-a',
      },
    },
    {
      label: 'stack:sync:deferred — candidates excluded',
      payload: {
        type: 'stack:sync:deferred',
        timestamp: ts,
        syncId: 'sync-005',
        trigger: 'manual',
        reason: 'Active builds in progress on 2 stack layers',
        excludedCandidates: ['eforge/feat-a', 'eforge/feat-b'],
      },
    },
    {
      label: 'stack:sync:deferred — no candidates',
      payload: {
        type: 'stack:sync:deferred',
        timestamp: ts,
        syncId: 'sync-006',
        reason: 'Active builds running',
        excludedCandidates: [],
      },
    },
    {
      label: 'stack:sync:skipped — no restack candidates',
      payload: {
        type: 'stack:sync:skipped',
        timestamp: ts,
        syncId: 'sync-007',
        trigger: 'manual',
        dryRun: false,
        reason: 'No stack branches need restacking',
        restackCandidates: [],
        excludedCandidates: [],
      },
    },
  ];

  it('accepts all valid stack:sync:* event payloads', () => {
    for (const { label, payload } of validStackSyncEvents) {
      const result = safeParseEforgeEvent(payload);
      expect(result.success, `${label} should be accepted: ${!result.success ? JSON.stringify((result as Record<string, unknown>).error) : ''}`).toBe(true);
    }
  });

  it('round-trips all stack:sync:* events through JSON', () => {
    for (const { label, payload } of validStackSyncEvents) {
      const roundTripped = JSON.parse(JSON.stringify(payload));
      const result = safeParseEforgeEvent(roundTripped);
      expect(result.success, `${label} round-trip should succeed`).toBe(true);
    }
  });

  it('rejects stack:sync:start missing syncId', () => {
    const result = safeParseEforgeEvent({
      type: 'stack:sync:start',
      timestamp: ts,
      dryRun: false,
      // syncId intentionally missing
    });
    expect(result.success).toBe(false);
  });

  it('rejects stack:sync:start missing dryRun', () => {
    const result = safeParseEforgeEvent({
      type: 'stack:sync:start',
      timestamp: ts,
      syncId: 'sync-001',
      // dryRun intentionally missing
    });
    expect(result.success).toBe(false);
  });

  it('rejects stack:sync:complete with invalid trigger literal', () => {
    const result = safeParseEforgeEvent({
      type: 'stack:sync:complete',
      timestamp: ts,
      syncId: 'sync-001',
      trigger: 'cron',
      dryRun: false,
      restackCandidates: [],
      excludedCandidates: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects stack:sync:failed with invalid outcome literal', () => {
    const result = safeParseEforgeEvent({
      type: 'stack:sync:failed',
      timestamp: ts,
      syncId: 'sync-001',
      dryRun: false,
      outcome: 'skipped',
      reason: 'wrong outcome literal for this event type',
    });
    expect(result.success).toBe(false);
  });

  it('stack:sync:* events are present in the event registry with daemon scope', () => {
    const syncEventTypes = [
      'stack:sync:start',
      'stack:sync:complete',
      'stack:sync:failed',
      'stack:sync:deferred',
      'stack:sync:skipped',
    ] as const;

    for (const type of syncEventTypes) {
      const meta = (eventRegistry as Record<string, { scope: string; persist: boolean }>)[type];
      expect(meta, `${type} must be in eventRegistry`).toBeDefined();
      expect(meta.scope).toBe('daemon');
    }
  });

  it('stack:sync:* events are in DAEMON_EVENT_TYPES (persisted)', () => {
    const persistedTypes = new Set(DAEMON_EVENT_TYPES);
    expect(persistedTypes.has('stack:sync:start')).toBe(true);
    expect(persistedTypes.has('stack:sync:complete')).toBe(true);
    expect(persistedTypes.has('stack:sync:failed')).toBe(true);
    expect(persistedTypes.has('stack:sync:deferred')).toBe(true);
    expect(persistedTypes.has('stack:sync:skipped')).toBe(true);
  });

  it('isPersistedDaemonEventType returns true for stack:sync:* events', () => {
    expect(isPersistedDaemonEventType('stack:sync:start')).toBe(true);
    expect(isPersistedDaemonEventType('stack:sync:complete')).toBe(true);
    expect(isPersistedDaemonEventType('stack:sync:failed')).toBe(true);
    expect(isPersistedDaemonEventType('stack:sync:deferred')).toBe(true);
    expect(isPersistedDaemonEventType('stack:sync:skipped')).toBe(true);
  });
});

// --- eforge:endregion event-schema-tests ---
