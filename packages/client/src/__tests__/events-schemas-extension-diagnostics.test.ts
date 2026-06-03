import { describe, it, expect } from 'vitest';
import { isAlwaysYieldedAgentEvent, safeParseEforgeEvent } from '../events.schemas.js';
import { eventRegistry, getEventSummary } from '../event-registry.js';
import type { EforgeEvent } from '../events.schemas.js';
import { extensionDiagnosticVariants, extensionPolicyVariants } from './events-schema-test-helpers.js';

// --- eforge:region event-schema-tests ---

describe('eventRegistry — extension diagnostics', () => {
  it('registers extension diagnostics as session-scoped, non-persistent events with summaries', () => {
    const failed = extensionDiagnosticVariants[0]!;
    const timeout = extensionDiagnosticVariants[2]!;
    expect(eventRegistry['extension:event-handler:failed']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['extension:event-handler:timeout']).toMatchObject({ scope: 'session', persist: false });
    expect(getEventSummary(failed)).toBe(
      'Extension audit-log event hook failed (plan:build:* on plan:build:failed): boom',
    );
    expect(getEventSummary(timeout)).toBe(
      'Extension audit-log event hook timed out after 5000ms (* on plan:build:complete)',
    );
  });
});

describe('eventRegistry — extension policy gates', () => {
  it('registers policy events as session-scoped, non-persistent events with summaries', () => {
    for (const event of extensionPolicyVariants) {
      expect(eventRegistry[event.type]).toMatchObject({ scope: 'session', persist: false });
    }
    expect(getEventSummary(extensionPolicyVariants[0]!)).toBe(
      'Policy gate beforePlanMerge (guardrails) returned block: protected paths changed',
    );
    expect(getEventSummary(extensionPolicyVariants[1]!)).toBe(
      'Policy gate beforeQueueDispatch (guardrails) failed under fail-open: boom',
    );
    expect(getEventSummary(extensionPolicyVariants[2]!)).toBe(
      'Policy gate beforeFinalMerge (guardrails) timed out after 5000ms under fail-closed',
    );
  });
});

