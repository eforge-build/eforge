/**
 * Reviewer isolation tests — verify that the review stage detects and
 * restores reviewer-introduced worktree mutations before review-fixer or
 * evaluator stages can treat them as candidate builder output.
 *
 * Uses the real `review` build stage via getBuildStage and a custom harness
 * that writes files to the worktree during its run to simulate a misbehaving
 * reviewer agent.
 */
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { EforgeEvent, PlanFile, OrchestrationConfig, AgentRole, AgentResultData } from '@eforge-build/engine/events';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import { DEFAULT_CONFIG, DEFAULT_REVIEW } from '@eforge-build/engine/config';
import { getBuildStage, type BuildStageContext } from '@eforge-build/engine/pipeline';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { createNoopTracingContext } from '@eforge-build/engine/tracing';
import { ModelTracker } from '@eforge-build/engine/model-tracker';
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

async function commitAll(repo: string, message: string): Promise<void> {
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', message]);
}

async function collect(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

function findEvent<T extends EforgeEvent['type']>(
  events: EforgeEvent[],
  type: T,
): Extract<EforgeEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<EforgeEvent, { type: T }> => e.type === type);
}

const STUB_RESULT: AgentResultData = {
  durationMs: 100,
  durationApiMs: 80,
  numTurns: 1,
  totalCostUsd: 0,
  usage: { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 },
  modelUsage: {},
};

/**
 * A harness that:
 * 1. Emits a valid empty review-issues block (no review findings)
 * 2. Writes one or more files to the worktree as side effects to simulate a
 *    misbehaving reviewer that mutates the worktree.
 */
class MutatingReviewerHarness implements AgentHarness {
  constructor(
    private readonly cwd: string,
    private readonly filesToCreate: Array<{ path: string; content: string }>,
    private readonly filesToModify: Array<{ path: string; content: string }> = [],
  ) {}

  effectiveCustomToolName(name: string): string { return name; }

  async *run(_options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    const agentId = 'mutating-reviewer-1';

    yield {
      type: 'agent:start',
      timestamp: new Date().toISOString(),
      planId,
      agentId,
      agent,
      model: 'stub-model',
      harness: 'claude-sdk' as const,
      harnessSource: 'tier' as const,
    };

    // Simulate mutations during the review run
    for (const file of this.filesToCreate) {
      await mkdir(join(this.cwd, file.path, '..'), { recursive: true });
      await writeFile(join(this.cwd, file.path), file.content, 'utf8');
    }
    for (const file of this.filesToModify) {
      await writeFile(join(this.cwd, file.path), file.content, 'utf8');
    }

    // Emit a valid review output (no code issues — the mutation is the violation)
    yield {
      type: 'agent:message',
      timestamp: new Date().toISOString(),
      planId,
      agentId,
      agent,
      content: 'Review complete.\n\n<review-issues></review-issues>',
    };

    yield {
      type: 'agent:result',
      timestamp: new Date().toISOString(),
      planId,
      agentId,
      agent,
      result: STUB_RESULT,
    };

    yield {
      type: 'agent:stop',
      timestamp: new Date().toISOString(),
      planId,
      agentId,
      agent,
      stopReason: 'end_turn',
    };
  }
}

function makeCtx(repo: string, harness: AgentHarness): BuildStageContext {
  const planFile: PlanFile = {
    id: 'plan-01-reviewer-isolation',
    name: 'Reviewer Isolation',
    dependsOn: [],
    branch: 'test/reviewer-isolation',
    body: '# Plan\n\n## Verification\n\n- [ ] Test passes.',
    filePath: join(repo, 'plan.md'),
  };
  const orchConfig: OrchestrationConfig = {
    name: 'test',
    description: 'test',
    created: new Date().toISOString(),
    mode: 'errand',
    baseBranch: 'main',
    pipeline: {
      scope: 'errand',
      compile: [],
      defaultBuild: ['review'],
      defaultReview: DEFAULT_REVIEW,
      rationale: 'test',
    },
    plans: [{
      id: planFile.id,
      name: planFile.name,
      dependsOn: [],
      branch: planFile.branch,
      build: ['review'],
      review: DEFAULT_REVIEW,
    }],
  };
  return {
    agentRuntimes: singletonRegistry(harness),
    config: DEFAULT_CONFIG,
    pipeline: orchConfig.pipeline,
    tracing: createNoopTracingContext(),
    cwd: repo,
    planSetName: 'test',
    sourceContent: '',
    modelTracker: new ModelTracker(),
    plans: [planFile],
    expeditionModules: [],
    moduleBuildConfigs: new Map(),
    planId: planFile.id,
    worktreePath: repo,
    planFile,
    orchConfig,
    reviewIssues: [],
    build: ['review'],
    review: { ...DEFAULT_REVIEW, strategy: 'single' },
  };
}

