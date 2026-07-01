import { describe, it, expect } from 'vitest';
import { safeParseEforgeEvent } from '../events.schemas.js';
import { eventRegistry } from '../event-registry.js';
import type { EforgeEvent } from '../events.schemas.js';

// --- eforge:region event-schema-tests ---

describe('safeParseEforgeEvent — dynamic perspective keys', () => {
it('accepts plan:build:review:parallel:start with a custom accessibility perspective', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspectives: ['code', 'accessibility'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts plan:build:review:parallel:perspective:start with a custom key', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:perspective:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspective: 'accessibility',
    });
    expect(result.success).toBe(true);
  });

  it('accepts plan:build:review:parallel:perspective:complete with a custom key', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:perspective:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspective: 'accessibility',
      issues: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts plan:build:review:parallel:perspective:error with a custom key', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:perspective:error',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspective: 'accessibility',
      error: 'No extension reviewer registered',
    });
    expect(result.success).toBe(true);
  });

  it('accepts perspectives-inferred with a custom key', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:decision',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      decision: {
        kind: 'perspectives-inferred',
        rationale: 'Inferred from file categories',
        perspectives: ['code', 'accessibility'],
        categories: ['code'],
        rules: ['code-files → code+security'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts perspectives-respawned with custom keys', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:decision',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      decision: {
        kind: 'perspectives-respawned',
        rationale: 'Starting round 2',
        round: 1,
        perspectives: ['code', 'accessibility'],
        dropped: ['performance-review'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects parallel:start with an uppercase perspective key', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspectives: ['CODE'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects parallel:start with a perspective key containing spaces', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspectives: ['my perspective'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects parallel:start with a perspective key starting with a digit', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspectives: ['1code'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects perspective:error with an uppercase perspective key', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:perspective:error',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspective: 'CODE',
      error: 'invalid key',
    });
    expect(result.success).toBe(false);
  });

it('accepts all six built-in perspectives in parallel:start', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:parallel:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      perspectives: ['code', 'security', 'api', 'docs', 'test', 'verify'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts review-profile-chosen planning decision with a custom key', () => {
    const result = safeParseEforgeEvent({
      type: 'planning:decision',
      timestamp: '2025-01-01T00:00:00.000Z',
      decision: {
        kind: 'review-profile-chosen',
        rationale: 'Custom perspective configured',
        strategy: 'parallel',
        perspectives: ['code', 'accessibility'],
        maxRounds: 2,
        evaluatorStrictness: 'standard',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts agent:start with a valid slug perspective key', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      agentId: 'agent-a11y',
      agent: 'reviewer',
      model: 'claude-opus-4-7',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'review',
      tierSource: 'tier',
      runtimeChoice: 'default',
      runtimeChoiceQualified: 'review.default',
      runtimeChoiceSource: 'default',
      perspective: 'accessibility',
    });
    expect(result.success).toBe(true);
  });

  it('rejects agent:start with an unsafe perspective key', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      agentId: 'agent-a11y',
      agent: 'reviewer',
      model: 'claude-opus-4-7',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'review',
      tierSource: 'tier',
      perspective: 'Accessibility Review',
    });
    expect(result.success).toBe(false);
  });
});

