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

describe('parsePlaybook / serializePlaybook — mode round-trip', () => {
  it('round-trips mode: autonomous through serialize/parse', () => {
    const pb = validPlaybook(); // mode: 'autonomous'
    const raw = serializePlaybook(pb);
    expect(raw).toContain('mode: autonomous');
    const parsed = parsePlaybook(raw);
    expect(parsed.mode).toBe('autonomous');
  });

  it('round-trips mode: planning through serialize/parse', () => {
    const pb = validPlanningPlaybook(); // mode: 'planning'
    const raw = serializePlaybook(pb);
    expect(raw).toContain('mode: planning');
    const parsed = parsePlaybook(raw);
    expect(parsed.mode).toBe('planning');
  });

  it('fails to parse a raw string missing mode', () => {
    const raw = `---
name: my-feature
description: A feature
scope: project-team
---

## Goal

Do something.
`;
    expect(() => parsePlaybook(raw)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// playbookToBuildSource
// ---------------------------------------------------------------------------


describe('playbookToBuildSource', () => {
  it('returns an object with name and source fields', () => {
    const pb = validPlaybook();
    const result = playbookToBuildSource(pb);
    expect(typeof result.name).toBe('string');
    expect(typeof result.source).toBe('string');
    expect(result.name).toBe(pb.name);
  });

  it('source contains the goal text', () => {
    const pb = validPlaybook();
    const result = playbookToBuildSource(pb);
    expect(result.source).toContain(pb.goal);
  });

  it('source contains the description as a heading', () => {
    const pb = validPlaybook();
    const result = playbookToBuildSource(pb);
    expect(result.source).toContain(pb.description);
  });

  it('source contains out-of-scope text when present', () => {
    const pb = validPlaybook();
    const result = playbookToBuildSource(pb);
    expect(result.source).toContain(pb.outOfScope);
  });

  it('source contains acceptance criteria when present', () => {
    const pb = validPlaybook();
    const result = playbookToBuildSource(pb);
    expect(result.source).toContain(pb.acceptanceCriteria);
  });

  it('source contains planner notes when present', () => {
    const pb = validPlaybook();
    const result = playbookToBuildSource(pb);
    expect(result.source).toContain(pb.plannerNotes);
  });

  it('exposes individual section fields', () => {
    const pb = validPlaybook();
    const result = playbookToBuildSource(pb);
    expect(result.goal).toBe(pb.goal);
    expect(result.outOfScope).toBe(pb.outOfScope);
    expect(result.acceptanceCriteria).toBe(pb.acceptanceCriteria);
    expect(result.plannerNotes).toBe(pb.plannerNotes);
  });

  it('omits empty optional sections from source', () => {
    const pb: Playbook = {
      ...validPlaybook(),
      outOfScope: '',
      acceptanceCriteria: '',
      plannerNotes: '',
    };
    const result = playbookToBuildSource(pb);
    expect(result.source).not.toContain('Out of scope');
    expect(result.source).not.toContain('Acceptance criteria');
    expect(result.source).not.toContain('Notes for the planner');
  });

  it('source is stable across identical inputs', () => {
    const pb = validPlaybook();
    expect(playbookToBuildSource(pb).source).toBe(playbookToBuildSource(pb).source);
  });

  it('throws PlaybookModeMismatchError for a planning playbook', () => {
    const pb = validPlanningPlaybook();
    expect(() => playbookToBuildSource(pb)).toThrow(PlaybookModeMismatchError);
  });
});

// ---------------------------------------------------------------------------
// playbookToPlanSeed
// ---------------------------------------------------------------------------


describe('playbookToPlanSeed', () => {
  it('throws PlaybookModeMismatchError for an autonomous playbook', () => {
    const pb = validPlaybook(); // mode: 'autonomous'
    expect(() => playbookToPlanSeed(pb)).toThrow(PlaybookModeMismatchError);
  });

  it('returns a seed object for a planning playbook', () => {
    const pb = validPlanningPlaybook();
    const seed = playbookToPlanSeed(pb);
    expect(seed).toBeDefined();
    expect(seed.sessionId).toBeTruthy();
    expect(seed.topic).toBe(pb.description);
    expect(seed.seededFrom).toBe(pb.name);
  });

  it('sessionId contains the playbook name', () => {
    const pb = validPlanningPlaybook();
    const seed = playbookToPlanSeed(pb);
    expect(seed.sessionId).toContain(pb.name);
  });

  it('populates sections Map with lowercase-heading keys', () => {
    const pb = validPlanningPlaybook();
    const seed = playbookToPlanSeed(pb);

    expect(seed.sections.has('goal')).toBe(true);
    expect(seed.sections.has('out of scope')).toBe(true);
    expect(seed.sections.has('acceptance criteria')).toBe(true);
    expect(seed.sections.has('notes from playbook')).toBe(true);
  });

  it('sections Map values contain the playbook content', () => {
    const pb = validPlanningPlaybook();
    const seed = playbookToPlanSeed(pb);

    expect(seed.sections.get('goal')).toBe(pb.goal);
    expect(seed.sections.get('out of scope')).toBe(pb.outOfScope);
    expect(seed.sections.get('acceptance criteria')).toBe(pb.acceptanceCriteria);
    expect(seed.sections.get('notes from playbook')).toBe(pb.plannerNotes);
  });
});

// ---------------------------------------------------------------------------
// writePlaybook / loadPlaybook / listPlaybooks round-trip
// ---------------------------------------------------------------------------

