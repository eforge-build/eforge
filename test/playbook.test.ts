/**
 * Tests for the playbook module.
 *
 * Covers:
 *  - validatePlaybook: schema validation (valid/invalid frontmatter, body)
 *  - playbookFrontmatterSchema: mode field validation
 *  - playbookToBuildSource: output shape stability, mode guard
 *  - playbookToPlanSeed: sections map, mode guard
 *  - serializePlaybook / parsePlaybook: round-trip including mode field
 *  - listPlaybooks / loadPlaybook: round-trip via writePlaybook then loadPlaybook
 *  - writePlaybook: atomic write + directory creation
 *  - Scope mismatch warning in listPlaybooks
 */
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// validatePlaybook
// ---------------------------------------------------------------------------

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

describe('writePlaybook + loadPlaybook round-trip', () => {
  const makeTempDir = useTempDir('playbook-');

  function makeOpts(root: string) {
    const configDir = resolve(root, 'eforge');
    const cwd = root;
    // Override XDG for user-tier tests
    process.env.XDG_CONFIG_HOME = resolve(root, 'xdg-config');
    return { configDir, cwd };
  }

  it('writes to project-team tier and loads it back', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);
    const pb = validPlaybook();

    const { path } = await writePlaybook({ ...opts, scope: 'project-team', playbook: pb });
    expect(path).toContain('eforge');
    expect(path).toContain('playbooks');
    expect(path).toContain('my-feature.md');

    const loaded = await loadPlaybook({ ...opts, name: 'my-feature' });
    expect(loaded.playbook.name).toBe('my-feature');
    expect(loaded.playbook.mode).toBe('autonomous');
    expect(loaded.playbook.goal).toContain('Implement the feature');
    expect(loaded.source).toBe('project-team');
  });

  it('writes to project-local tier and loads it back', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);
    const pb: Playbook = { ...validPlaybook(), scope: 'project-local' };

    await writePlaybook({ ...opts, scope: 'project-local', playbook: pb });
    const loaded = await loadPlaybook({ ...opts, name: 'my-feature' });
    expect(loaded.source).toBe('project-local');
  });

  it('writes to user tier and loads it back', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);
    const pb: Playbook = { ...validPlaybook(), scope: 'user' };

    await writePlaybook({ ...opts, scope: 'user', playbook: pb });
    const loaded = await loadPlaybook({ ...opts, name: 'my-feature' });
    expect(loaded.source).toBe('user');
  });

  it('creates the tier directory when it does not exist', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);
    const pb = validPlaybook();

    // Do NOT pre-create the directory
    await writePlaybook({ ...opts, scope: 'project-team', playbook: pb });
    const loaded = await loadPlaybook({ ...opts, name: 'my-feature' });
    expect(loaded.playbook.name).toBe('my-feature');
  });

  it('project-local wins over project-team when both exist', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);
    const pbProject: Playbook = { ...validPlaybook(), scope: 'project-team', goal: 'Project goal.' };
    const pbLocal: Playbook = { ...validPlaybook(), scope: 'project-local', goal: 'Local goal.' };

    await writePlaybook({ ...opts, scope: 'project-team', playbook: pbProject });
    await writePlaybook({ ...opts, scope: 'project-local', playbook: pbLocal });

    const loaded = await loadPlaybook({ ...opts, name: 'my-feature' });
    expect(loaded.source).toBe('project-local');
    expect(loaded.playbook.goal).toContain('Local goal');
    expect(loaded.shadows.some((s) => s.source === 'project-team')).toBe(true);
  });

  it('throws PlaybookNotFoundError when playbook does not exist', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);
    await expect(loadPlaybook({ ...opts, name: 'nonexistent' })).rejects.toThrow(PlaybookNotFoundError);
  });

  it('loadPlaybook returns a playbook with mode field', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);
    const pb = validPlaybook(); // mode: 'autonomous'

    await writePlaybook({ ...opts, scope: 'project-team', playbook: pb });
    const loaded = await loadPlaybook({ ...opts, name: 'my-feature' });
    expect(loaded.playbook.mode).toBe('autonomous');
  });

  it('preserves profile through writePlaybook and loadPlaybook', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);
    const pb: Playbook = { ...validPlaybook(), profile: 'docs-heavy' };

    await writePlaybook({ ...opts, scope: 'project-team', playbook: pb });
    const loaded = await loadPlaybook({ ...opts, name: 'my-feature' });
    expect(loaded.playbook.profile).toBe('docs-heavy');
  });

  it('preserves profile when copying a playbook to another scope', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);
    const pb: Playbook = { ...validPlaybook(), profile: 'docs-heavy' };

    await writePlaybook({ ...opts, scope: 'project-team', playbook: pb });
    const result = await copyPlaybookToScope({ ...opts, name: 'my-feature', targetScope: 'project-local' });
    const copiedRaw = await readFile(result.targetPath, 'utf-8');
    const copied = parsePlaybook(copiedRaw);

    expect(copied.scope).toBe('project-local');
    expect(copied.profile).toBe('docs-heavy');
  });
});