describe('safeParseEforgeEvent — review issue traceability', () => {
  it('accepts legacy review-complete and fix-complete events without issue traceability fields', () => {
    expect(safeParseEforgeEvent({
      type: 'plan:build:review:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      issues: [{
        severity: 'warning',
        category: 'style',
        file: 'src/app.ts',
        description: 'Legacy issue without an ID',
      }],
    }).success).toBe(true);

    expect(safeParseEforgeEvent({
      type: 'plan:build:review:fix:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
    }).success).toBe(true);
  });

  it('accepts review issues with issueId', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      issues: [{
        issueId: 'review-issue-1',
        severity: 'critical',
        category: 'bug',
        file: 'src/app.ts',
        description: 'Null dereference',
      }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects whitespace-only issue IDs across traceability fields', () => {
    expect(safeParseEforgeEvent({
      type: 'plan:build:review:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      issues: [{
        issueId: '   ',
        severity: 'critical',
        category: 'bug',
        file: 'src/app.ts',
        description: 'Null dereference',
      }],
    }).success).toBe(false);

    expect(safeParseEforgeEvent({
      type: 'plan:build:review:fix:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      issueReferences: [{ issueId: '   ', status: 'addressed' }],
    }).success).toBe(false);

    expect(safeParseEforgeEvent({
      type: 'plan:build:evaluate:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      accepted: 0,
      rejected: 1,
      verdicts: [{ file: 'src/app.ts', action: 'reject', reason: 'Still broken', issueIds: ['   '] }],
    }).success).toBe(false);
  });

  it('accepts fix-complete issueReferences with all statuses', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:fix:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      issueReferences: [
        { issueId: 'review-issue-1', status: 'addressed', note: 'Patched directly' },
        { issueId: 'review-issue-2', status: 'deferred', note: 'Requires product decision' },
        { issueId: 'review-issue-3', status: 'obsolete' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects fix-complete issueReferences with an invalid status', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:fix:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      issueReferences: [{ issueId: 'review-issue-1', status: 'ignored' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('safeParseEforgeEvent — ReviewIssue validation guidance', () => {
  it('accepts validation guidance fields with structural repair class', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      issues: [{
        severity: 'critical',
        category: 'validation-provider',
        file: 'src/app.ts',
        description: 'Validation provider failed',
        retryGuidance: 'Retry narrowly',
        failureKind: 'domain-signature',
        repairClass: 'structural',
        metadata: { rule: 'guardrail', count: 1, nested: { ok: true } },
        validationProviderName: 'guardrails',
        runtimeFailureKind: 'result',
      }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects validation guidance with an out-of-set repair class', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      issues: [{
        severity: 'critical',
        category: 'validation-provider',
        file: 'src/app.ts',
        description: 'Validation provider failed',
        repairClass: 'random',
      }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects validation guidance metadata beyond bounded wire string length', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      issues: [{
        severity: 'critical',
        category: 'validation-provider',
        file: 'src/app.ts',
        description: 'Validation provider failed',
        metadata: { value: 'x'.repeat(4097) },
      }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects validation guidance metadata beyond bounded wire depth', () => {
    let nested: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 9; i++) nested = { child: nested };

    const result = safeParseEforgeEvent({
      type: 'plan:build:review:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      issues: [{
        severity: 'critical',
        category: 'validation-provider',
        file: 'src/app.ts',
        description: 'Validation provider failed',
        metadata: nested,
      }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects validation guidance metadata beyond bounded wire node count', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      issues: [{
        severity: 'critical',
        category: 'validation-provider',
        file: 'src/app.ts',
        description: 'Validation provider failed',
        metadata: { values: Array.from({ length: 199 }, (_, index) => index) },
      }],
    });
    expect(result.success).toBe(false);
  });

  it('does not apply ReviewIssue metadata bounds to unrelated unknown payloads', () => {
    let nested: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 9; i++) nested = { child: nested };

    const result = safeParseEforgeEvent({
      type: 'agent:tool_use',
      timestamp: '2025-01-01T00:00:00.000Z',
      agentId: 'agent-01',
      agent: 'builder',
      tool: 'example',
      toolUseId: 'toolu-01',
      input: { issues: [{ metadata: nested }] },
    });
    expect(result.success).toBe(true);
  });
});

describe('safeParseEforgeEvent — plan:build:review:fix:continuation', () => {
  it('accepts plan:build:review:fix:continuation with required fields', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:fix:continuation',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      attempt: 1,
      maxContinuations: 2,
    });
    expect(result.success).toBe(true);
  });

  it('rejects plan:build:review:fix:continuation missing planId', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:fix:continuation',
      timestamp: '2025-01-01T00:00:00.000Z',
      attempt: 1,
      maxContinuations: 2,
    });
    expect(result.success).toBe(false);
  });

  it('rejects plan:build:review:fix:continuation missing attempt', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:fix:continuation',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      maxContinuations: 2,
    });
    expect(result.success).toBe(false);
  });

  it('rejects plan:build:review:fix:continuation missing maxContinuations', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:fix:continuation',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      attempt: 1,
    });
    expect(result.success).toBe(false);
  });

  it('round-trips through JSON', () => {
    const event: EforgeEvent = {
      type: 'plan:build:review:fix:continuation',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-42',
      attempt: 2,
      maxContinuations: 2,
    };
    const parsed = JSON.parse(JSON.stringify(event));
    const result = safeParseEforgeEvent(parsed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(event);
    }
  });
});

