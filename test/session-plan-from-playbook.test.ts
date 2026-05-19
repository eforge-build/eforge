/**
 * Tests for `createSessionPlanFromPlaybookSeed` and the `seeded_from_playbook`
 * frontmatter field in the session-plan module.
 *
 * Covers:
 *  - createSessionPlanFromPlaybookSeed: correct frontmatter fields, body sections
 *  - sessionPlanFrontmatterSchema: seeded_from_playbook is optional and round-trips
 *  - PlaybookModeMismatchError is thrown for autonomous playbooks
 */
import { describe, it, expect } from 'vitest';
import {
  createSessionPlanFromPlaybookSeed,
  parseSessionPlan,
  serializeSessionPlan,
  sessionPlanFrontmatterSchema,
  PlaybookModeMismatchError,
  type Playbook,
} from '@eforge-build/input';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlanningPlaybook(overrides: Partial<Playbook> = {}): Playbook {
  return {
    name: 'my-planning-feature',
    description: 'Plan the feature thoroughly',
    scope: 'project-team',
    mode: 'planning',
    goal: 'Design the new feature end-to-end.',
    outOfScope: 'No migrations allowed.',
    acceptanceCriteria: '- All tests pass.\n- Design doc approved.',
    plannerNotes: 'Check edge cases first.',
    ...overrides,
  };
}

function makeAutonomousPlaybook(): Playbook {
  return {
    name: 'my-autonomous-feature',
    description: 'Build the feature immediately',
    scope: 'project-team',
    mode: 'autonomous',
    goal: 'Implement the feature.',
    outOfScope: '',
    acceptanceCriteria: '- Feature works.',
    plannerNotes: '',
  };
}

// ---------------------------------------------------------------------------
// createSessionPlanFromPlaybookSeed — frontmatter fields
// ---------------------------------------------------------------------------

describe('createSessionPlanFromPlaybookSeed — frontmatter', () => {
  it('returns a SessionPlan with status: planning', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb });
    expect(plan.status).toBe('planning');
  });

  it('returns a SessionPlan with planning_type: unknown', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb });
    expect(plan.planning_type).toBe('unknown');
  });

  it('returns a SessionPlan with planning_depth: focused', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb });
    expect(plan.planning_depth).toBe('focused');
  });

  it('sets seeded_from_playbook to the playbook name', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb });
    expect(plan.seeded_from_playbook).toBe(pb.name);
  });

  it('sets profile to null', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb });
    expect(plan.profile).toBeNull();
  });

  it('sets empty required_dimensions, optional_dimensions, skipped_dimensions, open_questions', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb });
    expect(plan.required_dimensions).toEqual([]);
    expect(plan.optional_dimensions).toEqual([]);
    expect(plan.skipped_dimensions).toEqual([]);
    expect(plan.open_questions).toEqual([]);
  });

  it('uses playbook description as topic by default', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb });
    expect(plan.topic).toBe(pb.description);
  });

  it('respects the topic override', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb, topic: 'Custom Topic' });
    expect(plan.topic).toBe('Custom Topic');
  });

  it('respects the session override', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb, session: '2026-01-01-custom-session' });
    expect(plan.session).toBe('2026-01-01-custom-session');
  });

  it('derives a session id from the playbook name when not overridden', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb });
    expect(plan.session).toContain(pb.name);
  });
});

// ---------------------------------------------------------------------------
// createSessionPlanFromPlaybookSeed — body sections
// ---------------------------------------------------------------------------

describe('createSessionPlanFromPlaybookSeed — body sections', () => {
  it('body contains ## Goal section with playbook goal content', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb });
    expect(plan.body).toContain('## Goal');
    expect(plan.body).toContain(pb.goal);
  });

  it('body contains ## Out of scope section with playbook content', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb });
    expect(plan.body).toContain('## Out of scope');
    expect(plan.body).toContain(pb.outOfScope);
  });

  it('body contains ## Acceptance criteria section with playbook content', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb });
    expect(plan.body).toContain('## Acceptance criteria');
    expect(plan.body).toContain(pb.acceptanceCriteria);
  });

  it('body contains ## Notes from playbook section with planner notes', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb });
    expect(plan.body).toContain('## Notes from playbook');
    expect(plan.body).toContain(pb.plannerNotes);
  });

  it('omits ## Out of scope when playbook outOfScope is empty', () => {
    const pb = makePlanningPlaybook({ outOfScope: '' });
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb });
    expect(plan.body).not.toContain('## Out of scope');
  });

  it('omits ## Notes from playbook when plannerNotes is empty', () => {
    const pb = makePlanningPlaybook({ plannerNotes: '' });
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb });
    expect(plan.body).not.toContain('## Notes from playbook');
  });

  it('sections Map contains lowercase keys goal, out of scope, acceptance criteria, notes from playbook', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb });

    expect(plan.sections.has('goal')).toBe(true);
    expect(plan.sections.has('out of scope')).toBe(true);
    expect(plan.sections.has('acceptance criteria')).toBe(true);
    expect(plan.sections.has('notes from playbook')).toBe(true);
  });

  it('sections Map acceptance-criteria key contains the playbook acceptanceCriteria content', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb });
    const acContent = plan.sections.get('acceptance criteria') ?? '';
    expect(acContent).toContain('All tests pass');
  });
});

// ---------------------------------------------------------------------------
// createSessionPlanFromPlaybookSeed — mode guard
// ---------------------------------------------------------------------------

describe('createSessionPlanFromPlaybookSeed — mode guard', () => {
  it('throws PlaybookModeMismatchError for an autonomous playbook', () => {
    const pb = makeAutonomousPlaybook();
    expect(() => createSessionPlanFromPlaybookSeed({ playbook: pb })).toThrow(PlaybookModeMismatchError);
  });
});

// ---------------------------------------------------------------------------
// sessionPlanFrontmatterSchema — seeded_from_playbook field
// ---------------------------------------------------------------------------

describe('sessionPlanFrontmatterSchema — seeded_from_playbook', () => {
  const baseFrontmatter = {
    session: '2026-04-01-test-plan',
    topic: 'Test Plan',
    status: 'planning',
    planning_type: 'unknown',
    planning_depth: 'focused',
    required_dimensions: [],
    optional_dimensions: [],
    skipped_dimensions: [],
    open_questions: [],
    profile: null,
  };

  it('parses successfully without seeded_from_playbook (optional field)', () => {
    const result = sessionPlanFrontmatterSchema.safeParse(baseFrontmatter);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unexpected');
    expect(result.data.seeded_from_playbook).toBeUndefined();
  });

  it('parses successfully with seeded_from_playbook present', () => {
    const result = sessionPlanFrontmatterSchema.safeParse({
      ...baseFrontmatter,
      seeded_from_playbook: 'my-planning-feature',
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unexpected');
    expect(result.data.seeded_from_playbook).toBe('my-planning-feature');
  });

  it('round-trips seeded_from_playbook through parse/serialize', () => {
    const pb = makePlanningPlaybook();
    const plan = createSessionPlanFromPlaybookSeed({ playbook: pb, session: '2026-05-01-round-trip' });

    const serialized = serializeSessionPlan(plan);
    expect(serialized).toContain('seeded_from_playbook:');

    const reparsed = parseSessionPlan(serialized);
    expect(reparsed.seeded_from_playbook).toBe(pb.name);
  });
});
