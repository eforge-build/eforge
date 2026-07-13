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
import { composeReviewCycleTerminalError, convergenceExtension } from '@eforge-build/engine/pipeline/review-convergence';
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
  await writeFile(join(repo, 'package.json'), '{"type":"module"}\n', 'utf8');
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'src/app.ts'), 'export const value = 1;\n', 'utf8');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: initial']);
  return repo;
}

async function commitImplementation(repo: string): Promise<string> {
  const pre = (await git(repo, ['rev-parse', 'HEAD'])).trim();
  await writeFile(join(repo, 'src/app.ts'), 'export const value = 2;\n', 'utf8');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'feat: implementation']);
  return pre;
}

function makeContext(repo: string, harness: StubHarness, preImplementCommit: string, review: ReviewProfileConfig, build: Array<'review-cycle' | 'test-cycle'>): BuildStageContext {
  const planId = 'plan-01-recovery';
  const pipeline: PipelineComposition = { scope: 'errand', compile: [], defaultBuild: build, defaultReview: DEFAULT_REVIEW, rationale: 'same-plan recovery orchestration test' };
  const planFile: PlanFile = { id: planId, name: 'Same-plan Recovery', dependsOn: [], branch: `test/${planId}`, body: '# Plan\n', filePath: join(repo, 'plan.md') };
  const orchConfig: OrchestrationConfig = {
    name: 'same-plan-recovery-test', description: 'same-plan recovery test', created: new Date().toISOString(), mode: 'errand', baseBranch: 'main', pipeline,
    plans: [{ id: planId, name: planFile.name, dependsOn: [], branch: planFile.branch, build, review }],
  };
  return {
    agentRuntimes: singletonRegistry(harness), config: DEFAULT_CONFIG, pipeline, tracing: createNoopTracingContext(), cwd: repo,
    planSetName: 'same-plan-recovery-test', sourceContent: '', modelTracker: new ModelTracker(), plans: [planFile], expeditionModules: [], moduleBuildConfigs: new Map(),
    planId, worktreePath: repo, planFile, orchConfig, planEntry: orchConfig.plans[0], reviewIssues: [], build, review, preImplementCommit,
  };
}

const issueXml = '<review-issues><issue severity="critical" category="bugs" file="src/app.ts">Still broken.<fix>Set value to 3.</fix></issue></review-issues>';

// Fixer harness whose first review-fixer pass makes an ineffective edit and whose
// second (recovery) pass applies the real fix — or no edit at all when
// recoveryFixMutates is false, modeling a recovery fixer that finds nothing safe to change.
function makeEscalatingFixerHarness(repo: string, responses: StubResponse[], options?: { recoveryFixMutates?: boolean }): StubHarness {
  const recoveryFixMutates = options?.recoveryFixMutates ?? true;
  let fixerStops = 0;
  return new (class extends StubHarness {
    async *run(runOptions: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
      for await (const event of super.run(runOptions, agent, planId)) {
        yield event;
        if (event.type === 'agent:stop' && agent === 'review-fixer') {
          fixerStops += 1;
          if (fixerStops > 1 && !recoveryFixMutates) continue;
          const current = await readFile(join(repo, 'src/app.ts'), 'utf8');
          await writeFile(join(repo, 'src/app.ts'), fixerStops === 1 ? current.replace('value = 2', 'value = 4') : current.replace(/value = \d+/, 'value = 3'), 'utf8');
        }
      }
    }
  })(responses);
}

