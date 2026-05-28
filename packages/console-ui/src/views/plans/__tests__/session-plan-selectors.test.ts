import { describe, it, expect } from 'vitest';
import {
  readinessLabel,
  selectDefaultSession,
  selectDimensionCounts,
  isSessionInList,
} from '../session-plan-selectors';
import type { SessionPlanListEntryWire, SessionPlanDataWire } from '@eforge-build/client/browser';

// ---------------------------------------------------------------------------
// readinessLabel
// ---------------------------------------------------------------------------

describe('readinessLabel', () => {
  it('returns "ready" for true', () => {
    expect(readinessLabel(true)).toBe('ready');
  });

  it('returns "not ready" for false', () => {
    expect(readinessLabel(false)).toBe('not ready');
  });
});

// ---------------------------------------------------------------------------
// selectDefaultSession
// ---------------------------------------------------------------------------

describe('selectDefaultSession', () => {
  it('returns null for an empty plan list', () => {
    expect(selectDefaultSession([])).toBeNull();
  });

  it('returns the session ID of the first plan', () => {
    const plans: SessionPlanListEntryWire[] = [
      {
        session: 'sess-a',
        topic: 'A',
        status: 'planning',
        path: '/a',
        ready: false,
        missingDimensions: [],
      },
      {
        session: 'sess-b',
        topic: 'B',
        status: 'ready',
        path: '/b',
        ready: true,
        missingDimensions: [],
      },
    ];
    expect(selectDefaultSession(plans)).toBe('sess-a');
  });

  it('returns the only plan session when list has one entry', () => {
    const plans: SessionPlanListEntryWire[] = [
      {
        session: 'only-one',
        topic: 'Solo plan',
        status: 'ready',
        path: '/solo',
        ready: true,
        missingDimensions: [],
      },
    ];
    expect(selectDefaultSession(plans)).toBe('only-one');
  });
});

// ---------------------------------------------------------------------------
// selectDimensionCounts
// ---------------------------------------------------------------------------

describe('selectDimensionCounts', () => {
  it('returns zero counts for a plan with no dimensions', () => {
    const plan = {
      required_dimensions: [],
      optional_dimensions: [],
      skipped_dimensions: [],
    } as unknown as SessionPlanDataWire;
    const result = selectDimensionCounts(plan);
    expect(result.required).toBe(0);
    expect(result.optional).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('counts required, optional, and skipped dimensions correctly', () => {
    const plan = {
      required_dimensions: ['problem_statement', 'acceptance_criteria', 'scope'],
      optional_dimensions: ['performance', 'security'],
      skipped_dimensions: [
        { name: 'ui_mockups', reason: 'no UI' },
        { name: 'migration_plan', reason: 'no DB changes' },
      ],
    } as unknown as SessionPlanDataWire;
    const result = selectDimensionCounts(plan);
    expect(result.required).toBe(3);
    expect(result.optional).toBe(2);
    expect(result.skipped).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// isSessionInList
// ---------------------------------------------------------------------------

describe('isSessionInList', () => {
  const plans: SessionPlanListEntryWire[] = [
    {
      session: 'sess-a',
      topic: 'A',
      status: 'planning',
      path: '/a',
      ready: false,
      missingDimensions: [],
    },
    {
      session: 'sess-b',
      topic: 'B',
      status: 'ready',
      path: '/b',
      ready: true,
      missingDimensions: [],
    },
  ];

  it('returns false for a null session', () => {
    expect(isSessionInList(null, plans)).toBe(false);
  });

  it('returns true when the session is in the list', () => {
    expect(isSessionInList('sess-a', plans)).toBe(true);
    expect(isSessionInList('sess-b', plans)).toBe(true);
  });

  it('returns false when the session is not in the list', () => {
    expect(isSessionInList('sess-missing', plans)).toBe(false);
  });

  it('returns false for any session in an empty list', () => {
    expect(isSessionInList('sess-a', [])).toBe(false);
  });
});
