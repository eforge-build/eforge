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

describe('same-plan recovery build-stage orchestration', () => {
  const makeTempDir = useTempDir('eforge-same-plan-recovery-orchestration-');

  it('reruns evaluation after an eligible review-cycle recovery fix and avoids terminal failure when blockers clear', async () => {
    const repo = await initRepo(makeTempDir());
    const preImplementCommit = await commitImplementation(repo);
    class RecoveryHarness extends StubHarness {
      private fixerStops = 0;
      async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        for await (const event of super.run(options, agent, planId)) {
          yield event;
          if (event.type === 'agent:stop' && agent === 'review-fixer') {
            this.fixerStops += 1;
            const current = await readFile(join(repo, 'src/app.ts'), 'utf8');
            await writeFile(join(repo, 'src/app.ts'), this.fixerStops === 1 ? current.replace('value = 2', 'value = 4') : current.replace(/value = \d+/, 'value = 3'), 'utf8');
          }
        }
      }
    }
    const harness = new RecoveryHarness([
      { text: issueXml },
      { text: 'Normal fixer made no safe change.' },
      { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-0', input: { verdicts: [{ file: 'src/app.ts', action: 'accept', reason: 'Still unresolved.', issueOutcome: 'unresolved_blocking', issueIds: ['review-r0-code-1'] }] }, output: '' }] },
      { text: 'Recovery fixed the active-plan blocker.' },
      { toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-recovery', input: { verdicts: [{ file: 'src/app.ts', action: 'accept', reason: 'Recovered.', issueOutcome: 'resolved', issueIds: ['review-r0-code-1'] }] }, output: '' }] },
    ] satisfies StubResponse[]);
    const ctx = makeContext(repo, harness, preImplementCommit, { strategy: 'parallel', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' }, ['review-cycle']);

    const events = await collectEvents(getBuildStage('review-cycle')(ctx));

    expect(filterEvents(events, 'plan:build:recovery:attempt:start')).toHaveLength(1);
    expect(filterEvents(events, 'plan:build:evaluate:start')).toHaveLength(2);
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
