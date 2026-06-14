import { describe, expect, it } from 'vitest';
import {
  getSessionPlanDimensionSpec,
  validateSessionPlanCreationDraftReadiness,
} from '../packages/input/src/index.js';

const BUGFIX_FOCUSED_REQUIRED = [
  'problem-statement',
  'reproduction-steps',
  'root-cause',
  'acceptance-criteria',
  'assumptions-and-validation',
] as const;

function bugfixFocusedDraft(overrides: Record<string, unknown> = {}) {
  return {
    session: 'fix-fast-ux',
    topic: 'Fix fast UX bugs',
    planningType: 'bugfix',
    planningDepth: 'focused',
    sections: [
      { dimension: 'problem-statement', content: 'The fast UX flow regresses when filters refresh.' },
      { dimension: 'reproduction-steps', content: 'Open the dashboard, apply a filter, and refresh the results.' },
      { dimension: 'root-cause', content: 'The filter state is reset before the refresh callback reads it.' },
      { dimension: 'acceptance-criteria', content: '- Dashboard preserves selected filters after refresh.' },
      { dimension: 'assumptions-and-validation', content: 'Validate with targeted UI tests and a manual smoke check.' },
    ],
    skippedDimensions: [],
    ...overrides,
  };
}

describe('validateSessionPlanCreationDraftReadiness', () => {
  it('exports the canonical bugfix/focused readiness dimensions used by creation drafts', () => {
    expect(getSessionPlanDimensionSpec('bugfix', 'focused')).toMatchObject({
      required: [...BUGFIX_FOCUSED_REQUIRED],
      optional: [],
    });
  });

  it('returns valid for a bugfix/focused draft covering every required dimension', () => {
    const result = validateSessionPlanCreationDraftReadiness(bugfixFocusedDraft());

    expect(result).toMatchObject({
      valid: true,
      planningType: 'bugfix',
      planningDepth: 'focused',
      requiredDimensions: [...BUGFIX_FOCUSED_REQUIRED],
      unknownDimensions: [],
      missingDimensions: [],
      coveredDimensions: [...BUGFIX_FOCUSED_REQUIRED],
      skippedDimensions: [],
    });
  });

  it('returns valid when a required dimension is explicitly skipped with a non-empty reason', () => {
    const result = validateSessionPlanCreationDraftReadiness(bugfixFocusedDraft({
      sections: [
        { dimension: 'problem-statement', content: 'The fast UX flow regresses when filters refresh.' },
        { dimension: 'reproduction-steps', content: 'Open the dashboard, apply a filter, and refresh the results.' },
        { dimension: 'acceptance-criteria', content: '- Dashboard preserves selected filters after refresh.' },
        { dimension: 'assumptions-and-validation', content: 'Validate with targeted UI tests and a manual smoke check.' },
      ],
      skippedDimensions: [{ dimension: 'root-cause', reason: 'Root cause needs production telemetry and is tracked as follow-up input.' }],
    }));

    expect(result.valid).toBe(true);
    expect(result.coveredDimensions.sort()).toEqual([
      'acceptance-criteria',
      'assumptions-and-validation',
      'problem-statement',
      'reproduction-steps',
    ]);
    expect(result.skippedDimensions).toEqual(['root-cause']);
    expect(result.missingDimensions).toEqual([]);
  });

  it('returns invalid and names a required dimension that is neither covered nor skipped', () => {
    const result = validateSessionPlanCreationDraftReadiness(bugfixFocusedDraft({
      sections: [
        { dimension: 'reproduction-steps', content: 'Open the dashboard, apply a filter, and refresh the results.' },
        { dimension: 'root-cause', content: 'The filter state is reset before the refresh callback reads it.' },
        { dimension: 'acceptance-criteria', content: '- Dashboard preserves selected filters after refresh.' },
        { dimension: 'assumptions-and-validation', content: 'Validate with targeted UI tests and a manual smoke check.' },
      ],
    }));

    expect(result.valid).toBe(false);
    expect(result.missingDimensions).toContain('problem-statement');
    expect(result.messages.join('\n')).toContain('missing required dimension ids: problem-statement');
  });

  it('returns invalid and lists display-heading aliases as unknown dimension ids', () => {
    const result = validateSessionPlanCreationDraftReadiness(bugfixFocusedDraft({
      sections: [
        { dimension: 'Goal', content: 'Fix the grouped UX bug quickly.' },
        { dimension: 'Scope', content: 'Limit the fix to dashboard refresh behavior.' },
        { dimension: 'Validation', content: 'Run the dashboard test suite.' },
      ],
    }));

    expect(result.valid).toBe(false);
    expect(result.unknownDimensions).toEqual(expect.arrayContaining(['Goal', 'Scope', 'Validation']));
    expect(result.messages.join('\n')).toContain('unknown dimension ids: Goal, Scope, Validation');
    expect(result.messages.join('\n')).toMatch(/Do not use display-heading aliases.*Goal.*Scope.*Validation/);
  });

  it('returns invalid for acceptance criteria content that fails quality diagnostics', () => {
    const result = validateSessionPlanCreationDraftReadiness(bugfixFocusedDraft({
      sections: [
        { dimension: 'problem-statement', content: 'The fast UX flow regresses when filters refresh.' },
        { dimension: 'reproduction-steps', content: 'Open the dashboard, apply a filter, and refresh the results.' },
        { dimension: 'root-cause', content: 'The filter state is reset before the refresh callback reads it.' },
        { dimension: 'acceptance-criteria', content: '- Works correctly.' },
        { dimension: 'assumptions-and-validation', content: 'Validate with targeted UI tests and a manual smoke check.' },
      ],
    }));

    expect(result.valid).toBe(false);
    expect(result.acDiagnostics?.length).toBeGreaterThan(0);
    expect(result.messages.join('\n')).toMatch(/acceptance criteria/i);
    expect(result.messages.join('\n')).toContain('Works correctly');
  });

  it('returns invalid when a required skip reason is blank', () => {
    const result = validateSessionPlanCreationDraftReadiness(bugfixFocusedDraft({
      sections: [
        { dimension: 'problem-statement', content: 'The fast UX flow regresses when filters refresh.' },
        { dimension: 'reproduction-steps', content: 'Open the dashboard, apply a filter, and refresh the results.' },
        { dimension: 'acceptance-criteria', content: '- Dashboard preserves selected filters after refresh.' },
        { dimension: 'assumptions-and-validation', content: 'Validate with targeted UI tests and a manual smoke check.' },
      ],
      skippedDimensions: [{ dimension: 'root-cause', reason: '   ' }],
    }));

    expect(result.valid).toBe(false);
    expect(result.missingDimensions).toContain('root-cause');
    expect(result.messages.join('\n')).toMatch(/root-cause.*skip reason/i);
  });
});
