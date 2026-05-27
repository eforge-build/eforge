// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { classifyFamily, classifyAttention } from '../selectors';
import type { EforgeEvent } from '@eforge-build/client/browser';

function makeEvent(type: string, extra: Record<string, unknown> = {}): EforgeEvent {
  return { type, ...extra } as unknown as EforgeEvent;
}

// ---------------------------------------------------------------------------
// classifyFamily
// ---------------------------------------------------------------------------

describe('classifyFamily (drawer re-export)', () => {
  it('classifies agent:start as agent', () => {
    expect(classifyFamily(makeEvent('agent:start'))).toBe('agent');
  });

  it('classifies session:start as session', () => {
    expect(classifyFamily(makeEvent('session:start'))).toBe('session');
  });

  it('classifies plan:build:progress as session', () => {
    expect(classifyFamily(makeEvent('plan:build:progress'))).toBe('session');
  });

  it('classifies queue:item:added as scheduler', () => {
    expect(classifyFamily(makeEvent('queue:item:added'))).toBe('scheduler');
  });

  it('classifies daemon:heartbeat as daemon', () => {
    expect(classifyFamily(makeEvent('daemon:heartbeat'))).toBe('daemon');
  });

  it('classifies extension:run as extension', () => {
    expect(classifyFamily(makeEvent('extension:run'))).toBe('extension');
  });

  it('classifies stack:landing:start as stack', () => {
    expect(classifyFamily(makeEvent('stack:landing:start'))).toBe('stack');
  });

  it('classifies enqueue:prd as queue', () => {
    expect(classifyFamily(makeEvent('enqueue:prd'))).toBe('queue');
  });

  it('classifies unknown event type as other', () => {
    expect(classifyFamily(makeEvent('unknown:custom:event'))).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// classifyAttention
// ---------------------------------------------------------------------------

describe('classifyAttention (drawer re-export)', () => {
  it('returns true for event types containing "error"', () => {
    expect(classifyAttention(makeEvent('daemon:error'))).toBe(true);
  });

  it('returns true for event types containing "failed"', () => {
    expect(classifyAttention(makeEvent('plan:build:failed'))).toBe(true);
  });

  it('returns true for events with status "failed"', () => {
    expect(classifyAttention(makeEvent('plan:status:change', { status: 'failed' }))).toBe(true);
  });

  it('returns false for normal events', () => {
    expect(classifyAttention(makeEvent('session:start'))).toBe(false);
  });
});
