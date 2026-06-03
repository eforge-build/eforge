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
import { makeAutoBuildState, makeEvent, makeQueueItem, makeRun } from './daemon-reducer-test-helpers';

  describe('ADD_EVENT: daemon:auto-build:paused', () => {
    it('sets autoBuild.enabled to false', () => {
      const state: DaemonState = {
        ...initialDaemonState,
        autoBuild: makeAutoBuildState(true),
      };
      const event = makeEvent('daemon:auto-build:paused', { reason: 'Build failed' });

      const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

      expect(next.autoBuild?.enabled).toBe(false);
    });

    it('leaves autoBuild null when autoBuild is null but still appends to activity', () => {
      const state: DaemonState = { ...initialDaemonState, autoBuild: null };
      const event = makeEvent('daemon:auto-build:paused', { reason: 'whatever' });

      const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

      expect(next.autoBuild).toBeNull();
      expect(next.daemonActivity).toHaveLength(1);
      expect(next.daemonActivity[0].id).toBe('e1');
    });
  });

  describe('SET_AUTO_BUILD', () => {
    it('replaces the autoBuild slice', () => {
      const newState = makeAutoBuildState(false);
      const next = daemonReducer(initialDaemonState, {
        type: 'SET_AUTO_BUILD',
        autoBuild: newState,
      });
      expect(next.autoBuild).toEqual(newState);
    });

    it('accepts null to clear autoBuild', () => {
      const state: DaemonState = { ...initialDaemonState, autoBuild: makeAutoBuildState() };
      const next = daemonReducer(state, { type: 'SET_AUTO_BUILD', autoBuild: null });
      expect(next.autoBuild).toBeNull();
    });
  });

  describe('SET_CONNECTION_STATUS', () => {
    it('updates connectionStatus', () => {
      const next = daemonReducer(initialDaemonState, {
        type: 'SET_CONNECTION_STATUS',
        status: 'connected',
      });
      expect(next.connectionStatus).toBe('connected');
    });
  });

describe('selectLatestSessionId', () => {
  it('returns the sessionId of runs[0]', () => {
    const run = makeRun({ sessionId: 'latest-session' });
    const state: DaemonState = { ...initialDaemonState, runs: [run] };
    expect(selectLatestSessionId(state)).toBe('latest-session');
  });

  it('returns null when runs is empty', () => {
    expect(selectLatestSessionId(initialDaemonState)).toBeNull();
  });
});

describe('selectAutoBuildEnabled', () => {
  it('returns true when autoBuild.enabled is true', () => {
    const state: DaemonState = { ...initialDaemonState, autoBuild: makeAutoBuildState(true) };
    expect(selectAutoBuildEnabled(state)).toBe(true);
  });

  it('returns false when autoBuild is null', () => {
    expect(selectAutoBuildEnabled(initialDaemonState)).toBe(false);
  });
});

describe('selectQueueItems', () => {
  it('returns the queue array', () => {
    const queue = [makeQueueItem()];
    const state: DaemonState = { ...initialDaemonState, queue };
    expect(selectQueueItems(state)).toBe(queue);
  });
});

describe('selectRuns', () => {
  it('returns the runs array', () => {
    const runs = [makeRun()];
    const state: DaemonState = { ...initialDaemonState, runs };
    expect(selectRuns(state)).toBe(runs);
  });
});
