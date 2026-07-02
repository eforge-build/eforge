import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EforgeEvent, AgentRole } from '@eforge-build/engine/events';
import { AgentTerminalError, PlannerSubmissionError } from '@eforge-build/engine/harness';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';
import { runReview } from '@eforge-build/engine/agents/reviewer';
import { builderImplement, builderEvaluate, type BuilderEvaluationResult } from '@eforge-build/engine/agents/builder';
import type { EvaluationSnapshot } from '@eforge-build/engine/evaluation';
import { runParallelReview } from '@eforge-build/engine/agents/parallel-reviewer';
import { runPlanReview } from '@eforge-build/engine/agents/plan-reviewer';
import { runPlanEvaluate } from '@eforge-build/engine/agents/plan-evaluator';
import { runArchitectureEvaluate } from '@eforge-build/engine/agents/plan-evaluator';
import { runModulePlanner } from '@eforge-build/engine/agents/module-planner';
import { runArchitectureReview } from '@eforge-build/engine/agents/architecture-reviewer';
import { runPrdValidator } from '@eforge-build/engine/agents/prd-validator';
import type { ExpectedAcceptanceCriterion } from '@eforge-build/engine/validation/acceptance-criteria';
import { validatePipeline, formatStageRegistry, getCompileStageNames, getBuildStageNames, getCompileStageDescriptors, getBuildStageDescriptors, resolveAgentConfig } from '@eforge-build/engine/pipeline';
import { DEFAULT_CONFIG, resolveConfig, loadConfig } from '@eforge-build/engine/config';
import type { EforgeConfig } from '@eforge-build/engine/config';
import { singletonRegistry, buildAgentRuntimeRegistry, type AgentRuntimeRegistry } from '@eforge-build/engine/agent-runtime-registry';


describe('runParallelReview decision events', () => {
  // Use a per-test tmpdir (auto-cleaned) instead of `/tmp`. The tests below rely
  // on `computeReviewThresholdSnapshot()` finding no git repo so changedFiles
  // defaults to []. A unique tmpdir guarantees isolation from any system state
  // that might happen to live under /tmp.
  const makeTempDir = useTempDir('eforge-decision-test-');

  it('emits perspectives-inferred when strategy is parallel and no perspectives override', async () => {
    // Use strategy: 'parallel' (forced) to bypass threshold check without needing a real git repo.
    // Without a perspectives override, the reviewer must infer perspectives from changed files.
    // With a non-git tmpdir, changedFiles defaults to [] → categories all empty → no perspectives inferred.
    // The perspectives-inferred decision is still emitted (documenting that inference ran with empty result).
    const backend = new StubHarness([{ text: '<review-issues></review-issues>' }]);
    const cwd = makeTempDir();

    const events = await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\nDo the thing.',
        baseBranch: 'main',
        planId: 'plan-decision-test',
        cwd,
        strategy: 'parallel',
        // no perspectives override — inference runs
      }),
    );

    // perspectives-inferred must be emitted (even with empty result when no files detected)
    const perspectivesInferred = events.find(
      (e): e is Extract<EforgeEvent, { type: 'plan:build:decision' }> =>
        e.type === 'plan:build:decision' && (e as Extract<EforgeEvent, { type: 'plan:build:decision' }>).decision.kind === 'perspectives-inferred',
    );
    expect(perspectivesInferred).toBeDefined();
    expect(perspectivesInferred!.decision.kind).toBe('perspectives-inferred');

    // planId must be attributed to the correct plan
    expect(perspectivesInferred!.planId).toBe('plan-decision-test');
  });

  it('does NOT emit perspectives-inferred when perspectives override is supplied', async () => {
    const backend = new StubHarness([{ text: '<review-issues></review-issues>' }]);
    const cwd = makeTempDir();

    const events = await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\nDo the thing.',
        baseBranch: 'main',
        planId: 'plan-explicit-perspectives',
        cwd,
        strategy: 'parallel',
        perspectives: ['code', 'security'], // explicit override — no inference
      }),
    );

    const perspectivesInferred = events.find(
      (e) => e.type === 'plan:build:decision' && (e as Extract<EforgeEvent, { type: 'plan:build:decision' }>).decision.kind === 'perspectives-inferred',
    );
    expect(perspectivesInferred).toBeUndefined();
  });

  it('perspectives-inferred shape is BuildDecisionSchema-valid (empty-categories edge case)', async () => {
    // With strategy: 'parallel' (forced) and a non-git tmpdir, changedFiles defaults to [].
    // categorizeFiles([]) returns all empty buckets → determineApplicableReviewsWithRules
    // returns { perspectives: [], rules: [] }. The decision is still emitted with empty
    // arrays. We assert empty arrays here — `Array.isArray` alone would pass vacuously.
    const backend = new StubHarness([{ text: '<review-issues></review-issues>' }]);
    const cwd = makeTempDir();

    const events = await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan',
        baseBranch: 'main',
        planId: 'plan-schema-check',
        cwd,
        strategy: 'parallel',
        // no perspectives override
      }),
    );

    const perspectivesInferred = events.find(
      (e): e is Extract<EforgeEvent, { type: 'plan:build:decision' }> =>
        e.type === 'plan:build:decision' && (e as Extract<EforgeEvent, { type: 'plan:build:decision' }>).decision.kind === 'perspectives-inferred',
    );

    expect(perspectivesInferred).toBeDefined();
    expect(perspectivesInferred!.decision.kind).toBe('perspectives-inferred');
    // With no files detected, categories and perspectives are empty arrays.
    // rules always contains at least the budget rule from selectInitialReviewPerspectives.
    const d = perspectivesInferred!.decision as unknown as { kind: string; perspectives: unknown[]; categories: unknown[]; rules: string[] };
    expect(d.categories).toEqual([]);
    expect(d.rules).toContain('normal-risk change — budget 2');
    expect(d.perspectives).toEqual([]);
  });
});

