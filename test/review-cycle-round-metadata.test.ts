import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_CONFIG, DEFAULT_REVIEW } from '@eforge-build/engine/config';
import type { AgentRunOptions } from '@eforge-build/engine/harness';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import type { AgentRole, EforgeEvent, OrchestrationConfig, PlanFile } from '@eforge-build/engine/events';
import { getBuildStage, type BuildStageContext } from '@eforge-build/engine/pipeline';
import { ModelTracker } from '@eforge-build/engine/model-tracker';
import { createNoopTracingContext } from '@eforge-build/engine/tracing';
import type { ReviewProfileConfig } from '@eforge-build/client';
import type { PipelineComposition } from '@eforge-build/engine/schemas';
import { StubHarness, type StubResponse } from './stub-harness.js';
import { collectEvents, filterEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd });
  return stdout;
}

async function initRepo(dir: string): Promise<string> {
  const repo = join(dir, 'repo');
  await git(dir, ['init', '-b', 'main', repo]);
  await git(repo, ['config', 'user.email', 'test@eforge.build']);
  await git(repo, ['config', 'user.name', 'eforge-test']);
  return repo;
}

async function writeRepoFile(repo: string, path: string, content: string): Promise<void> {
  await mkdir(join(repo, path, '..'), { recursive: true });
  await writeFile(join(repo, path), content, 'utf8');
}

async function commitAll(repo: string, message: string): Promise<void> {
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', message]);
}

async function head(repo: string): Promise<string> {
  return (await git(repo, ['rev-parse', 'HEAD'])).trim();
}

function makeContext(repo: string, harness: StubHarness, preImplementCommit: string, review: ReviewProfileConfig): BuildStageContext {
  const planId = 'plan-01-round-metadata';
  const pipeline: PipelineComposition = {
    scope: 'errand',
    compile: [],
    defaultBuild: ['review-cycle'],
    defaultReview: DEFAULT_REVIEW,
    rationale: 'round metadata test',
  };
  const planFile: PlanFile = {
    id: planId,
    name: 'Review-Cycle Round Metadata',
    dependsOn: [],
    branch: `test/${planId}`,
    body: '# Plan\n\nImplement the feature.\n',
    filePath: join(repo, 'plan.md'),
  };
  const orchConfig: OrchestrationConfig = {
    name: 'round-metadata-test',
    description: 'round metadata test',
    created: new Date().toISOString(),
    mode: 'errand',
    baseBranch: 'main',
    pipeline,
    plans: [{ id: planId, name: planFile.name, dependsOn: [], branch: planFile.branch, build: ['review-cycle'], review }],
  };

  return {
    agentRuntimes: singletonRegistry(harness),
    config: DEFAULT_CONFIG,
    pipeline,
    tracing: createNoopTracingContext(),
    cwd: repo,
    planSetName: 'round-metadata-test',
    sourceContent: '',
    modelTracker: new ModelTracker(),
    plans: [planFile],
    expeditionModules: [],
    moduleBuildConfigs: new Map(),
    planId,
    worktreePath: repo,
    planFile,
    orchConfig,
    planEntry: orchConfig.plans[0],
    reviewIssues: [],
    build: ['review-cycle'],
    review,
    preImplementCommit,
  };
}

const issueXml = (description: string) => `<review-issues><issue severity="warning" category="bugs" file="src/app.ts">${description}<fix>Update the value.</fix></issue></review-issues>`;

function expectRound(events: EforgeEvent[], type: EforgeEvent['type'], rounds: number[]): void {
  expect(events.filter((event) => event.type === type).map((event) => (event as { round?: number }).round)).toEqual(rounds);
}

