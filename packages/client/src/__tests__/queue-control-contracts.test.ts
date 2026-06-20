import { describe, expect, it } from 'vitest';
import { API_ROUTES, buildPath, safeParseDaemonStreamSnapshot, type QueueCascadeApplyResponse, type QueueCascadePreviewResponse, type QueueHoldResponse, type QueueItemCapabilities } from '../index.js';

const capabilities: QueueItemCapabilities = {
  priority: { allowed: true },
  remove: { allowed: true },
  dependencyOverride: { allowed: false, reason: 'not waiting' },
  hold: { allowed: true },
  unhold: { allowed: false },
  cascadeRemove: { allowed: true },
  cancel: { allowed: true },
  cascadeCancel: { allowed: true },
};

function snapshot(queue: unknown[]) {
  return {
    cursor: 1,
    liveness: { type: 'daemon:heartbeat', timestamp: '2026-06-19T10:00:00.000Z', uptime: 1, queueDepth: 1, runningBuilds: 0, autoBuild: { enabled: true, paused: false }, subscribers: 1 },
    recentActivity: [], runs: [], queue, sessionMetadata: {},
    autoBuild: { enabled: true, watcher: { running: false, pid: null, sessionId: null } },
    stackLayers: [],
      failedEnqueues: [],
  };
}

describe('queue-control contracts', () => {
  it('exposes hold and cascade routes with encoded params', () => {
    expect(API_ROUTES.queueHold).toBe('/api/queue/:prdId/hold');
    expect(API_ROUTES.queueUnhold).toBe('/api/queue/:prdId/unhold');
    expect(API_ROUTES.queueCascadePreview).toBe('/api/queue/:prdId/cascade/preview');
    expect(API_ROUTES.queueCascadeApply).toBe('/api/queue/:prdId/cascade/apply');
    expect(buildPath(API_ROUTES.queueHold, { prdId: 'prd/1' })).toBe('/api/queue/prd%2F1/hold');
  });

  it('supports capability-bearing mutation responses', () => {
    const item = { id: 'prd-1', title: 'PRD 1', status: 'pending', capabilities, hold: { held: true, reason: 'pause' } };
    const hold: QueueHoldResponse = { status: 'held', item, queue: [item] };
    const preview: QueueCascadePreviewResponse = {
      target: { prdId: 'prd-1', title: 'PRD 1', status: 'pending', location: 'queue', dependsOn: [], depth: 0, effect: 'target-remove', blockers: [] },
      dependents: [], safeStrategies: ['target-only'], warnings: [], blockers: [], expectedAffected: { token: 'opaque', prdIds: ['prd-1'] },
    };
    const apply: QueueCascadeApplyResponse = { applied: true, operation: 'remove', strategy: 'target-only', target: { prdId: 'prd-1', previousStatus: 'pending', status: 'removed' }, dependents: [], warnings: [], blockers: [], queue: [item] };
    expect(hold.item.capabilities.remove.allowed).toBe(true);
    expect(preview.expectedAffected.token).toBe('opaque');
    expect(apply.target.status).toBe('removed');
  });

  it('parses queue hold and capability snapshot fields', () => {
    expect(safeParseDaemonStreamSnapshot(snapshot([{ id: 'prd-1', title: 'PRD 1', status: 'pending', hold: { held: true, heldAt: '2026-06-19T10:00:00.000Z' }, capabilities }]))).toMatchObject({ success: true });
    expect(safeParseDaemonStreamSnapshot(snapshot([{ id: 'prd-1', title: 'PRD 1', status: 'pending', capabilities: { priority: { allowed: 'yes' } } }]))).toMatchObject({ success: false });
  });
});
