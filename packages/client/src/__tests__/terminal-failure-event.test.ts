/**
 * Schema and registry tests for plan-01-terminal-failure-contract:
 *   - TerminalFailureScopeSchema accepts all required literals and rejects unknown values
 *   - safeParseEforgeEvent accepts build:terminal-failure for every required scope literal
 *   - safeParseEforgeEvent rejects build:terminal-failure with an invalid scope
 *   - eventRegistry['build:terminal-failure'] exists and summary contains the scope
 *   - TerminalFailureScopeSchema and TerminalFailureEnvelopeSchema are exported from client
 */

import { describe, it, expect } from 'vitest';
import { safeParseEforgeEvent } from '../events.schemas.js';
import { TerminalFailureScopeSchema, TerminalFailureEnvelopeSchema } from '../events.schemas.js';
import type { TerminalFailureScope, TerminalFailureEnvelope } from '../events.schemas.js';
import { eventRegistry, getEventSummary } from '../event-registry.js';
import { Value } from '@sinclair/typebox/value';

// ---------------------------------------------------------------------------
// TerminalFailureScopeSchema — all required literals
// ---------------------------------------------------------------------------

const REQUIRED_SCOPES: TerminalFailureScope[] = [
  'plan', 'post-merge-validation', 'prd-validation', 'acceptance-validation',
  'landing', 'artifact-recording', 'daemon', 'compile', 'unknown',
];

describe('TerminalFailureScopeSchema', () => {
  it.each(REQUIRED_SCOPES)('accepts required scope literal: %s', (scope) => {
    expect(Value.Check(TerminalFailureScopeSchema, scope)).toBe(true);
  });

  it('rejects a scope outside the required enum', () => {
    expect(Value.Check(TerminalFailureScopeSchema, 'invalid-scope')).toBe(false);
    expect(Value.Check(TerminalFailureScopeSchema, '')).toBe(false);
    expect(Value.Check(TerminalFailureScopeSchema, 'network-error')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TerminalFailureEnvelopeSchema — required and optional fields
// ---------------------------------------------------------------------------

describe('TerminalFailureEnvelopeSchema', () => {
  it('accepts minimal envelope with scope, message, and authoritative', () => {
    const envelope: TerminalFailureEnvelope = { scope: 'plan', message: 'Build failed', authoritative: true };
    expect(Value.Check(TerminalFailureEnvelopeSchema, envelope)).toBe(true);
  });

  it('accepts full envelope with all optional fields', () => {
    const envelope: TerminalFailureEnvelope = {
      scope: 'artifact-recording',
      message: 'Artifact recording failed',
      authoritative: true,
      planId: 'plan-01',
      stage: 'artifact-recording',
      phaseSummary: 'Phase summary',
      phaseStatus: 'failed',
      eventType: 'daemon:error',
      sourceEventType: 'daemon:error',
      sourceEventId: 42,
      sourceEventTimestamp: '2026-01-01T00:00:00.000Z',
      landing: { status: 'skipped', action: 'pr', reason: 'validation failed' },
      validationPassed: true,
      prdValidationPassed: true,
      acceptanceValidationPassed: false,
    };
    expect(Value.Check(TerminalFailureEnvelopeSchema, envelope)).toBe(true);
  });

  it('rejects envelope missing required scope', () => {
    const invalid = { message: 'Build failed', authoritative: true };
    expect(Value.Check(TerminalFailureEnvelopeSchema, invalid)).toBe(false);
  });

  it('rejects envelope missing required message', () => {
    const invalid = { scope: 'plan', authoritative: true };
    expect(Value.Check(TerminalFailureEnvelopeSchema, invalid)).toBe(false);
  });

  it('rejects envelope missing required authoritative', () => {
    const invalid = { scope: 'plan', message: 'Build failed' };
    expect(Value.Check(TerminalFailureEnvelopeSchema, invalid)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// safeParseEforgeEvent — build:terminal-failure for all scopes
// ---------------------------------------------------------------------------

describe('safeParseEforgeEvent — build:terminal-failure', () => {
  it.each(REQUIRED_SCOPES)('accepts build:terminal-failure with scope: %s', (scope) => {
    const event = {
      type: 'build:terminal-failure',
      runId: 'run-01',
      failure: { scope, message: `Terminal failure: ${scope}`, authoritative: true },
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('build:terminal-failure');
    }
  });

  it('rejects build:terminal-failure with invalid scope', () => {
    const event = {
      type: 'build:terminal-failure',
      runId: 'run-01',
      failure: { scope: 'not-a-valid-scope', message: 'fail', authoritative: true },
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(false);
  });

  it('rejects build:terminal-failure missing failure.scope', () => {
    const event = {
      type: 'build:terminal-failure',
      runId: 'run-01',
      failure: { message: 'fail', authoritative: true },
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(false);
  });

  it('rejects build:terminal-failure missing failure.authoritative', () => {
    const event = {
      type: 'build:terminal-failure',
      runId: 'run-01',
      failure: { scope: 'plan', message: 'Build failed' },
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// eventRegistry — build:terminal-failure entry
// ---------------------------------------------------------------------------

describe('eventRegistry[build:terminal-failure]', () => {
  it('exists in the registry', () => {
    expect(eventRegistry['build:terminal-failure']).toBeDefined();
  });

  it('is session-scoped and persisted', () => {
    const meta = eventRegistry['build:terminal-failure'];
    expect(meta.scope).toBe('session');
    expect(meta.persist).toBe(true);
  });

  it('summary contains the terminal failure scope', () => {
    const event = {
      type: 'build:terminal-failure' as const,
      runId: 'run-01',
      failure: { scope: 'artifact-recording' as TerminalFailureScope, message: 'Recording failed', authoritative: true },
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    const summary = getEventSummary(event);
    expect(summary).toBeDefined();
    expect(summary).toContain('artifact-recording');
  });
});
