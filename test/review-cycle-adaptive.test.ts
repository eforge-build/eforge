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

function makeContext(repo: string, harness: StubHarness, preImplementCommit: string): BuildStageContext {
  const planId = 'plan-01-adaptive-review-cycle-perspectives';
  const review: ReviewProfileConfig = {
    strategy: 'parallel',
    perspectives: ['code', 'docs', 'api'],
    maxRounds: 2,
    evaluatorStrictness: 'standard',
  };
  const pipeline: PipelineComposition = {
    scope: 'excursion',
    compile: [],
    defaultBuild: ['review-cycle'],
    defaultReview: DEFAULT_REVIEW,
    rationale: 'adaptive review-cycle test',
  };
  const planFile: PlanFile = {
    id: planId,
    name: 'Adaptive Review-Cycle Perspective Selection',
    dependsOn: [],
    branch: `test/${planId}`,
    body: '# Plan\n\nImplement the feature.\n',
    filePath: join(repo, 'plan.md'),
  };
  const orchConfig: OrchestrationConfig = {
    name: 'adaptive-test',
    description: 'adaptive test',
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
    planSetName: 'adaptive-test',
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

// --- eforge:region plan-01-dynamic-perspective-contracts ---
function makeDynamicKeyContext(repo: string, harness: StubHarness, preImplementCommit: string): BuildStageContext {
  const planId = 'plan-01-dynamic-perspective-test';
  const review: ReviewProfileConfig = {
    strategy: 'parallel',
    perspectives: ['code', 'accessibility'],
    maxRounds: 2,
    evaluatorStrictness: 'standard',
  };
  const pipeline: PipelineComposition = {
    scope: 'excursion',
    compile: [],
    defaultBuild: ['review-cycle'],
    defaultReview: DEFAULT_REVIEW,
    rationale: 'dynamic perspective key test',
  };
  const planFile: PlanFile = {
    id: planId,
    name: 'Dynamic Perspective Key Test',
    dependsOn: [],
    branch: `test/${planId}`,
    body: '# Plan\n\nTest dynamic key handling.\n',
    filePath: join(repo, 'plan.md'),
  };
  const orchConfig: OrchestrationConfig = {
    name: 'dynamic-persp-test',
    description: 'dynamic perspective test',
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
    planSetName: 'dynamic-persp-test',
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
// --- eforge:endregion plan-01-dynamic-perspective-contracts ---

describe('adaptive review-cycle perspective selection', () => {
  const makeTempDir = useTempDir('eforge-review-cycle-adaptive-');

  it('terminates after round 1 when warning fixes on ordinary code are all accepted (all perspectives dropped)', async () => {
    const repo = await initRepo(makeTempDir());
    await writeRepoFile(repo, 'src/app.ts', 'export const value = 1;\n');
    await writeRepoFile(repo, 'docs/guide.md', '# Guide\n');
    await commitAll(repo, 'chore: initial');
    const preImplementCommit = await head(repo);

    await writeRepoFile(repo, 'src/app.ts', 'export const value = 2;\n');
    await commitAll(repo, 'feat: implementation');

    const round1Issue = `<review-issues>
  <issue severity="warning" category="bugs" file="src/app.ts">
    Value needs a follow-up fix.
    <fix>Change value from 2 to 3.</fix>
  </issue>
</review-issues>`;

    class FixingHarness extends StubHarness {
      private readonly reviewerResponses: Record<string, StubResponse[]>;

      constructor(nonReviewerResponses: StubResponse[], reviewerResponses: Record<string, StubResponse[]>) {
        super(nonReviewerResponses);
        this.reviewerResponses = reviewerResponses;
      }

      async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        if (agent === 'reviewer') {
          const perspective = options.perspective;
          const routedResponse = perspective ? this.reviewerResponses[perspective]?.shift() : undefined;
          if (!perspective || !routedResponse) {
            throw new Error(`Missing routed reviewer response for perspective ${perspective ?? '<none>'}`);
          }
          for await (const event of new StubHarness([routedResponse]).run(options, agent, planId)) {
            yield event;
          }
          return;
        }

        for await (const event of super.run(options, agent, planId)) {
          yield event;
          if (event.type === 'agent:stop' && agent === 'review-fixer') {
            const current = await readFile(join(repo, 'src/app.ts'), 'utf8');
            await writeRepoFile(repo, 'src/app.ts', current.replace('2', '3'));
          }
        }
      }
    }

    const harness = new FixingHarness([
      { text: 'Applied review fix.' },
      { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-1', input: { verdicts: [{ file: 'src/app.ts', action: 'accept', reason: 'Correct' }] }, output: '' }] },
    ], {
      code: [{ text: round1Issue }],
      docs: [{ text: '<review-issues></review-issues>' }],
      api: [{ text: '<review-issues></review-issues>' }],
    });
    const ctx = makeContext(repo, harness, preImplementCommit);

    const events = await collectEvents(getBuildStage('review-cycle')(ctx));
    const reviewStarts = filterEvents(events, 'plan:build:review:parallel:start');

    // Only one review round: after round 1, the accepted fix on ordinary code
    // (src/app.ts) does not create concern overlap for code, docs, or api, so
    // all perspectives are dropped and the cycle terminates.
    expect(reviewStarts).toHaveLength(1);
    expect(reviewStarts[0].perspectives).toHaveLength(3);

    const respawned = events.filter(
      (event): event is Extract<EforgeEvent, { type: 'plan:build:decision' }> =>
        event.type === 'plan:build:decision' && event.decision.kind === 'perspectives-respawned',
    );
    expect(respawned).toHaveLength(1);
    expect(respawned[0].decision.perspectives).toEqual(['code', 'docs', 'api']);
    expect(respawned[0].decision.dropped).toEqual([]);

    const terminated = events.filter(
      (e): e is Extract<EforgeEvent, { type: 'plan:build:decision' }> =>
        e.type === 'plan:build:decision' && e.decision.kind === 'cycle-terminated',
    );
    expect(terminated).toHaveLength(1);
    const termDecision = terminated[0].decision as { kind: 'cycle-terminated'; reason: string; rationale: string };
    expect(termDecision.reason).toBe('no-issues');
    expect(termDecision.rationale).toContain('no review perspectives remain relevant after evaluation');
  });

  // --- eforge:region plan-01-adaptive-review-policy ---
  it('terminates early after round 1 when verify passed and all fixes accepted', async () => {
    const repo = await initRepo(makeTempDir());
    await writeRepoFile(repo, 'src/app.ts', 'export const value = 1;\n');
    await commitAll(repo, 'chore: initial');
    const preImplementCommit = await head(repo);

    await writeRepoFile(repo, 'src/app.ts', 'export const value = 2;\n');
    await commitAll(repo, 'feat: implementation');

    const round1Issue = `<review-issues>
  <issue severity="warning" category="bugs" file="src/app.ts">
    Value should be updated.
    <fix>Change value from 2 to 3.</fix>
  </issue>
</review-issues>`;

    class VerifyFixingHarness extends StubHarness {
      private readonly reviewerResponses: Record<string, StubResponse[]>;

      constructor(nonReviewerResponses: StubResponse[], reviewerResponses: Record<string, StubResponse[]>) {
        super(nonReviewerResponses);
        this.reviewerResponses = reviewerResponses;
      }

      async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        if (agent === 'reviewer') {
          const perspective = options.perspective;
          const routedResponse = perspective ? this.reviewerResponses[perspective]?.shift() : undefined;
          if (!perspective || !routedResponse) {
            throw new Error(`Missing routed reviewer response for perspective ${perspective ?? '<none>'}`);
          }
          for await (const event of new StubHarness([routedResponse]).run(options, agent, planId)) {
            yield event;
          }
          return;
        }
        for await (const event of super.run(options, agent, planId)) {
          yield event;
          if (event.type === 'agent:stop' && agent === 'review-fixer') {
            const current = await readFile(join(repo, 'src/app.ts'), 'utf8');
            await writeRepoFile(repo, 'src/app.ts', current.replace('2', '3'));
          }
        }
      }
    }

    const harness = new VerifyFixingHarness(
      [
        { text: 'Applied review fix.' },
        { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-1', input: { verdicts: [{ file: 'src/app.ts', action: 'accept', reason: 'Correct' }] }, output: '' }] },
      ],
      {
        code: [{ text: round1Issue }],
        verify: [{ text: '<review-issues></review-issues>' }],
      },
    );

    // Context with code + verify perspectives
    const planId = 'plan-01-early-term-test';
    const review: ReviewProfileConfig = {
      strategy: 'parallel',
      perspectives: ['code', 'verify'],
      maxRounds: 2,
      evaluatorStrictness: 'standard',
    };
    const pipeline: PipelineComposition = {
      scope: 'excursion',
      compile: [],
      defaultBuild: ['review-cycle'],
      defaultReview: DEFAULT_REVIEW,
      rationale: 'early termination test',
    };
    const planFile: PlanFile = {
      id: planId,
      name: 'Early Termination Test',
      dependsOn: [],
      branch: `test/${planId}`,
      body: '# Plan\n\nImplement the feature.\n',
      filePath: join(repo, 'plan.md'),
    };
    const orchConfig: OrchestrationConfig = {
      name: 'early-term-test',
      description: 'early termination test',
      created: new Date().toISOString(),
      mode: 'errand',
      baseBranch: 'main',
      pipeline,
      plans: [{ id: planId, name: planFile.name, dependsOn: [], branch: planFile.branch, build: ['review-cycle'], review }],
    };
    const ctx: BuildStageContext = {
      agentRuntimes: singletonRegistry(harness),
      config: DEFAULT_CONFIG,
      pipeline,
      tracing: createNoopTracingContext(),
      cwd: repo,
      planSetName: 'early-term-test',
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

    const events = await collectEvents(getBuildStage('review-cycle')(ctx));

    // Only one review round should start (early termination fires after round 1 evaluate)
    const reviewStarts = filterEvents(events, 'plan:build:review:parallel:start');
    expect(reviewStarts).toHaveLength(1);

    // cycle-terminated should be emitted with reason 'no-issues' and early-term rationale
    const terminated = events.filter(
      (e): e is Extract<EforgeEvent, { type: 'plan:build:decision' }> =>
        e.type === 'plan:build:decision' && e.decision.kind === 'cycle-terminated',
    );
    expect(terminated).toHaveLength(1);
    const termDecision = terminated[0].decision as { kind: 'cycle-terminated'; reason: string; rationale: string };
    expect(termDecision.reason).toBe('no-issues');
    expect(termDecision.rationale).toContain('Terminated');
    expect(termDecision.rationale).toContain('all fixes accepted');
    expect(termDecision.rationale).toContain('no unresolved high-risk concerns');
  });

  it('starts round 2 with narrower perspectives when evaluator rejects the fix', async () => {
    const repo = await initRepo(makeTempDir());
    await writeRepoFile(repo, 'src/app.ts', 'export const value = 1;\n');
    await writeRepoFile(repo, 'docs/guide.md', '# Guide\n');
    await commitAll(repo, 'chore: initial');
    const preImplementCommit = await head(repo);

    await writeRepoFile(repo, 'src/app.ts', 'export const value = 2;\n');
    await commitAll(repo, 'feat: implementation');

    const round1Issue = `<review-issues>
  <issue severity="warning" category="bugs" file="src/app.ts">
    Value should be updated.
    <fix>Change value from 2 to 3.</fix>
  </issue>
</review-issues>`;

    class RejectingHarness extends StubHarness {
      private readonly reviewerResponses: Record<string, StubResponse[]>;

      constructor(nonReviewerResponses: StubResponse[], reviewerResponses: Record<string, StubResponse[]>) {
        super(nonReviewerResponses);
        this.reviewerResponses = reviewerResponses;
      }

      async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        if (agent === 'reviewer') {
          const perspective = options.perspective;
          const routedResponse = perspective ? this.reviewerResponses[perspective]?.shift() : undefined;
          if (!perspective || !routedResponse) {
            throw new Error(`Missing routed reviewer response for perspective ${perspective ?? '<none>'}`);
          }
          for await (const event of new StubHarness([routedResponse]).run(options, agent, planId)) {
            yield event;
          }
          return;
        }
        for await (const event of super.run(options, agent, planId)) {
          yield event;
          if (event.type === 'agent:stop' && agent === 'review-fixer') {
            // Write a fixer change so the evaluator has something to reject
            const current = await readFile(join(repo, 'src/app.ts'), 'utf8');
            await writeRepoFile(repo, 'src/app.ts', current.replace('2', '3'));
          }
        }
      }
    }

    const harness = new RejectingHarness(
      [
        { text: 'Applied review fix.' },
        // Evaluator REJECTS the fix — this triggers continued review, not early termination
        { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-1', input: { verdicts: [{ file: 'src/app.ts', action: 'reject', reason: 'Fix is wrong' }] }, output: '' }] },
        // Round 2 code reviewer finds no issues
      ],
      {
        code: [{ text: round1Issue }, { text: '<review-issues></review-issues>' }],
        docs: [{ text: '<review-issues></review-issues>' }],
        api: [{ text: '<review-issues></review-issues>' }],
      },
    );

    const ctx = makeContext(repo, harness, preImplementCommit);
    // Make sure maxRounds is >= 3 so round 2 can run
    const ctxWithRounds: BuildStageContext = {
      ...ctx,
      review: { ...ctx.review, maxRounds: 3 },
    };

    const events = await collectEvents(getBuildStage('review-cycle')(ctxWithRounds));

    const reviewStarts = filterEvents(events, 'plan:build:review:parallel:start');
    expect(reviewStarts).toHaveLength(2);
    expect(reviewStarts[0].perspectives).toHaveLength(3);  // code, docs, api in round 1
    expect(reviewStarts[1].perspectives).toEqual(['code']); // only code in round 2

    // Round 2 perspectives-respawned should have non-empty dropped
    const respawned = events.filter(
      (e): e is Extract<EforgeEvent, { type: 'plan:build:decision' }> =>
        e.type === 'plan:build:decision' && e.decision.kind === 'perspectives-respawned',
    );
    const round2Respawned = respawned.find(r => (r.decision as { round: number }).round === 1)?.decision as
      { kind: 'perspectives-respawned'; perspectives: string[]; dropped: string[] } | undefined;
    expect(round2Respawned?.perspectives).toEqual(['code']);
    expect(round2Respawned?.dropped).not.toHaveLength(0);
    expect(round2Respawned?.dropped).toContain('docs');
    expect(round2Respawned?.dropped).toContain('api');
  });
  // --- eforge:endregion plan-01-adaptive-review-policy ---

  // --- eforge:region plan-01-dynamic-perspective-contracts ---
  it('diagnoses and skips unregistered dynamic perspective keys in review-cycle', async () => {
    const repo = await initRepo(makeTempDir());
    await writeRepoFile(repo, 'src/app.ts', 'export const value = 1;\n');
    await commitAll(repo, 'chore: initial');
    const preImplementCommit = await head(repo);

    class DynamicKeyHarness extends StubHarness {
      async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        if (agent === 'reviewer' && options.perspective === 'code') {
          for await (const event of new StubHarness([{ text: '<review-issues></review-issues>' }]).run(options, agent, planId)) {
            yield event;
          }
          return;
        }
        for await (const event of super.run(options, agent, planId)) {
          yield event;
        }
      }
    }

    const harness = new DynamicKeyHarness([]);
    const ctx = makeDynamicKeyContext(repo, harness, preImplementCommit);

    const events = await collectEvents(getBuildStage('review-cycle')(ctx));

    const skipped = events.find(
      (e): e is Extract<EforgeEvent, { type: 'extension:reviewer-perspective:skipped' }> =>
        e.type === 'extension:reviewer-perspective:skipped' && e.perspectiveKey === 'accessibility',
    );
    expect(skipped?.reason).toBe('unknown-key');
    expect(events.some((e) => e.type === 'plan:build:review:parallel:perspective:error')).toBe(false);

    const reviewStart = events.find(
      (e): e is Extract<EforgeEvent, { type: 'plan:build:review:parallel:start' }> =>
        e.type === 'plan:build:review:parallel:start',
    );
    expect(reviewStart?.perspectives).toEqual(['code']);
  });
  // --- eforge:endregion plan-01-dynamic-perspective-contracts ---
});
