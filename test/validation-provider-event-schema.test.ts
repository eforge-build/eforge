/**
 * Round-trip and registry parity tests for the new
 * extension:validation-provider:* event variants.
 *
 * Verifies:
 * 1. Each variant round-trips through `safeParseEforgeEvent`.
 * 2. Each variant has an entry in `eventRegistry`.
 */

import { describe, it, expect } from 'vitest';
import { safeParseEforgeEvent, eventRegistry } from '../packages/client/src/index.js';

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const base = {
  planId: 'plan-01',
  providerName: 'my-validator',
  extensionName: 'test-ext',
  extensionPath: '/ext/path',
};

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe('extension:validation-provider:start', () => {
  it('round-trips (validate form)', () => {
    const event = {
      type: 'extension:validation-provider:start' as const,
      timestamp: new Date().toISOString(),
      ...base,
      kind: 'validate' as const,
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('extension:validation-provider:start');
    }
  });

  it('round-trips (commands form with commandCount)', () => {
    const event = {
      type: 'extension:validation-provider:start' as const,
      timestamp: new Date().toISOString(),
      ...base,
      kind: 'commands' as const,
      commandCount: 3,
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });
});

describe('extension:validation-provider:complete', () => {
  it('round-trips (passed)', () => {
    const event = {
      type: 'extension:validation-provider:complete' as const,
      timestamp: new Date().toISOString(),
      ...base,
      status: 'passed' as const,
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('round-trips (skipped with message)', () => {
    const event = {
      type: 'extension:validation-provider:complete' as const,
      timestamp: new Date().toISOString(),
      ...base,
      status: 'skipped' as const,
      message: 'not applicable for this plan',
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });
});

describe('extension:validation-provider:error', () => {
  it('round-trips (function-form failure)', () => {
    const event = {
      type: 'extension:validation-provider:error' as const,
      timestamp: new Date().toISOString(),
      ...base,
      status: 'failed' as const,
      message: 'Validation failed: lint errors',
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('round-trips (command-form failure with command+exitCode+details)', () => {
    const event = {
      type: 'extension:validation-provider:error' as const,
      timestamp: new Date().toISOString(),
      ...base,
      status: 'failed' as const,
      message: 'Command exited with code 1',
      details: 'stderr output here',
      command: 'pnpm lint',
      exitCode: 1,
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });
});

describe('extension:validation-provider:timeout', () => {
  it('round-trips (function-form timeout)', () => {
    const event = {
      type: 'extension:validation-provider:timeout' as const,
      timestamp: new Date().toISOString(),
      ...base,
      timeoutMs: 5000,
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('round-trips (command-form timeout with command)', () => {
    const event = {
      type: 'extension:validation-provider:timeout' as const,
      timestamp: new Date().toISOString(),
      ...base,
      timeoutMs: 5000,
      command: 'pnpm type-check',
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Negative validation — ensure the schema actually constrains variants
// ---------------------------------------------------------------------------

describe('extension:validation-provider:* schema rejects invalid payloads', () => {
  it('complete rejects status="failed" (complete is passed|skipped only)', () => {
    const event = {
      type: 'extension:validation-provider:complete' as const,
      timestamp: new Date().toISOString(),
      ...base,
      status: 'failed' as unknown as 'passed',
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(false);
  });

  it('error rejects missing required message', () => {
    const event = {
      type: 'extension:validation-provider:error' as const,
      timestamp: new Date().toISOString(),
      ...base,
      status: 'failed' as const,
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(false);
  });

  it('start rejects unknown kind value', () => {
    const event = {
      type: 'extension:validation-provider:start' as const,
      timestamp: new Date().toISOString(),
      ...base,
      kind: 'bogus' as unknown as 'validate',
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Registry parity
// ---------------------------------------------------------------------------

describe('eventRegistry parity', () => {
  const newVariants = [
    'extension:validation-provider:start',
    'extension:validation-provider:complete',
    'extension:validation-provider:error',
    'extension:validation-provider:timeout',
  ] as const;

  for (const variant of newVariants) {
    it(`eventRegistry has entry for ${variant}`, () => {
      expect(eventRegistry[variant]).toBeDefined();
      expect(typeof eventRegistry[variant].scope).toBe('string');
      expect(typeof eventRegistry[variant].persist).toBe('boolean');
    });
  }
});
