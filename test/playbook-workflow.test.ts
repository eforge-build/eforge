import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR,
  createPlaybookWorkflowAdapter,
  isPlaybookWorkflowSessionPlanExistsError,
  isPlaybookWorkflowValidationError,
  parsePlaybook,
  playbookToBuildSource,
  type Playbook,
} from '@eforge-build/input';
import { useTempDir } from './test-tmpdir.js';

let previousXdgConfigHome: string | undefined;
let isolatedXdg = false;

function isolateXdgConfigHome(root: string): void {
  if (!isolatedXdg) previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
  isolatedXdg = true;
  process.env.XDG_CONFIG_HOME = resolve(root, 'xdg-config');
}

afterEach(() => {
  if (!isolatedXdg) return;
  if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
  previousXdgConfigHome = undefined;
  isolatedXdg = false;
});

function opts(cwd: string) { isolateXdgConfigHome(cwd); return { cwd, configDir: resolve(cwd, 'eforge') }; }

async function setup(cwd: string): Promise<{ cwd: string; configDir: string }> {
  const base = opts(cwd);
  await mkdir(base.configDir, { recursive: true });
  await writeFile(resolve(base.configDir, 'config.yaml'), '{}\n', 'utf-8');
  return base;
}

function playbook(overrides: Partial<Playbook> = {}): Playbook {
  return {
    name: 'demo-workflow',
    description: 'Demo workflow',
    scope: 'project-team',
    mode: 'autonomous',
    goal: 'Implement the workflow adapter.',
    outOfScope: 'Do not change routes.',
    acceptanceCriteria: '- The adapter writes scoped playbooks.',
    plannerNotes: 'Keep behavior stable.',
    ...overrides,
  };
}