describe('safeParseEforgeEvent — extension:agent-context:* variants', () => {
  it('accepts extension:agent-context:applied with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      role: 'builder',
      profile: 'default',
      promptCharCount: 1500,
      fragmentCount: 1,
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:agent-context:applied with all optional fields', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      role: 'builder',
      tier: 'implementation',
      phase: 'build',
      stage: 'implement',
      profile: 'default',
      planId: 'plan-01',
      harness: 'claude-sdk',
      toolbelt: 'browser-ui',
      projectMcpSelection: 'toolbelt',
      promptCharCount: 1500,
      fragmentCount: 2,
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:agent-context:applied with toolbelt: null', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      role: 'builder',
      profile: 'default',
      toolbelt: null,
      promptCharCount: 800,
      fragmentCount: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects extension:agent-context:applied missing promptCharCount', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      role: 'builder',
      profile: 'default',
      fragmentCount: 1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts extension:agent-context:failed with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      role: 'reviewer',
      profile: 'default',
      message: 'Handler threw an error',
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:agent-context:failed with optional stack field', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      role: 'builder',
      profile: 'default',
      message: 'Something went wrong',
      stack: 'Error: Something went wrong\n    at handler (/ext.ts:10:5)',
    });
    expect(result.success).toBe(true);
  });

  it('rejects extension:agent-context:failed missing message', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'my-ext',
      extensionPath: '/project/.eforge/extensions/my-ext.ts',
      role: 'builder',
      profile: 'default',
    });
    expect(result.success).toBe(false);
  });

  it('accepts extension:agent-context:timeout with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:timeout',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'slow-ext',
      extensionPath: '/project/.eforge/extensions/slow-ext.ts',
      role: 'planner',
      profile: 'default',
      timeoutMs: 5000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects extension:agent-context:timeout with non-number timeoutMs', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:timeout',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'slow-ext',
      extensionPath: '/project/.eforge/extensions/slow-ext.ts',
      role: 'planner',
      profile: 'default',
      timeoutMs: '5000',
    });
    expect(result.success).toBe(false);
  });

  it('accepts extension:agent-context:unsupported with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:unsupported',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'tool-ext',
      extensionPath: '/project/.eforge/extensions/tool-ext.ts',
      role: 'builder',
      profile: 'default',
      fields: ['tools'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:agent-context:unsupported with multiple field values', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:unsupported',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'tool-ext',
      extensionPath: '/project/.eforge/extensions/tool-ext.ts',
      role: 'builder',
      profile: 'default',
      fields: ['tools', 'allowedTools', 'disallowedTools'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects extension:agent-context:unsupported with unknown field literal', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-context:unsupported',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'tool-ext',
      extensionPath: '/project/.eforge/extensions/tool-ext.ts',
      role: 'builder',
      profile: 'default',
      fields: ['unknownField'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts extension:agent-tools:applied with toolbelt metadata', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-tools:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'tool-ext',
      extensionPath: '/project/.eforge/extensions/tool-ext.ts',
      role: 'builder',
      tier: 'implementation',
      phase: 'build',
      stage: 'implement',
      profile: 'default',
      planId: 'plan-01',
      harness: 'claude-sdk',
      toolbelt: 'browser-ui',
      projectMcpSelection: 'toolbelt',
      projectMcpServerNames: ['filesystem'],
      toolNames: ['inspect_context'],
      effectiveToolNames: ['mcp__eforge_engine__inspect_context'],
      registeredToolNames: [],
      inlineToolNames: ['inspect_context'],
      allowedToolsAdded: ['Read'],
      disallowedToolsAdded: ['Write'],
      excludedToolNames: ['duplicate_tool'],
      toolCount: 1,
      allowedToolCount: 1,
      disallowedToolCount: 1,
      excludedToolCount: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects extension:agent-tools:applied missing toolNames', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:agent-tools:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'tool-ext',
      extensionPath: '/project/.eforge/extensions/tool-ext.ts',
      role: 'builder',
      profile: 'default',
      effectiveToolNames: [],
      registeredToolNames: [],
      inlineToolNames: [],
      allowedToolsAdded: [],
      disallowedToolsAdded: [],
      excludedToolNames: [],
      toolCount: 0,
      allowedToolCount: 0,
      disallowedToolCount: 0,
      excludedToolCount: 0,
    });
    expect(result.success).toBe(false);
  });

  it('round-trips all five agent-context/tool variants through JSON', () => {
    const variants: import('../events.schemas.js').EforgeEvent[] = [
      {
        type: 'extension:agent-context:applied',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionName: 'my-ext',
        extensionPath: '/ext.ts',
        role: 'builder',
        tier: 'implementation',
        phase: 'build',
        stage: 'implement',
        profile: 'default',
        planId: 'plan-01',
        promptCharCount: 1000,
        fragmentCount: 1,
      },
      {
        type: 'extension:agent-context:failed',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionName: 'my-ext',
        extensionPath: '/ext.ts',
        role: 'builder',
        profile: 'default',
        message: 'boom',
      },
      {
        type: 'extension:agent-context:timeout',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionName: 'slow-ext',
        extensionPath: '/slow.ts',
        role: 'planner',
        profile: 'default',
        timeoutMs: 5000,
      },
      {
        type: 'extension:agent-context:unsupported',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionName: 'tool-ext',
        extensionPath: '/tool.ts',
        role: 'builder',
        profile: 'default',
        fields: ['tools'],
      },
      {
        type: 'extension:agent-tools:applied',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionName: 'tool-ext',
        extensionPath: '/tool.ts',
        role: 'builder',
        profile: 'default',
        toolNames: ['inspect_context'],
        effectiveToolNames: ['inspect_context'],
        registeredToolNames: [],
        inlineToolNames: ['inspect_context'],
        allowedToolsAdded: [],
        disallowedToolsAdded: [],
        excludedToolNames: [],
        toolCount: 1,
        allowedToolCount: 0,
        disallowedToolCount: 0,
        excludedToolCount: 0,
      },
    ];

    for (const event of variants) {
      const parsed = JSON.parse(JSON.stringify(event));
      expect(parsed).toEqual(event);
      const result = safeParseEforgeEvent(parsed);
      expect(result.success, `${event.type} should roundtrip through safeParseEforgeEvent`).toBe(true);
    }
  });
});

