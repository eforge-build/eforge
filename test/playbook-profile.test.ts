import { describe, it, expect, afterEach } from 'vitest';
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

let previousXdgConfigHome: string | undefined;
let hasIsolatedXdgConfigHome = false;

function isolateXdgConfigHome(root: string): void {
  if (!hasIsolatedXdgConfigHome) {
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    hasIsolatedXdgConfigHome = true;
  }
  process.env.XDG_CONFIG_HOME = resolve(root, 'xdg-config');
}

afterEach(() => {
  if (!hasIsolatedXdgConfigHome) return;
  if (previousXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
  }
  previousXdgConfigHome = undefined;
  hasIsolatedXdgConfigHome = false;
});

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

describe('playbookFrontmatterSchema — optional profile field', () => {
  it('accepts a playbook containing profile: docs-heavy', () => {
    const raw = `---
name: my-feature
description: A feature
scope: project-team
mode: autonomous
profile: docs-heavy
---

## Goal

Do something.
`;
    const result = validatePlaybook(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected');
    expect(result.playbook.profile).toBe('docs-heavy');
  });

  it('accepts a playbook without profile field (profile is optional)', () => {
    const raw = validPlaybookRaw();
    const result = validatePlaybook(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected');
    expect(result.playbook.profile).toBeUndefined();
  });

  it.each(['42', 'null'])('rejects profile: %s because profile must be a string', (profileValue) => {
    const raw = `---
name: my-feature
description: A feature
scope: project-team
mode: autonomous
profile: ${profileValue}
---

## Goal

Do something.
`;
    const result = validatePlaybook(raw);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected');
    expect(result.errors.some((e) => e.includes('profile'))).toBe(true);
  });

  it('rejects no existing playbook fixture because of profile field presence', () => {
    // All existing playbooks (without profile) must still parse successfully
    const raw = validPlaybookRaw();
    const result = validatePlaybook(raw);
    expect(result.ok).toBe(true);
  });
});


describe('serializePlaybook — profile field', () => {
  it('includes profile: field when profile is set', () => {
    const pb: Playbook = { ...validPlaybook(), profile: 'docs-heavy' };
    const serialized = serializePlaybook(pb);
    expect(serialized).toContain('profile: docs-heavy');
  });

  it('omits profile: field when profile is undefined', () => {
    const pb: Playbook = { ...validPlaybook() };
    const serialized = serializePlaybook(pb);
    expect(serialized).not.toContain('profile:');
  });

  it('round-trips profile field through parse/serialize', () => {
    const pb: Playbook = { ...validPlaybook(), profile: 'docs-heavy' };
    const raw = serializePlaybook(pb);
    const reparsed = parsePlaybook(raw);
    expect(reparsed.profile).toBe('docs-heavy');
  });

  it('serialized output contains mode: and postMerge: when profile is also present', () => {
    const pb: Playbook = { ...validPlaybook(), profile: 'docs-heavy', postMerge: ['pnpm build'] };
    const serialized = serializePlaybook(pb);
    expect(serialized).toContain('mode: autonomous');
    expect(serialized).toContain('profile: docs-heavy');
    expect(serialized).toContain('postMerge:');
  });
});


describe('playbookToBuildSource — profile field', () => {
  it('returns profile in the result for an autonomous playbook with profile', () => {
    const pb: Playbook = { ...validPlaybook(), profile: 'docs-heavy' };
    const result = playbookToBuildSource(pb);
    expect(result.profile).toBe('docs-heavy');
  });

  it('returns undefined profile for an autonomous playbook without profile', () => {
    const pb: Playbook = { ...validPlaybook() };
    const result = playbookToBuildSource(pb);
    expect(result.profile).toBeUndefined();
  });
});


describe('playbookToPlanSeed — profile field', () => {
  it('returns profile in the seed for a planning playbook with profile', () => {
    const pb: Playbook = { ...validPlanningPlaybook(), profile: 'docs-heavy' };
    const seed = playbookToPlanSeed(pb);
    expect(seed.profile).toBe('docs-heavy');
  });

  it('returns undefined profile for a planning playbook without profile', () => {
    const pb: Playbook = { ...validPlanningPlaybook() };
    const seed = playbookToPlanSeed(pb);
    expect(seed.profile).toBeUndefined();
  });
});


describe('listPlaybooks — profile field', () => {
  const makeTempDirForProfile = useTempDir('playbook-profile-');

  function makeOpts(root: string) {
    const configDir = resolve(root, 'eforge');
    const cwd = root;
    isolateXdgConfigHome(root);
    return { configDir, cwd };
  }

  it('includes profile in listing entries when playbook declares profile', async () => {
    const root = makeTempDirForProfile();
    const opts = makeOpts(root);
    const pb: Playbook = { ...validPlaybook(), profile: 'docs-heavy' };
    await writePlaybook({ ...opts, scope: 'project-team', playbook: pb });

    const { playbooks } = await listPlaybooks(opts);
    const entry = playbooks.find((p) => p.name === 'my-feature');
    expect(entry).toBeDefined();
    expect(entry!.profile).toBe('docs-heavy');
  });

  it('omits profile from listing entries when playbook has no profile', async () => {
    const root = makeTempDirForProfile();
    const opts = makeOpts(root);
    const pb: Playbook = { ...validPlaybook() };
    await writePlaybook({ ...opts, scope: 'project-team', playbook: pb });

    const { playbooks } = await listPlaybooks(opts);
    const entry = playbooks.find((p) => p.name === 'my-feature');
    expect(entry).toBeDefined();
    expect(entry!.profile).toBeUndefined();
  });
});
