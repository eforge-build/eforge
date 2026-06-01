/**
 * Tests for the TypeBox-based wire event schemas.
 *
 * Validates:
 *   - EforgeEventSchema is exported from @eforge-build/client (AC #13)
 *   - EforgeEvent is Static<>-derived: TypeBox validates what TypeScript accepts (AC #3)
 *   - The 5 new event variants round-trip through JSON (AC #3)
 *   - Runtime validation accepts valid payloads and rejects invalid ones
 *   - agent:start thinkingCoerced/thinkingOriginal optional fields parse correctly (AC #8 precursor)
 *   - Unknown event types are rejected, not silently accepted
 *
 * All fixtures are statically typed as EforgeEvent so field drift surfaces as
 * a TypeScript compile error rather than a runtime surprise.
 */

import { describe, it, expect } from 'vitest';
import { isAlwaysYieldedAgentEvent, safeParseDaemonStreamSnapshot, safeParseEforgeEvent, StackLayerWireSchema } from '../events.schemas.js';
import { DAEMON_EVENT_TYPES, eventRegistry, getEventSummary, isPersistedDaemonEventType } from '../event-registry.js';
import type { EforgeEvent, BuildFailureSummary } from '../events.schemas.js';
import { Value } from '@sinclair/typebox/value';

// ---------------------------------------------------------------------------
// Fixtures — the 5 new plan lifecycle + merge worktree variants
// ---------------------------------------------------------------------------

