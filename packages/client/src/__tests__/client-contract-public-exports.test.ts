import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as browser from '../browser.js';
import * as client from '../index.js';
import * as eventSchemas from '../events.js';
import type {
  FailedEnqueueReenqueueRequest,
  FailedEnqueueReenqueueResponse,
  FailedEnqueuesResponse,
  QueueCascadeApplyRequest,
  QueueCascadeApplyResponse,
  QueueCascadePreviewRequest,
  QueueCascadePreviewResponse,
  QueueHoldRequest,
  QueueHoldResponse,
  QueueUnholdRequest,
  QueueUnholdResponse,
  RecoveryGuidancePrepareRequest,
  RecoveryGuidancePrepareResponse,
  SchedulerPauseResponse,
  SchedulerResumeResponse,
} from '../routes.js';
import type {
  FailedEnqueueInfo,
  QueueItemCapabilities,
  QueueItemHold,
  QueueItemWithCapabilities,
} from '../types.js';

const capabilities: QueueItemCapabilities = {
  priority: { allowed: true },
  remove: { allowed: true },
  dependencyOverride: { allowed: true },
  hold: { allowed: true },
  unhold: { allowed: true },
  cascadeRemove: { allowed: true },
  cancel: { allowed: true },
  cascadeCancel: { allowed: true },
};

const held: QueueItemHold = { held: true, reason: 'operator pause', heldAt: '2026-06-19T10:00:00.000Z' };
const queueItem: QueueItemWithCapabilities = { id: 'prd-1', title: 'PRD 1', status: 'pending', hold: held, capabilities };
const failedEnqueue: FailedEnqueueInfo = {
  runId: 'run-1',
  sourceLabel: 'prd.md',
  provenance: { label: 'prd.md' },
  failureReason: 'enqueue failed',
  failedAt: '2026-06-19T10:00:00.000Z',
  canReenqueue: true,
  nextCommand: { executable: 'eforge', args: ['enqueue', 'prd.md'] },
};