describe('review-cycle round lifecycle metadata', () => {
  const makeTempDir = useTempDir('eforge-review-cycle-round-metadata-');

  it('emits round metadata for review-cycle review, review-fix, and evaluate events', async () => {
    const repo = await initRepo(makeTempDir());
    await writeRepoFile(repo, 'src/app.ts', 'export const value = 1;\n');
    await commitAll(repo, 'chore: initial');
    const preImplementCommit = await head(repo);
    await writeRepoFile(repo, 'src/app.ts', 'export const value = 2;\n');
    await commitAll(repo, 'feat: implementation');

    class FixingHarness extends StubHarness {
      private fixCount = 0;

      async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        for await (const event of super.run(options, agent, planId)) {
          yield event;
          if (event.type === 'agent:stop' && agent === 'review-fixer') {
            this.fixCount += 1;
            const current = await readFile(join(repo, 'src/app.ts'), 'utf8');
            await writeRepoFile(repo, 'src/app.ts', current.replace(/value = \d+/, `value = ${2 + this.fixCount}`));
          }
        }
      }
    }

    const harness = new FixingHarness([
      { text: issueXml('round 0 issue') },
      { toolCalls: [{ tool: 'submit_review_fixer_issue_references', toolUseId: 'refs-0', input: { issueReferences: [{ issueId: 'review-r0-code-1', status: 'addressed', note: 'Updated the value.' }] }, output: '' }], text: 'Applied round 0 fix.' },
      { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-0', input: { verdicts: [{ file: 'src/app.ts', action: 'reject', reason: 'Needs another attempt', issueIds: ['review-r0-code-1'] }] }, output: '' }] },
      { text: issueXml('round 1 issue') },
      { text: 'Applied round 1 fix.' },
      { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-1', input: { verdicts: [{ file: 'src/app.ts', action: 'accept', reason: 'Correct now' }] }, output: '' }] },
    ] satisfies StubResponse[]);

    const ctx = makeContext(repo, harness, preImplementCommit, {
      strategy: 'parallel',
      perspectives: ['code'],
      maxRounds: 2,
      evaluatorStrictness: 'standard',
    });

    const events = await collectEvents(getBuildStage('review-cycle')(ctx));

    expectRound(events, 'plan:build:review:start', [0, 1]);
    expectRound(events, 'plan:build:review:complete', [0, 1]);
    expectRound(events, 'plan:build:review:parallel:start', [0, 1]);
    expectRound(events, 'plan:build:review:parallel:perspective:start', [0, 1]);
    expectRound(events, 'plan:build:review:parallel:perspective:complete', [0, 1]);
    expectRound(events, 'plan:build:review:fix:start', [0, 1]);
    expectRound(events, 'plan:build:review:fix:complete', [0, 1]);
    expectRound(events, 'plan:build:evaluate:start', [0, 1]);
    expectRound(events, 'plan:build:evaluate:complete', [0, 1]);

    const perspectiveCompletes = filterEvents(events, 'plan:build:review:parallel:perspective:complete');
    expect(perspectiveCompletes.map((event) => event.issues[0]?.issueId)).toEqual(['review-r0-code-1', 'review-r1-code-1']);
    const reviewCompletes = filterEvents(events, 'plan:build:review:complete');
    const emittedIssueIds = reviewCompletes.flatMap((event) => event.issues.map((issue) => issue.issueId));
    expect(emittedIssueIds).toEqual(['review-r0-code-1', 'review-r1-code-1']);
    expect(new Set(emittedIssueIds).size).toBe(emittedIssueIds.length);
    expect(harness.prompts[1]).toContain('Issue ID: review-r0-code-1');
    expect(harness.prompts[4]).toContain('Issue ID: review-r1-code-1');
    expect(harness.prompts[2]).toContain('Current Reviewer Issue Context');
    expect(harness.prompts[2]).toContain('Issue ID: review-r0-code-1');
    expect(harness.prompts[2]).toContain('File: src/app.ts');
    expect(harness.prompts[2]).toContain('Severity: warning');
    expect(harness.prompts[2]).toContain('Category: bugs');
    expect(harness.prompts[2]).toContain('Description: round 0 issue');
    expect(harness.prompts[2]).toContain('Fixer status: addressed — Updated the value.');
    const evaluateCompletes = filterEvents(events, 'plan:build:evaluate:complete');
    expect(evaluateCompletes[0].verdicts).toEqual([{ file: 'src/app.ts', action: 'reject', reason: 'Needs another attempt', issueIds: ['review-r0-code-1'] }]);
  });

  it.each([
    ['cross-plan blocker', { planId: 'plan-other' }, 'cross-plan-blocker'],
    ['upstream/base-owned blocker', { planId: 'plan-01-round-metadata', owner: 'upstream' }, 'upstream-or-base-owned'],
  ] as const)('preserves terminal review-cycle failure after same-plan recovery refuses a %s', async (_label, metadata, reason) => {
    const repo = await initRepo(makeTempDir());
    await writeRepoFile(repo, 'src/app.ts', 'export const value = 1;\n');
    await commitAll(repo, 'chore: initial');
    const preImplementCommit = await head(repo);
    await writeRepoFile(repo, 'src/app.ts', 'export const value = 2;\n');
    await commitAll(repo, 'feat: implementation');

    class MutatingFixerHarness extends StubHarness {
      async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        for await (const event of super.run(options, agent, planId)) {
          yield event;
          if (event.type === 'agent:stop' && agent === 'review-fixer') {
            await writeRepoFile(repo, 'src/app.ts', 'export const value = 3;\n');
          }
        }
      }
    }
    const harness = new MutatingFixerHarness([
      { text: issueXml('belongs outside the active plan') },
      { text: 'No safe active-plan fix is available.' },
      { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-0', input: { verdicts: [{ file: 'src/app.ts', action: 'accept', reason: 'Still blocks outside active ownership.', issueOutcome: 'unresolved_blocking', issueIds: ['review-r0-code-1'] }] }, output: '' }] },
    ] satisfies StubResponse[]);
    const ctx = makeContext(repo, harness, preImplementCommit, {
      strategy: 'parallel',
      perspectives: ['code'],
      maxRounds: 1,
      evaluatorStrictness: 'standard',
    });

    const events: EforgeEvent[] = [];
    for await (const event of getBuildStage('review-cycle')(ctx)) {
      if (event.type === 'plan:build:review:complete') {
        event.issues[0].metadata = metadata;
        ctx.reviewIssues = event.issues;
      }
      events.push(event);
    }

    expect(events.some((event) => event.type === 'plan:build:recovery:skip' && event.reason === reason)).toBe(true);
    expect(events.some((event) => event.type === 'plan:build:recovery:attempt:start')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'plan:build:failed', planId: ctx.planId });
    expect(ctx.buildFailed).toBe(true);
  });

  it('assigns unique issue IDs to review-cycle synthetic reviewer failures', async () => {
    const repo = await initRepo(makeTempDir());
    await writeRepoFile(repo, 'src/app.ts', 'export const value = 1;\n');
    await commitAll(repo, 'chore: initial');
    const preImplementCommit = await head(repo);
    await writeRepoFile(repo, 'src/app.ts', 'export const value = 2;\n');
    await commitAll(repo, 'feat: implementation');

    class ThrowingReviewerHarness extends StubHarness {
      async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        if (agent === 'reviewer') {
          throw new Error('reviewer unavailable');
        }
        yield* super.run(options, agent, planId);
      }
    }

    const harness = new ThrowingReviewerHarness([
      { text: 'Recorded synthetic review failure.' },
      { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-0', input: { verdicts: [{ file: 'src/app.ts', action: 'accept', reason: 'Synthetic issue recorded' }] }, output: '' }] },
    ] satisfies StubResponse[]);
    const ctx = makeContext(repo, harness, preImplementCommit, {
      strategy: 'parallel',
      perspectives: ['code'],
      maxRounds: 1,
      evaluatorStrictness: 'standard',
    });

    const events = await collectEvents(getBuildStage('review-cycle')(ctx));
    const reviewComplete = filterEvents(events, 'plan:build:review:complete')[0];
    expect(reviewComplete).toBeDefined();
    expect(reviewComplete.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ issueId: 'review-r0-code-1', severity: 'critical', category: 'review-contract' }),
    ]));
    const emittedIssueIds = reviewComplete.issues.map((issue) => issue.issueId);
    expect(emittedIssueIds.every((issueId) => typeof issueId === 'string' && issueId.length > 0)).toBe(true);
    expect(new Set(emittedIssueIds).size).toBe(emittedIssueIds.length);
  });

  it('omits round metadata for standalone review, review-fix, and evaluate stages', async () => {
    const reviewRepo = await initRepo(makeTempDir());
    await writeRepoFile(reviewRepo, 'src/app.ts', 'export const value = 1;\n');
    await commitAll(reviewRepo, 'chore: initial');
    const reviewCtx = makeContext(reviewRepo, new StubHarness([{ text: 'Malformed reviewer output without XML.' }]), await head(reviewRepo), { ...DEFAULT_REVIEW, strategy: 'single' });
    const reviewEvents = await collectEvents(getBuildStage('review')(reviewCtx));
    expect(filterEvents(reviewEvents, 'plan:build:review:start')[0]).not.toHaveProperty('round');
    const standaloneReviewComplete = filterEvents(reviewEvents, 'plan:build:review:complete')[0];
    expect(standaloneReviewComplete).not.toHaveProperty('round');
    expect(standaloneReviewComplete.issues[0]).toMatchObject({
      issueId: 'review-r0-review-contract-1',
      severity: 'critical',
      category: 'review-contract',
    });

    const fixRepo = await initRepo(makeTempDir());
    await writeRepoFile(fixRepo, 'src/app.ts', 'export const value = 1;\n');
    await commitAll(fixRepo, 'chore: initial');
    const fixCtx = makeContext(fixRepo, new StubHarness([{ text: 'fixed' }]), await head(fixRepo), { ...DEFAULT_REVIEW, strategy: 'single' });
    fixCtx.reviewIssues = [{ severity: 'warning', category: 'bugs', file: 'src/app.ts', description: 'fix it' }];
    const fixEvents = await collectEvents(getBuildStage('review-fix')(fixCtx));
    expect(filterEvents(fixEvents, 'plan:build:review:fix:start')[0]).not.toHaveProperty('round');
    expect(filterEvents(fixEvents, 'plan:build:review:fix:complete')[0]).not.toHaveProperty('round');

    const evaluateRepo = await initRepo(makeTempDir());
    await writeRepoFile(evaluateRepo, 'src/app.ts', 'export const value = 1;\n');
    await commitAll(evaluateRepo, 'chore: initial');
    const preImplementCommit = await head(evaluateRepo);
    await writeRepoFile(evaluateRepo, 'src/app.ts', 'export const value = 2;\n');
    await commitAll(evaluateRepo, 'feat: implementation');
    await writeRepoFile(evaluateRepo, 'src/app.ts', 'export const value = 3;\n');
    const evaluateCtx = makeContext(evaluateRepo, new StubHarness([{ toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-standalone', input: { verdicts: [{ file: 'src/app.ts', action: 'accept', reason: 'Correct' }] }, output: '' }] }]), preImplementCommit, { ...DEFAULT_REVIEW, strategy: 'single' });
    const evaluateEvents = await collectEvents(getBuildStage('evaluate')(evaluateCtx));
    expect(filterEvents(evaluateEvents, 'plan:build:evaluate:start')[0]).not.toHaveProperty('round');
    expect(filterEvents(evaluateEvents, 'plan:build:evaluate:complete')[0]).not.toHaveProperty('round');
  });
});
