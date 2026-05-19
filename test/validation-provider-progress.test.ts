/**
 * Tests for event-to-progress mapping of extension:validation-provider:* events.
 *
 * Asserts that:
 * - extension:validation-provider:error produces a non-null ProgressUpdate
 * - extension:validation-provider:timeout produces a non-null ProgressUpdate
 * - extension:validation-provider:complete with status: 'passed' returns null (filtered)
 * - extension:validation-provider:start returns null (filtered)
 */

import { describe, it, expect } from 'vitest';
import { eventToProgress, type FollowCounters } from '../packages/client/src/event-to-progress.js';
import type { DaemonStreamEvent } from '../packages/client/src/session-stream.js';

const ZERO_COUNTERS: FollowCounters = { filesChanged: 0 };

// Helper: cast a partial event shape to DaemonStreamEvent for testing
function asEvent(partial: Record<string, unknown>): DaemonStreamEvent {
  return partial as unknown as DaemonStreamEvent;
}

describe('eventToProgress — extension:validation-provider:* family', () => {
  it('extension:validation-provider:error produces a non-null update with provider name and message', () => {
    const event = asEvent({
      type: 'extension:validation-provider:error',
      planId: 'plan-01',
      providerName: 'type-check-gate',
      extensionName: 'my-extension',
      extensionPath: '/project/.eforge/extensions/my-extension.js',
      status: 'failed',
      message: 'TypeScript type checking failed',
    });

    const result = eventToProgress(event, ZERO_COUNTERS);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('type-check-gate');
    expect(result!.message).toContain('my-extension');
    expect(result!.message).toContain('TypeScript type checking failed');
    expect(result!.counters).toEqual(ZERO_COUNTERS);
  });

  it('extension:validation-provider:timeout produces a non-null update with provider name and timeout', () => {
    const event = asEvent({
      type: 'extension:validation-provider:timeout',
      planId: 'plan-01',
      providerName: 'lint-gate',
      extensionName: 'my-extension',
      extensionPath: '/project/.eforge/extensions/my-extension.js',
      timeoutMs: 30000,
    });

    const result = eventToProgress(event, ZERO_COUNTERS);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('lint-gate');
    expect(result!.message).toContain('30000');
    expect(result!.counters).toEqual(ZERO_COUNTERS);
  });

  it('extension:validation-provider:complete with status: passed returns null (filtered)', () => {
    const event = asEvent({
      type: 'extension:validation-provider:complete',
      planId: 'plan-01',
      providerName: 'type-check-gate',
      extensionName: 'my-extension',
      extensionPath: '/project/.eforge/extensions/my-extension.js',
      status: 'passed',
    });

    const result = eventToProgress(event, ZERO_COUNTERS);
    expect(result).toBeNull();
  });

  it('extension:validation-provider:start returns null (filtered)', () => {
    const event = asEvent({
      type: 'extension:validation-provider:start',
      planId: 'plan-01',
      providerName: 'type-check-gate',
      extensionName: 'my-extension',
      extensionPath: '/project/.eforge/extensions/my-extension.js',
      kind: 'function',
    });

    const result = eventToProgress(event, ZERO_COUNTERS);
    expect(result).toBeNull();
  });

  it('extension:validation-provider:complete with status: skipped returns a non-null update', () => {
    const event = asEvent({
      type: 'extension:validation-provider:complete',
      planId: 'plan-01',
      providerName: 'type-check-gate',
      extensionName: 'my-extension',
      extensionPath: '/project/.eforge/extensions/my-extension.js',
      status: 'skipped',
    });

    const result = eventToProgress(event, ZERO_COUNTERS);
    expect(result).not.toBeNull();
    expect(result!.message).toContain('type-check-gate');
    expect(result!.message).toContain('skipped');
  });
});
