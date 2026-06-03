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

// --- eforge:region playbook-storage-suite ---
describe('writePlaybook + loadPlaybook round-trip', () => {
  const makeTempDir = useTempDir('playbook-');

  function makeOpts(root: string) {
    const configDir = resolve(root, 'eforge');
    const cwd = root;
    // Override XDG for user-tier tests
    isolateXdgConfigHome(root);
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
    isolateXdgConfigHome(root);
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
    isolateXdgConfigHome(root);
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

// --- eforge:endregion playbook-storage-suite ---