describe('eventRegistry — extension:agent-context:* diagnostics', () => {
  it('registers agent-context and agent-tools variants as session-scoped, non-persistent events', () => {
    expect(eventRegistry['extension:agent-context:applied']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['extension:agent-context:failed']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['extension:agent-context:timeout']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['extension:agent-context:unsupported']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['extension:agent-tools:applied']).toMatchObject({ scope: 'session', persist: false });
  });

  it('summary function for applied event includes extension name, char count, and role', () => {
    const event: import('../events.schemas.js').EforgeEvent = {
      type: 'extension:agent-context:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'my-ext',
      extensionPath: '/ext.ts',
      role: 'builder',
      tier: 'implementation',
      profile: 'default',
      promptCharCount: 1234,
      fragmentCount: 1,
    };
    const summary = getEventSummary(event);
    expect(summary).toContain('my-ext');
    expect(summary).toContain('1234');
    expect(summary).toContain('builder');
  });

  it('summary function for failed event includes extension name, role, and message', () => {
    const event: import('../events.schemas.js').EforgeEvent = {
      type: 'extension:agent-context:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'err-ext',
      extensionPath: '/err.ts',
      role: 'reviewer',
      profile: 'default',
      message: 'Handler exploded',
    };
    const summary = getEventSummary(event);
    expect(summary).toContain('err-ext');
    expect(summary).toContain('reviewer');
    expect(summary).toContain('Handler exploded');
  });

  it('summary function for timeout event includes extension name, timeoutMs, and role', () => {
    const event: import('../events.schemas.js').EforgeEvent = {
      type: 'extension:agent-context:timeout',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'slow-ext',
      extensionPath: '/slow.ts',
      role: 'planner',
      profile: 'default',
      timeoutMs: 3000,
    };
    const summary = getEventSummary(event);
    expect(summary).toContain('slow-ext');
    expect(summary).toContain('3000');
    expect(summary).toContain('planner');
  });

  it('summary function for tools-applied event includes extension name, role, accepted count, and excluded count', () => {
    const event: import('../events.schemas.js').EforgeEvent = {
      type: 'extension:agent-tools:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'tool-ext',
      extensionPath: '/tool.ts',
      role: 'builder',
      profile: 'default',
      toolNames: ['inspect_context'],
      effectiveToolNames: ['inspect_context'],
      registeredToolNames: [],
      inlineToolNames: ['inspect_context'],
      allowedToolsAdded: [],
      disallowedToolsAdded: [],
      excludedToolNames: ['duplicate_tool'],
      toolCount: 1,
      allowedToolCount: 0,
      disallowedToolCount: 0,
      excludedToolCount: 1,
    };
    expect(isAlwaysYieldedAgentEvent(event)).toBe(true);
    const summary = getEventSummary(event);
    expect(summary).toContain('tool-ext');
    expect(summary).toContain('builder');
    expect(summary).toContain('1 accepted');
    expect(summary).toContain('1 excluded');
  });

  it('summary function for unsupported event includes extension name, role, and fields', () => {
    const event: import('../events.schemas.js').EforgeEvent = {
      type: 'extension:agent-context:unsupported',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'tool-ext',
      extensionPath: '/tool.ts',
      role: 'builder',
      profile: 'default',
      fields: ['tools', 'allowedTools'],
    };
    const summary = getEventSummary(event);
    expect(summary).toContain('tool-ext');
    expect(summary).toContain('builder');
    expect(summary).toContain('tools');
    expect(summary).toContain('allowedTools');
  });
});



// ---------------------------------------------------------------------------
// queue:profile:* variants (EXTEND_09)
// ---------------------------------------------------------------------------

describe('safeParseEforgeEvent — extension reviewer perspective events', () => {
  it('accepts extension:reviewer-perspective:applied with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:reviewer-perspective:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/project/.eforge/extensions/a11y.js',
      extensionName: 'a11y-reviewer',
      perspectiveKey: 'accessibility',
      perspectiveLabel: 'Accessibility Review',
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:reviewer-perspective:applied with optional planId', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:reviewer-perspective:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/project/.eforge/extensions/a11y.js',
      extensionName: 'a11y-reviewer',
      perspectiveKey: 'accessibility',
      perspectiveLabel: 'Accessibility Review',
      planId: 'plan-01',
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:reviewer-perspective:skipped with reason not-applicable', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:reviewer-perspective:skipped',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/project/.eforge/extensions/a11y.js',
      extensionName: 'a11y-reviewer',
      perspectiveKey: 'accessibility',
      reason: 'not-applicable',
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:reviewer-perspective:skipped with all reason variants', () => {
    const reasons = ['not-applicable', 'applicability-error', 'applicability-timeout', 'unknown-key'] as const;
    for (const reason of reasons) {
      const result = safeParseEforgeEvent({
        type: 'extension:reviewer-perspective:skipped',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionPath: '/ext.js',
        extensionName: 'ext',
        perspectiveKey: 'my-lens',
        reason,
      });
      expect(result.success, `reason '${reason}' should be accepted`).toBe(true);
    }
  });

  it('accepts extension:reviewer-perspective:skipped unknown-key without extension provenance', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:reviewer-perspective:skipped',
      timestamp: '2025-01-01T00:00:00.000Z',
      perspectiveKey: 'missing-lens',
      reason: 'unknown-key',
      message: 'Perspective key "missing-lens" is not registered by any loaded extension',
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:reviewer-perspective:skipped with optional message and timeoutMs', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:reviewer-perspective:skipped',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      extensionName: 'ext',
      perspectiveKey: 'my-lens',
      reason: 'applicability-timeout',
      message: 'Timed out after 5000ms',
      timeoutMs: 5000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects extension:reviewer-perspective:applied missing extensionName', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:reviewer-perspective:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      perspectiveKey: 'my-lens',
      perspectiveLabel: 'My Lens',
    });
    expect(result.success).toBe(false);
  });

  it('rejects extension:reviewer-perspective:skipped with invalid reason literal', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:reviewer-perspective:skipped',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      extensionName: 'ext',
      perspectiveKey: 'my-lens',
      reason: 'invalid-reason',
    });
    expect(result.success).toBe(false);
  });

  it('round-trips extension reviewer perspective events through JSON', () => {
    const events: EforgeEvent[] = [
      {
        type: 'extension:reviewer-perspective:applied',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionPath: '/ext.js',
        extensionName: 'ext',
        perspectiveKey: 'accessibility',
        perspectiveLabel: 'Accessibility',
        planId: 'plan-01',
      },
      {
        type: 'extension:reviewer-perspective:skipped',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionPath: '/ext.js',
        extensionName: 'ext',
        perspectiveKey: 'accessibility',
        reason: 'not-applicable',
      },
    ];
    for (const event of events) {
      expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    }
  });
});

