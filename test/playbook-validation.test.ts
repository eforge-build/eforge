import { describe, it, expect } from 'vitest';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validatePlaybook,
  parsePlaybook,
  serializePlaybook,
  playbookToBuildSource,
  playbookToPlanSeed,
  playbookFrontmatterSchema,
  PlaybookModeMismatchError,
  writePlaybook,
  loadPlaybook,
  listPlaybooks,
  movePlaybook,
  copyPlaybookToScope,
  PlaybookNotFoundError,
  analyzeAcceptanceCriteria,
  type Playbook,
} from '@eforge-build/input';
import { getScopeDirectory } from '@eforge-build/scopes';
import { useTempDir } from './test-tmpdir.js';


function validPlaybookRaw(overrides: Partial<{
  name: string;
  description: string;
  scope: string;
  mode: string;
  body: string;
}> = {}): string {
  const name = overrides.name ?? 'my-feature';
  const description = overrides.description ?? 'Add the my-feature capability';
  const scope = overrides.scope ?? 'project-team';
  const mode = overrides.mode ?? 'autonomous';
  const body = overrides.body ?? `## Goal

Implement the feature.

## Out of scope

No migrations.

## Acceptance criteria

- Feature works.

## Notes for the planner

Keep it simple.`;

  return `---
name: ${name}
description: ${description}
scope: ${scope}
mode: ${mode}
---
${body}`;
}

function validPlaybook(): Playbook {
  return {
    name: 'my-feature',
    description: 'Add the my-feature capability',
    scope: 'project-team',
    mode: 'autonomous',
    goal: 'Implement the feature.',
    outOfScope: 'No migrations.',
    acceptanceCriteria: '- Feature works.',
    plannerNotes: 'Keep it simple.',
  };
}

function validPlanningPlaybook(): Playbook {
  return {
    name: 'my-planning-feature',
    description: 'Plan the my-feature capability',
    scope: 'project-team',
    mode: 'planning',
    goal: 'Plan the feature.',
    outOfScope: 'No migrations.',
    acceptanceCriteria: '- Planning is complete.',
    plannerNotes: 'Consider edge cases.',
  };
}

// validatePlaybook

// --- eforge:region playbook-validation-suite ---
describe('validatePlaybook', () => {
  it('returns ok:true for a valid playbook', () => {
    const result = validatePlaybook(validPlaybookRaw());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected');
    expect(result.playbook.name).toBe('my-feature');
    expect(result.playbook.description).toBe('Add the my-feature capability');
    expect(result.playbook.scope).toBe('project-team');
    expect(result.playbook.mode).toBe('autonomous');
    expect(result.playbook.goal).toBeTruthy();
  });

  it('returns ok:false when name is missing', () => {
    const raw = `---
description: A description
scope: user
mode: autonomous
---

## Goal

Do something.
`;
    const result = validatePlaybook(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected');
    expect(result.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('returns ok:false when description is missing', () => {
    const raw = `---
name: my-feature
scope: user
mode: autonomous
---

## Goal

Do something.
`;
    const result = validatePlaybook(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected');
    expect(result.errors.some((e) => e.includes('description'))).toBe(true);
  });

  it('returns ok:false when scope is missing', () => {
    const raw = `---
name: my-feature
description: A feature
mode: autonomous
---

## Goal

Do something.
`;
    const result = validatePlaybook(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected');
    expect(result.errors.some((e) => e.includes('scope'))).toBe(true);
  });

  it('returns ok:false when scope is an invalid enum value', () => {
    const raw = `---
name: my-feature
description: A feature
scope: global
mode: autonomous
---

## Goal

Do something.
`;
    const result = validatePlaybook(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns ok:false when ## Goal section is missing', () => {
    const raw = `---
name: my-feature
description: A feature
scope: user
mode: autonomous
---

## Out of scope

Nothing.
`;
    const result = validatePlaybook(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected');
    expect(result.errors.some((e) => e.toLowerCase().includes('goal'))).toBe(true);
  });

  it('returns ok:false when name is not kebab-case', () => {
    const raw = `---
name: My Feature
description: A feature
scope: user
mode: autonomous
---

## Goal

Do something.
`;
    const result = validatePlaybook(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected');
    expect(result.errors.some((e) => e.toLowerCase().includes('kebab'))).toBe(true);
  });

  it('returns ok:true when optional sections are absent', () => {
    const raw = `---
name: lean-feature
description: Lean
scope: project-local
mode: autonomous
---

## Goal

Just the goal.
`;
    const result = validatePlaybook(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected');
    expect(result.playbook.goal).toContain('Just the goal');
    expect(result.playbook.outOfScope).toBe('');
    expect(result.playbook.acceptanceCriteria).toBe('');
    expect(result.playbook.plannerNotes).toBe('');
  });

  it('parses optional postMerge field', () => {
    const raw = `---
name: full-feature
description: Full
scope: project-team
mode: autonomous
postMerge:
  - pnpm build
  - pnpm test
---

## Goal

Do everything.
`;
    const result = validatePlaybook(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected');
    expect(result.playbook.postMerge).toEqual(['pnpm build', 'pnpm test']);
  });
});

// ---------------------------------------------------------------------------
// playbookFrontmatterSchema — mode field validation
// ---------------------------------------------------------------------------


describe('playbookFrontmatterSchema — mode field', () => {
  it('returns failure when mode is missing, with path including "mode"', () => {
    const result = playbookFrontmatterSchema.safeParse({
      name: 'my-feature',
      description: 'A feature',
      scope: 'project-team',
      // mode intentionally omitted
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unexpected');
    const modeIssue = result.error.issues.find((i) => i.path.includes('mode'));
    expect(modeIssue).toBeDefined();
  });

  it('returns failure when mode is an invalid value', () => {
    const result = playbookFrontmatterSchema.safeParse({
      name: 'my-feature',
      description: 'A feature',
      scope: 'project-team',
      mode: 'invalid',
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unexpected');
    expect(result.error.issues.length).toBeGreaterThan(0);
  });

  it('accepts mode: autonomous', () => {
    const result = playbookFrontmatterSchema.safeParse({
      name: 'my-feature',
      description: 'A feature',
      scope: 'project-team',
      mode: 'autonomous',
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unexpected');
    expect(result.data.mode).toBe('autonomous');
  });

  it('accepts mode: planning', () => {
    const result = playbookFrontmatterSchema.safeParse({
      name: 'my-feature',
      description: 'A feature',
      scope: 'project-team',
      mode: 'planning',
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('unexpected');
    expect(result.data.mode).toBe('planning');
  });
});

// ---------------------------------------------------------------------------
// parsePlaybook / serializePlaybook round-trip with mode
// ---------------------------------------------------------------------------

// --- eforge:endregion playbook-validation-suite ---
