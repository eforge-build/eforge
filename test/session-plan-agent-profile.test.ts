import { describe, expect, it } from 'vitest';
import {
  createSessionPlan,
  normalizeBuildSource,
  parseSessionPlan,
  serializeSessionPlan,
  sessionPlanFrontmatterSchema,
} from '@eforge-build/input';

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
} as const;

function makeSessionPlanRaw(agentProfile?: string): string {
  return `---
session: 2026-04-01-test-plan
topic: "Test Plan"
status: planning
planning_type: feature
planning_depth: focused
required_dimensions:
  - scope
optional_dimensions: []
skipped_dimensions: []
open_questions: []
profile: null
${agentProfile === undefined ? '' : `agent_profile: ${agentProfile}\n`}---

# Test Plan

## Scope

Plan the change.
`;
}

describe('session plan agent_profile', () => {
  it('accepts a string and rejects a non-string value', () => {
    const valid = sessionPlanFrontmatterSchema.safeParse({
      ...baseFrontmatter,
      agent_profile: 'docs-heavy',
    });
    expect(valid.success).toBe(true);

    const invalid = sessionPlanFrontmatterSchema.safeParse({
      ...baseFrontmatter,
      agent_profile: 42,
    });
    expect(invalid.success).toBe(false);
    if (invalid.success) throw new Error('unexpected');
    expect(invalid.error.issues.some((issue) => issue.path.includes('agent_profile'))).toBe(true);
  });

  it('sets trimmed agent_profile from createSessionPlan agentProfile and omits blank values', () => {
    const withProfile = createSessionPlan({
      session: '2026-05-01-test',
      topic: 'Test plan',
      agentProfile: '  docs-heavy  ',
    });
    expect(withProfile.agent_profile).toBe('docs-heavy');

    const withoutProfile = createSessionPlan({
      session: '2026-05-01-test',
      topic: 'Test plan',
      agentProfile: '   ',
    });
    expect(withoutProfile.agent_profile).toBeUndefined();
  });

  it('round-trips agent_profile through serialize and parse', () => {
    const plan = parseSessionPlan(makeSessionPlanRaw('docs-heavy'));
    const serialized = serializeSessionPlan(plan);
    const reparsed = parseSessionPlan(serialized);

    expect(serialized).toContain('agent_profile: docs-heavy');
    expect(reparsed.agent_profile).toBe('docs-heavy');
  });

  it('returns trimmed agentProfile from normalizeBuildSource for session-plan sources', () => {
    const result = normalizeBuildSource({
      sourcePath: '/project/.eforge/session-plans/2026-04-01-test-plan.md',
      content: makeSessionPlanRaw('  docs-heavy  '),
    });

    expect(result.agentProfile).toBe('docs-heavy');
  });

  it('omits agentProfile from normalizeBuildSource when absent', () => {
    const result = normalizeBuildSource({
      sourcePath: '/project/.eforge/session-plans/2026-04-01-test-plan.md',
      content: makeSessionPlanRaw(),
    });

    expect(result.agentProfile).toBeUndefined();
  });

  it('omits agentProfile from normalizeBuildSource when the field is blank', () => {
    const result = normalizeBuildSource({
      sourcePath: '/project/.eforge/session-plans/2026-04-01-test-plan.md',
      content: makeSessionPlanRaw('""'),
    });

    expect(result.agentProfile).toBeUndefined();
  });
});