describe('convergence recovery budget', () => {
  it('extends by one attempt when blocking outcomes drop by half or more', () => {
    expect(convergenceExtension([4, 2], 1)).toMatchObject({ maxAttempts: 2, extended: true, previousBlockingIssueOutcomes: 4, lastBlockingIssueOutcomes: 2 });
    expect(convergenceExtension([8, 3], 1)).toMatchObject({ maxAttempts: 2, extended: true });
  });

  it('does not extend without material convergence, enough history, or a base budget', () => {
    expect(convergenceExtension([4, 3], 1)).toMatchObject({ maxAttempts: 1, extended: false });
    expect(convergenceExtension([2], 1)).toMatchObject({ maxAttempts: 1, extended: false });
    expect(convergenceExtension([], 1)).toMatchObject({ maxAttempts: 1, extended: false });
    expect(convergenceExtension([2, 4], 1)).toMatchObject({ maxAttempts: 1, extended: false });
    expect(convergenceExtension([4, 2], 0)).toMatchObject({ maxAttempts: 0, extended: false });
  });

  it('skips rounds whose evaluation did not run and never extends to zero blockers', () => {
    expect(convergenceExtension([4, undefined, 2], 1)).toMatchObject({ maxAttempts: 2, extended: true });
    expect(convergenceExtension([4, 0], 1)).toMatchObject({ maxAttempts: 1, extended: false });
  });
});

describe('review-cycle terminal error composition', () => {
  const evaluation = (overrides: Partial<{ ran: boolean; blockingIssueOutcomes: number; unresolvedIssueOutcomes: number; needsHumanReviewIssueOutcomes: number; rejected: number; review: number }>) =>
    ({ ran: true, blockingIssueOutcomes: 0, unresolvedIssueOutcomes: 0, needsHumanReviewIssueOutcomes: 0, rejected: 0, review: 0, ...overrides });

  it('prefers the post-recovery evaluation only when it ran, and discloses a narrowed scope', () => {
    const base = { maxRounds: 2, recoveryScopeCount: 1, blockingSnapshotCount: 3 };
    expect(composeReviewCycleTerminalError({ ...base, finalEvaluation: evaluation({ blockingIssueOutcomes: 3, unresolvedIssueOutcomes: 3 }), latestEvaluation: evaluation({ blockingIssueOutcomes: 1, unresolvedIssueOutcomes: 1 }), recoveryBlockingCheckRan: true }))
      .toBe('1 blocking issue outcome(s) remain after 2 review round(s) (1 unresolved, 0 need human review; 0 rejected, 0 under review). Recovery re-evaluated 1 of 3 blocking issue(s); counts reflect that subset.');
    expect(composeReviewCycleTerminalError({ ...base, finalEvaluation: evaluation({ blockingIssueOutcomes: 3, unresolvedIssueOutcomes: 3, rejected: 2 }), latestEvaluation: evaluation({ ran: false }), recoveryBlockingCheckRan: true }))
      .toBe('3 blocking issue outcome(s) remain after 2 review round(s) (3 unresolved, 0 need human review; 2 rejected, 0 under review).');
    expect(composeReviewCycleTerminalError({ ...base, finalEvaluation: undefined, latestEvaluation: undefined, recoveryBlockingCheckRan: false }))
      .toBe('Review cycle exhausted 2 round(s) without a final evaluation verdict.');
  });
});