const newVariants: EforgeEvent[] = [
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

const NEW_VARIANT_TYPES = new Set([
  'plan:status:change',
  'plan:error:set',
  'plan:error:clear',
  'merge:worktree:set',
  'merge:worktree:clear',
]);

const extensionDiagnosticVariants: EforgeEvent[] = [
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

const extensionPolicyVariants: EforgeEvent[] = [
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

const extensionPolicyGateMatrixVariants: EforgeEvent[] = [
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


// ---------------------------------------------------------------------------
// JSON round-trip tests
// ---------------------------------------------------------------------------

describe('new plan lifecycle + merge-worktree variants — JSON roundtrip', () => {
  it('roundtrips all 5 new variant types through JSON', () => {
    for (const event of newVariants) {
      const parsed = JSON.parse(JSON.stringify(event));
      expect(parsed).toEqual(event);
      expect(parsed.type).toBe(event.type);
    }
  });

  it('covers all 5 new variant type literals', () => {
    const types = new Set(newVariants.map((e) => e.type));
    expect(types).toEqual(NEW_VARIANT_TYPES);
  });
});

// ---------------------------------------------------------------------------
// Schema validation — valid payloads
// ---------------------------------------------------------------------------

describe('safeParseEforgeEvent — new variants', () => {
  it('accepts extension event-handler diagnostics with required fields', () => {
    for (const event of extensionDiagnosticVariants) {
      const result = safeParseEforgeEvent(event);
      expect(result.success, `${event.type} should be accepted`).toBe(true);
    }
  });

  it('round-trips extension event-handler diagnostics through JSON', () => {
    for (const event of extensionDiagnosticVariants) {
      expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    }
  });

  it('accepts extension policy decision, failure, and timeout events', () => {
    for (const event of extensionPolicyVariants) {
      const result = safeParseEforgeEvent(event);
      expect(result.success, `${event.type} should be accepted`).toBe(true);
    }
  });

  it('accepts policy decision, failed, and timeout events for every gate kind', () => {
    for (const event of extensionPolicyGateMatrixVariants) {
      const result = safeParseEforgeEvent(event);
      expect(result.success, `${event.type} should be accepted`).toBe(true);
    }
  });

  it('round-trips extension policy events through JSON', () => {
    for (const event of extensionPolicyVariants) {
      expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    }
  });

  it('accepts plan:status:change with every valid status value', () => {
    const statuses = ['pending', 'running', 'completed', 'failed', 'blocked', 'merged'] as const;
    for (const status of statuses) {
      const result = safeParseEforgeEvent({
        type: 'plan:status:change',
        timestamp: '2025-01-01T00:00:00.000Z',
        planId: 'plan-01',
        status,
      });
      expect(result.success, `status '${status}' should be accepted`).toBe(true);
    }
  });

  it('accepts plan:error:set with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:error:set',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      error: 'Build timed out',
    });
    expect(result.success).toBe(true);
  });

  it('accepts plan:error:clear with only planId + timestamp', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:error:clear',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
    });
    expect(result.success).toBe(true);
  });

  it('accepts merge:worktree:set with path', () => {
    const result = safeParseEforgeEvent({
      type: 'merge:worktree:set',
      timestamp: '2025-01-01T00:00:00.000Z',
      path: '/tmp/merge-worktree',
    });
    expect(result.success).toBe(true);
  });

  it('accepts merge:worktree:clear with only timestamp', () => {
    const result = safeParseEforgeEvent({
      type: 'merge:worktree:clear',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional envelope fields (sessionId, runId)', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:status:change',
      timestamp: '2025-01-01T00:00:00.000Z',
      sessionId: 'sess-abc',
      runId: 'run-xyz',
      planId: 'plan-01',
      status: 'running',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe('sess-abc');
      expect(result.data.runId).toBe('run-xyz');
    }
  });

  it('accepts daemon:auto-build:disabled with only the common envelope', () => {
    const result = safeParseEforgeEvent({
      type: 'daemon:auto-build:disabled',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts build:resume:start with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'build:resume:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-feature-x',
      setName: 'feature-x',
      featureBranch: 'eforge/feature-x',
    });
    expect(result.success).toBe(true);
  });

  it('accepts build:resume:state with seeded plan lists', () => {
    const result = safeParseEforgeEvent({
      type: 'build:resume:state',
      timestamp: '2025-01-01T00:00:00.000Z',
      seededMerged: ['plan-01', 'plan-02'],
      seededPending: ['plan-03'],
      featureBranch: 'eforge/feature-x',
      landedCommitCount: 2,
      diffStat: '5 files changed, 42 insertions(+), 3 deletions(-)',
    });
    expect(result.success).toBe(true);
  });

  it('accepts build:resume:ineligible without checkedPath', () => {
    const result = safeParseEforgeEvent({
      type: 'build:resume:ineligible',
      timestamp: '2025-01-01T00:00:00.000Z',
      reason: 'feature branch eforge/feature-x not found',
    });
    expect(result.success).toBe(true);
  });

  it('accepts build:resume:ineligible with checkedPath', () => {
    const result = safeParseEforgeEvent({
      type: 'build:resume:ineligible',
      timestamp: '2025-01-01T00:00:00.000Z',
      reason: 'orchestration.yaml not found',
      checkedPath: '/project/.worktrees/feature-x-merge/orchestration.yaml',
    });
    expect(result.success).toBe(true);
  });

  it('accepts build:resume:artifacts with source, orchestration, and plan artifacts', () => {
    const result = safeParseEforgeEvent({
      type: 'build:resume:artifacts',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-feature-x',
      setName: 'feature-x',
      featureBranch: 'eforge/feature-x',
      artifactSource: 'branch-history',
      artifactCommit: 'abc123',
      source: { label: '.eforge/queue/failed/prd-feature-x.md', path: '/repo/.eforge/queue/failed/prd-feature-x.md', content: '# PRD' },
      orchestration: {
        name: 'feature-x',
        description: 'Feature X',
        created: '2025-01-01T00:00:00.000Z',
        mode: 'excursion',
        baseBranch: 'main',
        pipeline: { scope: 'excursion', compile: [], defaultBuild: [], defaultReview: { strategy: 'auto', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' }, rationale: 'resume' },
        plans: [
          { id: 'plan-01', name: 'Plan 01', dependsOn: [], branch: 'feature-x/plan-01', build: ['implement'], review: { strategy: 'auto', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' } },
          { id: 'plan-02', name: 'Plan 02', dependsOn: ['plan-01'], branch: 'feature-x/plan-02', build: [['test', 'pnpm test']], review: { strategy: 'single', perspectives: ['security'], maxRounds: 2, evaluatorStrictness: 'strict' } },
        ],
      },
      plans: [
        { id: 'plan-01', name: 'Plan 01', body: '# Plan 01', dependsOn: [], branch: 'feature-x/plan-01', build: ['implement'], review: { strategy: 'auto', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' } },
        { id: 'plan-02', name: 'Plan 02', body: '# Plan 02', dependsOn: ['plan-01'], branch: 'feature-x/plan-02', build: [['test', 'pnpm test']], review: { strategy: 'single', perspectives: ['security'], maxRounds: 2, evaluatorStrictness: 'strict' } },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('registers build:resume:artifacts as persisted session metadata', () => {
    expect(eventRegistry['build:resume:artifacts'].scope).toBe('session');
    expect(eventRegistry['build:resume:artifacts'].persist).toBe(true);
  });

  it('accepts build:resume:complete with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'build:resume:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-feature-x',
      setName: 'feature-x',
    });
    expect(result.success).toBe(true);
  });

  it('accepts phase:start with resume command', () => {
    const result = safeParseEforgeEvent({
      type: 'phase:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      runId: 'run-1',
      planSet: 'feature-x',
      command: 'resume',
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Event registry metadata
// ---------------------------------------------------------------------------

describe('eventRegistry — extension diagnostics', () => {
  it('registers extension diagnostics as session-scoped, non-persistent events with summaries', () => {
    const failed = extensionDiagnosticVariants[0]!;
    const timeout = extensionDiagnosticVariants[2]!;
    expect(eventRegistry['extension:event-handler:failed']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['extension:event-handler:timeout']).toMatchObject({ scope: 'session', persist: false });
    expect(getEventSummary(failed)).toBe(
      'Extension audit-log event hook failed (plan:build:* on plan:build:failed): boom',
    );
    expect(getEventSummary(timeout)).toBe(
      'Extension audit-log event hook timed out after 5000ms (* on plan:build:complete)',
    );
  });
});

describe('eventRegistry — extension policy gates', () => {
  it('registers policy events as session-scoped, non-persistent events with summaries', () => {
    for (const event of extensionPolicyVariants) {
      expect(eventRegistry[event.type]).toMatchObject({ scope: 'session', persist: false });
    }
    expect(getEventSummary(extensionPolicyVariants[0]!)).toBe(
      'Policy gate beforePlanMerge (guardrails) returned block: protected paths changed',
    );
    expect(getEventSummary(extensionPolicyVariants[1]!)).toBe(
      'Policy gate beforeQueueDispatch (guardrails) failed under fail-open: boom',
    );
    expect(getEventSummary(extensionPolicyVariants[2]!)).toBe(
      'Policy gate beforeFinalMerge (guardrails) timed out after 5000ms under fail-closed',
    );
  });
});

describe('safeParseEforgeEvent — daemon:auto-build:transition', () => {
  it('accepts transition events with lifecycle detail', () => {
    const result = safeParseEforgeEvent({
      type: 'daemon:auto-build:transition',
      timestamp: '2025-01-01T00:00:00.000Z',
      previousMode: 'starting',
      nextMode: 'running',
      desired: 'enabled',
      reason: 'watcher started',
      source: 'watcher',
    });
    expect(result.success).toBe(true);
  });

  it('rejects transition events with invalid modes', () => {
    const result = safeParseEforgeEvent({
      type: 'daemon:auto-build:transition',
      timestamp: '2025-01-01T00:00:00.000Z',
      previousMode: 'warming-up',
      nextMode: 'running',
      desired: 'enabled',
      source: 'watcher',
    });
    expect(result.success).toBe(false);
  });

  it('rejects daemon heartbeat events with invalid autoBuild lifecycle literals', () => {
    const result = safeParseEforgeEvent({
      type: 'daemon:heartbeat',
      timestamp: '2025-01-01T00:00:00.000Z',
      uptime: 1000,
      queueDepth: 1,
      runningBuilds: 0,
      autoBuild: { enabled: true, paused: false, desired: 'enabled', mode: 'warming-up' },
      subscribers: 1,
    });
    expect(result.success).toBe(false);
  });
});


describe('eventRegistry — daemon:auto-build:transition', () => {
  it('registers transition events as daemon-scoped, persisted, summarized, and projected', () => {
    expect(eventRegistry['daemon:auto-build:transition']).toMatchObject({
      scope: 'daemon',
      persist: true,
    });
    expect(DAEMON_EVENT_TYPES).toContain('daemon:auto-build:transition');
    const event = {
      type: 'daemon:auto-build:transition',
      timestamp: '2025-01-01T00:00:00.000Z',
      previousMode: 'starting',
      nextMode: 'running',
      desired: 'enabled',
      reason: 'watcher started',
      source: 'watcher',
    } as const;
    expect(getEventSummary(event)).toBe('Auto-build starting → running (enabled): watcher started');

    const state = {
      runs: [],
      queue: [],
      autoBuild: { enabled: false, watcher: { running: true, pid: 1234, sessionId: 'watcher-1' } },
      latestHeartbeat: null,
      stackLayers: [],
    };
    expect(eventRegistry['daemon:auto-build:transition'].project?.(event, state)).toEqual({
      autoBuild: {
        enabled: true,
        watcher: { running: true, pid: 1234, sessionId: 'watcher-1' },
        desired: 'enabled',
        mode: 'running',
        lastTransition: {
          at: '2025-01-01T00:00:00.000Z',
          previousMode: 'starting',
          nextMode: 'running',
          desired: 'enabled',
          reason: 'watcher started',
          source: 'watcher',
        },
        reason: 'watcher started',
      },
    });
  });

  it('projects paused desired-enabled transitions as legacy enabled=false', () => {
    const event = {
      type: 'daemon:auto-build:transition',
      timestamp: '2025-01-01T00:00:00.000Z',
      previousMode: 'running',
      nextMode: 'paused',
      desired: 'enabled',
      reason: 'build failed',
      source: 'watcher',
    } as const;
    const state = {
      runs: [],
      queue: [],
      autoBuild: { enabled: true, watcher: { running: true, pid: 1234, sessionId: 'watcher-1' } },
      latestHeartbeat: null,
      stackLayers: [],
    };

    expect(eventRegistry['daemon:auto-build:transition'].project?.(event, state)).toMatchObject({
      autoBuild: {
        enabled: false,
        desired: 'enabled',
        mode: 'paused',
        reason: 'build failed',
      },
    });
  });
});

describe('eventRegistry — daemon:auto-build:disabled', () => {
  it('registers the disabled event as daemon-scoped, persisted, summarized, and projected', () => {
    expect(eventRegistry['daemon:auto-build:disabled']).toMatchObject({
      scope: 'daemon',
      persist: true,
      summary: 'Auto-build disabled',
    });

    const event = {
      type: 'daemon:auto-build:disabled',
      timestamp: '2025-01-01T00:00:00.000Z',
    } as const;
    expect(getEventSummary(event)).toBe('Auto-build disabled');

    const state = {
      runs: [],
      queue: [],
      autoBuild: { enabled: true, watcher: { running: true, pid: 1234, sessionId: null } },
      latestHeartbeat: null,
      stackLayers: [],
    };
    const project = eventRegistry['daemon:auto-build:disabled'].project;
    expect(project?.(event, state)).toEqual({
      autoBuild: { enabled: false, watcher: { running: true, pid: 1234, sessionId: null } },
    });
    expect(project?.(event, { ...state, autoBuild: { ...state.autoBuild, enabled: false } })).toBeUndefined();
    expect(project?.(event, { ...state, autoBuild: null })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Schema validation — invalid payloads rejected
// ---------------------------------------------------------------------------

describe('safeParseDaemonStreamSnapshot — enriched autoBuild state', () => {
  it('accepts autoBuild lifecycle fields in daemon stream snapshots', () => {
    const snapshot = {
      cursor: 1,
      liveness: {
        type: 'daemon:heartbeat',
        timestamp: '2025-01-01T00:00:00.000Z',
        uptime: 1000,
        queueDepth: 1,
        runningBuilds: 0,
        autoBuild: {
          enabled: true,
          paused: false,
          desired: 'enabled',
          mode: 'running',
          scheduler: { alive: true, paused: false },
          lastTransition: {
            at: '2025-01-01T00:00:00.000Z',
            previousMode: 'starting',
            nextMode: 'running',
            desired: 'enabled',
            source: 'watcher',
            reason: 'watcher started',
          },
          reason: 'watcher started',
        },
        subscribers: 1,
      },
      recentActivity: [],
      runs: [],
      queue: [],
      sessionMetadata: {},
      autoBuild: {
        enabled: true,
        watcher: { running: true, pid: 1234, sessionId: 'watcher-1' },
        desired: 'enabled',
        mode: 'running',
        scheduler: { alive: true, paused: false },
        lastTransition: {
          at: '2025-01-01T00:00:00.000Z',
          previousMode: 'starting',
          nextMode: 'running',
          desired: 'enabled',
          source: 'watcher',
          reason: 'watcher started',
        },
        reason: 'watcher started',
      },
      stackLayers: [],
    };

    const result = safeParseDaemonStreamSnapshot(snapshot);
    expect(result.success).toBe(true);
  });

  it('accepts scheduler runningCount and limit in daemon stream snapshots', () => {
    const snapshot = {
      cursor: 1,
      liveness: {
        type: 'daemon:heartbeat',
        timestamp: '2025-01-01T00:00:00.000Z',
        uptime: 1000,
        queueDepth: 1,
        runningBuilds: 2,
        autoBuild: {
          enabled: true,
          paused: false,
          desired: 'enabled',
          mode: 'running',
          scheduler: { alive: true, paused: false, runningCount: 2, limit: 4 },
        },
        subscribers: 1,
      },
      recentActivity: [],
      runs: [],
      queue: [],
      sessionMetadata: {},
      autoBuild: {
        enabled: true,
        watcher: { running: true, pid: 1234, sessionId: 'watcher-1' },
        desired: 'enabled',
        mode: 'running',
        scheduler: { alive: true, paused: false, runningCount: 2, limit: 4 },
      },
      stackLayers: [],
    };

    const result = safeParseDaemonStreamSnapshot(snapshot);
    expect(result.success).toBe(true);
  });

  it('rejects non-numeric scheduler runningCount and limit values', () => {
    const heartbeat = {
      type: 'daemon:heartbeat',
      timestamp: '2025-01-01T00:00:00.000Z',
      uptime: 1000,
      queueDepth: 1,
      runningBuilds: 2,
      autoBuild: {
        enabled: true,
        paused: false,
        scheduler: { alive: true, paused: false, runningCount: '2', limit: '4' },
      },
      subscribers: 1,
    };

    const result = safeParseEforgeEvent(heartbeat);
    expect(result.success).toBe(false);
  });

  it('rejects invalid autoBuild lifecycle field literals in daemon stream snapshots', () => {
    const snapshot = {
      cursor: 1,
      liveness: {
        type: 'daemon:heartbeat',
        timestamp: '2025-01-01T00:00:00.000Z',
        uptime: 1000,
        queueDepth: 1,
        runningBuilds: 0,
        autoBuild: { enabled: true, paused: false, desired: 'enabled', mode: 'warming-up' },
        subscribers: 1,
      },
      recentActivity: [],
      runs: [],
      queue: [],
      sessionMetadata: {},
      autoBuild: {
        enabled: true,
        watcher: { running: true, pid: 1234, sessionId: 'watcher-1' },
        desired: 'enabled',
        mode: 'running',
      },
    };

    const result = safeParseDaemonStreamSnapshot(snapshot);
    expect(result.success).toBe(false);
  });

  it('rejects invalid top-level autoBuild lifecycle field literals in daemon stream snapshots', () => {
    const snapshot = {
      cursor: 1,
      liveness: {
        type: 'daemon:heartbeat',
        timestamp: '2025-01-01T00:00:00.000Z',
        uptime: 1000,
        queueDepth: 1,
        runningBuilds: 0,
        autoBuild: { enabled: true, paused: false, desired: 'enabled', mode: 'running' },
        subscribers: 1,
      },
      recentActivity: [],
      runs: [],
      queue: [],
      sessionMetadata: {},
      autoBuild: {
        enabled: true,
        watcher: { running: true, pid: 1234, sessionId: 'watcher-1' },
        desired: 'enabled',
        mode: 'warming-up',
      },
    };

    const result = safeParseDaemonStreamSnapshot(snapshot);
    expect(result.success).toBe(false);
  });
});

describe('safeParseEforgeEvent — rejection of invalid payloads', () => {
  it('rejects extension:event-handler:failed missing message', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:event-handler:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'audit-log',
      extensionPath: '/project/.eforge/extensions/audit-log.js',
      pattern: '*',
      triggeringEventType: 'plan:build:failed',
    });
    expect(result.success).toBe(false);
  });

  it('rejects extension:event-handler:timeout with non-number timeoutMs', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:event-handler:timeout',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'audit-log',
      extensionPath: '/project/.eforge/extensions/audit-log.js',
      pattern: '*',
      triggeringEventType: 'plan:build:failed',
      timeoutMs: '5000',
    });
    expect(result.success).toBe(false);
  });

  it('rejects extension:policy:decision with invalid decision literal', () => {
    const result = safeParseEforgeEvent({
      ...extensionPolicyVariants[0]!,
      decision: 'modify',
    });
    expect(result.success).toBe(false);
  });

  it('rejects blocking extension:policy:decision events without a reason', () => {
    const eventMissingReason = { ...extensionPolicyVariants[0]! } as Record<string, unknown>;
    delete eventMissingReason.reason;
    expect(safeParseEforgeEvent(eventMissingReason).success).toBe(false);

    const approvalMissingReason = { ...extensionPolicyGateMatrixVariants[6]! } as Record<string, unknown>;
    delete approvalMissingReason.reason;
    expect(safeParseEforgeEvent(approvalMissingReason).success).toBe(false);
  });

  it('rejects extension:policy:timeout with invalid failure policy', () => {
    const result = safeParseEforgeEvent({
      ...extensionPolicyVariants[2]!,
      failurePolicy: 'ignore',
    });
    expect(result.success).toBe(false);
  });

  it('rejects extension policy events missing required provenance fields', () => {
    const eventMissingExtensionPath = { ...extensionPolicyVariants[0]! } as Record<string, unknown>;
    delete eventMissingExtensionPath.extensionPath;
    const result = safeParseEforgeEvent(eventMissingExtensionPath);
    expect(result.success).toBe(false);
  });

  it('rejects extension policy events with invalid registration indexes', () => {
    const result = safeParseEforgeEvent({
      ...extensionPolicyVariants[1]!,
      registrationIndex: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects policy events with missing or mismatched gate-specific target fields', () => {
    expect(safeParseEforgeEvent({
      ...extensionPolicyVariants[0]!,
      planId: undefined,
    }).success).toBe(false);

    expect(safeParseEforgeEvent({
      ...extensionPolicyVariants[1]!,
      method: 'beforePlanMerge',
    }).success).toBe(false);

    expect(safeParseEforgeEvent({
      ...extensionPolicyVariants[2]!,
      baseBranch: undefined,
    }).success).toBe(false);
  });

  it('rejects plan:status:change with an invalid status value', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:status:change',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      status: 'not-a-real-status',
    });
    expect(result.success).toBe(false);
  });

  it('rejects plan:status:change missing planId', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:status:change',
      timestamp: '2025-01-01T00:00:00.000Z',
      status: 'running',
    });
    expect(result.success).toBe(false);
  });

  it('rejects plan:error:set missing error field', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:error:set',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects merge:worktree:set missing path field', () => {
    const result = safeParseEforgeEvent({
      type: 'merge:worktree:set',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an entirely unknown event type', () => {
    const result = safeParseEforgeEvent({
      type: 'completely:unknown:event',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an event missing timestamp (required envelope field)', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:status:change',
      planId: 'plan-01',
      status: 'running',
    });
    expect(result.success).toBe(false);
  });

  it('rejects enqueue:complete missing planSet (required typed field)', () => {
    const result = safeParseEforgeEvent({
      type: 'enqueue:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      id: 'x',
      filePath: 'y',
      title: 'z',
      // planSet intentionally omitted
    });
    expect(result.success).toBe(false);
  });

  it('provides a non-empty error message on failure', () => {
    const result = safeParseEforgeEvent({
      type: 'completely:unknown:event',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// agent:start — thinkingCoerced / thinkingOriginal fields (AC #8 precursor)
// ---------------------------------------------------------------------------

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

describe('agent:start — runtime decision fields survive schema round-trip', () => {
  it('accepts agent:start with thinkingCoerced and thinkingOriginal', () => {
    const event = {
      type: 'agent:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      agentId: 'agent-xyz',
      agent: 'builder',
      model: 'claude-sonnet-4-5',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'standard',
      tierSource: 'tier',
      thinkingCoerced: true,
      thinkingOriginal: { type: 'enabled', budget_tokens: 10000 },
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Extract<typeof result.data, { type: 'agent:start' }>).thinkingCoerced).toBe(true);
      expect((result.data as Extract<typeof result.data, { type: 'agent:start' }>).thinkingOriginal).toEqual({
        type: 'enabled',
        budget_tokens: 10000,
      });
    }
  });

  it('accepts agent:start without optional thinking fields', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      agentId: 'agent-abc',
      agent: 'reviewer',
      model: 'claude-haiku-3-5',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'fast',
      tierSource: 'role',
    });
    expect(result.success).toBe(true);
  });

  it('round-trips agent:start with thinkingCoerced/thinkingOriginal through JSON', () => {
    const event: EforgeEvent = {
      type: 'agent:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      agentId: 'agent-xyz',
      agent: 'builder',
      model: 'claude-sonnet-4-5',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'standard',
      tierSource: 'tier',
      thinkingCoerced: true,
      thinkingOriginal: { type: 'enabled', budget_tokens: 10000 },
    };
    const parsed = JSON.parse(JSON.stringify(event));
    expect(parsed).toEqual(event);
  });
});

// ---------------------------------------------------------------------------
// Schema-as-source-of-truth: validation of pre-existing variants
// ---------------------------------------------------------------------------

describe('safeParseEforgeEvent — pre-existing variant spot-checks', () => {
  it('accepts a well-formed session:start event', () => {
    const result = safeParseEforgeEvent({
      type: 'session:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      sessionId: 'sess-123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a well-formed plan:build:failed event', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      error: 'build failed',
    });
    expect(result.success).toBe(true);
  });

  it('accepts error_transient_transport terminal subtype on build failures and retries', () => {
    const failed = safeParseEforgeEvent({
      type: 'plan:build:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      error: 'Backend error: WebSocket closed 1012',
      terminalSubtype: 'error_transient_transport',
    });
    expect(failed.success).toBe(true);

    const retry = safeParseEforgeEvent({
      type: 'agent:retry',
      timestamp: '2025-01-01T00:00:01.000Z',
      agent: 'builder',
      attempt: 1,
      maxAttempts: 4,
      subtype: 'error_transient_transport',
      label: 'builder-continuation',
      planId: 'plan-01',
    });
    expect(retry.success).toBe(true);
  });

  it('rejects unknown terminal subtypes on build failures and retries', () => {
    const failed = safeParseEforgeEvent({
      type: 'plan:build:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      error: 'Backend error: something else',
      terminalSubtype: 'error_not_in_schema',
    });
    expect(failed.success).toBe(false);

    const retry = safeParseEforgeEvent({
      type: 'agent:retry',
      timestamp: '2025-01-01T00:00:01.000Z',
      agent: 'builder',
      attempt: 1,
      maxAttempts: 4,
      subtype: 'error_not_in_schema',
      label: 'builder-continuation',
      planId: 'plan-01',
    });
    expect(retry.success).toBe(false);
  });

  it('accepts a well-formed daemon:heartbeat event', () => {
    const result = safeParseEforgeEvent({
      type: 'daemon:heartbeat',
      timestamp: '2025-01-01T00:00:00.000Z',
      uptime: 60000,
      queueDepth: 0,
      runningBuilds: 1,
      autoBuild: { enabled: true, paused: false },
      subscribers: 2,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an agent:start event WITHOUT toolbelt observability fields', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      agentId: 'a1',
      agent: 'builder',
      model: 'claude-sonnet-4-6',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'implementation',
      tierSource: 'tier',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an agent:start event WITH toolbelt observability fields (named toolbelt)', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      agentId: 'a1',
      agent: 'builder',
      model: 'claude-sonnet-4-6',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'implementation',
      tierSource: 'tier',
      toolbelt: 'browser-ui',
      toolbeltSource: 'tier',
      projectMcpSelection: 'toolbelt',
      projectMcpServerNames: ['playwright'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts agent:start with toolbelt: null when projectMcpSelection is none', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      agentId: 'a2',
      agent: 'evaluator',
      model: 'claude-opus-4-7',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'evaluation',
      tierSource: 'tier',
      toolbelt: null,
      toolbeltSource: 'tier',
      projectMcpSelection: 'none',
      projectMcpServerNames: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects agent:start with an invalid projectMcpSelection literal', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      agentId: 'a3',
      agent: 'builder',
      model: 'claude-sonnet-4-6',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'implementation',
      tierSource: 'tier',
      projectMcpSelection: 'something-else',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// agent:activity — new discriminant variant
// ---------------------------------------------------------------------------

describe('safeParseEforgeEvent — agent:activity variant', () => {
  it('accepts agent:activity as a recognized discriminant of EforgeEventSchema', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:activity',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      agentId: 'agt-abc123',
      agent: 'builder',
      files: [
        { path: 'src/foo.ts', status: 'M', additions: 10, deletions: 3, binary: false },
      ],
      totals: { filesChanged: 1, additions: 10, deletions: 3 },
      attribution: 'exact',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('agent:activity');
    }
  });

  it('accepts agent:activity with attribution: best_effort and notes', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:activity',
      timestamp: '2025-01-01T00:00:00.000Z',
      agentId: 'agt-def456',
      agent: 'review-fixer',
      totals: { filesChanged: 3, additions: 20, deletions: 5 },
      attribution: 'best_effort',
      notes: ['Unclaimed files outside shard scope: lib/utils.ts'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts agent:result without agentId (backward compatibility)', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:result',
      timestamp: '2025-01-01T00:00:00.000Z',
      agent: 'builder',
      result: {
        durationMs: 5000,
        durationApiMs: 4500,
        numTurns: 10,
        totalCostUsd: 0.05,
        usage: { input: 1000, output: 500, total: 1500, cacheRead: 0, cacheCreation: 0 },
        modelUsage: {},
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts agent:result with agentId', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:result',
      timestamp: '2025-01-01T00:00:00.000Z',
      agentId: 'agt-xyz789',
      agent: 'builder',
      result: {
        durationMs: 5000,
        durationApiMs: 4500,
        numTurns: 10,
        totalCostUsd: 0.05,
        usage: { input: 1000, output: 500, total: 1500, cacheRead: 0, cacheCreation: 0 },
        modelUsage: {},
      },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'agent:result') {
      expect(result.data.agentId).toBe('agt-xyz789');
    }
  });
});


// ---------------------------------------------------------------------------
// extension:agent-context:* and extension:agent-tools:* variants
// ---------------------------------------------------------------------------

describe('safeParseEforgeEvent — extension:agent-context:* variants', () => {
  it('accepts extension:agent-context:applied with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      role: 'builder',
      profile: 'default',
      promptCharCount: 1500,
      fragmentCount: 1,
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:agent-context:applied with all optional fields', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      role: 'builder',
      tier: 'implementation',
      phase: 'build',
      stage: 'implement',
      profile: 'default',
      planId: 'plan-01',
      harness: 'claude-sdk',
      toolbelt: 'browser-ui',
      projectMcpSelection: 'toolbelt',
      promptCharCount: 1500,
      fragmentCount: 2,
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:agent-context:applied with toolbelt: null', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      role: 'builder',
      profile: 'default',
      toolbelt: null,
      promptCharCount: 800,
      fragmentCount: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects extension:agent-context:applied missing promptCharCount', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      role: 'builder',
      profile: 'default',
      fragmentCount: 1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts extension:agent-context:failed with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      role: 'reviewer',
      profile: 'default',
      message: 'Handler threw an error',
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:agent-context:failed with optional stack field', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      role: 'builder',
      profile: 'default',
      message: 'Something went wrong',
      stack: 'Error: Something went wrong\n    at handler (/ext.ts:10:5)',
    });
    expect(result.success).toBe(true);
  });

  it('rejects extension:agent-context:failed missing message', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      role: 'builder',
      profile: 'default',
    });
    expect(result.success).toBe(false);
  });

  it('accepts extension:agent-context:timeout with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:timeout',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'slow-ext',
      extensionPath: '/project/.eforge/extensions/slow-ext.ts',
      role: 'planner',
      profile: 'default',
      timeoutMs: 5000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects extension:agent-context:timeout with non-number timeoutMs', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:timeout',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'slow-ext',
      extensionPath: '/project/.eforge/extensions/slow-ext.ts',
      role: 'planner',
      profile: 'default',
      timeoutMs: '5000',
    });
    expect(result.success).toBe(false);
  });

  it('accepts extension:agent-context:unsupported with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:unsupported',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'tool-ext',
      extensionPath: '/project/.eforge/extensions/tool-ext.ts',
      role: 'builder',
      profile: 'default',
      fields: ['tools'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:agent-context:unsupported with multiple field values', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:unsupported',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'tool-ext',
      extensionPath: '/project/.eforge/extensions/tool-ext.ts',
      role: 'builder',
      profile: 'default',
      fields: ['tools', 'allowedTools', 'disallowedTools'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects extension:agent-context:unsupported with unknown field literal', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:unsupported',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'tool-ext',
      extensionPath: '/project/.eforge/extensions/tool-ext.ts',
      role: 'builder',
      profile: 'default',
      fields: ['unknownField'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts extension:agent-tools:applied with toolbelt metadata', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-tools:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'tool-ext',
      extensionPath: '/project/.eforge/extensions/tool-ext.ts',
      role: 'builder',
      tier: 'implementation',
      phase: 'build',
      stage: 'implement',
      profile: 'default',
      planId: 'plan-01',
      harness: 'claude-sdk',
      toolbelt: 'browser-ui',
      projectMcpSelection: 'toolbelt',
      projectMcpServerNames: ['filesystem'],
      toolNames: ['inspect_context'],
      effectiveToolNames: ['mcp__eforge_engine__inspect_context'],
      registeredToolNames: [],
      inlineToolNames: ['inspect_context'],
      allowedToolsAdded: ['Read'],
      disallowedToolsAdded: ['Write'],
      excludedToolNames: ['duplicate_tool'],
      toolCount: 1,
      allowedToolCount: 1,
      disallowedToolCount: 1,
      excludedToolCount: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects extension:agent-tools:applied missing toolNames', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-tools:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'tool-ext',
      extensionPath: '/project/.eforge/extensions/tool-ext.ts',
      role: 'builder',
      profile: 'default',
      effectiveToolNames: [],
      registeredToolNames: [],
      inlineToolNames: [],
      allowedToolsAdded: [],
      disallowedToolsAdded: [],
      excludedToolNames: [],
      toolCount: 0,
      allowedToolCount: 0,
      disallowedToolCount: 0,
      excludedToolCount: 0,
    });
    expect(result.success).toBe(false);
  });

  it('round-trips all five agent-context/tool variants through JSON', () => {
    const variants: import('../events.schemas.js').EforgeEvent[] = [
      {
        type: 'extension:agent-context:applied',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionName: 'my-ext',
        extensionPath: '/ext.ts',
        role: 'builder',
        tier: 'implementation',
        phase: 'build',
        stage: 'implement',
        profile: 'default',
        planId: 'plan-01',
        promptCharCount: 1000,
        fragmentCount: 1,
      },
      {
        type: 'extension:agent-context:failed',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionName: 'my-ext',
        extensionPath: '/ext.ts',
        role: 'builder',
        profile: 'default',
        message: 'boom',
      },
      {
        type: 'extension:agent-context:timeout',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionName: 'slow-ext',
        extensionPath: '/slow.ts',
        role: 'planner',
        profile: 'default',
        timeoutMs: 5000,
      },
      {
        type: 'extension:agent-context:unsupported',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionName: 'tool-ext',
        extensionPath: '/tool.ts',
        role: 'builder',
        profile: 'default',
        fields: ['tools'],
      },
      {
        type: 'extension:agent-tools:applied',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionName: 'tool-ext',
        extensionPath: '/tool.ts',
        role: 'builder',
        profile: 'default',
        toolNames: ['inspect_context'],
        effectiveToolNames: ['inspect_context'],
        registeredToolNames: [],
        inlineToolNames: ['inspect_context'],
        allowedToolsAdded: [],
        disallowedToolsAdded: [],
        excludedToolNames: [],
        toolCount: 1,
        allowedToolCount: 0,
        disallowedToolCount: 0,
        excludedToolCount: 0,
      },
    ];

    for (const event of variants) {
      const parsed = JSON.parse(JSON.stringify(event));
      expect(parsed).toEqual(event);
      const result = safeParseEforgeEvent(parsed);
      expect(result.success, `${event.type} should roundtrip through safeParseEforgeEvent`).toBe(true);
    }
  });
});

describe('eventRegistry — extension:agent-context:* diagnostics', () => {
  it('registers agent-context and agent-tools variants as session-scoped, non-persistent events', () => {
    expect(eventRegistry['extension:agent-context:applied']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['extension:agent-context:failed']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['extension:agent-context:timeout']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['extension:agent-context:unsupported']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['extension:agent-tools:applied']).toMatchObject({ scope: 'session', persist: false });
  });

  it('summary function for applied event includes extension name, char count, and role', () => {
    const event: import('../events.schemas.js').EforgeEvent = {
      type: 'extension:agent-context:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'my-ext',
      extensionPath: '/ext.ts',
      role: 'builder',
      tier: 'implementation',
      profile: 'default',
      promptCharCount: 1234,
      fragmentCount: 1,
    };
    const summary = getEventSummary(event);
    expect(summary).toContain('my-ext');
    expect(summary).toContain('1234');
    expect(summary).toContain('builder');
  });

  it('summary function for failed event includes extension name, role, and message', () => {
    const event: import('../events.schemas.js').EforgeEvent = {
      type: 'extension:agent-context:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'err-ext',
      extensionPath: '/err.ts',
      role: 'reviewer',
      profile: 'default',
      message: 'Handler exploded',
    };
    const summary = getEventSummary(event);
    expect(summary).toContain('err-ext');
    expect(summary).toContain('reviewer');
    expect(summary).toContain('Handler exploded');
  });

  it('summary function for timeout event includes extension name, timeoutMs, and role', () => {
    const event: import('../events.schemas.js').EforgeEvent = {
      type: 'extension:agent-context:timeout',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'slow-ext',
      extensionPath: '/slow.ts',
      role: 'planner',
      profile: 'default',
      timeoutMs: 3000,
    };
    const summary = getEventSummary(event);
    expect(summary).toContain('slow-ext');
    expect(summary).toContain('3000');
    expect(summary).toContain('planner');
  });

  it('summary function for tools-applied event includes extension name, role, accepted count, and excluded count', () => {
    const event: import('../events.schemas.js').EforgeEvent = {
      type: 'extension:agent-tools:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'tool-ext',
      extensionPath: '/tool.ts',
      role: 'builder',
      profile: 'default',
      toolNames: ['inspect_context'],
      effectiveToolNames: ['inspect_context'],
      registeredToolNames: [],
      inlineToolNames: ['inspect_context'],
      allowedToolsAdded: [],
      disallowedToolsAdded: [],
      excludedToolNames: ['duplicate_tool'],
      toolCount: 1,
      allowedToolCount: 0,
      disallowedToolCount: 0,
      excludedToolCount: 1,
    };
    expect(isAlwaysYieldedAgentEvent(event)).toBe(true);
    const summary = getEventSummary(event);
    expect(summary).toContain('tool-ext');
    expect(summary).toContain('builder');
    expect(summary).toContain('1 accepted');
    expect(summary).toContain('1 excluded');
  });

  it('summary function for unsupported event includes extension name, role, and fields', () => {
    const event: import('../events.schemas.js').EforgeEvent = {
      type: 'extension:agent-context:unsupported',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'tool-ext',
      extensionPath: '/tool.ts',
      role: 'builder',
      profile: 'default',
      fields: ['tools', 'allowedTools'],
    };
    const summary = getEventSummary(event);
    expect(summary).toContain('tool-ext');
    expect(summary).toContain('builder');
    expect(summary).toContain('tools');
    expect(summary).toContain('allowedTools');
  });
});



// ---------------------------------------------------------------------------
// queue:profile:* variants (EXTEND_09)
// ---------------------------------------------------------------------------

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



// ---------------------------------------------------------------------------
// extension:input-source:* and extension:prd-enricher:* variants
// ---------------------------------------------------------------------------

const inputSourceVariants: EforgeEvent[] = [
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

const prdEnricherVariants: EforgeEvent[] = [
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

describe('safeParseEforgeEvent — extension:input-source:* and extension:prd-enricher:* variants', () => {
  it('accepts input-source and prd-enricher variants with required fields', () => {
    for (const event of [...inputSourceVariants, ...prdEnricherVariants]) {
      const result = safeParseEforgeEvent(event);
      expect(result.success, `${event.type} should be accepted`).toBe(true);
    }
  });

  it('accepts extension:input-source:failed with all reason literals', () => {
    const reasons = ['not-found', 'error', 'timeout', 'invalid-result'] as const;
    for (const reason of reasons) {
      const result = safeParseEforgeEvent({
        type: 'extension:input-source:failed',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionPath: '/ext.js',
        extensionName: 'my-ext',
        adapterName: 'my-ext:linear',
        sourceId: 'LIN-1',
        reason,
        message: 'failed',
      });
      expect(result.success, `reason '${reason}' should be accepted`).toBe(true);
    }
  });

  it('accepts extension:input-source:failed with optional timeoutMs', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:input-source:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      extensionName: 'my-ext',
      adapterName: 'my-ext:linear',
      sourceId: 'LIN-1',
      reason: 'timeout',
      message: 'timed out',
      timeoutMs: 5000,
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:prd-enricher:failed with all reason literals', () => {
    const reasons = ['error', 'timeout', 'invalid-result'] as const;
    for (const reason of reasons) {
      const result = safeParseEforgeEvent({
        type: 'extension:prd-enricher:failed',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionPath: '/ext.js',
        extensionName: 'my-ext',
        enricherName: 'my-ext:enricher',
        sourceId: 'LIN-1',
        reason,
        message: 'failed',
      });
      expect(result.success, `reason '${reason}' should be accepted`).toBe(true);
    }
  });

  it('rejects extension:prd-enricher:applied missing enricherName', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:prd-enricher:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      extensionName: 'my-ext',
      // enricherName intentionally omitted
      sourceId: 'LIN-1',
      changed: true,
      inputLength: 100,
      outputLength: 200,
    });
    expect(result.success).toBe(false);
  });

  it('rejects extension:input-source:failed with invalid reason literal', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:input-source:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      extensionName: 'my-ext',
      adapterName: 'my-ext:linear',
      sourceId: 'LIN-1',
      reason: 'network-error',
      message: 'failed',
    });
    expect(result.success).toBe(false);
  });

  it('rejects extension:prd-enricher:failed with invalid reason literal', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:prd-enricher:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      extensionName: 'my-ext',
      enricherName: 'my-ext:enricher',
      sourceId: 'LIN-1',
      reason: 'not-found',
      message: 'failed',
    });
    expect(result.success).toBe(false);
  });

  it('round-trips all four input-source/prd-enricher variants through JSON', () => {
    for (const event of [...inputSourceVariants, ...prdEnricherVariants]) {
      const parsed = JSON.parse(JSON.stringify(event));
      expect(parsed).toEqual(event);
      const result = safeParseEforgeEvent(parsed);
      expect(result.success, `${event.type} should roundtrip through safeParseEforgeEvent`).toBe(true);
    }
  });
});