describe('reviewer worktree mutation detection', () => {
  const makeTempDir = useTempDir('eforge-reviewer-isolation-');

  it('detects a reviewer-created untracked file and adds a critical review-contract issue', async () => {
    const repo = await initRepo(makeTempDir());
    await writeFile(join(repo, 'src.ts'), 'export const x = 1;\n', 'utf8');
    await commitAll(repo, 'chore: initial');

    const harness = new MutatingReviewerHarness(repo, [
      { path: 'reviewer-artifact.txt', content: 'I should not be here\n' },
    ]);
    const ctx = makeCtx(repo, harness);

    const events = await collect(getBuildStage('review')(ctx));

    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete).toBeDefined();

    // The aggregate complete event must contain a critical review-contract issue
    const contractIssue = complete!.issues.find(
      i => i.severity === 'critical' && i.category === 'review-contract',
    );
    expect(contractIssue).toBeDefined();
    expect(contractIssue!.file).toBe('reviewer-output');

    // The reviewer-created file must be removed after the review stage
    const files = await readdir(repo);
    expect(files).not.toContain('reviewer-artifact.txt');
  });

  it('detects a reviewer modification to a tracked file and adds a critical review-contract issue', async () => {
    const repo = await initRepo(makeTempDir());
    await writeFile(join(repo, 'src.ts'), 'export const x = 1;\n', 'utf8');
    await commitAll(repo, 'chore: initial');

    const harness = new MutatingReviewerHarness(
      repo,
      [],
      [{ path: 'src.ts', content: 'export const x = 999; // reviewer modified this\n' }],
    );
    const ctx = makeCtx(repo, harness);

    const events = await collect(getBuildStage('review')(ctx));

    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete).toBeDefined();

    const contractIssue = complete!.issues.find(
      i => i.severity === 'critical' && i.category === 'review-contract',
    );
    expect(contractIssue).toBeDefined();

    // The tracked file must be restored to its committed content after the review stage
    const { stdout: diff } = await exec('git', ['diff', '--name-only'], { cwd: repo });
    expect(diff.trim()).toBe('');
  });

  it('yields the review-complete event with all other issues preserved alongside the contract issue', async () => {
    const repo = await initRepo(makeTempDir());
    await writeFile(join(repo, 'src.ts'), 'export const x = 1;\n', 'utf8');
    await commitAll(repo, 'chore: initial');

    // Harness writes a file AND emits a review finding in the same output
    class MutatingReviewerWithIssues extends MutatingReviewerHarness {
      override async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        const agentId = 'mutating-reviewer-2';
        yield {
          type: 'agent:start',
          timestamp: new Date().toISOString(),
          planId,
          agentId,
          agent,
          model: 'stub-model',
          harness: 'claude-sdk' as const,
          harnessSource: 'tier' as const,
        };
        await writeFile(join(repo, 'mutation.txt'), 'mutated\n', 'utf8');
        yield {
          type: 'agent:message',
          timestamp: new Date().toISOString(),
          planId,
          agentId,
          agent,
          content: `Found an issue.\n\n<review-issues>
  <issue severity="warning" category="bugs" file="src.ts">Unnecessary mutation concern</issue>
</review-issues>`,
        };
        yield {
          type: 'agent:result',
          timestamp: new Date().toISOString(),
          planId,
          agentId,
          agent,
          result: STUB_RESULT,
        };
        yield {
          type: 'agent:stop',
          timestamp: new Date().toISOString(),
          planId,
          agentId,
          agent,
          stopReason: 'end_turn',
        };
      }
    }

    const harness = new MutatingReviewerWithIssues(repo, []);
    const ctx = makeCtx(repo, harness);

    const events = await collect(getBuildStage('review')(ctx));

    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete).toBeDefined();

    // The warning issue from the reviewer is preserved
    const warningIssue = complete!.issues.find(i => i.severity === 'warning' && i.category === 'bugs');
    expect(warningIssue).toBeDefined();

    // The contract violation issue is also appended
    const contractIssue = complete!.issues.find(
      i => i.severity === 'critical' && i.category === 'review-contract',
    );
    expect(contractIssue).toBeDefined();
  });

  it('does not inject a contract issue when the reviewer makes no mutations', async () => {
    const repo = await initRepo(makeTempDir());
    await writeFile(join(repo, 'src.ts'), 'export const x = 1;\n', 'utf8');
    await commitAll(repo, 'chore: initial');

    // Clean reviewer — no mutations
    class CleanReviewerHarness implements AgentHarness {
      effectiveCustomToolName(name: string): string { return name; }
      async *run(_options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
        const agentId = 'clean-reviewer-1';
        yield { type: 'agent:start', timestamp: new Date().toISOString(), planId, agentId, agent, model: 'stub-model', harness: 'claude-sdk' as const, harnessSource: 'tier' as const };
        yield { type: 'agent:message', timestamp: new Date().toISOString(), planId, agentId, agent, content: 'All good.\n\n<review-issues></review-issues>' };
        yield { type: 'agent:result', timestamp: new Date().toISOString(), planId, agentId, agent, result: STUB_RESULT };
        yield { type: 'agent:stop', timestamp: new Date().toISOString(), planId, agentId, agent, stopReason: 'end_turn' };
      }
    }

    const ctx = makeCtx(repo, new CleanReviewerHarness());
    const events = await collect(getBuildStage('review')(ctx));

    const complete = findEvent(events, 'plan:build:review:complete');
    expect(complete).toBeDefined();

    // No contract violation should appear for a clean reviewer
    const contractIssue = complete!.issues.find(i => i.category === 'review-contract');
    expect(contractIssue).toBeUndefined();

    // Issues list should be empty (clean review output)
    expect(complete!.issues).toHaveLength(0);
  });
});
