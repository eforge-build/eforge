import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  daemonReducer,
  initialDaemonState,
  selectLatestSessionId,
  selectAutoBuildEnabled,
  selectQueueItems,
  selectRuns,
  selectDaemonActivity,
  selectHeartbeatStaleness,
  selectStackLayers,
  ACTIVITY_BUFFER_CAP,
  type DaemonState,
  type HeartbeatPayload,
} from '../daemon-reducer';
import type { EforgeEvent } from '../types';
import type { AutoBuildState } from '../api';
import type { QueueItem, StackLayerWire } from '../types';
import {
  makeAutoBuildState,
  makeEvent,
  makeQueueItem,
  makeRun,
  makeStackLayer,
} from './daemon-reducer-test-helpers';

describe('ADD_EVENT: daemon:recovery events', () => {
  it('appends daemon:recovery:start to daemonActivity', () => {
    const event = makeEvent('daemon:recovery:start', {});
    const next = daemonReducer(initialDaemonState, { type: 'ADD_EVENT', event, eventId: 'e1' });
    expect(next.daemonActivity).toHaveLength(1);
  });

  it('appends daemon:recovery:run-marked-failed to daemonActivity', () => {
    const event = makeEvent('daemon:recovery:run-marked-failed', {
      runId: 'run-1',
      planSet: 'my-set',
      reason: 'orphaned',
    });
    const next = daemonReducer(initialDaemonState, { type: 'ADD_EVENT', event, eventId: 'e2' });
    expect(next.daemonActivity).toHaveLength(1);
  });

  it('appends daemon:recovery:lock-removed to daemonActivity', () => {
    const event = makeEvent('daemon:recovery:lock-removed', {
      path: '/tmp/eforge.lock',
      pid: 999,
    });
    const next = daemonReducer(initialDaemonState, { type: 'ADD_EVENT', event, eventId: 'e3' });
    expect(next.daemonActivity).toHaveLength(1);
  });

  it('appends daemon:recovery:complete to daemonActivity', () => {
    const event = makeEvent('daemon:recovery:complete', {
      runsFailed: 1,
      locksRemoved: 1,
      durationMs: 50,
    });
    const next = daemonReducer(initialDaemonState, { type: 'ADD_EVENT', event, eventId: 'e4' });
    expect(next.daemonActivity).toHaveLength(1);
  });
});

describe('ADD_EVENT: daemon:orphan:reaped', () => {
  it('appends to daemonActivity', () => {
    const event = makeEvent('daemon:orphan:reaped', {
      runId: 'run-1',
      sessionId: 'session-99',
      planSet: 'my-set',
      pid: 1234,
    });
    const next = daemonReducer(initialDaemonState, { type: 'ADD_EVENT', event, eventId: 'e1' });
    expect(next.daemonActivity).toHaveLength(1);
    expect(next.daemonActivity[0].event.type).toBe('daemon:orphan:reaped');
  });
});

describe('ADD_EVENT: daemon:warning / daemon:error', () => {
  it('appends daemon:warning to daemonActivity', () => {
    const event = makeEvent('daemon:warning', {
      source: 'scheduler',
      message: 'high queue depth',
    });
    const next = daemonReducer(initialDaemonState, { type: 'ADD_EVENT', event, eventId: 'e1' });
    expect(next.daemonActivity).toHaveLength(1);
  });

  it('appends daemon:error to daemonActivity', () => {
    const event = makeEvent('daemon:error', {
      source: 'db',
      message: 'write failed',
      stack: 'Error: ...',
    });
    const next = daemonReducer(initialDaemonState, { type: 'ADD_EVENT', event, eventId: 'e1' });
    expect(next.daemonActivity).toHaveLength(1);
  });
});