// ---------------------------------------------------------------------------
// listPlaybooks
// ---------------------------------------------------------------------------

describe('listPlaybooks', () => {
  const makeTempDir = useTempDir('playbook-list-');

  function makeOpts(root: string) {
    const configDir = resolve(root, 'eforge');
    const cwd = root;
    process.env.XDG_CONFIG_HOME = resolve(root, 'xdg-config');
    return { configDir, cwd };
  }

  it('returns empty list when no playbooks exist', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);
    const { playbooks, warnings } = await listPlaybooks(opts);
    expect(playbooks).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('returns three entries with correct source labels for distinct names', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);

    const pbLocal: Playbook = { ...validPlaybook(), name: 'local-pb', scope: 'project-local' };
    const pbProject: Playbook = { ...validPlaybook(), name: 'project-pb', scope: 'project-team' };
    const pbUser: Playbook = { ...validPlaybook(), name: 'user-pb', scope: 'user' };

    await writePlaybook({ ...opts, scope: 'project-local', playbook: pbLocal });
    await writePlaybook({ ...opts, scope: 'project-team', playbook: pbProject });
    await writePlaybook({ ...opts, scope: 'user', playbook: pbUser });

    const { playbooks, warnings } = await listPlaybooks(opts);
    expect(playbooks).toHaveLength(3);
    expect(warnings).toHaveLength(0);

    const byName = Object.fromEntries(playbooks.map((p) => [p.name, p]));
    expect(byName['local-pb'].source).toBe('project-local');
    expect(byName['project-pb'].source).toBe('project-team');
    expect(byName['user-pb'].source).toBe('user');
    expect(byName['local-pb'].shadows).toEqual([]);
    expect(byName['project-pb'].shadows).toEqual([]);
    expect(byName['user-pb'].shadows).toEqual([]);
  });

  it('includes mode in list entries for autonomous and planning playbooks', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);

    const pbAuto: Playbook = { ...validPlaybook(), name: 'auto-pb', scope: 'project-team', mode: 'autonomous' };
    const pbPlan: Playbook = { ...validPlanningPlaybook(), name: 'plan-pb', scope: 'project-team', mode: 'planning' };

    await writePlaybook({ ...opts, scope: 'project-team', playbook: pbAuto });
    await writePlaybook({ ...opts, scope: 'project-team', playbook: pbPlan });

    const { playbooks, warnings } = await listPlaybooks(opts);
    expect(warnings).toHaveLength(0);

    const byName = Object.fromEntries(playbooks.map((p) => [p.name, p]));
    expect(byName['auto-pb'].mode).toBe('autonomous');
    expect(byName['plan-pb'].mode).toBe('planning');
  });

  it('keeps legacy entries without mode listable with a safe autonomous default', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);
    const { configDir, cwd } = opts;
    const projectDir = resolve(getScopeDirectory('project-team', { cwd, configDir }), 'playbooks');
    await mkdir(projectDir, { recursive: true });

    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      resolve(projectDir, 'legacy-pb.md'),
      `---
name: legacy-pb
description: Legacy playbook
scope: project-team
---

## Goal

Still appears in the listing.
`,
      'utf-8',
    );

    const { playbooks } = await listPlaybooks(opts);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0]).toEqual(expect.objectContaining({
      name: 'legacy-pb',
      mode: 'autonomous',
      source: 'project-team',
    }));
  });

  it('returns one entry with full shadow chain when same name exists in all three tiers', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);

    const pbLocal: Playbook = { ...validPlaybook(), name: 'shared', scope: 'project-local' };
    const pbProject: Playbook = { ...validPlaybook(), name: 'shared', scope: 'project-team' };
    const pbUser: Playbook = { ...validPlaybook(), name: 'shared', scope: 'user' };

    // Write project-team and user with their own scope values
    await writePlaybook({ ...opts, scope: 'project-team', playbook: pbProject });
    await writePlaybook({ ...opts, scope: 'user', playbook: pbUser });
    // Write local last (it wins)
    await writePlaybook({ ...opts, scope: 'project-local', playbook: pbLocal });

    const { playbooks } = await listPlaybooks(opts);
    expect(playbooks).toHaveLength(1);
    expect(playbooks[0].name).toBe('shared');
    expect(playbooks[0].source).toBe('project-local');
    expect(playbooks[0].shadows).toHaveLength(2);
    expect(playbooks[0].shadows[0].source).toBe('project-team');
    expect(typeof playbooks[0].shadows[0].path).toBe('string');
    expect(playbooks[0].shadows[1].source).toBe('user');
    expect(typeof playbooks[0].shadows[1].path).toBe('string');
  });

  it('emits a warning when frontmatter scope does not match storage tier', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);

    // Write a playbook with scope: user but store it in the project-team dir
    const mismatchedPlaybook: Playbook = { ...validPlaybook(), name: 'mismatch', scope: 'user' };
    // Write it but force it into project-team dir manually
    const { configDir, cwd } = opts;
    const projectDir = resolve(getScopeDirectory('project-team', { cwd, configDir }), 'playbooks');
    await mkdir(projectDir, { recursive: true });

    // Use writePlaybook with project-team scope but frontmatter says user
    // We need to write the file directly with mismatched content
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      resolve(projectDir, 'mismatch.md'),
      `---
name: mismatch
description: A mismatched playbook
scope: user
mode: autonomous
---

## Goal

This has wrong scope in frontmatter.
`,
      'utf-8',
    );

    const { warnings } = await listPlaybooks(opts);
    expect(warnings.some((w) => w.includes('mismatch') && w.includes('scope'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// movePlaybook
// ---------------------------------------------------------------------------

describe('movePlaybook', () => {
  const makeTempDir = useTempDir('playbook-move-');

  function makeOpts(root: string) {
    const configDir = resolve(root, 'eforge');
    const cwd = root;
    process.env.XDG_CONFIG_HOME = resolve(root, 'xdg-config');
    return { configDir, cwd };
  }

  it('moves a playbook from project-team to project-local', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);
    const pb: Playbook = { ...validPlaybook(), scope: 'project-team' };

    await writePlaybook({ ...opts, scope: 'project-team', playbook: pb });

    const { path } = await movePlaybook({
      ...opts,
      name: 'my-feature',
      fromScope: 'project-team',
      toScope: 'project-local',
    });

    expect(path).toContain('.eforge');
    const loaded = await loadPlaybook({ ...opts, name: 'my-feature' });
    expect(loaded.source).toBe('project-local');
  });

  it('moves a playbook from project-local to project-team', async () => {
    const root = makeTempDir();
    const opts = makeOpts(root);
    const pb: Playbook = { ...validPlaybook(), scope: 'project-local' };

    await writePlaybook({ ...opts, scope: 'project-local', playbook: pb });

    await movePlaybook({
      ...opts,
      name: 'my-feature',
      fromScope: 'project-local',
      toScope: 'project-team',
    });

    const loaded = await loadPlaybook({ ...opts, name: 'my-feature' });
    expect(loaded.source).toBe('project-team');
  });
});

// ---------------------------------------------------------------------------
// Bundled playbooks
// ---------------------------------------------------------------------------

describe('bundled playbooks', () => {
  it('all bundled playbooks parse successfully', async () => {
    const playbooksDir = fileURLToPath(new URL('../eforge/playbooks', import.meta.url));
    const files = (await readdir(playbooksDir)).filter(f => f.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const raw = await readFile(resolve(playbooksDir, file), 'utf-8');
      const parsed = parsePlaybook(raw);
      expect(parsed.mode, `${file} should have a valid mode`).toMatch(/^(autonomous|planning)$/);
    }
  });

  it('complexity-hotspot-reduction.md parses with mode: planning', async () => {
    const playbooksDir = fileURLToPath(new URL('../eforge/playbooks', import.meta.url));
    const raw = await readFile(resolve(playbooksDir, 'complexity-hotspot-reduction.md'), 'utf-8');
    const parsed = parsePlaybook(raw);
    expect(parsed.mode).toBe('planning');
  });

  it('all bundled playbooks with acceptance criteria pass AC quality analysis', async () => {
    const playbooksDir = fileURLToPath(new URL('../eforge/playbooks', import.meta.url));
    const files = (await readdir(playbooksDir)).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const raw = await readFile(resolve(playbooksDir, file), 'utf-8');
      const parsed = parsePlaybook(raw);
      if (!parsed.acceptanceCriteria) continue;
      const acQuality = analyzeAcceptanceCriteria(parsed.acceptanceCriteria);
      expect(
        acQuality.valid,
        `${file} has AC quality issues:\n${acQuality.diagnostics.map((d, i) => `  ${i + 1}. [${d.kind}] ${d.message}`).join('\n')}`,
      ).toBe(true);
    }
  });

  it('dependency-update.md has valid, non-empty acceptance criteria with required evidence-artifact coverage', async () => {
    const playbooksDir = fileURLToPath(new URL('../eforge/playbooks', import.meta.url));
    const raw = await readFile(resolve(playbooksDir, 'dependency-update.md'), 'utf-8');
    const parsed = parsePlaybook(raw);
    expect(parsed.acceptanceCriteria, 'dependency-update.md must have non-empty acceptance criteria').toBeTruthy();
    const acQuality = analyzeAcceptanceCriteria(parsed.acceptanceCriteria!);
    expect(
      acQuality.valid,
      `dependency-update.md has AC quality issues:\n${acQuality.diagnostics.map((d, i) => `  ${i + 1}. [${d.kind}] ${d.message}`).join('\n')}`,
    ).toBe(true);
    const ac = parsed.acceptanceCriteria!;
    expect(ac, 'must reference tracked dependency-update evidence artifact').toContain('tracked dependency-update evidence artifact');
    expect(ac, 'must reference pnpm audit exit status/findings').toContain('pnpm audit');
    expect(ac, 'must reference manifest diff-review conclusions').toContain('manifest diff-review');
    expect(ac, 'must reference lockfile diff-review conclusions').toContain('lockfile diff-review');
    expect(ac, 'must reference unexpected new packages').toContain('unexpected');
    expect(ac, 'must reference lifecycle-script inspection').toContain('lifecycle-script');
    expect(ac, 'must reference repository inspection').toContain('repository');
    expect(ac, 'must reference maintainer inspection').toContain('maintainer');
    expect(ac, 'must reference native/build-behavior inspection').toContain('native');
    expect(ac, 'must reference npm diff conclusions').toContain('npm diff');
  });
});

// ---------------------------------------------------------------------------
// profile field — parse / serialize / round-trip / build-source / plan-seed
// ---------------------------------------------------------------------------

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
    process.env.XDG_CONFIG_HOME = resolve(root, 'xdg-config');
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