describe('eventRegistry — extension:input-source:* and extension:prd-enricher:* variants', () => {
  it('registers all four variants as session-scoped, non-persistent events with summaries', () => {
    expect(eventRegistry['extension:input-source:fetched']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['extension:input-source:failed']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['extension:prd-enricher:applied']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['extension:prd-enricher:failed']).toMatchObject({ scope: 'session', persist: false });
  });

  it('summary for input-source:fetched includes extension name, adapter name, source id, and content length', () => {
    const summary = getEventSummary(inputSourceVariants[0]!);
    expect(summary).toContain('my-ext');
    expect(summary).toContain('my-ext:linear');
    expect(summary).toContain('LIN-123');
    expect(summary).toContain('4200');
  });

  it('summary for input-source:failed includes extension name, adapter name, source id, and reason', () => {
    const summary = getEventSummary(inputSourceVariants[1]!);
    expect(summary).toContain('my-ext');
    expect(summary).toContain('my-ext:linear');
    expect(summary).toContain('LIN-404');
    expect(summary).toContain('not-found');
  });

  it('summary for prd-enricher:applied includes extension name, enricher name, source id, and changed flag', () => {
    const summary = getEventSummary(prdEnricherVariants[0]!);
    expect(summary).toContain('my-ext');
    expect(summary).toContain('my-ext:context-injector');
    expect(summary).toContain('LIN-123');
    expect(summary).toContain('true');
  });

  it('summary for prd-enricher:failed includes extension name, enricher name, source id, and reason', () => {
    const summary = getEventSummary(prdEnricherVariants[1]!);
    expect(summary).toContain('my-ext');
    expect(summary).toContain('my-ext:context-injector');
    expect(summary).toContain('LIN-123');
    expect(summary).toContain('error');
  });
});