describe('BATCH_SEED: stackLayers seeding', () => {
  it('seeds stackLayers from the snapshot', () => {
    const layers = [makeStackLayer({ prdId: 'prd-seed-1' })];
    const state = daemonReducer(initialDaemonState, {
      type: 'BATCH_SEED',
      runs: [],
      queue: [],
      sessionMetadata: {},
      autoBuild: null,
      stackLayers: layers,
    });
    expect(state.stackLayers).toEqual(layers);
  });

  it('initialDaemonState.stackLayers is an empty array', () => {
    expect(initialDaemonState.stackLayers).toEqual([]);
  });

  it('preserves existing stackLayers when stackLayers is omitted in BATCH_SEED', () => {
    const existing = [makeStackLayer({ prdId: 'prd-existing' })];
    const startState = { ...initialDaemonState, stackLayers: existing };
    const next = daemonReducer(startState, {
      type: 'BATCH_SEED',
      runs: [],
      queue: [],
      sessionMetadata: {},
      autoBuild: null,
      // stackLayers omitted
    });
    expect(next.stackLayers).toEqual(existing);
  });

  it('replaces stackLayers with an empty array when snapshot has []', () => {
    const existing = [makeStackLayer({ prdId: 'prd-old' })];
    const startState = { ...initialDaemonState, stackLayers: existing };
    const next = daemonReducer(startState, {
      type: 'BATCH_SEED',
      runs: [],
      queue: [],
      sessionMetadata: {},
      autoBuild: null,
      stackLayers: [],
    });
    expect(next.stackLayers).toEqual([]);
  });
});

describe('ADD_EVENT: stack:layer:recorded — live projection', () => {
  it('appends a new layer when the prdId is not yet in the list', () => {
    const event = makeEvent('stack:layer:recorded', {
      prdId: 'prd-new',
      stackId: 'stack-xyz',
      provider: 'git-spice',
      branch: 'feat/prd-new',
      baseBranch: 'main',
      artifact: { branch: 'feat/prd-new', commitSha: 'abc123' },
      landingAction: 'pr',
      status: 'pending',
    });

    const next = daemonReducer(initialDaemonState, { type: 'ADD_EVENT', event, eventId: 'e1' });

    expect(next.stackLayers).toHaveLength(1);
    expect(next.stackLayers[0]).toMatchObject({
      prdId: 'prd-new',
      stackId: 'stack-xyz',
      provider: 'git-spice',
      branch: 'feat/prd-new',
      baseBranch: 'main',
      artifact: { branch: 'feat/prd-new', commitSha: 'abc123' },
      landingAction: 'pr',
      status: 'pending',
    });
    expect(next.daemonActivity).toHaveLength(1);
    expect(next.daemonActivity[0].id).toBe('e1');
  });

  it('updates an existing layer by prdId', () => {
    const existing = makeStackLayer({ prdId: 'prd-update', status: 'pending', branch: 'feat/old' });
    const startState = { ...initialDaemonState, stackLayers: [existing] };

    const event = makeEvent('stack:layer:recorded', {
      prdId: 'prd-update',
      stackId: 'stack-abc',
      provider: 'git-spice',
      branch: 'feat/new',
      status: 'building',
    });

    const next = daemonReducer(startState, { type: 'ADD_EVENT', event, eventId: 'e2' });

    expect(next.stackLayers).toHaveLength(1);
    expect(next.stackLayers[0]).toMatchObject({
      prdId: 'prd-update',
      branch: 'feat/new',
      status: 'building',
    });
  });

  it('leaves other layers untouched when updating one', () => {
    const layer1 = makeStackLayer({ prdId: 'prd-a' });
    const layer2 = makeStackLayer({ prdId: 'prd-b', status: 'building' });
    const startState = { ...initialDaemonState, stackLayers: [layer1, layer2] };

    const event = makeEvent('stack:layer:recorded', {
      prdId: 'prd-a',
      stackId: 'stack-abc',
      provider: 'git-spice',
      branch: 'feat/prd-a',
      status: 'built',
    });

    const next = daemonReducer(startState, { type: 'ADD_EVENT', event, eventId: 'e3' });

    expect(next.stackLayers).toHaveLength(2);
    expect(next.stackLayers[0]?.status).toBe('built');
    expect(next.stackLayers[1]).toEqual(layer2);
  });
});