describe('client contract public exports', () => {
  it('exports all new browser helpers from the browser-safe facade', () => {
    expect(browser.prepareRecoveryGuidance).toEqual(expect.any(Function));
    expect(browser.holdQueueItem).toEqual(expect.any(Function));
    expect(browser.unholdQueueItem).toEqual(expect.any(Function));
    expect(browser.previewQueueCascade).toEqual(expect.any(Function));
    expect(browser.applyQueueCascade).toEqual(expect.any(Function));
    expect(browser.fetchFailedEnqueues).toEqual(expect.any(Function));
    expect(browser.reenqueueFailedEnqueue).toEqual(expect.any(Function));
    expect(browser.pauseScheduler).toEqual(expect.any(Function));
    expect(browser.resumeScheduler).toEqual(expect.any(Function));
  });

  it('exports all new node helpers from the main facade', () => {
    expect(client.apiPrepareRecoveryGuidance).toEqual(expect.any(Function));
    expect(client.apiPrepareRecoveryGuidanceIfRunning).toEqual(expect.any(Function));
    expect(client.apiHoldQueueItem).toEqual(expect.any(Function));
    expect(client.apiHoldQueueItemIfRunning).toEqual(expect.any(Function));
    expect(client.apiUnholdQueueItem).toEqual(expect.any(Function));
    expect(client.apiUnholdQueueItemIfRunning).toEqual(expect.any(Function));
    expect(client.apiPreviewQueueCascade).toEqual(expect.any(Function));
    expect(client.apiPreviewQueueCascadeIfRunning).toEqual(expect.any(Function));
    expect(client.apiApplyQueueCascade).toEqual(expect.any(Function));
    expect(client.apiApplyQueueCascadeIfRunning).toEqual(expect.any(Function));
    expect(client.apiGetFailedEnqueues).toEqual(expect.any(Function));
    expect(client.apiGetFailedEnqueuesIfRunning).toEqual(expect.any(Function));
    expect(client.apiReenqueueFailedEnqueue).toEqual(expect.any(Function));
    expect(client.apiReenqueueFailedEnqueueIfRunning).toEqual(expect.any(Function));
    expect(client.apiSchedulerPause).toEqual(expect.any(Function));
    expect(client.apiSchedulerPauseIfRunning).toEqual(expect.any(Function));
    expect(client.apiSchedulerResume).toEqual(expect.any(Function));
    expect(client.apiSchedulerResumeIfRunning).toEqual(expect.any(Function));
  });

  it('keeps new request and response wire types exportable from the route barrel', () => {
    const recoveryRequest: RecoveryGuidancePrepareRequest = { prdId: 'prd-1', setName: 'set-a' };
    const recoveryResponse: RecoveryGuidancePrepareResponse = {
      prdId: recoveryRequest.prdId,
      setName: 'set-a',
      featureBranch: 'feature/prd-1',
      baseBranch: 'main',
      outputDir: 'eforge/plans/set-a',
      sidecarPath: '.eforge/queue/failed/prd-1.recovery.json',
      sidecarGeneratedAt: '2026-06-19T10:00:00.000Z',
      plans: [{ planId: 'plan-1', path: 'eforge/plans/set-a/plan-1.md', status: 'already-current' }],
    };
    const holdRequest: QueueHoldRequest = { reason: 'operator pause' };
    const holdResponse: QueueHoldResponse = { status: 'held', item: queueItem, queue: [queueItem] };
    const unholdRequest: QueueUnholdRequest = {};
    const unholdResponse: QueueUnholdResponse = { status: 'unheld', item: queueItem, queue: [queueItem] };
    const previewRequest: QueueCascadePreviewRequest = { operation: 'remove' };
    const previewResponse: QueueCascadePreviewResponse = {
      target: { prdId: 'prd-1', title: 'PRD 1', status: 'pending', location: 'queue', dependsOn: [], depth: 0, effect: 'target-remove', blockers: [] },
      dependents: [],
      safeStrategies: ['target-only'],
      warnings: [],
      blockers: [],
      expectedAffected: { token: 'opaque', prdIds: ['prd-1'] },
    };
    const applyRequest: QueueCascadeApplyRequest = { operation: 'remove', strategy: 'target-only', expectedAffected: previewResponse.expectedAffected, confirmDependents: false };
    const applyResponse: QueueCascadeApplyResponse = {
      applied: true,
      operation: applyRequest.operation,
      strategy: applyRequest.strategy,
      target: { prdId: 'prd-1', previousStatus: 'pending', status: 'removed' },
      dependents: [],
      warnings: [],
      blockers: [],
      queue: [],
    };
    const failedList: FailedEnqueuesResponse = [failedEnqueue];
    const reenqueueRequest: FailedEnqueueReenqueueRequest = { confirm: true };
    const reenqueueResponse: FailedEnqueueReenqueueResponse = { enqueued: true, failedEnqueue, queue: [queueItem], runs: [], newRunId: 'run-2' };
    const pauseResponse: SchedulerPauseResponse = { enabled: true, watcher: { running: false, pid: null, sessionId: null } };
    const resumeResponse: SchedulerResumeResponse = pauseResponse;

    expect({ recoveryResponse, holdRequest, holdResponse, unholdRequest, unholdResponse, previewRequest, applyResponse, failedList, reenqueueRequest, reenqueueResponse, resumeResponse }).toMatchObject({
      recoveryResponse: { plans: [{ status: 'already-current' }] },
      holdResponse: { item: { capabilities } },
      applyResponse: { target: { status: 'removed' } },
      reenqueueResponse: { newRunId: 'run-2' },
      resumeResponse: pauseResponse,
    });
  });

  it('exports reusable schema symbols through the browser-safe events barrel', () => {
    expect(eventSchemas.QueueItemCapabilitySchema).toBeDefined();
    expect(eventSchemas.QueueItemCapabilitiesSchema).toBeDefined();
    expect(eventSchemas.QueueItemHoldSchema).toBeDefined();
    expect(eventSchemas.FailedEnqueueInfoSchema).toBeDefined();
  });

  it('bumps the daemon API version for the Console feature gate', () => {
    expect(client.DAEMON_API_VERSION).toBe(72);
    expect(browser.DAEMON_API_VERSION).toBe(72);
    const source = readFileSync('packages/client/src/api-version-const.ts', 'utf8');
    expect(source).toContain('Console feature gate');
    expect(source).toContain('failed-enqueue projections');
  });
});
