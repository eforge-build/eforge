/**
 * Tests that toolbelt observability fields flow through buildAgentStartEvent —
 * agent:start events carry toolbelt summary fields when the run options carry them.
 */

import { describe, it, expect } from 'vitest';
import { buildAgentStartEvent } from '@eforge-build/engine/harnesses/common';

// ---------------------------------------------------------------------------
// buildAgentStartEvent — toolbelt fields on agent:start
// ---------------------------------------------------------------------------

describe('buildAgentStartEvent — toolbelt observability fields', () => {
  const baseOpts = {
    agentId: 'agent-1',
    agent: 'builder' as const,
    model: 'claude-sonnet-4-6',
    harness: 'claude-sdk' as const,
    harnessSource: 'tier' as const,
    tier: 'implementation',
    tierSource: 'tier' as const,
  };

  it('omits toolbelt fields when not provided', () => {
    const event = buildAgentStartEvent(baseOpts);

    expect('toolbelt' in event).toBe(false);
    expect('toolbeltSource' in event).toBe(false);
    expect('projectMcpSelection' in event).toBe(false);
    expect('projectMcpServerNames' in event).toBe(false);
  });

  it('includes all four toolbelt fields when toolbeltSource is default (omitted toolbelt)', () => {
    const event = buildAgentStartEvent({
      ...baseOpts,
      toolbeltSource: 'default',
      projectMcpSelection: 'all',
      projectMcpServerNames: ['figma', 'playwright', 'stripe'],
    });

    expect('toolbelt' in event).toBe(false); // toolbelt is undefined → omitted
    expect(event.toolbeltSource).toBe('default');
    expect(event.projectMcpSelection).toBe('all');
    expect(event.projectMcpServerNames).toEqual(['figma', 'playwright', 'stripe']);
  });

  it('includes toolbelt: null when toolbelt is none', () => {
    const event = buildAgentStartEvent({
      ...baseOpts,
      toolbelt: null,
      toolbeltSource: 'tier',
      projectMcpSelection: 'none',
      projectMcpServerNames: [],
    });

    expect(event.toolbelt).toBeNull();
    expect(event.toolbeltSource).toBe('tier');
    expect(event.projectMcpSelection).toBe('none');
    expect(event.projectMcpServerNames).toEqual([]);
  });

  it('includes toolbelt name when a named toolbelt is active', () => {
    const event = buildAgentStartEvent({
      ...baseOpts,
      toolbelt: 'browser-ui',
      toolbeltSource: 'tier',
      projectMcpSelection: 'toolbelt',
      projectMcpServerNames: ['playwright'],
    });

    expect(event.toolbelt).toBe('browser-ui');
    expect(event.toolbeltSource).toBe('tier');
    expect(event.projectMcpSelection).toBe('toolbelt');
    expect(event.projectMcpServerNames).toEqual(['playwright']);
  });

  it('does not emit toolbelt key when toolbelt is explicitly undefined', () => {
    const event = buildAgentStartEvent({
      ...baseOpts,
      toolbelt: undefined,
      toolbeltSource: 'default',
      projectMcpSelection: 'all',
      projectMcpServerNames: [],
    });

    // toolbelt: undefined → omitted (the "only include when defined" pattern)
    expect('toolbelt' in event).toBe(false);
    expect(event.toolbeltSource).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// agent:start — toolbelt fields flow from AgentRunOptions through harness
// ---------------------------------------------------------------------------

describe('agent:start event carries toolbelt fields from run options', () => {
  it('agent:start includes toolbelt summary fields when set on options', async () => {
    // Use StubHarness-style direct testing of buildAgentStartEvent rather than
    // running a full harness (which would require the Claude SDK or Pi SDK).
    // The harness implementations delegate directly to buildAgentStartEvent,
    // so this tests the full data path.
    const event = buildAgentStartEvent({
      planId: 'plan-01',
      agentId: 'agent-1',
      agent: 'evaluator',
      model: 'claude-opus-4-7',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'evaluation',
      tierSource: 'tier',
      effort: 'high',
      effortSource: 'tier',
      toolbelt: 'browser-ui',
      toolbeltSource: 'tier',
      projectMcpSelection: 'toolbelt',
      projectMcpServerNames: ['playwright'],
    });

    expect(event.type).toBe('agent:start');
    expect(event.toolbelt).toBe('browser-ui');
    expect(event.toolbeltSource).toBe('tier');
    expect(event.projectMcpSelection).toBe('toolbelt');
    expect(event.projectMcpServerNames).toEqual(['playwright']);
  });

  it('agent:start includes projectMcpSelection=all when toolbelt is omitted (default)', () => {
    const event = buildAgentStartEvent({
      agentId: 'agent-2',
      agent: 'builder',
      model: 'claude-sonnet-4-6',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'implementation',
      tierSource: 'tier',
      toolbeltSource: 'default',
      projectMcpSelection: 'all',
      projectMcpServerNames: ['figma', 'playwright'],
    });

    expect('toolbelt' in event).toBe(false);
    expect(event.toolbeltSource).toBe('default');
    expect(event.projectMcpSelection).toBe('all');
    expect(event.projectMcpServerNames).toEqual(['figma', 'playwright']);
  });

  it('agent:start includes toolbelt=null and projectMcpSelection=none when toolbelt is none', () => {
    const event = buildAgentStartEvent({
      agentId: 'agent-3',
      agent: 'reviewer',
      model: 'claude-opus-4-7',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'review',
      tierSource: 'tier',
      toolbelt: null,
      toolbeltSource: 'tier',
      projectMcpSelection: 'none',
      projectMcpServerNames: [],
    });

    expect(event.toolbelt).toBeNull();
    expect(event.toolbeltSource).toBe('tier');
    expect(event.projectMcpSelection).toBe('none');
    expect(event.projectMcpServerNames).toEqual([]);
  });
});