describe('ADD_EVENT: stack:landing:update — live projection', () => {
  it('attaches landing data to an existing layer', () => {
    const existing = makeStackLayer({ prdId: 'prd-land' });
    const startState = { ...initialDaemonState, stackLayers: [existing] };

    const event = makeEvent('stack:landing:update', {
      prdId: 'prd-land',
      stackId: 'stack-abc',
      action: 'pr',
      branch: 'feat/prd-land',
      status: 'started',
    });

    const next = daemonReducer(startState, { type: 'ADD_EVENT', event, eventId: 'e1' });

    expect(next.stackLayers[0]?.landing).toMatchObject({
      action: 'pr',
      status: 'started',
    });
    expect(next.daemonActivity).toHaveLength(1);
  });

  it('updates landing with prUrl when status is complete', () => {
    const existing = makeStackLayer({ prdId: 'prd-land-complete' });
    const startState = { ...initialDaemonState, stackLayers: [existing] };

    // First: start the landing
    const startEvent = makeEvent('stack:landing:update', {
      prdId: 'prd-land-complete',
      stackId: 'stack-abc',
      action: 'pr',
      branch: 'feat/prd-land-complete',
      status: 'started',
    });
    const s1 = daemonReducer(startState, { type: 'ADD_EVENT', event: startEvent, eventId: 'e1' });

    // Then: complete with a PR URL
    const completeEvent = makeEvent('stack:landing:update', {
      prdId: 'prd-land-complete',
      stackId: 'stack-abc',
      action: 'pr',
      branch: 'feat/prd-land-complete',
      status: 'complete',
      prUrl: 'https://github.com/org/repo/pull/99',
    });
    const s2 = daemonReducer(s1, { type: 'ADD_EVENT', event: completeEvent, eventId: 'e2' });

    expect(s2.stackLayers[0]?.landing).toMatchObject({
      action: 'pr',
      status: 'complete',
      prUrl: 'https://github.com/org/repo/pull/99',
    });
  });

  it('is a no-op (but still appends to activity) when prdId is not found', () => {
    const existing = makeStackLayer({ prdId: 'prd-other' });
    const startState = { ...initialDaemonState, stackLayers: [existing] };

    const event = makeEvent('stack:landing:update', {
      prdId: 'prd-unknown',
      stackId: 'stack-xyz',
      action: 'pr',
      branch: 'feat/unknown',
      status: 'started',
    });

    const next = daemonReducer(startState, { type: 'ADD_EVENT', event, eventId: 'e1' });

    // Layer unchanged
    expect(next.stackLayers[0]).toEqual(existing);
    // Activity still appended
    expect(next.daemonActivity).toHaveLength(1);
  });

  it('complete: transitions layer status to landed and preserves prUrl', () => {
    const existing = makeStackLayer({ prdId: 'prd-complete', status: 'built' });
    const startState = { ...initialDaemonState, stackLayers: [existing] };

    const event = makeEvent('stack:landing:update', {
      prdId: 'prd-complete',
      stackId: 'stack-abc',
      action: 'pr',
      branch: 'feat/prd-complete',
      status: 'complete',
      prUrl: 'https://github.com/org/repo/pull/42',
    });

    const next = daemonReducer(startState, { type: 'ADD_EVENT', event, eventId: 'e1' });

    expect(next.stackLayers[0]?.status).toBe('landed');
    expect(next.stackLayers[0]?.landing?.prUrl).toBe('https://github.com/org/repo/pull/42');
  });

  it('complete + merge: transitions layer status to merged', () => {
    const existing = makeStackLayer({ prdId: 'prd-merge-complete', status: 'built' });
    const startState = { ...initialDaemonState, stackLayers: [existing] };

    const event = makeEvent('stack:landing:update', {
      prdId: 'prd-merge-complete',
      stackId: 'stack-abc',
      action: 'merge',
      branch: 'feat/prd-merge-complete',
      status: 'complete',
    });

    const next = daemonReducer(startState, { type: 'ADD_EVENT', event, eventId: 'e1' });

    expect(next.stackLayers[0]?.status).toBe('merged');
  });

  it('failed: transitions layer status to failed', () => {
    const existing = makeStackLayer({ prdId: 'prd-fail', status: 'built' });
    const startState = { ...initialDaemonState, stackLayers: [existing] };

    const event = makeEvent('stack:landing:update', {
      prdId: 'prd-fail',
      stackId: 'stack-abc',
      action: 'pr',
      branch: 'feat/prd-fail',
      status: 'failed',
      reason: 'git-spice submit failed',
    });

    const next = daemonReducer(startState, { type: 'ADD_EVENT', event, eventId: 'e1' });

    expect(next.stackLayers[0]?.status).toBe('failed');
    expect(next.stackLayers[0]?.landing?.reason).toBe('git-spice submit failed');
  });

  it('skipped + merge: transitions layer status to merged', () => {
    const existing = makeStackLayer({ prdId: 'prd-merge', status: 'built' });
    const startState = { ...initialDaemonState, stackLayers: [existing] };

    const event = makeEvent('stack:landing:update', {
      prdId: 'prd-merge',
      stackId: 'stack-abc',
      action: 'merge',
      branch: 'feat/prd-merge',
      status: 'skipped',
      reason: "Landing action is 'merge', not 'pr'",
    });

    const next = daemonReducer(startState, { type: 'ADD_EVENT', event, eventId: 'e1' });

    expect(next.stackLayers[0]?.status).toBe('merged');
  });

  it('skipped + leave: transitions layer status to landed', () => {
    const existing = makeStackLayer({ prdId: 'prd-leave', status: 'built' });
    const startState = { ...initialDaemonState, stackLayers: [existing] };

    const event = makeEvent('stack:landing:update', {
      prdId: 'prd-leave',
      stackId: 'stack-abc',
      action: 'leave',
      branch: 'feat/prd-leave',
      status: 'skipped',
      reason: "Landing action is 'leave', not 'pr'",
    });

    const next = daemonReducer(startState, { type: 'ADD_EVENT', event, eventId: 'e1' });

    expect(next.stackLayers[0]?.status).toBe('landed');
  });

  it('skipped + pr: transitions layer status to failed (pre-landing skip)', () => {
    const existing = makeStackLayer({ prdId: 'prd-preabort', status: 'built' });
    const startState = { ...initialDaemonState, stackLayers: [existing] };

    const event = makeEvent('stack:landing:update', {
      prdId: 'prd-preabort',
      stackId: 'stack-abc',
      action: 'pr',
      branch: 'feat/prd-preabort',
      status: 'skipped',
      reason: 'Build failed before landing',
    });

    const next = daemonReducer(startState, { type: 'ADD_EVENT', event, eventId: 'e1' });

    expect(next.stackLayers[0]?.status).toBe('failed');
  });

  it('started: does not change layer status', () => {
    const existing = makeStackLayer({ prdId: 'prd-start', status: 'built' });
    const startState = { ...initialDaemonState, stackLayers: [existing] };

    const event = makeEvent('stack:landing:update', {
      prdId: 'prd-start',
      stackId: 'stack-abc',
      action: 'pr',
      branch: 'feat/prd-start',
      status: 'started',
    });

    const next = daemonReducer(startState, { type: 'ADD_EVENT', event, eventId: 'e1' });

    expect(next.stackLayers[0]?.status).toBe('built');
    expect(next.stackLayers[0]?.landing?.status).toBe('started');
  });
});

describe('selectStackLayers', () => {
  it('returns the stackLayers array', () => {
    const layers = [makeStackLayer({ prdId: 'prd-sel-1' })];
    const state: DaemonState = { ...initialDaemonState, stackLayers: layers };
    expect(selectStackLayers(state)).toBe(layers);
  });

  it('returns [] from initialDaemonState', () => {
    expect(selectStackLayers(initialDaemonState)).toEqual([]);
  });
});
