import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db.js';
import { buildRunSummary as projectionBuildRunSummary } from '../projections/run-summary.js';
import { buildRunSummary as serverBuildRunSummary } from '../server.js';

const ts = '2025-01-01T00:00:00.000Z';
function event(type: string, data: Record<string, unknown>): string { return JSON.stringify({ type, timestamp: ts, ...data }); }

describe('run summary projection', () => {
  it('matches the compatibility server export for seeded plan lifecycle state', () => {
    const db = openDatabase(':memory:');
    db.insertRun({ id: 'r1', sessionId: 's1', planSet: 'set', command: 'build', status: 'running', startedAt: ts, cwd: process.cwd() });
    db.insertEvent({ runId: 'r1', type: 'planning:complete', data: event('planning:complete', { plans: [{ id: 'p1', name: 'P1', body: '# P1', branch: 'b1', dependsOn: ['p0'] }] }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'plan:build:start', planId: 'p1', data: event('plan:build:start', { planId: 'p1' }), timestamp: ts });
    expect(projectionBuildRunSummary(db, 's1')).toEqual(serverBuildRunSummary(db, 's1'));
    db.close();
  });
  it('creates missing entries from build-start and does not create missing failed entries', () => {
    const db = openDatabase(':memory:');
    db.insertRun({ id: 'r1', sessionId: 's1', planSet: 'set', command: 'build', status: 'failed', startedAt: ts, cwd: process.cwd() });
    db.insertEvent({ runId: 'r1', type: 'plan:build:start', planId: 'p1', data: event('plan:build:start', { planId: 'p1' }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'plan:build:failed', planId: 'missing', data: event('plan:build:failed', { planId: 'missing' }), timestamp: ts });
    expect(projectionBuildRunSummary(db, 's1').plans).toEqual([{ id: 'p1', status: 'running', branch: null, dependsOn: [] }]);
    db.close();
  });
  it('uses the latest planning event and reports current phase, active agent, and error counts', () => {
    const db = openDatabase(':memory:');
    db.insertRun({ id: 'r1', sessionId: 's1', planSet: 'set', command: 'build', status: 'running', startedAt: ts, cwd: process.cwd() });
    db.insertEvent({ runId: 'r1', type: 'planning:complete', data: event('planning:complete', { plans: [{ id: 'old', branch: 'old', dependsOn: [] }] }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'planning:complete', data: event('planning:complete', { plans: [{ id: 'new', branch: 'new', dependsOn: ['old'] }] }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'phase:start', data: event('phase:start', { phase: 'review' }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'agent:start', agent: 'builder', data: event('agent:start', { agentId: 'a1', agent: 'builder' }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'agent:start', agent: 'reviewer', data: event('agent:start', { agentId: 'a2', agent: 'reviewer' }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'agent:stop', agent: 'reviewer', data: event('agent:stop', { agentId: 'a2' }), timestamp: ts });
    db.insertEvent({ runId: 'r1', type: 'plan:build:failed', data: event('plan:build:failed', { planId: 'new' }), timestamp: ts });
    const summary = projectionBuildRunSummary(db, 's1');
    expect(summary.plans).toEqual([{ id: 'new', status: 'failed', branch: 'new', dependsOn: ['old'] }]);
    expect(summary.currentPhase).toBe('review');
    expect(summary.currentAgent).toBe('builder');
    expect(summary.eventCounts.errors).toBe(1);
    db.close();
  });
});
