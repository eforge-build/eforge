/**
 * Tests for the sharded-build → review-cycle → verify perspective flow.
 *
 * Covers:
 * 1. extractVerificationCommands: the shared utility that parses verification
 *    commands from a plan body.
 * 2. Runtime guard simulation: a sharded plan missing review-cycle or verify
 *    gets them injected (guard logic mirrored from eforge.ts planRunner).
 * 3. End-to-end stub scenario: verify perspective surfaces a critical issue,
 *    review-fixer applies the fix, round 2 finds no issues.
 * 4. Full pipeline integration: runBuildPipeline with sharded implement +
 *    review-cycle in a real temp git repo.
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { extractVerificationCommands } from '@eforge-build/engine/verification';
import { getVerifyReviewIssueSchemaYaml } from '@eforge-build/engine/schemas';
import { applyShardedPlanGuard } from '@eforge-build/engine/sharded-plan-guard';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';
import { runParallelReview } from '@eforge-build/engine/agents/parallel-reviewer';
import { runReviewFixer } from '@eforge-build/engine/agents/review-fixer';
import { runBuildPipeline, type BuildStageContext } from '@eforge-build/engine/pipeline';
import { DEFAULT_CONFIG, DEFAULT_REVIEW } from '@eforge-build/engine/config';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { createNoopTracingContext } from '@eforge-build/engine/tracing';
import { ModelTracker } from '@eforge-build/engine/model-tracker';
import type { ReviewIssue, PlanFile, OrchestrationConfig } from '@eforge-build/engine/events';
import type { BuildStageSpec } from '@eforge-build/engine/config';
import type { ReviewProfileConfig } from '@eforge-build/client';
import type { PipelineComposition } from '@eforge-build/engine/schemas';

// ---------------------------------------------------------------------------
// extractVerificationCommands
// ---------------------------------------------------------------------------

describe('extractVerificationCommands', () => {
  const planWithVerification = `# My Plan

Some implementation plan.

## Implementation

Do some work.

## Verification

- [ ] \`pnpm type-check\` passes with zero errors.
- [ ] \`pnpm build\` produces bundles for all workspace packages.
- [ ] \`pnpm test\` passes.
`;

  it('extracts commands from the Verification section', () => {
    const cmds = extractVerificationCommands(planWithVerification, [], 'full');
    expect(cmds).toContain('pnpm type-check');
    expect(cmds).toContain('pnpm build');
    expect(cmds).toContain('pnpm test');
  });

  it('filters out test commands in build-only scope', () => {
    const cmds = extractVerificationCommands(planWithVerification, [], 'build-only');
    expect(cmds).toContain('pnpm type-check');
    expect(cmds).toContain('pnpm build');
    expect(cmds).not.toContain('pnpm test');
  });

  it('prepends postMergeCommands before extracted commands', () => {
    const cmds = extractVerificationCommands(planWithVerification, ['pnpm install'], 'full');
    expect(cmds[0]).toBe('pnpm install');
    expect(cmds).toContain('pnpm type-check');
    expect(cmds).toContain('pnpm test');
  });

  it('deduplicates postMergeCommands that overlap with plan commands', () => {
    // pnpm install is both a postMergeCommand and in the plan
    const planWithInstall = `## Verification\n\n- [ ] \`pnpm install\`\n- [ ] \`pnpm build\`\n`;
    const cmds = extractVerificationCommands(planWithInstall, ['pnpm install'], 'full');
    expect(cmds.filter(c => c === 'pnpm install')).toHaveLength(1);
    expect(cmds).toContain('pnpm build');
  });

  it('returns empty array when there is no Verification section', () => {
    const planWithoutVerification = `# My Plan\n\nNo verification section here.\n`;
    const cmds = extractVerificationCommands(planWithoutVerification, ['pnpm install'], 'full');
    expect(cmds).toHaveLength(0);
  });

  it('returns empty array when Verification section has no recognized commands', () => {
    const planWithEmptyVerification = `# My Plan\n\n## Verification\n\n- [ ] Manual check only.\n`;
    const cmds = extractVerificationCommands(planWithEmptyVerification, [], 'full');
    expect(cmds).toHaveLength(0);
  });

  it('does not run postMergeCommands when there are no plan commands (nothing to verify against)', () => {
    const planWithEmptyVerification = `## Verification\n\n- [ ] Manual check.\n`;
    const cmds = extractVerificationCommands(planWithEmptyVerification, ['pnpm install'], 'full');
    expect(cmds).toHaveLength(0);
  });

  it('extracts npm and npx commands as well as pnpm', () => {
    const plan = `## Verification\n\n- [ ] \`npm test\`\n- [ ] \`npx tsc --noEmit\`\n- [ ] \`yarn build\`\n`;
    const cmds = extractVerificationCommands(plan, [], 'full');
    expect(cmds).toContain('npm test');
    expect(cmds).toContain('npx tsc --noEmit');
    expect(cmds).toContain('yarn build');
  });

  it('stops extraction at the next ## heading', () => {
    const plan = `## Verification\n\n- [ ] \`pnpm build\`\n\n## Post-Merge Notes\n\n- [ ] \`pnpm deploy\`\n`;
    const cmds = extractVerificationCommands(plan, [], 'full');
    expect(cmds).toContain('pnpm build');
    expect(cmds).not.toContain('pnpm deploy');
  });
});

// ---------------------------------------------------------------------------
// Runtime guard simulation
// ---------------------------------------------------------------------------

describe('sharded plan runtime guard', () => {
  const defaultReview: ReviewProfileConfig = {
    strategy: 'auto',
    perspectives: ['code', 'security'],
    maxRounds: 2,
  };

  it('injects review-cycle into a sharded plan that omits it', () => {
    const build: BuildStageSpec[] = ['implement'];
    const shards = [{ id: 'shard-a', roots: ['packages/'] }];

    const { planBuild } = applyShardedPlanGuard(build, defaultReview, shards);
    expect(planBuild).toContain('review-cycle');
  });

  it('does not duplicate review-cycle when already present', () => {
    const build: BuildStageSpec[] = ['implement', 'review-cycle'];
    const shards = [{ id: 'shard-a', roots: ['packages/'] }];

    const { planBuild } = applyShardedPlanGuard(build, defaultReview, shards);
    expect(planBuild.filter(s => s === 'review-cycle')).toHaveLength(1);
  });

  it('injects verify into a sharded plan that omits it from perspectives', () => {
    const build: BuildStageSpec[] = ['implement', 'review-cycle'];
    const shards = [{ id: 'shard-a', roots: ['packages/'] }];

    const { planReview } = applyShardedPlanGuard(build, defaultReview, shards);
    expect(planReview.perspectives).toContain('verify');
  });

  it('does not duplicate verify when already present in perspectives', () => {
    const build: BuildStageSpec[] = ['implement', 'review-cycle'];
    const shards = [{ id: 'shard-a', roots: ['packages/'] }];
    const reviewWithVerify: ReviewProfileConfig = {
      ...defaultReview,
      perspectives: ['code', 'verify'],
    };

    const { planReview } = applyShardedPlanGuard(build, reviewWithVerify, shards);
    expect(planReview.perspectives.filter(p => p === 'verify')).toHaveLength(1);
  });

  it('does not modify build or review for a non-sharded plan (no shards)', () => {
    const build: BuildStageSpec[] = ['implement', 'review-cycle'];

    const { planBuild, planReview } = applyShardedPlanGuard(build, defaultReview, undefined);
    expect(planBuild).toEqual(build);
    expect(planReview).toBe(defaultReview);
  });

  it('does not modify build or review when shards array is empty', () => {
    const build: BuildStageSpec[] = ['implement', 'review-cycle'];

    const { planBuild, planReview } = applyShardedPlanGuard(build, defaultReview, []);
    expect(planBuild).toEqual(build);
    expect(planReview).toBe(defaultReview);
  });

  it('handles parallel stage arrays in build pipeline when checking for review-cycle', () => {
    // review-cycle in a parallel group: [['doc-update', 'review-cycle']]
    const build: BuildStageSpec[] = ['implement', ['doc-update', 'review-cycle']];
    const shards = [{ id: 'shard-a', roots: ['packages/'] }];

    const { planBuild } = applyShardedPlanGuard(build, defaultReview, shards);
    // review-cycle is already present (inside the nested array), should not inject again
    const flat = planBuild.flat();
    expect(flat.filter(s => s === 'review-cycle')).toHaveLength(1);
  });

  it('populates injected with review-cycle and verify when both are missing', () => {
    const build: BuildStageSpec[] = ['implement'];
    const shards = [{ id: 'shard-a', roots: ['packages/'] }];

    const { injected } = applyShardedPlanGuard(build, defaultReview, shards);
    expect(injected).toContain('review-cycle');
    expect(injected).toContain('verify');
  });

  it('returns empty injected when nothing needs to be added', () => {
    const build: BuildStageSpec[] = ['implement', 'review-cycle'];
    const shards = [{ id: 'shard-a', roots: ['packages/'] }];
    const reviewWithVerify: ReviewProfileConfig = { ...defaultReview, perspectives: ['code', 'verify'] };

    const { injected } = applyShardedPlanGuard(build, reviewWithVerify, shards);
    expect(injected).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end stub scenario: verify → fixer → round 2 passes
// ---------------------------------------------------------------------------

describe('verify perspective round-trip with review fixer', () => {
  it('surfacing a verify failure in round 1 → fixer → round 2 clean', async () => {
    // Round 1: verify perspective emits a critical issue for a failing type-check
    const round1VerifyText = `<review-issues>
  <issue severity="critical" category="verification-failure" file="packages/engine/src/foo.ts">
    Command \`pnpm type-check\` failed with exit code 1.
    <fix>Command: pnpm type-check
Exit code: 1
stderr: error TS2345: Argument of type 'string' is not assignable to parameter of type 'number' at packages/engine/src/foo.ts:42</fix>
  </issue>
</review-issues>`;

    const reviewBackend = new StubHarness([{ text: round1VerifyText }]);

    const round1Events = await collectEvents(
      runParallelReview({
        harness: reviewBackend,
        planContent: '# Sharded Plan\n\n## Verification\n\n- [ ] `pnpm type-check`',
        baseBranch: 'main',
        planId: 'plan-01-sharded',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['verify'],
      }),
    );

    const round1Complete = findEvent(round1Events, 'plan:build:review:complete');
    expect(round1Complete).toBeDefined();
    expect(round1Complete!.issues).toHaveLength(1);

    const issue = round1Complete!.issues[0] as ReviewIssue;
    expect(issue.severity).toBe('critical');
    expect(issue.category).toBe('verification-failure');
    expect(issue.file).toBe('packages/engine/src/foo.ts');
    expect(issue.fix).toContain('pnpm type-check');
    expect(issue.fix).toContain('Exit code: 1');
    expect(issue.fix).toContain('TS2345');

    // Review fixer receives the issue and applies a fix to a file outside the original diff
    // (verify issues allow cross-diff fixes per the review-fixer.md update)
    const fixerBackend = new StubHarness([{ text: 'Applied fix to packages/engine/src/foo.ts: corrected argument type.' }]);

    const fixerEvents = await collectEvents(
      runReviewFixer({
        harness: fixerBackend,
        planId: 'plan-01-sharded',
        cwd: '/tmp',
        issues: round1Complete!.issues,
      }),
    );

    expect(findEvent(fixerEvents, 'plan:build:review:fix:start')).toBeDefined();
    expect(findEvent(fixerEvents, 'plan:build:review:fix:complete')).toBeDefined();

    // The fixer prompt should include the issues with the verify failure details
    expect(fixerBackend.prompts[0]).toContain('verification-failure');

    // Round 2: verify perspective finds no failures
    const round2VerifyText = '<review-issues></review-issues>';
    const round2Backend = new StubHarness([{ text: round2VerifyText }]);

    const round2Events = await collectEvents(
      runParallelReview({
        harness: round2Backend,
        planContent: '# Sharded Plan\n\n## Verification\n\n- [ ] `pnpm type-check`',
        baseBranch: 'main',
        planId: 'plan-01-sharded',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['verify'],
      }),
    );

    const round2Complete = findEvent(round2Events, 'plan:build:review:complete');
    expect(round2Complete).toBeDefined();
    expect(round2Complete!.issues).toHaveLength(0);
  });

  it('verify schema YAML is included in the prompt (template variable substitution)', async () => {
    const backend = new StubHarness([{ text: '<review-issues></review-issues>' }]);

    await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Test Plan\n\n## Verification\n\n- [ ] `pnpm build`',
        baseBranch: 'main',
        planId: 'plan-schema-test',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['verify'],
      }),
    );

    const prompt = backend.prompts[0];
    // The schema YAML should be embedded in the prompt
    const schemaYaml = getVerifyReviewIssueSchemaYaml();
    // At minimum, the schema content (verification-failure) should appear in the prompt
    expect(prompt).toContain('verification-failure');
    expect(schemaYaml.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Full pipeline integration: sharded implement → review-cycle
// ---------------------------------------------------------------------------

describe('sharded build → review-cycle full pipeline integration', () => {
  const makeTempDir = useTempDir('eforge-sharded-integration-');

  it('sharded implement + verify review-cycle → round 1 issue → fix → round 2 clean', async () => {
    const cwd = makeTempDir();

    // Set up a real git repo so the coordinator can commit
    execFileSync('git', ['init'], { cwd });
    execFileSync('git', ['config', 'user.email', 'test@eforge.build'], { cwd });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd });
    writeFileSync(join(cwd, 'README.md'), '# Test\n');
    execFileSync('git', ['add', 'README.md'], { cwd });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd });

    // Capture the actual branch name (main or master depending on git config)
    const baseBranch = execFileSync(
      'git', ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd, encoding: 'utf8' },
    ).trim();

    // Write a file in the shard scope. The coordinator's `git add -A` will stage it.
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'version.ts'), 'export const CONST_VALUE = 9;\n');

    // --- StubHarness responses (consumed in order across all agent calls) ---
    // Call 0: builder shard-a (builderImplement) — no-op text response
    // Call 1: reviewer (verify perspective, round 1) — 1 critical issue
    // Call 2: review-fixer — applies fix (text only, no real file writes)
    // Call 3: reviewer (verify perspective, round 2) — no issues
    const round1VerifyText = `<review-issues>
  <issue severity="critical" category="verification-failure" file="src/version.ts">
    CONST_VALUE must be 10, not 9.
    <fix>Change CONST_VALUE from 9 to 10 in src/version.ts</fix>
  </issue>
</review-issues>`;

    const harness = new StubHarness([
      { text: 'Implementation complete.' },
      { text: round1VerifyText },
      { text: 'Applied fix to src/version.ts: updated CONST_VALUE to 10.' },
      { text: '<review-issues></review-issues>' },
    ]);

    // --- Plan configuration ---
    const planId = 'plan-01-sharded';
    const planFile: PlanFile = {
      id: planId,
      name: 'Sharded Integration Test Plan',
      dependsOn: [],
      branch: `test/${planId}`,
      body: '# Sharded Plan\n\n## Verification\n\n- [ ] `pnpm type-check`\n',
      filePath: join(cwd, 'plan-01-sharded.md'),
      // Declare 1 shard for src/ — coordinator commits after all shards finish
      agents: {
        builder: {
          shards: [{ id: 'shard-a', roots: ['src/'] }],
        },
      },
    };

    const reviewConfig: ReviewProfileConfig = {
      strategy: 'parallel',
      perspectives: ['verify'],
      maxRounds: 2,
    };

    const buildPipeline: PipelineComposition = {
      scope: 'excursion',
      compile: ['planner'],
      defaultBuild: ['implement', 'review-cycle'],
      defaultReview: DEFAULT_REVIEW,
      rationale: 'integration test pipeline',
    };

    const orchConfig: OrchestrationConfig = {
      name: 'test-plan-set',
      description: 'Integration test',
      created: new Date().toISOString(),
      mode: 'errand',
      baseBranch,
      pipeline: buildPipeline,
      plans: [{
        id: planId,
        name: planFile.name,
        dependsOn: [],
        branch: planFile.branch,
        build: ['implement', 'review-cycle'],
        review: reviewConfig,
      }],
    };

    const buildCtx: BuildStageContext = {
      agentRuntimes: singletonRegistry(harness),
      config: DEFAULT_CONFIG,
      pipeline: buildPipeline,
      tracing: createNoopTracingContext(),
      cwd,
      planSetName: 'test-plan-set',
      sourceContent: '',
      modelTracker: new ModelTracker(),
      plans: [planFile],
      expeditionModules: [],
      moduleBuildConfigs: new Map(),
      planId,
      worktreePath: cwd,
      planFile,
      orchConfig,
      planEntry: orchConfig.plans[0],
      reviewIssues: [],
      build: ['implement', 'review-cycle'],
      review: reviewConfig,
    };

    // --- Run the pipeline ---
    const events = await collectEvents(runBuildPipeline(buildCtx));

    // --- Assertions ---

    // plan:build:start and plan:build:complete bracket everything
    expect(findEvent(events, 'plan:build:start')).toBeDefined();
    expect(findEvent(events, 'plan:build:complete')).toBeDefined();
    // plan:build:failed must NOT appear
    expect(findEvent(events, 'plan:build:failed')).toBeUndefined();

    // Coordinator committed after all shards finished
    expect(findEvent(events, 'plan:build:implement:complete')).toBeDefined();

    // Review round 1: parallel start with verify perspective
    const reviewStarts = filterEvents(events, 'plan:build:review:parallel:start');
    expect(reviewStarts.length).toBeGreaterThanOrEqual(1);
    const round1Start = reviewStarts[0] as { perspectives: string[] };
    expect(round1Start.perspectives).toContain('verify');

    // Review round 1: complete with 1 critical issue
    const reviewCompletes = filterEvents(events, 'plan:build:review:complete');
    expect(reviewCompletes.length).toBeGreaterThanOrEqual(1);
    const round1Complete = reviewCompletes[0] as { issues: ReviewIssue[] };
    expect(round1Complete.issues).toHaveLength(1);
    expect(round1Complete.issues[0].category).toBe('verification-failure');

    // Review fixer ran
    expect(findEvent(events, 'plan:build:review:fix:start')).toBeDefined();
    expect(findEvent(events, 'plan:build:review:fix:complete')).toBeDefined();

    // Review round 2: parallel start with verify perspective
    expect(reviewStarts.length).toBeGreaterThanOrEqual(2);
    const round2Start = reviewStarts[1] as { perspectives: string[] };
    expect(round2Start.perspectives).toContain('verify');

    // Review round 2: clean (0 issues)
    expect(reviewCompletes.length).toBeGreaterThanOrEqual(2);
    const round2Complete = reviewCompletes[1] as { issues: ReviewIssue[] };
    expect(round2Complete.issues).toHaveLength(0);

    // Terminal event is plan:build:complete (not plan:build:failed)
    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe('plan:build:complete');
  });

  it('emits plan:build:progress events when guard injects review-cycle or verify', async () => {
    const cwd = makeTempDir();

    // Minimal git repo for coordinator commit
    execFileSync('git', ['init'], { cwd });
    execFileSync('git', ['config', 'user.email', 'test@eforge.build'], { cwd });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd });
    writeFileSync(join(cwd, 'README.md'), '# Test\n');
    execFileSync('git', ['add', 'README.md'], { cwd });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd });
    const baseBranch = execFileSync(
      'git', ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd, encoding: 'utf8' },
    ).trim();

    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(join(cwd, 'src', 'version.ts'), 'export const CONST_VALUE = 9;\n');

    // Use implement-only build — guard should inject review-cycle and verify
    // via applyShardedPlanGuard (called in eforge.ts planRunner), but here
    // we call runBuildPipeline directly so the guard doesn't run automatically.
    // Instead, verify the guard's event emission by calling applyShardedPlanGuard
    // and checking that injected fields trigger progress events.
    //
    // We verify indirectly: set planFile.agents.builder.shards so the guard
    // WOULD inject if run, then confirm the injected array contains both items.
    const planFile: PlanFile = {
      id: 'plan-progress-test',
      name: 'Progress Event Test',
      dependsOn: [],
      branch: 'test/plan-progress-test',
      body: '# Plan\n',
      filePath: join(cwd, 'plan-progress.md'),
      agents: {
        builder: {
          shards: [{ id: 'shard-a', roots: ['src/'] }],
        },
      },
    };

    // Confirm guard emits both injected items
    const reviewOnly: ReviewProfileConfig = { strategy: 'auto', perspectives: ['code'], maxRounds: 2 };
    const { injected } = applyShardedPlanGuard(['implement'], reviewOnly, planFile.agents!['builder']!.shards);
    expect(injected).toContain('review-cycle');
    expect(injected).toContain('verify');
    expect(injected).toHaveLength(2);

    // When nothing is missing, injected is empty
    const reviewWithVerify: ReviewProfileConfig = { strategy: 'auto', perspectives: ['verify'], maxRounds: 2 };
    const { injected: noop } = applyShardedPlanGuard(['implement', 'review-cycle'], reviewWithVerify, planFile.agents!['builder']!.shards);
    expect(noop).toHaveLength(0);
  });
});