describe('safeParseEforgeEvent — review-fixer agent:retry payload', () => {
  it('accepts agent:retry with agent review-fixer and error_max_turns', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:retry',
      timestamp: '2025-01-01T00:00:00.000Z',
      agent: 'review-fixer',
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_max_turns',
      label: 'review-fixer-continuation',
      planId: 'plan-42',
    });
    expect(result.success).toBe(true);
  });

  it('accepts agent:retry for review-fixer without planId', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:retry',
      timestamp: '2025-01-01T00:00:00.000Z',
      agent: 'review-fixer',
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_max_turns',
      label: 'review-fixer-continuation',
    });
    expect(result.success).toBe(true);
  });

  it('accepts agent:retry for review-fixer with any valid AgentTerminalSubtype (schema not restricted to error_max_turns)', () => {
    // The schema accepts any valid AgentTerminalSubtype — policy filtering is runtime-only.
    const result = safeParseEforgeEvent({
      type: 'agent:retry',
      timestamp: '2025-01-01T00:00:00.000Z',
      agent: 'review-fixer',
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_during_execution',
      label: 'review-fixer-continuation',
    });
    expect(result.success).toBe(true);
  });

  it('rejects agent:retry missing agent field', () => {
    const result = safeParseEforgeEvent({
      type: 'agent:retry',
      timestamp: '2025-01-01T00:00:00.000Z',
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_max_turns',
      label: 'review-fixer-continuation',
    });
    expect(result.success).toBe(false);
  });
});



// ---------------------------------------------------------------------------
// recovery:summary — multi-failure and enriched plan entry fields
// ---------------------------------------------------------------------------

const reviewCycleRoundLifecyclePayloads = [{ type: 'plan:build:review:start', planId: 'plan-01' }, { type: 'plan:build:review:complete', planId: 'plan-01', issues: [] }, { type: 'plan:build:review:parallel:start', planId: 'plan-01', perspectives: ['code'] }, { type: 'plan:build:review:parallel:perspective:start', planId: 'plan-01', perspective: 'code' }, { type: 'plan:build:review:parallel:perspective:complete', planId: 'plan-01', perspective: 'code', issues: [] }, { type: 'plan:build:review:parallel:perspective:error', planId: 'plan-01', perspective: 'code', error: 'timeout' }, { type: 'plan:build:review:fix:start', planId: 'plan-01', issueCount: 1 }, { type: 'plan:build:review:fix:complete', planId: 'plan-01' }, { type: 'plan:build:review:fix:continuation', planId: 'plan-01', attempt: 1, maxContinuations: 2 }, { type: 'plan:build:evaluate:start', planId: 'plan-01' }, { type: 'plan:build:evaluate:continuation', planId: 'plan-01', attempt: 1, maxContinuations: 2 }, { type: 'plan:build:evaluate:complete', planId: 'plan-01', accepted: 1, rejected: 0 }] as const;

describe('safeParseEforgeEvent — review-cycle round metadata', () => {
  it('accepts all lifecycle variants with round 0 and without round, and rejects a negative round', () => {
    for (const payload of reviewCycleRoundLifecyclePayloads) {
      expect(safeParseEforgeEvent({ timestamp: '2025-01-01T00:00:00.000Z', ...payload, round: 0 }).success, payload.type).toBe(true);
      expect(safeParseEforgeEvent({ timestamp: '2025-01-01T00:00:00.000Z', ...payload }).success, payload.type).toBe(true);
      expect(safeParseEforgeEvent({ timestamp: '2025-01-01T00:00:00.000Z', ...payload, round: -1 }).success, payload.type).toBe(false);
      const meta = (eventRegistry as Record<string, { scope: string; persist: boolean }>)[payload.type];
      expect(meta).toMatchObject({ scope: 'session', persist: false });
    }
  });
});

// --- eforge:endregion event-schema-tests ---