describe('eventRegistry — extension reviewer perspective events', () => {
  it('registers perspective events as session-scoped, non-persistent events', () => {
    expect(eventRegistry['extension:reviewer-perspective:applied']).toMatchObject({
      scope: 'session',
      persist: false,
    });
    expect(eventRegistry['extension:reviewer-perspective:skipped']).toMatchObject({
      scope: 'session',
      persist: false,
    });
  });

  it('generates summaries for applied and skipped perspective events', () => {
    const appliedEvent: EforgeEvent = {
      type: 'extension:reviewer-perspective:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      extensionName: 'a11y',
      perspectiveKey: 'accessibility',
      perspectiveLabel: 'Accessibility',
      planId: 'plan-01',
    };
    const skippedEvent: EforgeEvent = {
      type: 'extension:reviewer-perspective:skipped',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      extensionName: 'a11y',
      perspectiveKey: 'accessibility',
      reason: 'not-applicable',
    };
    expect(getEventSummary(appliedEvent)).toContain('accessibility');
    expect(getEventSummary(appliedEvent)).toContain('a11y');
    expect(getEventSummary(skippedEvent)).toContain('accessibility');
    expect(getEventSummary(skippedEvent)).toContain('not-applicable');
  });
});

describe('safeParseEforgeEvent — extension:validation-provider:* variants', () => {
  const base = {
    timestamp: '2025-01-01T00:00:00.000Z',
    planId: 'plan-01',
    providerName: 'custom-validator',
    extensionName: 'quality-ext',
    extensionPath: '/project/.eforge/extensions/quality-ext.ts',
  };

  it('accepts validation provider lifecycle events', () => {
    const events = [
      { ...base, type: 'extension:validation-provider:start', kind: 'commands', commandCount: 2 },
      { ...base, type: 'extension:validation-provider:complete', status: 'passed', message: 'ok' },
      { ...base, type: 'extension:validation-provider:error', status: 'failed', message: 'npm test failed', command: 'npm test', exitCode: 1 },
      { ...base, type: 'extension:validation-provider:timeout', timeoutMs: 5000, command: 'npm test' },
    ];

    for (const event of events) {
      expect(safeParseEforgeEvent(event).success, event.type).toBe(true);
    }
  });

  it('rejects invalid validation provider lifecycle payloads', () => {
    const events = [
      { ...base, type: 'extension:validation-provider:start', kind: 'lint' },
      { ...base, type: 'extension:validation-provider:complete', status: 'failed' },
      { ...base, type: 'extension:validation-provider:error', status: 'passed', message: 'wrong status' },
      { ...base, type: 'extension:validation-provider:timeout', timeoutMs: -1 },
    ];

    for (const event of events) {
      expect(safeParseEforgeEvent(event).success, event.type).toBe(false);
    }
  });
});

describe('eventRegistry — extension validation provider events', () => {
  it('registers validation provider events as session-scoped, non-persistent events with summaries', () => {
    const events = [
      { type: 'extension:validation-provider:start', kind: 'validate', commandCount: 1 },
      { type: 'extension:validation-provider:complete', status: 'skipped', message: 'no commands' },
      { type: 'extension:validation-provider:error', status: 'failed', message: 'boom', command: 'npm test' },
      { type: 'extension:validation-provider:timeout', timeoutMs: 5000, command: 'npm test' },
    ].map((event) => ({
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      providerName: 'custom-validator',
      extensionName: 'quality-ext',
      extensionPath: '/project/.eforge/extensions/quality-ext.ts',
      ...event,
    } as EforgeEvent));

    for (const event of events) {
      expect(eventRegistry[event.type]).toMatchObject({ scope: 'session', persist: false });
      expect(getEventSummary(event)).toContain('quality-ext');
      expect(getEventSummary(event)).toContain('custom-validator');
    }
  });
});

// --- eforge:endregion event-schema-tests ---