describe('playbook workflow adapter', () => {
  const makeTempDir = useTempDir('playbook-workflow-');

  it('exposes the bundled descriptor and scoped surface', () => {
    expect(PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR).toEqual({
      id: 'builtin:playbooks',
      kind: 'workflow-input-adapter',
      sourceScopes: ['project-local', 'project-team', 'user'],
    });
    expect(Object.keys(createPlaybookWorkflowAdapter().scoped).sort()).toEqual([
      'compileAutonomous', 'copy', 'demote', 'list', 'load', 'move', 'promote', 'save', 'seedPlanningSessionPlan', 'validateRaw', 'write',
    ]);
  });

  it('lists and loads with precedence, source, shadows, mode, and profile fields', async () => {
    const base = await setup(makeTempDir());
    const adapter = createPlaybookWorkflowAdapter();
    await adapter.scoped.write({ ...base, scope: 'user', playbook: playbook({ scope: 'user', goal: 'User goal.' }) });
    await adapter.scoped.write({ ...base, scope: 'project-team', playbook: playbook({ scope: 'project-team', goal: 'Team goal.', mode: 'planning', profile: 'docs-heavy' }) });
    await adapter.scoped.write({ ...base, scope: 'project-local', playbook: playbook({ scope: 'project-local', goal: 'Local goal.', profile: 'local-profile' }) });

    const listed = await adapter.scoped.list(base);
    const entry = listed.playbooks.find((item) => item.name === 'demo-workflow');
    expect(entry).toMatchObject({ source: 'project-local', scope: 'project-local', mode: 'autonomous', profile: 'local-profile' });
    expect(entry?.shadows.map((shadow) => shadow.source)).toEqual(['project-team', 'user']);

    const loaded = await adapter.scoped.load({ ...base, name: 'demo-workflow' });
    expect(loaded.source).toBe('project-local');
    expect(loaded.playbook.goal).toBe('Local goal.');
    expect(loaded.shadows.map((shadow) => shadow.source)).toEqual(['project-team', 'user']);
  });

  it('saves drafts in Markdown format and rejects invalid draft content with domain errors', async () => {
    const base = await setup(makeTempDir());
    const adapter = createPlaybookWorkflowAdapter();
    const saved = await adapter.scoped.save({
      ...base,
      scope: 'project-team',
      frontmatter: { name: 'saved-demo', description: 'Saved demo', scope: 'project-team', mode: 'autonomous' },
      body: { goal: 'Save through the adapter.', acceptanceCriteria: '- The saved playbook round trips.' },
    });
    const raw = await readFile(saved.path, 'utf-8');
    expect(raw).toContain('name: saved-demo');
    expect(raw).toContain('## Goal\n\nSave through the adapter.');
    expect(parsePlaybook(raw).acceptanceCriteria).toContain('round trips');

    await expect(adapter.scoped.save({ ...base, scope: 'project-team', frontmatter: {}, body: {} })).rejects.toSatisfy(isPlaybookWorkflowValidationError);
    await expect(adapter.scoped.save({
      ...base,
      scope: 'project-team',
      frontmatter: { name: 'bad-ac', description: 'Bad AC', scope: 'project-team', mode: 'autonomous' },
      body: { goal: 'Bad AC.', acceptanceCriteria: 'Manual checks:\n- Manually inspect the page.' },
    })).rejects.toSatisfy(isPlaybookWorkflowValidationError);
  });

  it('moves, promotes, demotes, and copies through scoped methods', async () => {
    const base = await setup(makeTempDir());
    const adapter = createPlaybookWorkflowAdapter();
    await adapter.scoped.write({ ...base, scope: 'project-team', playbook: playbook({ name: 'move-demo', scope: 'project-team' }) });
    const moved = await adapter.scoped.move({ ...base, name: 'move-demo', fromScope: 'project-team', toScope: 'user' });
    expect(moved.path).toContain('move-demo.md');
    expect((await adapter.scoped.load({ ...base, name: 'move-demo' })).source).toBe('user');

    await adapter.scoped.write({ ...base, scope: 'project-local', playbook: playbook({ name: 'promote-demo', scope: 'project-local' }) });
    expect((await adapter.scoped.promote({ ...base, name: 'promote-demo' })).path).toContain('promote-demo.md');
    expect((await adapter.scoped.load({ ...base, name: 'promote-demo' })).source).toBe('project-team');
    expect((await adapter.scoped.demote({ ...base, name: 'promote-demo' })).path).toContain('promote-demo.md');
    expect((await adapter.scoped.load({ ...base, name: 'promote-demo' })).source).toBe('project-local');

    const copied = await adapter.scoped.copy({ ...base, name: 'promote-demo', targetScope: 'user' });
    expect(copied.targetScope).toBe('user');
    expect(parsePlaybook(await readFile(copied.targetPath, 'utf-8')).scope).toBe('user');
  });

  it('validates raw playbook content and compiles autonomous playbooks with existing semantics', async () => {
    const adapter = createPlaybookWorkflowAdapter();
    const raw = `---\nname: raw-demo\ndescription: Raw demo\nscope: project-team\nmode: autonomous\n---\n\n## Goal\n\nCompile it.\n`;
    expect(adapter.scoped.validateRaw(raw).ok).toBe(true);
    const invalid = adapter.scoped.validateRaw('---\nname: bad\n---\n\n## Goal\n\nNo mode.\n');
    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error('unexpected valid raw playbook');
    expect(invalid.errors.length).toBeGreaterThan(0);

    const pb = playbook({ postMerge: ['pnpm build'], profile: 'docs-heavy' });
    expect(adapter.scoped.compileAutonomous(pb)).toEqual(playbookToBuildSource(pb));
  });

  it('seeds planning session plans under project-local storage and inherits agent profile', async () => {
    const base = await setup(makeTempDir());
    const adapter = createPlaybookWorkflowAdapter();
    await adapter.scoped.write({ ...base, scope: 'project-team', playbook: playbook({ name: 'planning-demo', mode: 'planning', scope: 'project-team', profile: 'planner-profile' }) });

    const seeded = await adapter.scoped.seedPlanningSessionPlan({ ...base, name: 'planning-demo', session: '2026-01-01-planning-demo' });
    expect(seeded.path).toBe(resolve(base.cwd, '.eforge', 'session-plans', '2026-01-01-planning-demo.md'));
    const raw = await readFile(seeded.path, 'utf-8');
    expect(raw).toContain('seeded_from_playbook: planning-demo');
    expect(raw).toContain('agent_profile: planner-profile');
    expect(raw).toContain('## Notes from playbook');
    await expect(adapter.scoped.seedPlanningSessionPlan({ ...base, name: 'planning-demo', session: seeded.session })).rejects.toSatisfy(isPlaybookWorkflowSessionPlanExistsError);
  });

  it('keeps the adapter isolated from daemon, client, and engine imports', async () => {
    const source = await readFile('packages/input/src/playbook-workflow.ts', 'utf-8');
    expect(source).not.toContain('@eforge-build/client');
    expect(source).not.toContain('@eforge-build/engine');
    expect(source).not.toContain('packages/monitor/src/routes');
    expect(source).not.toContain('daemonRequest');
  });
});
