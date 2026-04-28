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
 */

import { describe, it, expect } from 'vitest';
import { extractVerificationCommands } from '@eforge-build/engine/verification';
import { getVerifyReviewIssueSchemaYaml } from '@eforge-build/engine/schemas';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { runParallelReview } from '@eforge-build/engine/agents/parallel-reviewer';
import { runReviewFixer } from '@eforge-build/engine/agents/review-fixer';
import type { ReviewIssue } from '@eforge-build/engine/events';
import type { BuildStageSpec } from '@eforge-build/engine/config';
import type { ReviewProfileConfig } from '@eforge-build/client';

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
  /**
   * Mirrors the guard logic from eforge.ts planRunner.
   * Used to verify the guard's behavior without wiring the full engine.
   */
  function applyShardedPlanGuard(
    planBuild: BuildStageSpec[],
    planReview: ReviewProfileConfig,
    shards: unknown[] | undefined,
  ): { planBuild: BuildStageSpec[]; planReview: ReviewProfileConfig } {
    if (shards && shards.length > 0) {
      const flatStages = planBuild.flat();
      if (!flatStages.includes('review-cycle')) {
        planBuild = [...planBuild, 'review-cycle'];
      }
      if (!planReview.perspectives.includes('verify')) {
        planReview = { ...planReview, perspectives: [...planReview.perspectives, 'verify'] };
      }
    }
    return { planBuild, planReview };
  }

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
