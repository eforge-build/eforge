/**
 * pipeline-error-translator — focused tests for toBuildFailedEvent.
 *
 * Covers:
 *   1. AgentTerminalError input produces a build:failed event with the matching terminalSubtype.
 *   2. Plain Error input produces a build:failed event without terminalSubtype.
 *   3. Non-Error throw value produces a build:failed event with a stringified message.
 */

import { describe, it, expect } from 'vitest';
import { AgentTerminalError } from '@eforge-build/engine/harness';
import { toBuildFailedEvent } from '@eforge-build/engine/pipeline';

describe('toBuildFailedEvent', () => {
  it('maps AgentTerminalError to a build:failed event with terminalSubtype', () => {
    const planId = 'plan-01';
    const err = new AgentTerminalError('error_max_turns', 'Reached maximum number of turns (80).');

    const event = toBuildFailedEvent(planId, err);

    expect(event.type).toBe('plan:build:failed');
    expect(event.planId).toBe(planId);
    expect(event.error).toBe(err.message);
    expect(event.terminalSubtype).toBe('error_max_turns');
  });

  it('maps AgentTerminalError with error_max_budget_usd subtype correctly', () => {
    const planId = 'plan-02';
    const err = new AgentTerminalError('error_max_budget_usd', 'Budget exceeded.');

    const event = toBuildFailedEvent(planId, err);

    expect(event.type).toBe('plan:build:failed');
    expect(event.planId).toBe(planId);
    expect(event.terminalSubtype).toBe('error_max_budget_usd');
  });

  it('maps a plain transient transport Error to error_transient_transport', () => {
    const planId = 'plan-03';
    const err = new Error('Backend error: WebSocket closed 1012');

    const event = toBuildFailedEvent(planId, err);

    expect(event.type).toBe('plan:build:failed');
    expect(event.planId).toBe(planId);
    expect(event.error).toBe('Backend error: WebSocket closed 1012');
    expect(event.terminalSubtype).toBe('error_transient_transport');
  });

  it('maps Backend error: WebSocket closed 1000 (observed planner failure) to error_transient_transport', () => {
    // Regression test: close code 1000 (normal closure) was previously not classified
    // as a transient transport failure, causing planner retries to be skipped.
    const planId = 'plan-03a';
    const err = new Error('Backend error: WebSocket closed 1000');

    const event = toBuildFailedEvent(planId, err);

    expect(event.type).toBe('plan:build:failed');
    expect(event.planId).toBe(planId);
    expect(event.error).toBe('Backend error: WebSocket closed 1000');
    expect(event.terminalSubtype).toBe('error_transient_transport');
  });

  it('maps observed Claude Code SDK socket-close message to error_transient_transport', () => {
    // Regression test: Claude SDK throws an "API Error: The socket connection was closed
    // unexpectedly" message that must be classified as transient transport so retry policies
    // can run, rather than being treated as a permanent build failure.
    const planId = 'plan-03b';
    const observedMessage =
      "API Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()";
    const err = new Error(observedMessage);

    const event = toBuildFailedEvent(planId, err);

    expect(event.type).toBe('plan:build:failed');
    expect(event.planId).toBe(planId);
    expect(event.error).toBe(observedMessage);
    expect(event.terminalSubtype).toBe('error_transient_transport');
  });

  it('maps backend Codex SSE response-header timeout to error_transient_transport', () => {
    const planId = 'plan-03';
    const err = new Error('Backend error: Codex SSE response headers timed out after 10000ms');

    const event = toBuildFailedEvent(planId, err);

    expect(event.type).toBe('plan:build:failed');
    expect(event.planId).toBe(planId);
    expect(event.error).toBe('Backend error: Codex SSE response headers timed out after 10000ms');
    expect(event.terminalSubtype).toBe('error_transient_transport');
  });

  it('maps a plain Error to a build:failed event without terminalSubtype', () => {
    const planId = 'plan-03';
    const err = new Error('Something went wrong');

    const event = toBuildFailedEvent(planId, err);

    expect(event.type).toBe('plan:build:failed');
    expect(event.planId).toBe(planId);
    expect(event.error).toBe('Something went wrong');
    expect(event.terminalSubtype).toBeUndefined();
  });

  it('maps a non-Error throw value to a build:failed event with stringified message', () => {
    const planId = 'plan-04';
    const thrown = 'string error value';

    const event = toBuildFailedEvent(planId, thrown);

    expect(event.type).toBe('plan:build:failed');
    expect(event.planId).toBe(planId);
    expect(event.error).toBe('string error value');
    expect(event.terminalSubtype).toBeUndefined();
  });

  it('maps a thrown object to a build:failed event with String() representation', () => {
    const planId = 'plan-05';
    const thrown = { code: 'ENOENT', message: 'file not found' };

    const event = toBuildFailedEvent(planId, thrown);

    expect(event.type).toBe('plan:build:failed');
    expect(event.planId).toBe(planId);
    expect(event.error).toBe(String(thrown));
    expect(event.terminalSubtype).toBeUndefined();
  });

  it('includes a timestamp in the ISO format', () => {
    const event = toBuildFailedEvent('plan-06', new Error('test'));

    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