// ---------------------------------------------------------------------------
// Dynamic perspective key tests
// ---------------------------------------------------------------------------

describe('safeParseEforgeEvent — dynamic perspective keys', () => {
  it('accepts plan:build:review:parallel:start with a custom accessibility perspective', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspectives: ['code', 'accessibility'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts plan:build:review:parallel:perspective:start with a custom key', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:perspective:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspective: 'accessibility',
    });
    expect(result.success).toBe(true);
  });

  it('accepts plan:build:review:parallel:perspective:complete with a custom key', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:perspective:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspective: 'accessibility',
      issues: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts plan:build:review:parallel:perspective:error with a custom key', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:perspective:error',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspective: 'accessibility',
      error: 'No extension reviewer registered',
    });
    expect(result.success).toBe(true);
  });

  it('accepts perspectives-inferred with a custom key', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:decision',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      decision: {
        kind: 'perspectives-inferred',
        rationale: 'Inferred from file categories',
        perspectives: ['code', 'accessibility'],
        categories: ['code'],
        rules: ['code-files → code+security'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts perspectives-respawned with custom keys', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:decision',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      decision: {
        kind: 'perspectives-respawned',
        rationale: 'Starting round 2',
        round: 1,
        perspectives: ['code', 'accessibility'],
        dropped: ['performance-review'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects parallel:start with an uppercase perspective key', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspectives: ['CODE'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects parallel:start with a perspective key containing spaces', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspectives: ['my perspective'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects parallel:start with a perspective key starting with a digit', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspectives: ['1code'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects perspective:error with an uppercase perspective key', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:perspective:error',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspective: 'CODE',
      error: 'invalid key',
    });
    expect(result.success).toBe(false);
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

describe('safeParseEforgeEvent — dynamic perspective keys', () => {

  it('accepts all six built-in perspectives in parallel:start', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspectives: ['code', 'security', 'api', 'docs', 'test', 'verify'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts review-profile-chosen planning decision with a custom key', () => {
    const result = safeParseEforgeEvent({
      type: 'planning:decision',
      timestamp: '2025-01-01T00:00:00.000Z',
      decision: {
        kind: 'review-profile-chosen',
        rationale: 'Custom perspective configured',
        strategy: 'parallel',
        perspectives: ['code', 'accessibility'],
        maxRounds: 2,
        evaluatorStrictness: 'standard',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts agent:start with a valid slug perspective key', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      agentId: 'agent-a11y',
      agent: 'reviewer',
      model: 'claude-opus-4-7',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'review',
      tierSource: 'tier',
      perspective: 'accessibility',
    });
    expect(result.success).toBe(true);
  });

  it('rejects agent:start with an unsafe perspective key', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      agentId: 'agent-a11y',
      agent: 'reviewer',
      model: 'claude-opus-4-7',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'review',
      tierSource: 'tier',
      perspective: 'Accessibility Review',
    });
    expect(result.success).toBe(false);
  });
});



// ---------------------------------------------------------------------------
// enqueue:complete queue projector
// ---------------------------------------------------------------------------

describe('eventRegistry — enqueue:complete queue projector', () => {
  const baseState = {
    runs: [],
    queue: [],
    autoBuild: null,
    latestHeartbeat: null,
    stackLayers: [],
  };

  const enqueueCompleteEvent = {
    type: 'enqueue:complete' as const,
    timestamp: '2025-01-01T00:00:00.000Z',
    id: 'prd-test-001',
    filePath: 'eforge/queue/prd-test-001.md',
    title: 'Test Feature',
    planSet: 'test-feature-set',
  };

  it('registers enqueue:complete as daemon-scoped, persisted, and summarized', () => {
    expect(eventRegistry['enqueue:complete']).toMatchObject({
      scope: 'daemon',
      persist: true,
    });
    expect(DAEMON_EVENT_TYPES).toContain('enqueue:complete');
  });

  it('project function is defined for queue projection', () => {
    expect(eventRegistry['enqueue:complete'].project).toBeDefined();
  });

  it('inserts a minimal pending QueueItem when not already in queue', () => {
    const project = eventRegistry['enqueue:complete'].project!;
    const delta = project(enqueueCompleteEvent, baseState);
    expect(delta).toBeDefined();
    expect(delta!.queue).toHaveLength(1);
    expect(delta!.queue![0]).toEqual({
      id: 'prd-test-001',
      title: 'Test Feature',
      status: 'pending',
    });
  });

  it('uses event.id (not event.planSet or event.filePath) as QueueItem.id', () => {
    const project = eventRegistry['enqueue:complete'].project!;
    const delta = project(enqueueCompleteEvent, baseState);
    expect(delta!.queue![0]!.id).toBe('prd-test-001');
    expect(delta!.queue![0]!.id).not.toBe('test-feature-set');
    expect(delta!.queue![0]!.id).not.toBe('eforge/queue/prd-test-001.md');
  });

  it('returns undefined (no-op) when a queue item with the same id already exists', () => {
    const project = eventRegistry['enqueue:complete'].project!;
    const stateWithItem = {
      ...baseState,
      // Existing non-pending statuses must also dedupe by id.
      queue: [{ id: 'prd-test-001', title: 'Test Feature', status: 'running' as const }],
    };
    const delta = project(enqueueCompleteEvent, stateWithItem);
    expect(delta).toBeUndefined();
  });

  it('does not mutate or project runs, autoBuild, or latestHeartbeat', () => {
    const project = eventRegistry['enqueue:complete'].project!;
    const stateWithNonQueueSlices = {
      runs: [
        {
          id: 'run-1',
          planSet: 'existing-plan-set',
          command: 'build' as const,
          status: 'running' as const,
          startedAt: '2025-01-01T00:00:00.000Z',
          cwd: '/tmp/project',
        },
      ],
      queue: [],
      autoBuild: {
        enabled: true,
        watcher: { running: true, pid: 1234, sessionId: 'watcher-1' },
      },
      latestHeartbeat: {
        at: 123,
        payload: {
          uptime: 1000,
          queueDepth: 0,
          runningBuilds: 0,
          autoBuild: { enabled: true, paused: false },
          subscribers: 0,
        },
      },
      stackLayers: [],
    };
    const before = structuredClone({
      runs: stateWithNonQueueSlices.runs,
      autoBuild: stateWithNonQueueSlices.autoBuild,
      latestHeartbeat: stateWithNonQueueSlices.latestHeartbeat,
    });

    const delta = project(enqueueCompleteEvent, stateWithNonQueueSlices);

    expect(delta).not.toHaveProperty('runs');
    expect(delta).not.toHaveProperty('autoBuild');
    expect(delta).not.toHaveProperty('latestHeartbeat');
    expect(stateWithNonQueueSlices.runs).toEqual(before.runs);
    expect(stateWithNonQueueSlices.autoBuild).toEqual(before.autoBuild);
    expect(stateWithNonQueueSlices.latestHeartbeat).toEqual(before.latestHeartbeat);
  });

  it('daemon:run:upsert remains the only run-state projector', () => {
    expect(eventRegistry['daemon:run:upsert'].project).toBeDefined();
    // enqueue:start and enqueue:failed must not define projectors (run state is authoritative via daemon:run:upsert)
    const reg = eventRegistry as Record<string, { project?: unknown }>;
    expect(reg['enqueue:start']!.project).toBeUndefined();
    expect(reg['enqueue:failed']!.project).toBeUndefined();
  });
});



// ---------------------------------------------------------------------------
// isPersistedDaemonEventType predicate
// ---------------------------------------------------------------------------

describe('isPersistedDaemonEventType', () => {
  it('returns true for queue lifecycle event types', () => {
    expect(isPersistedDaemonEventType('queue:prd:discovered')).toBe(true);
    expect(isPersistedDaemonEventType('queue:prd:start')).toBe(true);
    expect(isPersistedDaemonEventType('queue:prd:complete')).toBe(true);
    expect(isPersistedDaemonEventType('queue:complete')).toBe(true);
  });

  it('returns true for daemon scheduler event types', () => {
    expect(isPersistedDaemonEventType('daemon:scheduler:dequeued')).toBe(true);
    expect(isPersistedDaemonEventType('daemon:scheduler:capacity-blocked')).toBe(true);
    expect(isPersistedDaemonEventType('daemon:scheduler:dependency-blocked')).toBe(true);
    expect(isPersistedDaemonEventType('daemon:scheduler:paused')).toBe(true);
    expect(isPersistedDaemonEventType('daemon:scheduler:resumed')).toBe(true);
  });

  it('returns true for daemon lifecycle event types', () => {
    expect(isPersistedDaemonEventType('daemon:lifecycle:starting')).toBe(true);
    expect(isPersistedDaemonEventType('daemon:lifecycle:ready')).toBe(true);
    expect(isPersistedDaemonEventType('daemon:run:upsert')).toBe(true);
  });

  it('returns false for daemon:heartbeat — LIVE-ONLY, must not be persisted', () => {
    expect(isPersistedDaemonEventType('daemon:heartbeat')).toBe(false);
  });

  it('returns false for session-scoped non-persisted events', () => {
    expect(isPersistedDaemonEventType('plan:build:start')).toBe(false);
    expect(isPersistedDaemonEventType('agent:start')).toBe(false);
    expect(isPersistedDaemonEventType('planning:complete')).toBe(false);
    expect(isPersistedDaemonEventType('build:resume:artifacts')).toBe(false);
  });

  it('returns false for completely unknown strings', () => {
    expect(isPersistedDaemonEventType('not:a:real:event')).toBe(false);
    expect(isPersistedDaemonEventType('')).toBe(false);
  });

  it('is consistent with DAEMON_EVENT_TYPES allowlist — every type in the array returns true', () => {
    for (const type of DAEMON_EVENT_TYPES) {
      expect(isPersistedDaemonEventType(type), `${type} should return true`).toBe(true);
    }
  });

  it('has no overlap with daemon:heartbeat — heartbeat is absent from DAEMON_EVENT_TYPES', () => {
    expect(DAEMON_EVENT_TYPES).not.toContain('daemon:heartbeat');
  });
});

describe('safeParseEforgeEvent — extension reviewer perspective events', () => {
  it('accepts extension:reviewer-perspective:applied with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:reviewer-perspective:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/project/.eforge/extensions/a11y.js',
      extensionName: 'a11y-reviewer',
      perspectiveKey: 'accessibility',
      perspectiveLabel: 'Accessibility Review',
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:reviewer-perspective:applied with optional planId', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:reviewer-perspective:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/project/.eforge/extensions/a11y.js',
      extensionName: 'a11y-reviewer',
      perspectiveKey: 'accessibility',
      perspectiveLabel: 'Accessibility Review',
      planId: 'plan-01',
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:reviewer-perspective:skipped with reason not-applicable', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:reviewer-perspective:skipped',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/project/.eforge/extensions/a11y.js',
      extensionName: 'a11y-reviewer',
      perspectiveKey: 'accessibility',
      reason: 'not-applicable',
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:reviewer-perspective:skipped with all reason variants', () => {
    const reasons = ['not-applicable', 'applicability-error', 'applicability-timeout', 'unknown-key'] as const;
    for (const reason of reasons) {
      const result = safeParseEforgeEvent({
        type: 'extension:reviewer-perspective:skipped',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionPath: '/ext.js',
        extensionName: 'ext',
        perspectiveKey: 'my-lens',
        reason,
      });
      expect(result.success, `reason '${reason}' should be accepted`).toBe(true);
    }
  });

  it('accepts extension:reviewer-perspective:skipped unknown-key without extension provenance', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:reviewer-perspective:skipped',
      timestamp: '2025-01-01T00:00:00.000Z',
      perspectiveKey: 'missing-lens',
      reason: 'unknown-key',
      message: 'Perspective key "missing-lens" is not registered by any loaded extension',
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:reviewer-perspective:skipped with optional message and timeoutMs', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:reviewer-perspective:skipped',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      extensionName: 'ext',
      perspectiveKey: 'my-lens',
      reason: 'applicability-timeout',
      message: 'Timed out after 5000ms',
      timeoutMs: 5000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects extension:reviewer-perspective:applied missing extensionName', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:reviewer-perspective:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      perspectiveKey: 'my-lens',
      perspectiveLabel: 'My Lens',
    });
    expect(result.success).toBe(false);
  });

  it('rejects extension:reviewer-perspective:skipped with invalid reason literal', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:reviewer-perspective:skipped',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      extensionName: 'ext',
      perspectiveKey: 'my-lens',
      reason: 'invalid-reason',
    });
    expect(result.success).toBe(false);
  });

  it('round-trips extension reviewer perspective events through JSON', () => {
    const events: EforgeEvent[] = [
      {
        type: 'extension:reviewer-perspective:applied',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionPath: '/ext.js',
        extensionName: 'ext',
        perspectiveKey: 'accessibility',
        perspectiveLabel: 'Accessibility',
        planId: 'plan-01',
      },
      {
        type: 'extension:reviewer-perspective:skipped',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionPath: '/ext.js',
        extensionName: 'ext',
        perspectiveKey: 'accessibility',
        reason: 'not-applicable',
      },
    ];
    for (const event of events) {
      expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    }
  });
});