// --- Parallel Reviewer: verify perspective ---

describe('runParallelReview verify perspective', () => {
  it('accepts verify as an override perspective and dispatches to reviewer-verify prompt', async () => {
    const backend = new StubHarness([{ text: '<review-issues></review-issues>' }]);

    const events = await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\n## Verification\n\n- [ ] `pnpm build`',
        baseBranch: 'main',
        planId: 'plan-verify-wiring',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['verify'],
      }),
    );

    // The stub should have been invoked once (one perspective = one agent call)
    expect(backend.prompts).toHaveLength(1);

    // The prompt should be the reviewer-verify prompt (contains its unique marker text)
    expect(backend.prompts[0]).toContain('verification specialist');

    // Review lifecycle events should be emitted
    expect(findEvent(events, 'plan:build:review:start')).toBeDefined();
    expect(findEvent(events, 'plan:build:review:parallel:start')).toBeDefined();
    expect(findEvent(events, 'plan:build:review:complete')).toBeDefined();

    // The parallel:start event should include the verify perspective
    const parallelStart = findEvent(events, 'plan:build:review:parallel:start');
    expect(parallelStart).toBeDefined();
    expect(parallelStart!.perspectives).toContain('verify');
  });

  it('verify perspective prompt includes review_issue_schema variable with verification-failure category', async () => {
    const backend = new StubHarness([{ text: '<review-issues></review-issues>' }]);

    await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\n## Verification\n\n- [ ] `pnpm type-check`',
        baseBranch: 'main',
        planId: 'plan-schema-wiring',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['verify'],
      }),
    );

    expect(backend.prompts).toHaveLength(1);
    // The schema YAML ({{review_issue_schema}}) should be substituted in the prompt
    // and contain 'verification-failure' as the only allowed category
    expect(backend.prompts[0]).toContain('verification-failure');
  });

  it('verify perspective is registered alongside the five diff-based perspectives', () => {
    // Run with all 6 perspectives and verify the stub gets called 6 times
    // This confirms all 6 entries exist in PERSPECTIVE_PROMPTS and PERSPECTIVE_SCHEMA_YAML
    const backend = new StubHarness([
      { text: '<review-issues></review-issues>' }, // code
      { text: '<review-issues></review-issues>' }, // security
      { text: '<review-issues></review-issues>' }, // api
      { text: '<review-issues></review-issues>' }, // docs
      { text: '<review-issues></review-issues>' }, // test
      { text: '<review-issues></review-issues>' }, // verify
    ]);

    return collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan\n\n## Verification\n\n- [ ] `pnpm build`',
        baseBranch: 'main',
        planId: 'plan-six-perspectives',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['code', 'security', 'api', 'docs', 'test', 'verify'],
      }),
    ).then(() => {
      // 6 perspectives = 6 agent calls
      expect(backend.prompts).toHaveLength(6);
    });
  });

  it('emits a perspective error rather than a downgrade for late max-turns reviewer errors', async () => {
    const backend = new StubHarness([{
      resultText: '<review-issues><issue severity="warning" category="bug" file="src/late.ts">Late finding</issue></review-issues>',
      lateError: new AgentTerminalError('error_max_turns', 'turn limit after result'),
    }]);

    const events = await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan',
        baseBranch: 'main',
        planId: 'plan-parallel-max-turns-boundary',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['code'],
      }),
    );

    expect(findEvent(events, 'agent:warning')).toBeUndefined();
    expect(filterEvents(events, 'plan:build:review:parallel:perspective:complete')).toHaveLength(0);
    expect(filterEvents(events, 'plan:build:review:parallel:perspective:error')).toHaveLength(1);
  });

  it('forwards perspective to harness.run options for each parallel agent call', async () => {
    // Verifies the data-flow fix: perspective must appear in the AgentRunOptions
    // passed to harness.run so the real harness can stamp it on agent:start.
    const backend = new StubHarness([
      { text: '<review-issues></review-issues>' }, // code
      { text: '<review-issues></review-issues>' }, // security
    ]);

    await collectEvents(
      runParallelReview({
        harness: backend,
        planContent: '# Plan',
        baseBranch: 'main',
        planId: 'plan-perspective-forwarding',
        cwd: '/tmp',
        strategy: 'parallel',
        perspectives: ['code', 'security'],
      }),
    );

    // Each harness.run call must carry the corresponding perspective
    expect(backend.calls).toHaveLength(2);
    const perspectives = backend.calls.map((c) => c.perspective);
    expect(perspectives).toContain('code');
    expect(perspectives).toContain('security');
    // Every parallel call has a perspective set; none are undefined
    for (const p of perspectives) {
      expect(p).toBeDefined();
    }
  });
});

// --- AgentRuntimeRegistry profile override threading (AC12) ---
