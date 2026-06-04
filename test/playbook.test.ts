import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeAcceptanceCriteria,
  listPlaybooks,
  loadPlaybook,
  parsePlaybook,
  type Playbook,
} from '@eforge-build/input';
import { useTempDir } from './test-tmpdir.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const projectTeamConfigDir = resolve(repoRoot, 'eforge');
const playbooksDir = resolve(projectTeamConfigDir, 'playbooks');

const playbookCases = [
  {
    name: 'test-thinning-audit',
    fileName: 'test-thinning-audit.md',
    scope: 'project-team',
    mode: 'planning',
  },
  {
    name: 'test-thinning-conservative',
    fileName: 'test-thinning-conservative.md',
    scope: 'project-team',
    mode: 'autonomous',
  },
] as const;

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

async function readProjectTeamPlaybook(fileName: string): Promise<string> {
  return readFile(resolve(playbooksDir, fileName), 'utf-8');
}

function expectNoAcceptanceCriteriaBulletEndsWithColon(playbook: Playbook): void {
  const offendingLine = playbook.acceptanceCriteria
    .split('\n')
    .find((line) => /^\s*-\s+.*:\s*$/.test(line));
  expect(offendingLine).toBeUndefined();
}

function expectAcceptanceCriteriaQuality(playbook: Playbook, name: string): void {
  expect(playbook.acceptanceCriteria.trim(), `${name} must have acceptance criteria`).not.toBe('');
  const result = analyzeAcceptanceCriteria(playbook.acceptanceCriteria);
  expect(
    result.valid,
    `${name} has AC quality issues:\n${result.diagnostics.map((d, i) => `  ${i + 1}. [${d.kind}] ${d.message}`).join('\n')}`,
  ).toBe(true);
}

function expectRequiredEvidenceGuidance(raw: string): void {
  expect(raw).toContain('eforge/plans/<plan-set>/deleted-test-coverage.md');
  expect(raw).toContain('each deleted test');
  expect(raw).toContain('each consolidated test');
  expect(raw).toContain('retained adjacent test or lower-level contract');
  expect(raw).toContain('validation command or evidence');
  expect(raw).toContain('temporary plan artifact');
  expect(raw).toContain('normal `cleanupPlanFiles` cleanup');
  expect(raw).toContain('must not require permanent committed documentation');
  expect(raw).toContain('future review candidate');
  expect(raw.toLowerCase()).not.toContain('implementation summary');
}

describe('project-team test-thinning playbooks', () => {
  const makeTempDir = useTempDir('playbook-resolution-');

  it.each(playbookCases)('$name parses with expected project-team frontmatter', async ({ fileName, scope, mode }) => {
    const raw = await readProjectTeamPlaybook(fileName);
    const parsed = parsePlaybook(raw);

    expect(parsed.scope).toBe(scope);
    expect(parsed.mode).toBe(mode);
  });

  it.each(playbookCases)('$name has valid standalone acceptance criteria', async ({ name, fileName }) => {
    const raw = await readProjectTeamPlaybook(fileName);
    const parsed = parsePlaybook(raw);

    expectAcceptanceCriteriaQuality(parsed, name);
    expectNoAcceptanceCriteriaBulletEndsWithColon(parsed);
  });

  it.each(playbookCases)('$name contains required temporary deleted-test coverage guidance', async ({ fileName }) => {
    const raw = await readProjectTeamPlaybook(fileName);

    expectRequiredEvidenceGuidance(raw);
  });

  it('audit playbook tells planners to carry deletion and consolidation evidence requirements into generated plans', async () => {
    const raw = await readProjectTeamPlaybook('test-thinning-audit.md');

    expect(raw).toContain('Generated implementation plans that delete tests require `eforge/plans/<plan-set>/deleted-test-coverage.md`');
    expect(raw).toContain('Generated implementation plans that consolidate tests require `eforge/plans/<plan-set>/deleted-test-coverage.md`');
    expect(raw).toContain('created only when the generated implementation plan deletes or consolidates tests');
  });

  it('conservative playbook tells builders to create evidence when deleting or consolidating tests', async () => {
    const raw = await readProjectTeamPlaybook('test-thinning-conservative.md');

    expect(raw).toContain('Builders create `eforge/plans/<plan-set>/deleted-test-coverage.md` under the active plan set directory when tests are deleted');
    expect(raw).toContain('Builders create `eforge/plans/<plan-set>/deleted-test-coverage.md` under the active plan set directory when tests are consolidated');
    expect(raw).toContain('created only when tests are deleted or consolidated');
  });

  it('resolves both names from the project-team tier with repository configDir', async () => {
    const cwd = makeTempDir();
    isolateXdgConfigHome(cwd);
    await mkdir(process.env.XDG_CONFIG_HOME!, { recursive: true });

    const { playbooks } = await listPlaybooks({ configDir: projectTeamConfigDir, cwd });
    const byName = new Map(playbooks.map((playbook) => [playbook.name, playbook]));

    for (const { name, mode } of playbookCases) {
      expect(byName.get(name)).toEqual(expect.objectContaining({
        name,
        source: 'project-team',
        scope: 'project-team',
        mode,
      }));

      const loaded = await loadPlaybook({ configDir: projectTeamConfigDir, cwd, name });
      expect(loaded.source).toBe('project-team');
      expect(loaded.playbook.scope).toBe('project-team');
    }
  });
});
