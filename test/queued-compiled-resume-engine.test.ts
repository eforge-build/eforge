import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';
import { appendAcceptanceCriteriaInventoryBlock, type CanonicalAcceptanceCriteriaInventory } from '@eforge-build/engine/validation/acceptance-criteria-inventory';
import { openDatabase } from '@eforge-build/monitor/db';
import { resolveResumePrdContent } from '@eforge-build/engine/resume/compiled-build';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { QueuedPrd } from '@eforge-build/engine/prd-queue';
import { StubHarness } from './stub-harness.js';
import { useTempDir } from './test-tmpdir.js';

const makeTempDir = useTempDir('eforge-queued-compiled-resume-');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function writeFileEnsuringDir(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function initRepo(): string {
  const cwd = makeTempDir();
  git(cwd, ['init', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['config', 'user.name', 'Test User']);
  writeFileEnsuringDir(join(cwd, 'README.md'), '# test\n');
  git(cwd, ['add', 'README.md']);
  git(cwd, ['commit', '-m', 'chore: initial']);
  return cwd;
}

function writeCompiledPlanSet(cwd: string, setName: string): void {
  writeFileEnsuringDir(join(cwd, 'eforge', 'plans', setName, 'orchestration.yaml'), `name: ${setName}
description: Queued resume plan set
base_branch: main
mode: excursion
validate: []
plans:
  - id: plan-01
    name: Plan 01
    depends_on: []
    branch: ${setName}/plan-01
    build:
      - implement
    review:
      strategy: auto
      perspectives:
        - code
      maxRounds: 1
      evaluatorStrictness: standard
pipeline:
  scope: excursion
  compile: []
  defaultBuild: []
  defaultReview:
    strategy: auto
    perspectives:
      - code
    maxRounds: 1
    evaluatorStrictness: standard
  rationale: resume
`);
  writeFileEnsuringDir(join(cwd, 'eforge', 'plans', setName, 'plan-01.md'), `---
id: plan-01
name: Plan 01
---

# Plan 01
`);
}

function createFeatureBranchWithArtifacts(cwd: string, setName: string): void {
  git(cwd, ['switch', '-c', `eforge/${setName}`]);
  writeCompiledPlanSet(cwd, setName);
  git(cwd, ['add', 'eforge']);
  git(cwd, ['commit', '-m', 'plan: compiled artifacts']);
  git(cwd, ['switch', 'main']);
}

function seedFailedRunEvidence(cwd: string, setName: string): void {
  const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
  const runId = `run-${setName}`;
  const ts = '2026-01-01T00:00:00.000Z';
  db.insertRun({ id: runId, planSet: setName, command: 'build', status: 'failed', startedAt: ts, cwd });
  db.insertEvent({ runId, type: 'plan:status:change', planId: 'plan-01', data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-01', status: 'completed', timestamp: ts }), timestamp: ts });
  db.insertEvent({ runId, type: 'plan:merge:complete', planId: 'plan-01', data: JSON.stringify({ type: 'plan:merge:complete', planId: 'plan-01', commitSha: 'abc123', timestamp: ts }), timestamp: ts });
  db.insertEvent({ runId, type: 'phase:end', data: JSON.stringify({ type: 'phase:end', runId, result: { status: 'failed', summary: 'failed' }, timestamp: ts }), timestamp: ts });
  db.updateRunStatus(runId, 'failed', ts);
  db.close();
}

function prdContent(title: string): string {
  const body = `# ${title}\n\n## Acceptance Criteria\n\n- Queued resume validates the requeued PRD body.\n`;
  const inventory: CanonicalAcceptanceCriteriaInventory = {
    version: 1,
    criteria: [{ id: 'ac-001', text: 'Queued resume validates the requeued PRD body.', raw: 'Queued resume validates the requeued PRD body.', sourceQuote: 'Queued resume validates the requeued PRD body.', confidence: 0.95 }],
  };
  return appendAcceptanceCriteriaInventoryBlock(body, inventory);
}

async function writeResumeMarkedPrd(cwd: string, prdId: string, setName: string, body: string): Promise<QueuedPrd> {
  const content = `---\ntitle: ${prdId}\nresume_mode: compiled\nresume_from: ${prdId}\nresume_set_name: ${setName}\nresume_feature_branch: eforge/${setName}\nresume_base_branch: main\n---\n\n${body}\n`;
  const filePath = join(cwd, '.eforge', 'queue', `${prdId}.md`);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
  return { id: prdId, filePath, frontmatter: { title: prdId, resume_mode: 'compiled', resume_from: prdId, resume_set_name: setName, resume_feature_branch: `eforge/${setName}`, resume_base_branch: 'main' }, content, lastCommitHash: '', lastCommitDate: '' };
}

async function collect(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe('queued compiled-build resume execution', () => {
  it('runs scheduler-owned resume without planning and validates the requeued PRD body', async () => {
    const cwd = initRepo();
    const setName = 'queued-resume';
    const prdId = 'queued-resume-prd';
    createFeatureBranchWithArtifacts(cwd, setName);
    seedFailedRunEvidence(cwd, setName);
    const prd = await writeResumeMarkedPrd(cwd, prdId, setName, prdContent('Queued Resume PRD'));
    const validationResponse = { text: JSON.stringify({ gaps: [], completionPercent: 100, acceptanceVerdicts: [{ criterion: 'ac-001', verdict: 'pass', evidence: 'The requeued PRD body was validated.' }] }) };
    const stub = new StubHarness([
      { text: JSON.stringify({ gaps: [], completionPercent: 100, acceptanceVerdicts: [{ criterion: 'Queued resume validates the requeued PRD body.', verdict: 'pass', evidence: 'The requeued PRD body was validated.' }] }) },
      validationResponse,
    ]);
    const engine = await EforgeEngine.create({
      cwd,
      agentRuntimes: stub,
      config: {
        landing: { ...DEFAULT_CONFIG.landing, action: 'leave' },
        build: {
          ...DEFAULT_CONFIG.build,
          postMergeCommands: [],
          cleanupPlanFiles: false,
          validation: {
            ...DEFAULT_CONFIG.build.validation,
            allowNoCommands: true,
            noCommandsReason: 'queued resume test',
            allowNoCommittedChanges: true,
            noCommittedChangesReason: 'stub harness does not create commits in queued resume test',
          },
        },
      },
    });

    const events = await collect(engine.buildSinglePrd(prd, {}, 'scheduler-session'));

    expect(events).toContainEqual(expect.objectContaining({ type: 'phase:start', command: 'continue-repair' }));
    expect(events.filter((event) => event.type === 'planning:start')).toHaveLength(0);
    expect(events.filter((event) => event.type === 'planning:complete')).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: 'prd_validation:start' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'prd_validation:complete', passed: true }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'acceptance_validation:complete', passed: true }));
    expect(stub.prompts.some((prompt) => prompt.includes('Queued resume validates the requeued PRD body.'))).toBe(true);
  });

  it('resolves PRD provenance from feature-branch history when absent at the tip', async () => {
    const cwd = initRepo();
    const setName = 'history-resume';
    git(cwd, ['switch', '-c', `eforge/${setName}`]);
    writeFileEnsuringDir(join(cwd, 'eforge', 'prds', `${setName}.md`), '# Historical PRD\n');
    git(cwd, ['add', 'eforge/prds']);
    git(cwd, ['commit', '-m', 'build: record prd provenance']);
    rmSync(join(cwd, 'eforge', 'prds', `${setName}.md`));
    git(cwd, ['add', 'eforge/prds']);
    git(cwd, ['commit', '-m', 'cleanup: remove prd provenance']);
    git(cwd, ['switch', 'main']);

    const resolved = await resolveResumePrdContent({ cwd, prdId: 'missing-prd', setName, featureBranch: `eforge/${setName}` });

    expect(resolved?.source).toBe('branch-history');
    expect(resolved?.content).toContain('Historical PRD');
  });
});
