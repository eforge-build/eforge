import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { openDatabase } from '@eforge-build/monitor/db';
import { useTempDir } from './test-tmpdir.js';
import { StubHarness } from './stub-harness.js';

const NETWORK_TIMEOUT = 'Backend error: Codex SSE response headers timed out after 10000ms';

const makeTempDir = useTempDir('eforge-recovery-sidecar-analyst-network-fallback-');

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

async function writeFileEnsuringDir(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf-8');
}

async function initFailedPrdFixture(prdId: string): Promise<string> {
  const cwd = makeTempDir();
  git(cwd, ['init', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'test@eforge.test']);
  git(cwd, ['config', 'user.name', 'Eforge Test']);
  await writeFileEnsuringDir(join(cwd, 'README.md'), '# recovery fallback fixture\n');
  git(cwd, ['add', 'README.md']);
  git(cwd, ['commit', '-m', 'chore: initial']);

  await writeFileEnsuringDir(
    join(cwd, '.eforge', 'queue', 'failed', `${prdId}.md`),
    `# ${prdId}\n\nBuild the queued PRD.\n`,
  );

  return cwd;
}

async function createFeatureBranchWithArtifacts(cwd: string, setName: string): Promise<void> {
  git(cwd, ['switch', '-c', `eforge/${setName}`]);
  await writeFileEnsuringDir(
    join(cwd, 'eforge', 'plans', setName, 'orchestration.yaml'),
    `name: ${setName}\ndescription: Recovery resume fixture\nbase_branch: main\nmode: excursion\nvalidate: []\nplans:\n  - id: plan-01\n    name: Plan 01\n    depends_on: []\n    branch: ${setName}/plan-01\n    build:\n      - implement\n    review:\n      strategy: auto\n      perspectives:\n        - code\n      maxRounds: 1\n      evaluatorStrictness: standard\npipeline:\n  scope: excursion\n  compile: []\n  defaultBuild: []\n  defaultReview:\n    strategy: auto\n    perspectives:\n      - code\n    maxRounds: 1\n    evaluatorStrictness: standard\n  rationale: recovery resume fixture\n`,
  );
  await writeFileEnsuringDir(
    join(cwd, 'eforge', 'plans', setName, 'plan-01.md'),
    '# Plan 01\n',
  );
  git(cwd, ['add', 'eforge']);
  git(cwd, ['commit', '-m', 'plan: compiled artifacts']);
  git(cwd, ['switch', 'main']);
}

function seedFailedBuildEvidence(cwd: string, setName: string): void {
  const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
  const runId = `run-${setName}`;
  const ts = '2026-01-01T00:00:00.000Z';
  db.insertRun({ id: runId, sessionId: `session-${setName}`, planSet: setName, command: 'build', status: 'failed', startedAt: ts, cwd, pid: 12345 });
  db.insertEvent({ runId, type: 'plan:status:change', planId: 'plan-01', data: JSON.stringify({ type: 'plan:status:change', planId: 'plan-01', status: 'failed', timestamp: ts }), timestamp: ts });
  db.insertEvent({ runId, type: 'agent:tool_use', planId: 'plan-01', data: JSON.stringify({ type: 'agent:tool_use', planId: 'plan-01', agent: 'builder', tool: 'Edit', toolUseId: 'tool-1', input: {}, timestamp: ts }), timestamp: ts });
  db.insertEvent({ runId, type: 'plan:build:failed', planId: 'plan-01', data: JSON.stringify({ type: 'plan:build:failed', planId: 'plan-01', error: NETWORK_TIMEOUT, terminalSubtype: 'error_transient_transport', timestamp: ts }), timestamp: ts });
  db.insertEvent({ runId, type: 'phase:end', data: JSON.stringify({ type: 'phase:end', runId, result: { status: 'failed', summary: NETWORK_TIMEOUT }, timestamp: ts }), timestamp: ts });
  db.close();
}

async function collectEvents(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

async function recoverWithNetworkAnalystFailure(cwd: string, setName: string, prdId: string): Promise<{ sidecar: any; stub: StubHarness }> {
  const stub = new StubHarness([{ error: new Error(NETWORK_TIMEOUT) }]);
  const engine = await EforgeEngine.create({ cwd, agentRuntimes: stub });
  const events = await collectEvents(engine.recover(setName, prdId));
  const complete = events.find((event): event is Extract<EforgeEvent, { type: 'recovery:complete' }> => event.type === 'recovery:complete');
  expect(complete?.sidecarJsonPath).toBeDefined();
  const sidecar = JSON.parse(await readFile(complete!.sidecarJsonPath!, 'utf-8'));
  return { sidecar, stub };
}

describe('EforgeEngine.recover() sidecar resume projection when recovery analyst has network failure', () => {
  it('keeps compiled-build resume recommended when read-only projection is eligible', async () => {
    const prdId = 'eligible-network-fallback-prd';
    const setName = 'eligible-network-fallback-set';
    const cwd = await initFailedPrdFixture(prdId);
    await createFeatureBranchWithArtifacts(cwd, setName);
    seedFailedBuildEvidence(cwd, setName);

    const { sidecar, stub } = await recoverWithNetworkAnalystFailure(cwd, setName, prdId);

    expect(stub.calls).toHaveLength(1);
    expect(sidecar.verdict.recoveryError).toContain(NETWORK_TIMEOUT);
    expect(sidecar.verdict.verdict).toBe('manual');
    expect(sidecar.resumeEligibility.eligible).toBe(true);
    expect(sidecar.recoveryOptions).toContainEqual(expect.objectContaining({
      kind: 'compiled-build-resume',
      action: 'eforge_resume_build',
      recommended: true,
    }));
    expect(sidecar.report.recommendedAction).toContain('eforge_resume_build');
  });

  it('stays manual with an ineligibility reason when read-only projection is ineligible', async () => {
    const prdId = 'ineligible-network-fallback-prd';
    const setName = 'ineligible-network-fallback-set';
    const cwd = await initFailedPrdFixture(prdId);
    seedFailedBuildEvidence(cwd, setName);

    const { sidecar, stub } = await recoverWithNetworkAnalystFailure(cwd, setName, prdId);

    expect(stub.calls).toHaveLength(1);
    expect(sidecar.verdict.recoveryError).toContain(NETWORK_TIMEOUT);
    expect(sidecar.verdict.verdict).toBe('manual');
    expect(sidecar.resumeEligibility.eligible).toBe(false);
    expect(sidecar.resumeEligibility.reason).toEqual(expect.any(String));
    expect(sidecar.resumeEligibility.reason.length).toBeGreaterThan(0);
    expect(sidecar.recoveryOptions?.some((option: { kind: string; action: string; recommended: boolean }) => (
      option.kind === 'compiled-build-resume' && option.action === 'eforge_resume_build' && option.recommended
    ))).not.toBe(true);
  });
});
