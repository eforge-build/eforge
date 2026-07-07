import { describe, it, expect } from 'vitest';
import { RECOVERY_AUTO_RESUME_MAX_ATTEMPTS, safeParseEforgeEvent } from '../events.schemas.js';
import { DAEMON_EVENT_TYPES, eventRegistry, getEventSummary, isPersistedDaemonEventType } from '../event-registry.js';
import type { BuildFailureSummary, EforgeEvent } from '../events.schemas.js';
import { extensionPolicyGateMatrixVariants, extensionPolicyVariants } from './events-schema-test-helpers.js';

// --- eforge:region event-schema-tests ---

describe('safeParseEforgeEvent — rejection of invalid payloads', () => {
  it('rejects extension:event-handler:failed missing message', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:event-handler:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'audit-log',
      extensionPath: '/project/.eforge/extensions/audit-log.js',
      pattern: '*',
      triggeringEventType: 'plan:build:failed',
    });
    expect(result.success).toBe(false);
  });

  it('rejects extension:event-handler:timeout with non-number timeoutMs', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:event-handler:timeout',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionName: 'audit-log',
      extensionPath: '/project/.eforge/extensions/audit-log.js',
      pattern: '*',
      triggeringEventType: 'plan:build:failed',
      timeoutMs: '5000',
    });
    expect(result.success).toBe(false);
  });

  it('rejects extension:policy:decision with invalid decision literal', () => {
    const result = safeParseEforgeEvent({
      ...extensionPolicyVariants[0]!,
      decision: 'modify',
    });
    expect(result.success).toBe(false);
  });

  it('rejects blocking extension:policy:decision events without a reason', () => {
    const eventMissingReason = { ...extensionPolicyVariants[0]! } as Record<string, unknown>;
    delete eventMissingReason.reason;
    expect(safeParseEforgeEvent(eventMissingReason).success).toBe(false);

    const approvalMissingReason = { ...extensionPolicyGateMatrixVariants[6]! } as Record<string, unknown>;
    delete approvalMissingReason.reason;
    expect(safeParseEforgeEvent(approvalMissingReason).success).toBe(false);
  });

  it('rejects blocking extension:policy:decision events with whitespace-only reasons', () => {
    const blockResult = safeParseEforgeEvent({
      ...extensionPolicyVariants[0]!,
      reason: '   ',
    });
    expect(blockResult.success).toBe(false);
    if (!blockResult.success) {
      expect(blockResult.error.message).toContain('reason');
    }

    const approvalResult = safeParseEforgeEvent({
      ...extensionPolicyGateMatrixVariants[6]!,
      reason: '\t  ',
    });
    expect(approvalResult.success).toBe(false);
    if (!approvalResult.success) {
      expect(approvalResult.error.message).toContain('reason');
    }
  });

  it('rejects extension:policy:timeout with invalid failure policy', () => {
    const result = safeParseEforgeEvent({
      ...extensionPolicyVariants[2]!,
      failurePolicy: 'ignore',
    });
    expect(result.success).toBe(false);
  });

  it('rejects extension policy events missing required provenance fields', () => {
    const eventMissingExtensionPath = { ...extensionPolicyVariants[0]! } as Record<string, unknown>;
    delete eventMissingExtensionPath.extensionPath;
    const result = safeParseEforgeEvent(eventMissingExtensionPath);
    expect(result.success).toBe(false);
  });

  it('rejects extension policy events with invalid registration indexes', () => {
    const result = safeParseEforgeEvent({
      ...extensionPolicyVariants[1]!,
      registrationIndex: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects policy events with missing or mismatched gate-specific target fields', () => {
    expect(safeParseEforgeEvent({
      ...extensionPolicyVariants[0]!,
      planId: undefined,
    }).success).toBe(false);

    expect(safeParseEforgeEvent({
      ...extensionPolicyVariants[1]!,
      method: 'beforePlanMerge',
    }).success).toBe(false);

    expect(safeParseEforgeEvent({
      ...extensionPolicyVariants[2]!,
      baseBranch: undefined,
    }).success).toBe(false);
  });

  it('rejects plan:status:change with an invalid status value', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:status:change',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      status: 'not-a-real-status',
    });
    expect(result.success).toBe(false);
  });

  it('rejects plan:status:change missing planId', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:status:change',
      timestamp: '2025-01-01T00:00:00.000Z',
      status: 'running',
    });
    expect(result.success).toBe(false);
  });

  it('rejects plan:error:set missing error field', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:error:set',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects merge:worktree:set missing path field', () => {
    const result = safeParseEforgeEvent({
      type: 'merge:worktree:set',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an entirely unknown event type', () => {
    const result = safeParseEforgeEvent({
      type: 'completely:unknown:event',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an event missing timestamp (required envelope field)', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:status:change',
      planId: 'plan-01',
      status: 'running',
    });
    expect(result.success).toBe(false);
  });

  it('rejects enqueue:complete missing planSet (required typed field)', () => {
    const result = safeParseEforgeEvent({
      type: 'enqueue:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      id: 'x',
      filePath: 'y',
      title: 'z',
      // planSet intentionally omitted
    });
    expect(result.success).toBe(false);
  });

  it('provides a non-empty error message on failure', () => {
    const result = safeParseEforgeEvent({
      type: 'completely:unknown:event',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// agent:start — thinkingCoerced / thinkingOriginal fields (AC #8 precursor)
// ---------------------------------------------------------------------------

describe('safeParseEforgeEvent — acceptance_validation:complete', () => {
  it('accepts a valid acceptance_validation:complete event with passing verdicts', () => {
    const event: EforgeEvent = {
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
      verdicts: [
        { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found at src/login.ts' },
      ],
      source: 'prd',
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts acceptance_validation:complete with fail and unknown verdicts', () => {
    const event: EforgeEvent = {
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found' },
        { criterion: 'Must support OAuth', verdict: 'fail', evidence: 'No OAuth integration found' },
        { criterion: 'Must be accessible', verdict: 'unknown', evidence: 'Cannot verify from diff alone' },
      ],
      source: 'prd',
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts acceptance_validation:complete with optional waivers', () => {
    const event: EforgeEvent = {
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
      verdicts: [
        { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found at src/login.ts' },
      ],
      waivers: ['Out of scope for this iteration'],
      source: 'prd',
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts acceptance_validation:complete with acceptance conflicts and summarizes the conflict count', () => {
    const event: EforgeEvent = {
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must support OAuth', verdict: 'unknown', evidence: 'OAuth flow is not verifiable from diff alone' },
      ],
      acceptanceConflicts: [
        {
          criterion: 'Must support OAuth',
          evidence: 'Acceptance criteria disagree about OAuth scope',
          conflictsWith: 'OAuth is explicitly out of scope',
          scope: 'unknown',
          recommendedAction: 'manual_review',
        },
      ],
      source: 'prd',
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
    expect(getEventSummary(event)).toBe('Acceptance validation inconclusive: 1 criterion/criteria unknown; no criterion was verified (1 conflict(s) reported)');
  });

  it('rejects acceptance_validation:complete passed:true with non-passing verdicts unless waived', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
      verdicts: [
        { criterion: 'Must support OAuth', verdict: 'fail', evidence: 'No OAuth integration found' },
      ],
      source: 'prd',
    });
    expect(result.success).toBe(false);

    const waived = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
      verdicts: [
        { criterion: 'Must support OAuth', verdict: 'fail', evidence: 'No OAuth integration found' },
      ],
      waivers: ['OAuth is explicitly out of scope for this iteration'],
      source: 'prd',
    });
    expect(waived.success).toBe(true);
  });

  it('rejects acceptance_validation:complete passed:false with all-passing verdicts', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found' },
      ],
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with blank waiver reason entries', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
      verdicts: [
        { criterion: 'Must support OAuth', verdict: 'fail', evidence: 'No OAuth integration found' },
      ],
      waivers: ['   '],
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with empty criterion string', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: '', verdict: 'fail', evidence: 'Something is missing' },
      ],
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with empty evidence string', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must support login', verdict: 'fail', evidence: '' },
      ],
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with invalid verdict literal', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must support login', verdict: 'maybe', evidence: 'Some evidence' },
      ],
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with invalid acceptance conflicts', () => {
    const missingConflictsWith = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must support login', verdict: 'unknown', evidence: 'Conflicting acceptance criteria' },
      ],
      acceptanceConflicts: [
        {
          criterion: 'Must support login',
          evidence: 'Conflicting acceptance criteria',
          scope: 'unknown',
          recommendedAction: 'manual_review',
        },
      ],
      source: 'prd',
    });
    expect(missingConflictsWith.success).toBe(false);

    const invalidRecommendedAction = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must support login', verdict: 'unknown', evidence: 'Conflicting acceptance criteria' },
      ],
      acceptanceConflicts: [
        {
          criterion: 'Must support login',
          evidence: 'Conflicting acceptance criteria',
          conflictsWith: 'Login is out of scope',
          scope: 'unknown',
          recommendedAction: 'ignore_conflict',
        },
      ],
      source: 'prd',
    });
    expect(invalidRecommendedAction.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with empty verdicts array', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
      verdicts: [],
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with missing passed field', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      verdicts: [
        { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found' },
      ],
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with missing verdicts field', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      source: 'prd',
    });
    expect(result.success).toBe(false);
  });

  it('rejects acceptance_validation:complete with missing source field', () => {
    const result = safeParseEforgeEvent({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must support login', verdict: 'fail', evidence: 'Login component missing' },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('safeParseEforgeEvent — gap_close:complete requires passed', () => {
  it('accepts gap_close:complete with passed: true', () => {
    const event: EforgeEvent = {
      type: 'gap_close:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts gap_close:complete with passed: false', () => {
    const event: EforgeEvent = {
      type: 'gap_close:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('rejects gap_close:complete without a passed field', () => {
    const result = safeParseEforgeEvent({
      type: 'gap_close:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('eventRegistry — validation evidence summaries', () => {
  it('summarizes gap_close:complete using the required passed verdict', () => {
    expect(getEventSummary({
      type: 'gap_close:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
    })).toBe('Gap closing complete: all gaps resolved');
    expect(getEventSummary({
      type: 'gap_close:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
    })).toBe('Gap closing complete: gaps remain');
  });

  it('registers and summarizes acceptance_validation:complete events', () => {
    expect(eventRegistry['acceptance_validation:complete']).toMatchObject({
      scope: 'session',
      persist: false,
    });
    expect(getEventSummary({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: true,
      verdicts: [
        { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found' },
      ],
      source: 'prd',
    })).toBe('Acceptance validation passed: 1 criterion/criteria verified');
    expect(getEventSummary({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found' },
        { criterion: 'Must support OAuth', verdict: 'fail', evidence: 'OAuth not found' },
        { criterion: 'Must be accessible', verdict: 'unknown', evidence: 'Cannot verify from diff' },
      ],
      source: 'prd',
    })).toBe('Acceptance validation failed: 1 criterion/criteria failed, 1 unknown');
  });

  it('summarizes all-unknown failed acceptance_validation:complete events as inconclusive', () => {
    const summary = getEventSummary({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must support OAuth', verdict: 'unknown', evidence: 'Cannot verify from diff' },
        { criterion: 'Must support SSO', verdict: 'unknown', evidence: 'Cannot verify from diff' },
      ],
      source: 'prd',
    });

    expect(summary).toContain('inconclusive');
    expect(summary).toContain('2 criterion/criteria unknown');
    expect(summary).toContain('no criterion was verified');
    expect(summary).not.toContain('not passed');
  });

  it('summarizes mixed fail and unknown acceptance_validation:complete events with separate counts', () => {
    expect(getEventSummary({
      type: 'acceptance_validation:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      passed: false,
      verdicts: [
        { criterion: 'Must reject invalid tokens', verdict: 'fail', evidence: 'Invalid token request succeeded' },
        { criterion: 'Must expose audit trail', verdict: 'unknown', evidence: 'No deterministic proof found' },
        { criterion: 'Must support login', verdict: 'pass', evidence: 'Login proof found' },
      ],
      source: 'prd',
    })).toBe('Acceptance validation failed: 1 criterion/criteria failed, 1 unknown');
  });
});

describe('recovery:summary event — optional BuildFailureSummary fields', () => {
  function makeBaseSummary() {
    return {
      prdId: 'prd-1',
      setName: 'my-set',
      featureBranch: 'eforge/my-set',
      baseBranch: 'main',
      plans: [{ planId: 'acceptance-validation', status: 'failed' }],
      failingPlan: { planId: 'acceptance-validation' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: ['claude-sonnet-4-5'],
      failedAt: '2025-01-01T00:00:00.000Z',
      partial: true,
    };
  }

  it('accepts a recovery:summary event with no optional fields', () => {
    const event: EforgeEvent = {
      type: 'recovery:summary',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-1',
      summary: makeBaseSummary(),
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with terminalFailure field', () => {
    const event: EforgeEvent = {
      type: 'recovery:summary',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-1',
      summary: {
        ...makeBaseSummary(),
        terminalFailure: {
          stage: 'acceptance-validation',
          phaseSummary: 'All acceptance criteria failed',
          phaseStatus: 'failed',
          eventType: 'acceptance_validation:complete',
        },
      },
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with acceptanceValidation field including unknown verdicts', () => {
    const event: EforgeEvent = {
      type: 'recovery:summary',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-2',
      summary: {
        ...makeBaseSummary(),
        acceptanceValidation: {
          passed: false,
          total: 2,
          pass: 0,
          fail: 0,
          unknown: 2,
          verdicts: [
            { criterion: 'Must support login', verdict: 'unknown', evidence: 'Cannot verify login from diff alone' },
            { criterion: 'Must support OAuth', verdict: 'unknown', evidence: 'Cannot verify OAuth from diff alone' },
          ],
        },
      },
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with validationCommands field', () => {
    const event: EforgeEvent = {
      type: 'recovery:summary',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-1',
      summary: {
        ...makeBaseSummary(),
        validationCommands: [
          { command: 'pnpm type-check', exitCode: 0, output: 'No errors found' },
          { command: 'pnpm test', exitCode: 1, output: 'Test failed' },
        ],
      },
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with landing field', () => {
    const event: EforgeEvent = {
      type: 'recovery:summary',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-1',
      summary: {
        ...makeBaseSummary(),
        landing: {
          status: 'skipped',
          action: 'pr',
          reason: 'Acceptance validation failed — landing skipped',
        },
      },
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with all optional fields combined', () => {
    const event: EforgeEvent = {
      type: 'recovery:summary',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-full',
      summary: {
        ...makeBaseSummary(),
        terminalFailure: {
          stage: 'acceptance-validation',
          phaseStatus: 'failed',
          eventType: 'acceptance_validation:complete',
        },
        acceptanceValidation: {
          passed: false,
          total: 3,
          pass: 1,
          fail: 0,
          unknown: 2,
          verdicts: [
            { criterion: 'Must support login', verdict: 'pass', evidence: 'Login component found' },
            { criterion: 'Must support OAuth', verdict: 'unknown', evidence: 'Cannot determine OAuth from diff' },
            { criterion: 'Must be accessible', verdict: 'unknown', evidence: 'Cannot verify accessibility from diff' },
          ],
        },
        validationCommands: [
          { command: 'pnpm type-check', exitCode: 0, output: 'No errors' },
        ],
        landing: {
          status: 'skipped',
          reason: 'Acceptance validation failed',
        },
      },
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });
});

describe('recovery:summary event — multi-plan optional fields', () => {
  /**
   * Base summary with one failed plan — used as the foundation for optional-field tests.
   * Uses unknown cast because BuildFailureSummary / EforgeEvent types do not yet have
   * the new fields (failingPlans, commitSha, testPassed, testFailed, completedAt,
   * toolUseCount); the type definitions will be updated by this plan's implementation.
   */
  function makeBaseSummary() {
    return {
      prdId: 'prd-multi',
      setName: 'multi-plan-set',
      featureBranch: 'eforge/multi-plan-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01', status: 'merged' },
        { planId: 'plan-02', status: 'failed', error: 'API error 529: overloaded_error' },
      ],
      failingPlan: { planId: 'plan-02' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };
  }

  it('accepts recovery:summary with failingPlans array containing multiple FailingPlanEntry items', () => {
    const event = {type: 'recovery:summary',timestamp: '2026-05-26T06:15:10.000Z',prdId: 'prd-multi',summary: {...makeBaseSummary(),failingPlans: [{planId: 'plan-02',errorMessage: 'API error 529: overloaded_error',terminalSubtype: 'error_transient_transport'},{planId: 'plan-03',errorMessage: 'API error 529: overloaded_error',terminalSubtype: 'error_transient_transport'},],},};
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with PlanSummaryEntry items containing commitSha', () => {
    const event = {type: 'recovery:summary',timestamp: '2026-05-26T06:15:10.000Z',prdId: 'prd-multi',summary: {...makeBaseSummary(),plans: [{planId: 'plan-01',status: 'merged',commitSha: 'abc1234def5678901234567890abcdef12345678'},{planId: 'plan-02',status: 'failed',error: 'API error 529: overloaded_error'},],},};
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with PlanSummaryEntry items containing testPassed and testFailed counts', () => {
    const event = {type: 'recovery:summary',timestamp: '2026-05-26T06:15:10.000Z',prdId: 'prd-multi',summary: {...makeBaseSummary(),plans: [{planId: 'plan-01',status: 'merged',testPassed: 42,testFailed: 0},{planId: 'plan-02',status: 'failed',error: 'API error 529'},],},};
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with PlanSummaryEntry items containing completedAt timestamp', () => {
    const event = {type: 'recovery:summary',timestamp: '2026-05-26T06:15:10.000Z',prdId: 'prd-multi',summary: {...makeBaseSummary(),plans: [{planId: 'plan-01',status: 'merged',completedAt: '2026-05-26T05:30:00.000Z'},{planId: 'plan-02',status: 'failed',error: 'API error 529'},],},};
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with PlanSummaryEntry items containing toolUseCount', () => {
    const event = {type: 'recovery:summary',timestamp: '2026-05-26T06:15:10.000Z',prdId: 'prd-multi',summary: {...makeBaseSummary(),plans: [{planId: 'plan-01',status: 'merged'},{planId: 'plan-02',status: 'failed',error: 'API error 529',toolUseCount: 3},],},};
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with failingPlans entries containing toolUseCount', () => {
    const event = {type: 'recovery:summary',timestamp: '2026-05-26T06:15:10.000Z',prdId: 'prd-multi',summary: {...makeBaseSummary(),failingPlans: [{planId: 'plan-02',errorMessage: 'API error 529',terminalSubtype: 'error_transient_transport',toolUseCount: 5},],},};
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with all new multi-plan optional fields combined', () => {
    const event = {type: 'recovery:summary',timestamp: '2026-05-26T06:15:10.000Z',prdId: 'prd-multi-full',summary: {prdId: 'prd-multi-full',setName: 'multi-plan-set',featureBranch: 'eforge/multi-plan-set',baseBranch: 'main',plans: [{planId: 'plan-01',status: 'merged',commitSha: 'abc1234def5678901234567890abcdef12345678',completedAt: '2026-05-26T05:30:00.000Z',testPassed: 20,testFailed: 0,},{planId: 'plan-02',status: 'merged',completedAt: '2026-05-26T05:45:00.000Z',},{planId: 'plan-04',status: 'failed',error: 'API error 529: overloaded_error',toolUseCount: 3,},{planId: 'plan-06',status: 'failed',error: 'API error 529: overloaded_error',toolUseCount: 0,},] satisfies BuildFailureSummary['plans'],failingPlan: {planId: 'plan-06'},failingPlans: [{planId: 'plan-04',errorMessage: 'API error 529: overloaded_error',terminalSubtype: 'error_transient_transport',toolUseCount: 3},{planId: 'plan-06',errorMessage: 'API error 529: overloaded_error',terminalSubtype: 'error_transient_transport',toolUseCount: 0},],landedCommits: [{sha: 'abc1234def5678901234567890abcdef12345678',subject: 'feat: plan-01',author: 'Test',date: '2026-05-26T05:30:00.000Z'},],diffStat: '10 files changed',modelsUsed: ['claude-sonnet-4-6'],failedAt: '2026-05-26T06:15:10.000Z',},} satisfies EforgeEvent;
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });

  it('rejects recovery:summary when failingPlans is a string instead of an array', () => {
    const event = {type: 'recovery:summary',timestamp: '2026-05-26T06:15:10.000Z',prdId: 'prd-multi',summary: {...makeBaseSummary(),failingPlans: 'not-array',},};
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(false);
  });

  it('rejects PlanSummaryEntry when testPassed is a string instead of a number', () => {
    const event = {type: 'recovery:summary',timestamp: '2026-05-26T06:15:10.000Z',prdId: 'prd-multi',summary: {...makeBaseSummary(),plans: [{planId: 'plan-01',status: 'merged',testPassed: '42'},],},};
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(false);
  });

  it('rejects PlanSummaryEntry when toolUseCount is a string instead of a number', () => {
    const event = {type: 'recovery:summary',timestamp: '2026-05-26T06:15:10.000Z',prdId: 'prd-multi',summary: {...makeBaseSummary(),plans: [{planId: 'plan-01',status: 'failed',toolUseCount: 'three'},],},};
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(false);
  });

  it('rejects PlanSummaryEntry when commitSha is a number instead of a string', () => {
    const event = {type: 'recovery:summary',timestamp: '2026-05-26T06:15:10.000Z',prdId: 'prd-multi',summary: {...makeBaseSummary(),plans: [{planId: 'plan-01',status: 'merged',commitSha: 12345},],},};
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(false);
  });

  it('rejects FailingPlanEntry when toolUseCount is not a number', () => {
    const event = {type: 'recovery:summary',timestamp: '2026-05-26T06:15:10.000Z',prdId: 'prd-multi',summary: {...makeBaseSummary(),failingPlans: [{planId: 'plan-02',errorMessage: 'err',toolUseCount: 'five'},],},};
    const result = safeParseEforgeEvent(event as unknown as EforgeEvent);
    expect(result.success).toBe(false);
  });

  it('existing recovery:summary without new fields still validates (backward compatibility)', () => {
    // Legacy sidecars without failingPlans, commitSha, testPassed, etc. must still parse cleanly.
    const event: EforgeEvent = {
      type: 'recovery:summary',
      timestamp: '2026-05-26T06:15:10.000Z',
      prdId: 'prd-legacy',
      summary: {
        prdId: 'prd-legacy',
        setName: 'legacy-set',
        featureBranch: 'eforge/legacy-set',
        baseBranch: 'main',
        plans: [{ planId: 'plan-01', status: 'failed', error: 'Type error' }],
        failingPlan: { planId: 'plan-01', errorMessage: 'Type error' },
        landedCommits: [],
        diffStat: '',
        modelsUsed: [],
        failedAt: '2026-05-26T06:15:10.000Z',
      },
    };
    const result = safeParseEforgeEvent(event);
    expect(result.success).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// plan:build:review:fix:continuation and review-fixer agent:retry variants
// ---------------------------------------------------------------------------

describe('safeParseEforgeEvent — recovery auto-resume policy events', () => {
  const timestamp = '2026-05-26T06:15:10.000Z';

  const validEvents = [
    {
      type: 'recovery:auto-resume:evaluate',
      timestamp,
      prdId: 'prd-auto-resume',
      setName: 'set-auto-resume',
      enabled: false,
      attempt: 0,
      maxAttempts: 1,
    },
    {
      type: 'recovery:auto-resume:stopped',
      timestamp,
      prdId: 'prd-auto-resume',
      setName: 'set-auto-resume',
      reason: 'disabled',
      attempt: 0,
      maxAttempts: 1,
      message: 'Recovery auto-resume is disabled by configuration.',
    },
    {
      type: 'recovery:auto-resume:queued',
      timestamp,
      prdId: 'prd-auto-resume',
      setName: 'set-auto-resume',
      action: 'continue-repair',
      attempt: 1,
      maxAttempts: 1,
    },
  ] satisfies EforgeEvent[];

  const auditBudgetEvents = [
    { ...validEvents[0], maxAttempts: 0 },
    { ...validEvents[1], maxAttempts: 0 },
  ] satisfies EforgeEvent[];

  it('accepts valid typed recovery auto-resume fixtures', () => {
    for (const event of [...validEvents, ...auditBudgetEvents]) {
      expect(safeParseEforgeEvent(event).success, event.type).toBe(true);
    }
  });

  it('registers recovery auto-resume events as persisted daemon audit events', () => {
    for (const { type } of validEvents) {
      expect(eventRegistry[type]).toMatchObject({ scope: 'daemon', persist: true });
      expect(DAEMON_EVENT_TYPES).toContain(type);
      expect(isPersistedDaemonEventType(type)).toBe(true);
    }
  });

  it('rejects invalid recovery auto-resume fixtures', () => {
    expect(safeParseEforgeEvent({ ...validEvents[0], maxAttempts: -1 }).success).toBe(false);
    expect(safeParseEforgeEvent({ ...validEvents[1], reason: 'secret-third-option' }).success).toBe(false);
    expect(safeParseEforgeEvent({ ...validEvents[2], action: 'retry' }).success).toBe(false);
    expect(safeParseEforgeEvent({ ...validEvents[2], attempt: 0 }).success).toBe(false);
    expect(safeParseEforgeEvent({ ...validEvents[2], maxAttempts: 0 }).success).toBe(false);
    expect(safeParseEforgeEvent({ ...validEvents[0], maxAttempts: RECOVERY_AUTO_RESUME_MAX_ATTEMPTS + 1 }).success).toBe(false);
  });

  it('rejects queued recovery auto-resume attempts that exceed maxAttempts while allowing exhausted audit states', () => {
    expect(safeParseEforgeEvent({ ...validEvents[0], attempt: 2, maxAttempts: 1 }).success).toBe(true);
    expect(safeParseEforgeEvent({ ...validEvents[1], attempt: 2, maxAttempts: 1 }).success).toBe(true);
    expect(safeParseEforgeEvent({ ...validEvents[2], attempt: 2, maxAttempts: 1 }).success).toBe(false);
  });

  it('accepts every documented recovery auto-resume stopped reason', () => {
    for (const reason of [
      'disabled',
      'attempt-budget-exhausted',
      'not-continue-repair',
      'not-high-confidence',
      'not-eligible',
      'manual-confirmation-required',
      'partial-sidecar',
      'malformed-sidecar',
      'missing-sidecar',
      'ineligible-artifacts',
      'dirty-worktree',
      'conflicting-worktree',
      'queue-preflight-blocked',
      'conflicting-applied-marker',
      'active-gate-or-hold',
      'repeated-failure-signature',
      'error',
    ]) {
      expect(safeParseEforgeEvent({ ...validEvents[1], reason }).success, reason).toBe(true);
    }
  });

  it('summarizes recovery auto-resume policy events with PRD and budget or reason context', () => {
    expect(getEventSummary(validEvents[0])).toContain('prd-auto-resume');
    expect(getEventSummary(validEvents[0])).toContain('0/1');
    expect(getEventSummary(validEvents[2])).toContain('prd-auto-resume');
    expect(getEventSummary(validEvents[2])).toContain('1/1');
    expect(getEventSummary(validEvents[1])).toContain('prd-auto-resume');
    expect(getEventSummary(validEvents[1])).toContain('disabled');
  });
});


describe('safeParseEforgeEvent — recovery:summary with multi-failure fields', () => {
  const baseRecoverySummaryEvent = {
    type: 'recovery:summary',
    timestamp: '2026-05-26T06:15:10.000Z',
    prdId: 'add-eforge-console-side-by-side',
    summary: {
      prdId: 'add-eforge-console-side-by-side',
      setName: 'multi-plan-set',
      featureBranch: 'eforge/multi-plan-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01-console-shell', status: 'merged' },
        { planId: 'plan-02-activity-audit-view', status: 'merged' },
        { planId: 'plan-04-queue-view', status: 'failed', error: 'API error 529' },
        { planId: 'plan-06-static-serving', status: 'failed', error: 'API error 529' },
      ],
      failingPlan: {
        planId: 'plan-06-static-serving',
        errorMessage: 'API error 529',
        terminalSubtype: 'error_transient_transport',
      },
      landedCommits: [],
      diffStat: '',
      modelsUsed: ['claude-sonnet-4-6'],
      failedAt: '2026-05-26T06:15:10.000Z',
    },
  };

  it('accepts recovery:summary without new optional fields (legacy)', () => {
    const result = safeParseEforgeEvent(baseRecoverySummaryEvent);
    expect(result.success).toBe(true);
  });

  it('rejects recovery:summary reviewFailure issue metadata beyond bounded depth', () => {
    const result = safeParseEforgeEvent({
      ...baseRecoverySummaryEvent,
      summary: {
        ...baseRecoverySummaryEvent.summary,
        reviewFailure: {
          planId: 'plan-06-static-serving',
          issues: [{
            severity: 'critical',
            category: 'validation-provider',
            file: 'src/a.ts',
            description: 'deep metadata',
            metadata: { a: { b: { c: { d: { e: { f: { g: { h: { i: 'too deep' } } } } } } } } },
          }],
        },
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('/summary/reviewFailure/issues/0/metadata');
    }
  });

  it('accepts recovery:summary with failingPlans array', () => {
    const result = safeParseEforgeEvent({
      ...baseRecoverySummaryEvent,
      summary: {
        ...baseRecoverySummaryEvent.summary,
        failingPlans: [
          {
            planId: 'plan-04-queue-view',
            errorMessage: 'API error 529',
            terminalSubtype: 'error_transient_transport',
            toolUseCount: 3,
          },
          {
            planId: 'plan-06-static-serving',
            errorMessage: 'API error 529',
            terminalSubtype: 'error_transient_transport',
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with enriched plan entries (commitSha, testPassed, testFailed)', () => {
    const result = safeParseEforgeEvent({
      ...baseRecoverySummaryEvent,
      summary: {
        ...baseRecoverySummaryEvent.summary,
        plans: [
          {
            planId: 'plan-01-console-shell',
            status: 'merged',
            mergedAt: '2026-05-26T05:05:00.000Z',
            commitSha: 'abc1234def5678901234567890abcdef12345678',
          },
          {
            planId: 'plan-02-activity-audit-view',
            status: 'merged',
            testPassed: 42,
            testFailed: 0,
          },
          {
            planId: 'plan-04-queue-view',
            status: 'failed',
            error: 'API error 529',
            terminalSubtype: 'error_transient_transport',
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts recovery:summary with completedAt on plan entries', () => {
    const result = safeParseEforgeEvent({
      ...baseRecoverySummaryEvent,
      summary: {
        ...baseRecoverySummaryEvent.summary,
        plans: [
          {
            planId: 'plan-01-console-shell',
            status: 'merged',
            completedAt: '2026-05-26T05:30:00.000Z',
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts failingPlan with toolUseCount', () => {
    const result = safeParseEforgeEvent({
      ...baseRecoverySummaryEvent,
      summary: {
        ...baseRecoverySummaryEvent.summary,
        failingPlan: {
          planId: 'plan-06-static-serving',
          errorMessage: 'API error 529',
          terminalSubtype: 'error_transient_transport',
          toolUseCount: 0,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('round-trips recovery:summary with all new optional fields through JSON', () => {
    const event = {
      ...baseRecoverySummaryEvent,
      summary: {
        ...baseRecoverySummaryEvent.summary,
        plans: [
          {
            planId: 'plan-01-console-shell',
            status: 'merged',
            commitSha: 'abc1234',
            testPassed: 10,
            testFailed: 0,
            completedAt: '2026-05-26T05:30:00.000Z',
          },
        ],
        failingPlans: [
          {
            planId: 'plan-04-queue-view',
            errorMessage: 'API error 529',
            toolUseCount: 3,
          },
        ],
      },
    };
    const parsed = JSON.parse(JSON.stringify(event));
    expect(parsed).toEqual(event);
    const result = safeParseEforgeEvent(parsed);
    expect(result.success).toBe(true);
  });
});


// --- eforge:endregion event-schema-tests ---