describe('eventRegistry — extension reviewer perspective events', () => {
  it('registers perspective events as session-scoped, non-persistent events', () => {
    expect(eventRegistry['extension:reviewer-perspective:applied']).toMatchObject({
      scope: 'session',
      persist: false,
    });
    expect(eventRegistry['extension:reviewer-perspective:skipped']).toMatchObject({
      scope: 'session',
      persist: false,
    });
  });

  it('generates summaries for applied and skipped perspective events', () => {
    const appliedEvent: EforgeEvent = {
      type: 'extension:reviewer-perspective:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      extensionName: 'a11y',
      perspectiveKey: 'accessibility',
      perspectiveLabel: 'Accessibility',
      planId: 'plan-01',
    };
    const skippedEvent: EforgeEvent = {
      type: 'extension:reviewer-perspective:skipped',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      extensionName: 'a11y',
      perspectiveKey: 'accessibility',
      reason: 'not-applicable',
    };
    expect(getEventSummary(appliedEvent)).toContain('accessibility');
    expect(getEventSummary(appliedEvent)).toContain('a11y');
    expect(getEventSummary(skippedEvent)).toContain('accessibility');
    expect(getEventSummary(skippedEvent)).toContain('not-applicable');
  });
});


describe('safeParseEforgeEvent — acceptance_validation:complete', () => {
  it('accepts a valid acceptance_validation:complete event with passing verdicts', () => {
    const event: EforgeEvent = {
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
      verdicts: [
        { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found at src/login.ts' },
      ],
      source: 'prd',
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts acceptance_validation:complete with fail and unknown verdicts', () => {
    const event: EforgeEvent = {
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found' },
        { criterion: 'Must support OAuth', verdict: 'fail', evidence: 'No OAuth integration found' },
        { criterion: 'Must be accessible', verdict: 'unknown', evidence: 'Cannot verify from diff alone' },
      ],
      source: 'prd',
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts acceptance_validation:complete with optional waivers', () => {
    const event: EforgeEvent = {
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
      verdicts: [
        { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found at src/login.ts' },
      ],
      waivers: ['Out of scope for this iteration'],
      source: 'prd',
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('rejects acceptance_validation:complete passed:true with non-passing verdicts unless waived', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
      verdicts: [
        { criterion: 'Must support OAuth', verdict: 'fail', evidence: 'No OAuth integration found' },
      ],
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete passed:false with all-passing verdicts', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found' },
      ],
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with blank waiver reason entries', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
      verdicts: [
        { criterion: 'Must support OAuth', verdict: 'fail', evidence: 'No OAuth integration found' },
      ],
      waivers: ['   '],
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with empty criterion string', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: '', verdict: 'fail', evidence: 'Something is missing' },
      ],
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with empty evidence string', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must support login', verdict: 'fail', evidence: '' },
      ],
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with invalid verdict literal', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must support login', verdict: 'maybe', evidence: 'Some evidence' },
      ],
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with empty verdicts array', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
      verdicts: [],
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with missing passed field', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      verdicts: [
        { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found' },
      ],
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with missing verdicts field', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with missing source field', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must support login', verdict: 'fail', evidence: 'Login component missing' },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('safeParseEforgeEvent — gap_close:complete requires passed', () => {
  it('accepts gap_close:complete with passed: true', () => {
    const event: EforgeEvent = {
      type: 'gap_close:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts gap_close:complete with passed: false', () => {
    const event: EforgeEvent = {
      type: 'gap_close:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('rejects gap_close:complete without a passed field', () => {
    const result = safeParseEforgeEvent({
      type: 'gap_close:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('eventRegistry — validation evidence summaries', () => {
  it('summarizes gap_close:complete using the required passed verdict', () => {
    expect(getEventSummary({
      type: 'gap_close:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
    })).toBe('Gap closing complete: all gaps resolved');
    expect(getEventSummary({
      type: 'gap_close:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
    })).toBe('Gap closing complete: gaps remain');
  });

  it('registers and summarizes acceptance_validation:complete events', () => {
    expect(eventRegistry['acceptance_validation:complete']).toMatchObject({
      scope: 'session',
      persist: false,
    });
    expect(getEventSummary({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
      verdicts: [
        { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found' },
      ],
      source: 'prd',
    })).toBe('Acceptance validation passed: 1 criterion/criteria verified');
    expect(getEventSummary({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found' },
        { criterion: 'Must support OAuth', verdict: 'fail', evidence: 'OAuth not found' },
        { criterion: 'Must be accessible', verdict: 'unknown', evidence: 'Cannot verify from diff' },
      ],
      source: 'prd',
    })).toBe('Acceptance validation failed: 2 criterion/criteria not passed');
  });
});

describe('recovery:summary event — optional BuildFailureSummary fields', () => {
  function makeBaseSummary() {
    return {
      prdId: 'prd-1',
      setName: 'my-set',
      featureBranch: 'eforge/my-set',
      baseBranch: 'main',
      plans: [{ planId: 'acceptance-validation', status: 'failed' }],
      failingPlan: { planId: 'acceptance-validation' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: ['claude-sonnet-4-5'],
      failedAt: '2025-01-01T00:00:00.000Z',
      partial: true,
    };
  }

  it('accepts a recovery:summary event with no optional fields', () => {
    const event: EforgeEvent = {
      type: 'recovery:summary',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-1',
      summary: makeBaseSummary(),
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with terminalFailure field', () => {
    const event: EforgeEvent = {
      type: 'recovery:summary',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-1',
      summary: {
        ...makeBaseSummary(),
        terminalFailure: {
          stage: 'acceptance-validation',
          phaseSummary: 'All acceptance criteria failed',
          phaseStatus: 'failed',
          eventType: 'acceptance_validation:complete',
        },
      },
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with acceptanceValidation field including unknown verdicts', () => {
    const event: EforgeEvent = {
      type: 'recovery:summary',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-2',
      summary: {
        ...makeBaseSummary(),
        acceptanceValidation: {
          passed: false,
          total: 2,
          pass: 0,
          fail: 0,
          unknown: 2,
          verdicts: [
            { criterion: 'Must support login', verdict: 'unknown', evidence: 'Cannot verify login from diff alone' },
            { criterion: 'Must support OAuth', verdict: 'unknown', evidence: 'Cannot verify OAuth from diff alone' },
          ],
        },
      },
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with validationCommands field', () => {
    const event: EforgeEvent = {
      type: 'recovery:summary',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-1',
      summary: {
        ...makeBaseSummary(),
        validationCommands: [
          { command: 'pnpm type-check', exitCode: 0, output: 'No errors found' },
          { command: 'pnpm test', exitCode: 1, output: 'Test failed' },
        ],
      },
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with landing field', () => {
    const event: EforgeEvent = {
      type: 'recovery:summary',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-1',
      summary: {
        ...makeBaseSummary(),
        landing: {
          status: 'skipped',
          action: 'pr',
          reason: 'Acceptance validation failed — landing skipped',
        },
      },
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with all optional fields combined', () => {
    const event: EforgeEvent = {
      type: 'recovery:summary',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-full',
      summary: {
        ...makeBaseSummary(),
        terminalFailure: {
          stage: 'acceptance-validation',
          phaseStatus: 'failed',
          eventType: 'acceptance_validation:complete',
        },
        acceptanceValidation: {
          passed: false,
          total: 3,
          pass: 1,
          fail: 0,
          unknown: 2,
          verdicts: [
            { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found' },
            { criterion: 'Must support OAuth', verdict: 'unknown', evidence: 'Cannot determine OAuth from diff' },
            { criterion: 'Must be accessible', verdict: 'unknown', evidence: 'Cannot verify accessibility from diff' },
          ],
        },
        validationCommands: [
          { command: 'pnpm type-check', exitCode: 0, output: 'No errors' },
        ],
        landing: {
          status: 'skipped',
          reason: 'Acceptance validation failed',
        },
      },
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });
});

describe('recovery:summary event — multi-plan optional fields', () => {
  /**
   * Base summary with one failed plan — used as the foundation for optional-field tests.
   * Uses unknown cast because BuildFailureSummary / EforgeEvent types do not yet have
   * the new fields (failingPlans, commitSha, testPassed, testFailed, completedAt,
   * toolUseCount); the type definitions will be updated by this plan's implementation.
   */
  function makeBaseSummary() {
    return {
      prdId: 'prd-multi',
      setName: 'multi-plan-set',
      featureBranch: 'eforge/multi-plan-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01', status: 'merged' },
        { planId: 'plan-02', status: 'failed', error: 'API error 529: overloaded_error' },
      ],
      failingPlan: { planId: 'plan-02' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };
  }

  it('accepts recovery:summary with failingPlans array containing multiple FailingPlanEntry items', () => {
    const event = {
      type: 'recovery:summary',
      timestamp: '2026-05-26T06:15:10.000Z',
      prdId: 'prd-multi',
      summary: {
        ...makeBaseSummary(),
        failingPlans: [
          { planId: 'plan-02', errorMessage: 'API error 529: overloaded_error', terminalSubtype: 'error_transient_transport' },
          { planId: 'plan-03', errorMessage: 'API error 529: overloaded_error', terminalSubtype: 'error_transient_transport' },
        ],
      },
    };
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with PlanSummaryEntry items containing commitSha', () => {
    const event = {
      type: 'recovery:summary',
      timestamp: '2026-05-26T06:15:10.000Z',
      prdId: 'prd-multi',
      summary: {
        ...makeBaseSummary(),
        plans: [
          { planId: 'plan-01', status: 'merged', commitSha: 'abc1234def5678901234567890abcdef12345678' },
          { planId: 'plan-02', status: 'failed', error: 'API error 529: overloaded_error' },
        ],
      },
    };
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with PlanSummaryEntry items containing testPassed and testFailed counts', () => {
    const event = {
      type: 'recovery:summary',
      timestamp: '2026-05-26T06:15:10.000Z',
      prdId: 'prd-multi',
      summary: {
        ...makeBaseSummary(),
        plans: [
          { planId: 'plan-01', status: 'merged', testPassed: 42, testFailed: 0 },
          { planId: 'plan-02', status: 'failed', error: 'API error 529' },
        ],
      },
    };
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with PlanSummaryEntry items containing completedAt timestamp', () => {
    const event = {
      type: 'recovery:summary',
      timestamp: '2026-05-26T06:15:10.000Z',
      prdId: 'prd-multi',
      summary: {
        ...makeBaseSummary(),
        plans: [
          { planId: 'plan-01', status: 'merged', completedAt: '2026-05-26T05:30:00.000Z' },
          { planId: 'plan-02', status: 'failed', error: 'API error 529' },
        ],
      },
    };
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with PlanSummaryEntry items containing toolUseCount', () => {
    const event = {
      type: 'recovery:summary',
      timestamp: '2026-05-26T06:15:10.000Z',
      prdId: 'prd-multi',
      summary: {
        ...makeBaseSummary(),
        plans: [
          { planId: 'plan-01', status: 'merged' },
          { planId: 'plan-02', status: 'failed', error: 'API error 529', toolUseCount: 3 },
        ],
      },
    };
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with failingPlans entries containing toolUseCount', () => {
    const event = {
      type: 'recovery:summary',
      timestamp: '2026-05-26T06:15:10.000Z',
      prdId: 'prd-multi',
      summary: {
        ...makeBaseSummary(),
        failingPlans: [
          { planId: 'plan-02', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport', toolUseCount: 5 },
        ],
      },
    };
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with all new multi-plan optional fields combined', () => {
    const event = {
      type: 'recovery:summary',
      timestamp: '2026-05-26T06:15:10.000Z',
      prdId: 'prd-multi-full',
      summary: {
        prdId: 'prd-multi-full',
        setName: 'multi-plan-set',
        featureBranch: 'eforge/multi-plan-set',
        baseBranch: 'main',
        plans: [
          {
            planId: 'plan-01',
            status: 'merged',
            commitSha: 'abc1234def5678901234567890abcdef12345678',
            completedAt: '2026-05-26T05:30:00.000Z',
            testPassed: 20,
            testFailed: 0,
          },
          {
            planId: 'plan-02',
            status: 'merged',
            completedAt: '2026-05-26T05:45:00.000Z',
          },
          {
            planId: 'plan-04',
            status: 'failed',
            error: 'API error 529: overloaded_error',
            toolUseCount: 3,
          },
          {
            planId: 'plan-06',
            status: 'failed',
            error: 'API error 529: overloaded_error',
            toolUseCount: 0,
          },
        ] satisfies BuildFailureSummary['plans'],
        failingPlan: { planId: 'plan-06' },
        failingPlans: [
          { planId: 'plan-04', errorMessage: 'API error 529: overloaded_error', terminalSubtype: 'error_transient_transport', toolUseCount: 3 },
          { planId: 'plan-06', errorMessage: 'API error 529: overloaded_error', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
        ],
        landedCommits: [
          { sha: 'abc1234def5678901234567890abcdef12345678', subject: 'feat: plan-01', author: 'Test', date: '2026-05-26T05:30:00.000Z' },
        ],
        diffStat: '10 files changed',
        modelsUsed: ['claude-sonnet-4-6'],
        failedAt: '2026-05-26T06:15:10.000Z',
      },
    } satisfies EforgeEvent;
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('rejects recovery:summary when failingPlans is a string instead of an array', () => {
    const event = {
      type: 'recovery:summary',
      timestamp: '2026-05-26T06:15:10.000Z',
      prdId: 'prd-multi',
      summary: {
        ...makeBaseSummary(),
        failingPlans: 'not-array',
      },
    };
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(false);
  });

  it('rejects PlanSummaryEntry when testPassed is a string instead of a number', () => {
    const event = {
      type: 'recovery:summary',
      timestamp: '2026-05-26T06:15:10.000Z',
      prdId: 'prd-multi',
      summary: {
        ...makeBaseSummary(),
        plans: [
          { planId: 'plan-01', status: 'merged', testPassed: '42' },
        ],
      },
    };
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(false);
  });

  it('rejects PlanSummaryEntry when toolUseCount is a string instead of a number', () => {
    const event = {
      type: 'recovery:summary',
      timestamp: '2026-05-26T06:15:10.000Z',
      prdId: 'prd-multi',
      summary: {
        ...makeBaseSummary(),
        plans: [
          { planId: 'plan-01', status: 'failed', toolUseCount: 'three' },
        ],
      },
    };
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(false);
  });

  it('rejects PlanSummaryEntry when commitSha is a number instead of a string', () => {
    const event = {
      type: 'recovery:summary',
      timestamp: '2026-05-26T06:15:10.000Z',
      prdId: 'prd-multi',
      summary: {
        ...makeBaseSummary(),
        plans: [
          { planId: 'plan-01', status: 'merged', commitSha: 12345 },
        ],
      },
    };
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(false);
  });

  it('rejects FailingPlanEntry when toolUseCount is not a number', () => {
    const event = {
      type: 'recovery:summary',
      timestamp: '2026-05-26T06:15:10.000Z',
      prdId: 'prd-multi',
      summary: {
        ...makeBaseSummary(),
        failingPlans: [
          { planId: 'plan-02', errorMessage: 'err', toolUseCount: 'five' },
        ],
      },
    };
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(false);
  });

  it('existing recovery:summary without new fields still validates (backward compatibility)', () => {
    // Legacy sidecars without failingPlans, commitSha, testPassed, etc. must still parse cleanly.
    const event: EforgeEvent = {
      type: 'recovery:summary',
      timestamp: '2026-05-26T06:15:10.000Z',
      prdId: 'prd-legacy',
      summary: {
        prdId: 'prd-legacy',
        setName: 'legacy-set',
        featureBranch: 'eforge/legacy-set',
        baseBranch: 'main',
        plans: [{ planId: 'plan-01', status: 'failed', error: 'Type error' }],
        failingPlan: { planId: 'plan-01', errorMessage: 'Type error' },
        landedCommits: [],
        diffStat: '',
        modelsUsed: [],
        failedAt: '2026-05-26T06:15:10.000Z',
      },
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// plan:build:review:fix:continuation and review-fixer agent:retry variants
// ---------------------------------------------------------------------------

describe('safeParseEforgeEvent — plan:build:review:fix:continuation', () => {
  it('accepts plan:build:review:fix:continuation with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:fix:continuation',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      attempt: 1,
      maxContinuations: 2,
    });
    expect(result.success).toBe(true);
  });

  it('rejects plan:build:review:fix:continuation missing planId', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:fix:continuation',
      timestamp: '2025-01-01T00:00:00.000Z',
      attempt: 1,
      maxContinuations: 2,
    });
    expect(result.success).toBe(false);
  });

  it('rejects plan:build:review:fix:continuation missing attempt', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:fix:continuation',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      maxContinuations: 2,
    });
    expect(result.success).toBe(false);
  });

  it('rejects plan:build:review:fix:continuation missing maxContinuations', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:fix:continuation',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      attempt: 1,
    });
    expect(result.success).toBe(false);
  });

  it('round-trips through JSON', () => {
    const event: EforgeEvent = {
      type: 'plan:build:review:fix:continuation',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-42',
      attempt: 2,
      maxContinuations: 2,
    };
    const parsed = JSON.parse(JSON.stringify(event));
    const result = safeParseEforgeEvent(parsed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(event);
    }
  });
});

describe('safeParseEforgeEvent — review-fixer agent:retry payload', () => {
  it('accepts agent:retry with agent review-fixer and error_max_turns', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:retry',
      timestamp: '2025-01-01T00:00:00.000Z',
      agent: 'review-fixer',
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_max_turns',
      label: 'review-fixer-continuation',
      planId: 'plan-42',
    });
    expect(result.success).toBe(true);
  });

  it('accepts agent:retry for review-fixer without planId', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:retry',
      timestamp: '2025-01-01T00:00:00.000Z',
      agent: 'review-fixer',
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_max_turns',
      label: 'review-fixer-continuation',
    });
    expect(result.success).toBe(true);
  });

  it('accepts agent:retry for review-fixer with any valid AgentTerminalSubtype (schema not restricted to error_max_turns)', () => {
    // The schema accepts any valid AgentTerminalSubtype — policy filtering is runtime-only.
    const result = safeParseEforgeEvent({
      type: 'agent:retry',
      timestamp: '2025-01-01T00:00:00.000Z',
      agent: 'review-fixer',
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_during_execution',
      label: 'review-fixer-continuation',
    });
    expect(result.success).toBe(true);
  });

  it('rejects agent:retry missing agent field', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:retry',
      timestamp: '2025-01-01T00:00:00.000Z',
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_max_turns',
      label: 'review-fixer-continuation',
    });
    expect(result.success).toBe(false);
  });
});



// ---------------------------------------------------------------------------
// recovery:summary — multi-failure and enriched plan entry fields
// ---------------------------------------------------------------------------

describe('safeParseEforgeEvent — recovery:summary with multi-failure fields', () => {
  const baseRecoverySummaryEvent = {
    type: 'recovery:summary',
    timestamp: '2026-05-26T06:15:10.000Z',
    prdId: 'add-eforge-console-side-by-side',
    summary: {
      prdId: 'add-eforge-console-side-by-side',
      setName: 'multi-plan-set',
      featureBranch: 'eforge/multi-plan-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01-console-shell', status: 'merged' },
        { planId: 'plan-02-activity-audit-view', status: 'merged' },
        { planId: 'plan-04-queue-view', status: 'failed', error: 'API error 529' },
        { planId: 'plan-06-static-serving', status: 'failed', error: 'API error 529' },
      ],
      failingPlan: {
        planId: 'plan-06-static-serving',
        errorMessage: 'API error 529',
        terminalSubtype: 'error_transient_transport',
      },
      landedCommits: [],
      diffStat: '',
      modelsUsed: ['claude-sonnet-4-6'],
      failedAt: '2026-05-26T06:15:10.000Z',
    },
  };

  it('accepts recovery:summary without new optional fields (legacy)', () => {
    const result = safeParseEforgeEvent(baseRecoverySummaryEvent);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with failingPlans array', () => {
    const result = safeParseEforgeEvent({
      ...baseRecoverySummaryEvent,
      summary: {
        ...baseRecoverySummaryEvent.summary,
        failingPlans: [
          {
            planId: 'plan-04-queue-view',
            errorMessage: 'API error 529',
            terminalSubtype: 'error_transient_transport',
            toolUseCount: 3,
          },
          {
            planId: 'plan-06-static-serving',
            errorMessage: 'API error 529',
            terminalSubtype: 'error_transient_transport',
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with enriched plan entries (commitSha, testPassed, testFailed)', () => {
    const result = safeParseEforgeEvent({
      ...baseRecoverySummaryEvent,
      summary: {
        ...baseRecoverySummaryEvent.summary,
        plans: [
          {
            planId: 'plan-01-console-shell',
            status: 'merged',
            mergedAt: '2026-05-26T05:05:00.000Z',
            commitSha: 'abc1234def5678901234567890abcdef12345678',
          },
          {
            planId: 'plan-02-activity-audit-view',
            status: 'merged',
            testPassed: 42,
            testFailed: 0,
          },
          {
            planId: 'plan-04-queue-view',
            status: 'failed',
            error: 'API error 529',
            terminalSubtype: 'error_transient_transport',
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with completedAt on plan entries', () => {
    const result = safeParseEforgeEvent({
      ...baseRecoverySummaryEvent,
      summary: {
        ...baseRecoverySummaryEvent.summary,
        plans: [
          {
            planId: 'plan-01-console-shell',
            status: 'merged',
            completedAt: '2026-05-26T05:30:00.000Z',
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts failingPlan with toolUseCount', () => {
    const result = safeParseEforgeEvent({
      ...baseRecoverySummaryEvent,
      summary: {
        ...baseRecoverySummaryEvent.summary,
        failingPlan: {
          planId: 'plan-06-static-serving',
          errorMessage: 'API error 529',
          terminalSubtype: 'error_transient_transport',
          toolUseCount: 0,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('round-trips recovery:summary with all new optional fields through JSON', () => {
    const event = {
      ...baseRecoverySummaryEvent,
      summary: {
        ...baseRecoverySummaryEvent.summary,
        plans: [
          {
            planId: 'plan-01-console-shell',
            status: 'merged',
            commitSha: 'abc1234',
            testPassed: 10,
            testFailed: 0,
            completedAt: '2026-05-26T05:30:00.000Z',
          },
        ],
        failingPlans: [
          {
            planId: 'plan-04-queue-view',
            errorMessage: 'API error 529',
            toolUseCount: 3,
          },
        ],
      },
    };
    const parsed = JSON.parse(JSON.stringify(event));
    expect(parsed).toEqual(event);
    const result = safeParseEforgeEvent(parsed);
    expect(result.success).toBe(true);
  });
});



// ---------------------------------------------------------------------------
// recovery:complete — optional verdict source metadata fields
// ---------------------------------------------------------------------------

describe('recovery:complete event — optional RecoveryVerdict metadata fields', () => {
  /**
   * Build a minimal valid recovery:complete event.
   */
  function makeBaseRecoveryCompleteEvent(verdictOverrides?: Record<string, unknown>) {
    return {
      type: 'recovery:complete',
      timestamp: '2026-05-26T06:15:10.000Z',
      prdId: 'test-prd',
      verdict: {
        verdict: 'retry',
        confidence: 'high',
        rationale: 'All failures were transient transport errors.',
        completedWork: [],
        remainingWork: [],
        risks: [],
        ...verdictOverrides,
      },
    };
  }

  it('accepts recovery:complete without new optional metadata fields (legacy compatibility)', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent());
    expect(result.success).toBe(true);
  });

  it('accepts recovery:complete with recommendationSource=deterministic', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      recommendationSource: 'deterministic',
    }));
    expect(result.success).toBe(true);
  });

  it('accepts recovery:complete with recommendationSource=analyst', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      recommendationSource: 'analyst',
    }));
    expect(result.success).toBe(true);
  });

  it('accepts recovery:complete with recommendationSource=manual-fallback', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      recommendationSource: 'manual-fallback',
    }));
    expect(result.success).toBe(true);
  });

  it('accepts recovery:complete with recommendationRationale string', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      recommendationRationale: 'All 2 failed plans have terminalSubtype error_transient_transport with zero tool use.',
    }));
    expect(result.success).toBe(true);
  });

  it('accepts recovery:complete with verdictInvalidationReason string', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      verdict: 'manual',
      confidence: 'low',
      rationale: 'Analyst verdict was rejected.',
      verdictInvalidationReason: 'Analyst rationale did not mention plan-04-queue-view',
    }));
    expect(result.success).toBe(true);
  });

  it('accepts recovery:complete with all three metadata fields combined', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      recommendationSource: 'deterministic',
      recommendationRationale: 'All failed plans are transient; no completed work.',
      verdictInvalidationReason: 'Analyst output omitted plan-04-queue-view from rationale.',
    }));
    expect(result.success).toBe(true);
  });

  it('rejects recovery:complete when recommendationSource is not a known value', () => {
    // If recommendationSource is a closed union, unknown values should be rejected
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      recommendationSource: 'llm-gut-feeling',
    }));
    // Closed union rejects unknown values; open string accepts any string.
    // The plan says "use a closed union for source values if practical" — test for rejection.
    expect(result.success).toBe(false);
  });

  it('rejects recovery:complete when recommendationSource is a number instead of a string', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      recommendationSource: 42,
    }));
    expect(result.success).toBe(false);
  });

  it('rejects recovery:complete when recommendationRationale is a number instead of a string', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      recommendationRationale: 999,
    }));
    expect(result.success).toBe(false);
  });

  it('rejects recovery:complete when verdictInvalidationReason is a boolean instead of a string', () => {
    const result = safeParseEforgeEvent(makeBaseRecoveryCompleteEvent({
      verdictInvalidationReason: true,
    }));
    expect(result.success).toBe(false);
  });

  it('round-trips recovery:complete with all verdict metadata through JSON', () => {
    const event = makeBaseRecoveryCompleteEvent({
      recommendationSource: 'analyst',
      recommendationRationale: 'Deterministic retry recommendation based on transient errors.',
      verdictInvalidationReason: undefined, // analyst verdict was accepted
    });
    const parsed = JSON.parse(JSON.stringify(event));
    const result = safeParseEforgeEvent(parsed);
    expect(result.success).toBe(true);
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
      label: 'stack:sync:start — no trigger (manual/default), wet',
      payload: { type: 'stack:sync:start', timestamp: ts, syncId: 'sync-003', dryRun: false },
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

