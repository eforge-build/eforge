// --- eforge:region event-schema-tests ---

/**
 * Tests for the TypeBox-based wire event schemas.
 *
 * Focused core/lifecycle coverage. Domain-specific event suites live beside
 * this file as events-schemas-*.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { safeParseEforgeEvent } from '../events.schemas.js';
import { DAEMON_EVENT_TYPES, eventRegistry, isPersistedDaemonEventType } from '../event-registry.js';
import type { EforgeEvent } from '../events.schemas.js';
import { extensionDiagnosticVariants, extensionPolicyGateMatrixVariants, extensionPolicyVariants } from './events-schema-test-helpers.js';

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

  it('accepts phase:start with continue-repair command', () => {
    const result = safeParseEforgeEvent({
      type: 'phase:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      runId: 'run-1',
      planSet: 'feature-x',
      command: 'continue-repair',
    });
    expect(result.success).toBe(true);
  });

  it('rejects phase:start with resume command', () => {
    const result = safeParseEforgeEvent({
      type: 'phase:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      runId: 'run-1',
      planSet: 'feature-x',
      command: 'resume',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Event registry metadata
// ---------------------------------------------------------------------------

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
      runtimeChoice: 'default',
      runtimeChoiceQualified: 'standard.default',
      runtimeChoiceSource: 'default',
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
      runtimeChoice: 'default',
      runtimeChoiceQualified: 'fast.default',
      runtimeChoiceSource: 'default',
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
      runtimeChoice: 'default',
      runtimeChoiceQualified: 'standard.default',
      runtimeChoiceSource: 'default',
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
// Queue dependency projection
// ---------------------------------------------------------------------------

describe('eventRegistry — live queue dependency projectors', () => {
  const baseState = {
    runs: [],
    queue: [],
    autoBuild: null,
    latestHeartbeat: null,
    stackLayers: [],
  };

  it('projects queue:prd:discovered dependsOn into an empty queue', () => {
    const project = eventRegistry['queue:prd:discovered'].project!;
    const delta = project({
      type: 'queue:prd:discovered',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'child-prd',
      title: 'Child PRD',
      dependsOn: ['parent-prd'],
    }, baseState);

    expect(delta?.queue?.[0]).toEqual({
      id: 'child-prd',
      title: 'Child PRD',
      status: 'pending',
      dependsOn: ['parent-prd'],
    });
  });

  it('merges discovered dependencies into an existing enqueue-complete queue row', () => {
    const project = eventRegistry['queue:prd:discovered'].project!;
    const delta = project({
      type: 'queue:prd:discovered',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'child-prd',
      title: 'Child PRD',
      dependsOn: ['parent-prd'],
    }, {
      ...baseState,
      queue: [{ id: 'child-prd', title: 'Enqueued title', status: 'pending' }],
    });

    expect(delta?.queue?.[0]).toEqual({
      id: 'child-prd',
      title: 'Child PRD',
      status: 'pending',
      dependsOn: ['parent-prd'],
    });
  });

  it('unions dependency-blocked ids into an existing queue row without dropping existing dependencies', () => {
    const project = eventRegistry['daemon:scheduler:dependency-blocked'].project!;
    const delta = project({
      type: 'daemon:scheduler:dependency-blocked',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'child-prd',
      blockedBy: ['parent-prd', 'sibling-prd'],
    }, {
      ...baseState,
      queue: [{ id: 'child-prd', title: 'Child PRD', status: 'pending', dependsOn: ['existing-prd', 'parent-prd'] }],
    });

    expect(delta?.queue?.[0]?.dependsOn).toEqual(['existing-prd', 'parent-prd', 'sibling-prd']);
  });

  it('does not reintroduce dependencies on terminal queue rows', () => {
    const project = eventRegistry['daemon:scheduler:dependency-blocked'].project!;
    const delta = project({
      type: 'daemon:scheduler:dependency-blocked',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'child-prd',
      blockedBy: ['parent-prd'],
    }, {
      ...baseState,
      queue: [{ id: 'child-prd', title: 'Child PRD', status: 'failed' }],
    });

    expect(delta).toBeUndefined();
  });

  it('accepts and registers queue dependency override audit events', () => {
    const event = {
      type: 'queue:prd:dependency-overridden',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'child-prd',
      title: 'Child PRD',
      removedDependency: 'parent-prd',
      previousDependsOn: ['parent-prd', 'other-prd'],
      currentDependsOn: ['other-prd'],
      reason: 'operator approved',
    } as const;
    expect(safeParseEforgeEvent(event).success).toBe(true);
    expect(eventRegistry['queue:prd:dependency-overridden']).toMatchObject({ scope: 'daemon', persist: true });
    expect(DAEMON_EVENT_TYPES).toContain('queue:prd:dependency-overridden');
    expect(isPersistedDaemonEventType('queue:prd:dependency-overridden')).toBe(true);
  });

  it('projects queue dependency overrides into existing queue item dependsOn metadata', () => {
    const project = eventRegistry['queue:prd:dependency-overridden'].project!;
    const delta = project({
      type: 'queue:prd:dependency-overridden',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'child-prd',
      title: 'Child PRD',
      removedDependency: 'parent-prd',
      previousDependsOn: ['parent-prd', 'other-prd'],
      currentDependsOn: ['other-prd'],
    }, {
      ...baseState,
      queue: [{ id: 'child-prd', title: 'Child PRD', status: 'pending', dependsOn: ['parent-prd', 'other-prd'] }],
    });
    expect(delta?.queue?.[0]?.dependsOn).toEqual(['other-prd']);
  });

  it('removes dependsOn metadata and marks waiting items pending when an override clears the final dependency', () => {
    const project = eventRegistry['queue:prd:dependency-overridden'].project!;
    const delta = project({
      type: 'queue:prd:dependency-overridden',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'child-prd',
      title: 'Child PRD',
      removedDependency: 'parent-prd',
      previousDependsOn: ['parent-prd'],
      currentDependsOn: [],
    }, {
      ...baseState,
      queue: [{ id: 'child-prd', title: 'Child PRD', status: 'waiting', dependsOn: ['parent-prd'] }],
    });
    expect(delta?.queue?.[0]).toEqual({ id: 'child-prd', title: 'Child PRD', status: 'pending' });
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

  it('returns true for extension action lifecycle event types', () => {
    expect(isPersistedDaemonEventType('extension:action:start')).toBe(true);
    expect(isPersistedDaemonEventType('extension:action:complete')).toBe(true);
    expect(isPersistedDaemonEventType('extension:action:failed')).toBe(true);
    expect(isPersistedDaemonEventType('extension:action:timeout')).toBe(true);
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

// --- eforge:endregion event-schema-tests ---