describe('same-plan recovery build-stage orchestration', () => {
  const makeTempDir = useTempDir('eforge-same-plan-recovery-orchestration-');

  it('reruns evaluation after an eligible review-cycle recovery fix and avoids terminal failure when blockers clear', async () => {
    const repo = await initRepo(makeTempDir());
    const preImplementCommit = await commitImplementation(repo);
    const harness = makeEscalatingFixerHarness(repo, [
      { text: issueXml },
      { text: 'Normal fixer made no safe change.' },
      { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-0', input: { verdicts: [{ file: 'src/app.ts', action: 'accept', reason: 'Still unresolved.', issueOutcome: 'unresolved_blocking', issueIds: ['review-r0-code-1'] }] }, output: '' }] },
      { text: 'Recovery fixed the active-plan blocker.' },
      { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-recovery', input: { verdicts: [{ file: 'src/app.ts', action: 'accept', reason: 'Recovered.', issueOutcome: 'resolved', issueIds: ['review-r0-code-1'] }] }, output: '' }] },
    ] satisfies StubResponse[]);
    const ctx = makeContext(repo, harness, preImplementCommit, { strategy: 'parallel', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' }, ['review-cycle']);

    const events = await collectEvents(getBuildStage('review-cycle')(ctx));

    const recoveryFixerPrompt = harness.prompts.filter((_, index) => harness.calls[index]?.stage === 'review-fix').at(-1) ?? '';
    expect(recoveryFixerPrompt).toContain('## Final verifier/test verdicts');
    expect(recoveryFixerPrompt).toContain('Still unresolved.');
    expect(recoveryFixerPrompt).toContain('## Changed files\n\n- src/app.ts');
    expect(recoveryFixerPrompt).toContain('## Diff context');
    expect(recoveryFixerPrompt).toContain('diff --git a/src/app.ts b/src/app.ts');
    expect(recoveryFixerPrompt).toContain('## Prior repair attempts');
    expect(recoveryFixerPrompt).toContain('round 1: attempted repair for 1 issue(s); evaluation accepted 1, rejected 0, blocking outcomes 1.');
    expect(filterEvents(events, 'plan:build:recovery:attempt:start')).toHaveLength(1);
    expect(filterEvents(events, 'plan:build:evaluate:start')).toHaveLength(2);
    expect(filterEvents(events, 'plan:build:recovery:attempt:result').at(-1)).toMatchObject({ blockersCleared: true });
    expect(events.some((event) => event.type === 'plan:build:failed')).toBe(false);
    expect(ctx.buildFailed).not.toBe(true);
  });

  it('reports the post-recovery evaluation in the terminal failure message when blockers shrink but persist', async () => {
    const repo = await initRepo(makeTempDir());
    const preImplementCommit = await commitImplementation(repo);
    const harness = makeEscalatingFixerHarness(repo, [
      { text: issueXml },
      { text: 'Fixer made no safe change.' },
      { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-0', input: { verdicts: [
        { file: 'src/app.ts', action: 'reject', reason: 'Fix attempt made things worse.', issueOutcome: 'unresolved_blocking', issueIds: ['review-r0-code-1'] },
      ] }, output: '' }] },
      { text: 'Recovery improved but did not clear the blocker.' },
      { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-recovery', input: { verdicts: [
        { file: 'src/app.ts', action: 'accept', reason: 'Better, still unresolved.', issueOutcome: 'unresolved_blocking', issueIds: ['review-r0-code-1'] },
      ] }, output: '' }] },
    ] satisfies StubResponse[]);
    const ctx = makeContext(repo, harness, preImplementCommit, { strategy: 'parallel', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' }, ['review-cycle']);

    const events = await collectEvents(getBuildStage('review-cycle')(ctx));

    expect(filterEvents(events, 'plan:build:recovery:attempt:result').at(-1)).toMatchObject({ blockersCleared: false });
    const failed = events.at(-1);
    expect(failed).toMatchObject({ type: 'plan:build:failed', planId: ctx.planId });
    expect((failed as { error: string }).error).toBe('1 blocking issue outcome(s) remain after 1 review round(s) (1 unresolved, 0 need human review; 0 rejected, 0 under review).');
    expect(ctx.buildFailed).toBe(true);
  });

  it('discloses narrowed recovery scope in the terminal failure message', async () => {
    const repo = await initRepo(makeTempDir());
    const preImplementCommit = await commitImplementation(repo);
    const twoIssueXml = '<review-issues><issue severity="critical" category="bugs" file="src/app.ts">Still broken.<fix>Set value to 3.</fix></issue><issue severity="critical" category="bugs" file="src/app.ts">Also broken.<fix>Guard the export.</fix></issue></review-issues>';
    const roundEval = { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-0', input: { verdicts: [
      { file: 'src/app.ts', action: 'accept', reason: 'Still unresolved.', issueOutcome: 'unresolved_blocking', issueIds: ['review-r0-code-1'], retryGuidance: 'Retry the value fix narrowly.' },
    ] }, output: '' }] };
    const recoveryEval = { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-recovery', input: { verdicts: [
      { file: 'src/app.ts', action: 'accept', reason: 'Better, still unresolved.', issueOutcome: 'unresolved_blocking', issueIds: ['review-r0-code-1'] },
    ] }, output: '' }] };
    const harness = makeEscalatingFixerHarness(repo, [
      { text: twoIssueXml },
      { text: 'Fixer attempted both issues.' },
      roundEval,
      { text: 'Recovery retried the scoped issue.' },
      recoveryEval,
    ] satisfies StubResponse[]);
    const ctx = makeContext(repo, harness, preImplementCommit, { strategy: 'parallel', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' }, ['review-cycle']);

    const events = await collectEvents(getBuildStage('review-cycle')(ctx));

    const failed = events.at(-1);
    expect(failed).toMatchObject({ type: 'plan:build:failed', planId: ctx.planId });
    expect((failed as { error: string }).error).toBe('1 blocking issue outcome(s) remain after 1 review round(s) (1 unresolved, 0 need human review; 0 rejected, 0 under review). Recovery re-evaluated 1 of 2 blocking issue(s); counts reflect that subset.');
    expect(ctx.buildFailed).toBe(true);
  });

  it('falls back to the pre-recovery evaluation when the recovery fix makes no committable change', async () => {
    const repo = await initRepo(makeTempDir());
    const preImplementCommit = await commitImplementation(repo);
    const harness = makeEscalatingFixerHarness(repo, [
      { text: issueXml },
      { text: 'Fixer made no safe change.' },
      { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-0', input: { verdicts: [
        { file: 'src/app.ts', action: 'reject', reason: 'Fix attempt made things worse.', issueOutcome: 'unresolved_blocking', issueIds: ['review-r0-code-1'] },
      ] }, output: '' }] },
      { text: 'Recovery found nothing safe to change.' },
    ] satisfies StubResponse[], { recoveryFixMutates: false });
    const ctx = makeContext(repo, harness, preImplementCommit, { strategy: 'parallel', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' }, ['review-cycle']);

    const events = await collectEvents(getBuildStage('review-cycle')(ctx));

    expect(filterEvents(events, 'plan:build:recovery:attempt:result').at(-1)).toMatchObject({ blockersCleared: false });
    const failed = events.at(-1);
    expect(failed).toMatchObject({ type: 'plan:build:failed', planId: ctx.planId });
    expect((failed as { error: string }).error).toBe('1 blocking issue outcome(s) remain after 1 review round(s) (1 unresolved, 0 need human review; 1 rejected, 0 under review).');
    expect(ctx.buildFailed).toBe(true);
  });

  it('extends the recovery budget and recovers on the second attempt when review rounds converge', async () => {
    const repo = await initRepo(makeTempDir());
    const preImplementCommit = await commitImplementation(repo);
    class ConvergingFixerHarness extends StubHarness {
      private stops = 0;
      async *run(runOptions: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        for await (const event of super.run(runOptions, agent, planId)) {
          yield event;
          if (event.type === 'agent:stop' && agent === 'review-fixer') {
            this.stops += 1;
            if (this.stops === 1) await writeFile(join(repo, 'src/util.ts'), 'export const util = 1;\n', 'utf8');
            await writeFile(join(repo, 'src/app.ts'), `export const value = ${3 + this.stops};\n`, 'utf8');
          }
        }
      }
    }
    const twoIssueXml = '<review-issues><issue severity="critical" category="bugs" file="src/app.ts">Still broken.<fix>Set value to 3.</fix></issue><issue severity="critical" category="bugs" file="src/util.ts">Util missing.<fix>Add util module.</fix></issue></review-issues>';
    const oneIssueXml = '<review-issues><issue severity="critical" category="bugs" file="src/app.ts">Still broken.<fix>Set value to 3.</fix></issue></review-issues>';
    const verdict = (toolUseId: string, verdicts: object[]) => ({ toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId, input: { verdicts }, output: '' }] });
    const harness = new ConvergingFixerHarness([
      { text: twoIssueXml },
      { text: 'Round 0 fixes.' },
      verdict('eval-r0', [
        { file: 'src/app.ts', action: 'accept', reason: 'Still unresolved.', issueOutcome: 'unresolved_blocking', issueIds: ['review-r0-code-1'] },
        { file: 'src/util.ts', action: 'accept', reason: 'Still unresolved.', issueOutcome: 'unresolved_blocking', issueIds: ['review-r0-code-2'] },
      ]),
      { text: oneIssueXml },
      { text: 'Round 1 fixes.' },
      verdict('eval-r1', [
        { file: 'src/app.ts', action: 'accept', reason: 'Nearly there.', issueOutcome: 'unresolved_blocking', issueIds: ['review-r1-code-1'], retryGuidance: 'Retry narrowly.' },
      ]),
      { text: 'Recovery attempt 1.' },
      verdict('eval-rec1', [
        { file: 'src/app.ts', action: 'accept', reason: 'Still short.', issueOutcome: 'unresolved_blocking', issueIds: ['review-r1-code-1'] },
      ]),
      { text: 'Recovery attempt 2.' },
      verdict('eval-rec2', [
        { file: 'src/app.ts', action: 'accept', reason: 'Recovered.', issueOutcome: 'resolved', issueIds: ['review-r1-code-1'] },
      ]),
    ] satisfies StubResponse[]);
    const ctx = makeContext(repo, harness, preImplementCommit, { strategy: 'parallel', perspectives: ['code'], maxRounds: 2, evaluatorStrictness: 'standard' }, ['review-cycle']);

    const events = await collectEvents(getBuildStage('review-cycle')(ctx));

    const extensionIndex = events.findIndex((event) => event.type === 'plan:build:decision' && (event as { decision: { kind: string } }).decision.kind === 'recovery-budget-extended');
    expect(events[extensionIndex]).toMatchObject({ decision: { previousBlockingIssueOutcomes: 2, lastBlockingIssueOutcomes: 1, maxAttempts: 2 } });
    const recoveryStartIndex = events.findIndex((event) => event.type === 'plan:build:recovery:start');
    expect(extensionIndex).toBeGreaterThan(-1);
    expect(recoveryStartIndex).toBe(extensionIndex + 1);
    expect(filterEvents(events, 'plan:build:recovery:start').at(0)).toMatchObject({ maxAttempts: 2 });
    expect(filterEvents(events, 'plan:build:recovery:attempt:start')).toHaveLength(2);
    expect(filterEvents(events, 'plan:build:recovery:attempt:result').at(-1)).toMatchObject({ blockersCleared: true });
    expect(events.some((event) => event.type === 'plan:build:failed')).toBe(false);
    expect(ctx.buildFailed).not.toBe(true);
  });

  it('preserves the existing terminal failure path when recovery is skipped as cross-plan', async () => {
    const repo = await initRepo(makeTempDir());
    const preImplementCommit = await commitImplementation(repo);
    class MutatingFixerHarness extends StubHarness {
      async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        for await (const event of super.run(options, agent, planId)) {
          yield event;
          if (event.type === 'agent:stop' && agent === 'review-fixer') {
            const current = await readFile(join(repo, 'src/app.ts'), 'utf8');
            await writeFile(join(repo, 'src/app.ts'), current.replace('value = 2', 'value = 4'), 'utf8');
          }
        }
      }
    }
    const harness = new MutatingFixerHarness([
      { text: issueXml },
      { text: 'Changed code, but blocker belongs elsewhere.' },
      { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-0', input: { verdicts: [{ file: 'src/app.ts', action: 'accept', reason: 'Still unresolved.', issueOutcome: 'unresolved_blocking', issueIds: ['review-r0-code-1'] }] }, output: '' }] },
    ] satisfies StubResponse[]);
    const ctx = makeContext(repo, harness, preImplementCommit, { strategy: 'parallel', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' }, ['review-cycle']);

    const events: EforgeEvent[] = [];
    for await (const event of getBuildStage('review-cycle')(ctx)) {
      if (event.type === 'plan:build:review:complete') {
        event.issues[0].metadata = { planId: 'plan-other' };
        ctx.reviewIssues = event.issues;
      }
      events.push(event);
    }

    expect(events.some((event) => event.type === 'plan:build:recovery:skip' && event.reason === 'cross-plan-blocker')).toBe(true);
    expect(events.some((event) => event.type === 'plan:build:recovery:attempt:start')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'plan:build:failed', planId: ctx.planId });
    expect(ctx.buildFailed).toBe(true);
  });
});
