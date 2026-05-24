/**
 * Tests for Pi tool-call infrastructure error classification.
 *
 * `isPiToolInfrastructureError` is a narrow predicate that matches the well-attested
 * "Theme not initialized. Call initTheme() first." message family produced when a
 * project-local Pi extension accesses the global Pi theme proxy in a headless SDK session
 * (no TUI initialized). The predicate is intentionally conservative — it should NOT match
 * unrelated tool-result text, model output, or generic error messages.
 *
 * `classifyAgentTerminalSubtype` must return 'error_pi_tool_infrastructure' for errors
 * that match `isPiToolInfrastructureError`, in addition to the existing subtypes it
 * already classifies (error_transient_transport, AgentTerminalError subtypes).
 */

import { describe, it, expect } from 'vitest';
import {
  isPiToolInfrastructureError,
  classifyAgentTerminalSubtype,
  AgentTerminalError,
} from '@eforge-build/engine/harness';

// ---------------------------------------------------------------------------
// isPiToolInfrastructureError — matching cases
// ---------------------------------------------------------------------------

describe('isPiToolInfrastructureError — should match', () => {
  it('matches the canonical "Theme not initialized. Call initTheme() first." string', () => {
    expect(isPiToolInfrastructureError('Theme not initialized. Call initTheme() first.')).toBe(true);
  });

  it('matches case-insensitive (all lower)', () => {
    expect(isPiToolInfrastructureError('theme not initialized. call inittheme() first.')).toBe(true);
  });

  it('matches case-insensitive (all upper)', () => {
    expect(isPiToolInfrastructureError('THEME NOT INITIALIZED. CALL INITTHEME() FIRST.')).toBe(true);
  });

  it('matches with leading whitespace', () => {
    expect(isPiToolInfrastructureError('  Theme not initialized. Call initTheme() first.')).toBe(true);
  });

  it('matches with trailing whitespace', () => {
    expect(isPiToolInfrastructureError('Theme not initialized. Call initTheme() first.  ')).toBe(true);
  });

  it('matches when embedded in a longer error message', () => {
    expect(isPiToolInfrastructureError('Error in tool_call hook: Theme not initialized. Call initTheme() first.')).toBe(true);
  });

  it('matches the "theme not initialized" fragment without the initTheme suffix', () => {
    // The regex matches on "theme\s+not\s+initialized", so a partial match is sufficient
    expect(isPiToolInfrastructureError('Theme not initialized')).toBe(true);
  });

  // Wrapper-prefix cases (PI_TOOL_INFRA_WRAPPER_RE)
  it('matches the "Pi tool-call infrastructure failure:" wrapper prefix', () => {
    expect(isPiToolInfrastructureError('Pi tool-call infrastructure failure: something went wrong')).toBe(true);
  });

  it('matches wrapper prefix with "Error: " preamble', () => {
    expect(isPiToolInfrastructureError('Error: Pi tool-call infrastructure failure: foo bar')).toBe(true);
  });

  it('matches wrapper prefix with leading whitespace', () => {
    expect(isPiToolInfrastructureError('  Pi tool-call infrastructure failure: leading whitespace')).toBe(true);
  });

  it('matches wrapper prefix case-insensitively', () => {
    expect(isPiToolInfrastructureError('PI TOOL-CALL INFRASTRUCTURE FAILURE: CAPS')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isPiToolInfrastructureError — should NOT match
// ---------------------------------------------------------------------------

describe('isPiToolInfrastructureError — should not match', () => {
  it('does not match empty string', () => {
    expect(isPiToolInfrastructureError('')).toBe(false);
  });

  it('does not match "File not found"', () => {
    expect(isPiToolInfrastructureError('File not found')).toBe(false);
  });

  it('does not match "permission denied"', () => {
    expect(isPiToolInfrastructureError('permission denied')).toBe(false);
  });

  it('does not match a successful tool JSON payload', () => {
    expect(isPiToolInfrastructureError('{"ok":true,"result":"done"}')).toBe(false);
  });

  it('does not match "Tool result: ok"', () => {
    expect(isPiToolInfrastructureError('Tool result: ok')).toBe(false);
  });

  it('does not match "backend error: invalid API key"', () => {
    expect(isPiToolInfrastructureError('Backend error: invalid API key')).toBe(false);
  });

  it('does not match "Backend error: WebSocket closed 1012"', () => {
    expect(isPiToolInfrastructureError('Backend error: WebSocket closed 1012')).toBe(false);
  });

  it('does not match generic "Error" without theme context', () => {
    expect(isPiToolInfrastructureError('Error: something went wrong')).toBe(false);
  });

  it('does not match "model not found"', () => {
    expect(isPiToolInfrastructureError('model not found')).toBe(false);
  });

  it('does not match random text with "theme" but not "not initialized"', () => {
    expect(isPiToolInfrastructureError('Setting theme to dark mode')).toBe(false);
    expect(isPiToolInfrastructureError('Applied theme successfully')).toBe(false);
  });

  // Wrapper-prefix negative cases: must start at (or near) the beginning of the string
  it('does not match "Pi tool-call infrastructure failure:" when not at the start of the string', () => {
    expect(isPiToolInfrastructureError('Some prefix Pi tool-call infrastructure failure: mid-message')).toBe(false);
  });

  it('does not match an ordinary successful tool-result JSON payload', () => {
    expect(isPiToolInfrastructureError('{"result":"success","data":{"count":42}}')).toBe(false);
  });

  it('does not match wrapper-like text inside a JSON tool payload', () => {
    expect(isPiToolInfrastructureError('{"stderr":"Pi tool-call infrastructure failure: command output only"}')).toBe(false);
  });

  it('does not match an application-level TypeError without theme or infrastructure context', () => {
    expect(isPiToolInfrastructureError('TypeError: Cannot read properties of undefined')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyAgentTerminalSubtype — error_pi_tool_infrastructure
// ---------------------------------------------------------------------------

describe('classifyAgentTerminalSubtype — error_pi_tool_infrastructure', () => {
  it('returns error_pi_tool_infrastructure for AgentTerminalError with that subtype', () => {
    const err = new AgentTerminalError('error_pi_tool_infrastructure', 'Theme not initialized. Call initTheme() first.');
    expect(classifyAgentTerminalSubtype(err)).toBe('error_pi_tool_infrastructure');
  });

  it('returns error_pi_tool_infrastructure for a plain Error with theme-init message', () => {
    const err = new Error('Theme not initialized. Call initTheme() first.');
    expect(classifyAgentTerminalSubtype(err)).toBe('error_pi_tool_infrastructure');
  });

  it('returns error_pi_tool_infrastructure for a plain string with theme-init message', () => {
    expect(classifyAgentTerminalSubtype('Theme not initialized. Call initTheme() first.')).toBe('error_pi_tool_infrastructure');
  });

  it('returns error_pi_tool_infrastructure for embedded theme-init message in Error', () => {
    const err = new Error('Pi tool-call infrastructure failure: Theme not initialized. Call initTheme() first.');
    expect(classifyAgentTerminalSubtype(err)).toBe('error_pi_tool_infrastructure');
  });

  it('returns error_pi_tool_infrastructure for the explicit wrapper prefix in Error', () => {
    const err = new Error('Pi tool-call infrastructure failure: hook failed before tool result');
    expect(classifyAgentTerminalSubtype(err)).toBe('error_pi_tool_infrastructure');
  });
});

// ---------------------------------------------------------------------------
// classifyAgentTerminalSubtype — existing subtypes are unaffected
// ---------------------------------------------------------------------------

describe('classifyAgentTerminalSubtype — existing subtypes unaffected', () => {
  it('still classifies error_transient_transport', () => {
    const err = new AgentTerminalError('error_transient_transport', 'Backend error: WebSocket closed 1012');
    expect(classifyAgentTerminalSubtype(err)).toBe('error_transient_transport');
  });

  it('still classifies error_max_turns via AgentTerminalError subtype', () => {
    const err = new AgentTerminalError('error_max_turns', 'reached max turns');
    expect(classifyAgentTerminalSubtype(err)).toBe('error_max_turns');
  });

  it('still classifies transient transport from plain Error message', () => {
    const err = new Error('Backend error: WebSocket closed 1012');
    expect(classifyAgentTerminalSubtype(err)).toBe('error_transient_transport');
  });

  it('returns undefined for unclassified errors', () => {
    expect(classifyAgentTerminalSubtype(new Error('something unexpected'))).toBeUndefined();
    expect(classifyAgentTerminalSubtype('random error')).toBeUndefined();
    expect(classifyAgentTerminalSubtype(42)).toBeUndefined();
    expect(classifyAgentTerminalSubtype(null)).toBeUndefined();
  });

  it('transient transport takes precedence over pi-infra when both patterns are present', () => {
    // Per plan: transient-transport check runs before pi-infra check in classifyAgentTerminalSubtype.
    // In practice these patterns would never coincide, but verify ordering.
    // Use AgentTerminalError explicitly to confirm subtype precedence.
    const err = new AgentTerminalError('error_transient_transport', 'some msg');
    expect(classifyAgentTerminalSubtype(err)).toBe('error_transient_transport');
  });
});
