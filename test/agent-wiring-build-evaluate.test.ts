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

import { StopErrorHarness } from './agent-wiring-helpers.js';

// --- eforge:region build-evaluate-wiring ---

describe('builderImplement wiring', () => {
  it('emits implement lifecycle events on success', async () => {
    const backend = new StubHarness([{ text: 'Implementation done.' }]);

    const events = await collectEvents(builderImplement(
      { id: 'plan-1', name: 'Feature', dependsOn: [], branch: 'feature/x', body: 'content', filePath: '/tmp/plan.md' },
      { harness: backend, cwd: '/tmp' },
    ));

    expect(findEvent(events, 'plan:build:implement:start')).toBeDefined();
    expect(findEvent(events, 'plan:build:implement:complete')).toBeDefined();
    expect(findEvent(events, 'plan:build:failed')).toBeUndefined();
  });

  it('emits build:failed when backend throws', async () => {
    const backend = new StubHarness([{ error: new Error('Agent timeout') }]);

    const events = await collectEvents(builderImplement(
      { id: 'plan-1', name: 'Feature', dependsOn: [], branch: 'feature/x', body: 'content', filePath: '/tmp/plan.md' },
      { harness: backend, cwd: '/tmp' },
    ));

    const failed = findEvent(events, 'plan:build:failed');
    expect(failed).toBeDefined();
    expect(failed!.error).toContain('Agent timeout');
    // Should NOT emit implement:complete on failure
    expect(findEvent(events, 'plan:build:implement:complete')).toBeUndefined();
  });

  it('emits plan:build:failed when harness yields agent:stop with error and no agent:result', async () => {
    const harness = new StopErrorHarness('Pi configuration error: provider unavailable');

    const events = await collectEvents(builderImplement(
      { id: 'plan-1', name: 'Feature', dependsOn: [], branch: 'feature/x', body: 'content', filePath: '/tmp/plan.md' },
      { harness, cwd: '/tmp' },
    ));

    const failures = filterEvents(events, 'plan:build:failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].error).toContain('Pi configuration error: provider unavailable');
    expect(findEvent(events, 'plan:build:implement:complete')).toBeUndefined();

    const stopEvents = filterEvents(events, 'agent:stop');
    expect(stopEvents).toHaveLength(1);
    expect(stopEvents[0].error).toBe('Pi configuration error: provider unavailable');
    expect(events.indexOf(stopEvents[0])).toBeLessThan(events.indexOf(failures[0]));
  });

  it('classifies transient transport stop errors on plan:build:failed', async () => {
    const harness = new StopErrorHarness('Backend error: WebSocket closed 1000');

    const events = await collectEvents(builderImplement(
      { id: 'plan-1', name: 'Feature', dependsOn: [], branch: 'feature/x', body: 'content', filePath: '/tmp/plan.md' },
      { harness, cwd: '/tmp' },
    ));

    const failures = filterEvents(events, 'plan:build:failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].terminalSubtype).toBe('error_transient_transport');
  });

  it('does not fail a completed builder run when agent:stop has an error after agent:result', async () => {
    const harness = new StopErrorHarness('Backend error: WebSocket closed 1000', true);

    const events = await collectEvents(builderImplement(
      { id: 'plan-1', name: 'Feature', dependsOn: [], branch: 'feature/x', body: 'content', filePath: '/tmp/plan.md' },
      { harness, cwd: '/tmp' },
    ));

    expect(filterEvents(events, 'agent:result')).toHaveLength(1);
    expect(filterEvents(events, 'agent:stop')).toHaveLength(1);
    expect(filterEvents(events, 'plan:build:failed')).toHaveLength(0);
    expect(filterEvents(events, 'plan:build:implement:complete')).toHaveLength(1);
  });
});

describe('builderEvaluate wiring', () => {
  async function collectEvaluation(gen: AsyncGenerator<EforgeEvent, BuilderEvaluationResult>): Promise<{ events: EforgeEvent[]; result: BuilderEvaluationResult | undefined }> {
    const events: EforgeEvent[] = [];
    while (true) {
      const next = await gen.next();
      if (next.done) return { events, result: next.value };
      events.push(next.value);
    }
  }

  function makeEvaluationSnapshot(): EvaluationSnapshot {
    return {
      cwd: '/tmp',
      capturedAt: '2026-01-01T00:00:00.000Z',
      baseHead: 'base',
      stagedPatch: '',
      candidatePatch: 'diff --git a/a.ts b/a.ts\n',
      files: [
        {
          path: 'a.ts',
          status: 'modified',
          statusCode: 'M',
          diff: 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n',
          diffHeader: 'diff --git a/a.ts b/a.ts\n',
          hunks: [{ index: 1, header: '@@ -1 +1 @@', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, diff: '@@ -1 +1 @@\n-old\n+new\n' }],
          isBinary: false,
          isUntracked: false,
          isRenameOnly: false,
          requiresFileVerdict: false,
        },
      ],
    };
  }

  it('preserves XML fallback verdicts with hunk metadata after a late transport error', async () => {
    const backend = new StubHarness([{
      text: `<evaluation>
  <verdict file="a.ts" hunk="1" action="accept">Good change</verdict>
  <verdict file="b.ts" action="review">Needs discussion</verdict>
</evaluation>`,
      lateError: new Error('Backend error: WebSocket error'),
    }]);

    const { events, result } = await collectEvaluation(builderEvaluate(
      { id: 'plan-1', name: 'Feature', dependsOn: [], branch: 'feature/x', body: 'content', filePath: '/tmp/plan.md' },
      { harness: backend, cwd: '/tmp' },
    ));

    expect(findEvent(events, 'plan:build:evaluate:start')).toBeDefined();
    expect(findEvent(events, 'plan:build:evaluate:complete')).toBeUndefined();
    expect(result?.source).toBe('xml');
    expect(result?.failed).toBe(false);
    expect(result?.verdicts).toEqual([
      { file: 'a.ts', hunk: 1, action: 'accept', reason: 'Good change' },
      { file: 'b.ts', action: 'review', reason: 'Needs discussion' },
    ]);
    expect(filterEvents(events, 'agent:warning')).toHaveLength(1);
    expect(filterEvents(events, 'plan:build:failed')).toHaveLength(0);
  });

  it('wires structured evaluation tools, denylist, and late transport verdict preservation', async () => {
    const backend = new StubHarness([{
      toolCalls: [{
        tool: 'submit_evaluation_verdicts',
        toolUseId: 'eval-1',
        input: { verdicts: [{ file: 'a.ts', hunk: 1, action: 'accept', reason: 'Correct' }] },
        output: '',
      }],
      lateError: new Error('Backend error: WebSocket error'),
    }]);

    const { events, result } = await collectEvaluation(builderEvaluate(
      { id: 'plan-1', name: 'Feature', dependsOn: [], branch: 'feature/x', body: 'content', filePath: '/tmp/plan.md' },
      { harness: backend, cwd: '/tmp', evaluatorSnapshot: makeEvaluationSnapshot() },
    ));

    expect(backend.customToolSets[0]?.map(tool => tool.name).sort()).toEqual([
      'get_evaluation_diff',
      'list_evaluation_files',
      'submit_evaluation_verdicts',
    ]);
    // Denylist must include both Claude-cased and Pi-lowercase mutation tool names.
    expect(backend.calls[0].disallowedTools).toEqual(expect.arrayContaining(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'write', 'edit', 'bash']));
    expect(result?.source).toBe('structured');
    expect(result?.failed).toBe(false);
    expect(result?.verdicts).toEqual([{ file: 'a.ts', hunk: 1, action: 'accept', reason: 'Correct' }]);
    expect(filterEvents(events, 'agent:warning')).toHaveLength(1);
    expect(filterEvents(events, 'plan:build:failed')).toHaveLength(0);
  });

  it('prefers structured verdict submissions over XML fallback text after a late transport error', async () => {
    const backend = new StubHarness([{
      toolCalls: [{
        tool: 'submit_evaluation_verdicts',
        toolUseId: 'eval-1',
        input: { verdicts: [{ file: 'a.ts', hunk: 1, action: 'accept', reason: 'Structured verdict' }] },
        output: '',
      }],
      text: `<evaluation>
  <verdict file="a.ts" hunk="1" action="reject">XML fallback should be ignored</verdict>
</evaluation>`,
      lateError: new Error('Backend error: WebSocket error'),
    }]);

    const { result } = await collectEvaluation(builderEvaluate(
      { id: 'plan-1', name: 'Feature', dependsOn: [], branch: 'feature/x', body: 'content', filePath: '/tmp/plan.md' },
      { harness: backend, cwd: '/tmp', evaluatorSnapshot: makeEvaluationSnapshot() },
    ));

    expect(result?.source).toBe('structured');
    expect(result?.verdicts).toEqual([
      { file: 'a.ts', hunk: 1, action: 'accept', reason: 'Structured verdict' },
    ]);
  });

  // builderEvaluate catches errors and yields build:failed (no re-throw) —
  // the builder owns the plan lifecycle so it handles errors gracefully.
  // Contrast with runPlanEvaluate which re-throws after yielding zero counts,
  // because plan evaluation errors propagate to the engine's plan() method.
  it('emits build:failed for no-verdict retryable transport failures', async () => {
    const backend = new StubHarness([{ lateError: new Error('Backend error: WebSocket error') }]);

    const { events, result } = await collectEvaluation(builderEvaluate(
      { id: 'plan-1', name: 'Feature', dependsOn: [], branch: 'feature/x', body: 'content', filePath: '/tmp/plan.md' },
      { harness: backend, cwd: '/tmp' },
    ));

    const failed = findEvent(events, 'plan:build:failed');
    expect(failed?.terminalSubtype).toBe('error_transient_transport');
    expect(result).toMatchObject({ failed: true, source: 'none', verdicts: [] });
    expect(findEvent(events, 'plan:build:evaluate:complete')).toBeUndefined();
  });
});

// --- Plan Reviewer ---


describe('runPlanEvaluate wiring', () => {
  function makePlanEvaluationSnapshot(): EvaluationSnapshot {
    return {
      cwd: '/tmp',
      capturedAt: '2026-01-01T00:00:00.000Z',
      baseHead: 'base',
      stagedPatch: '',
      candidatePatch: 'diff --git a/eforge/plans/my-plan/a.md b/eforge/plans/my-plan/a.md\n',
      files: [
        {
          path: 'eforge/plans/my-plan/a.md',
          status: 'modified',
          statusCode: 'M',
          diff: 'diff --git a/eforge/plans/my-plan/a.md b/eforge/plans/my-plan/a.md\n@@ -1 +1 @@\n-old\n+new\n',
          diffHeader: 'diff --git a/eforge/plans/my-plan/a.md b/eforge/plans/my-plan/a.md\n',
          hunks: [{ index: 1, header: '@@ -1 +1 @@', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, diff: '@@ -1 +1 @@\n-old\n+new\n' }],
          isBinary: false,
          isUntracked: false,
          isRenameOnly: false,
          requiresFileVerdict: false,
        },
      ],
    };
  }

  it('counts evaluation verdicts and preserves hunk metadata in summaries', async () => {
    const backend = new StubHarness([{
      text: `<evaluation>
  <verdict file="plans/a.md" hunk="1" action="accept">Good fix</verdict>
  <verdict file="plans/b.md" action="reject">Over-scoped</verdict>
</evaluation>`,
    }]);

    const events = await collectEvents(runPlanEvaluate({
      harness: backend,
      planSetName: 'my-plan',
      sourceContent: 'PRD content',
      cwd: '/tmp',
    }));

    expect(findEvent(events, 'planning:evaluate:start')).toBeDefined();
    const complete = findEvent(events, 'planning:evaluate:complete');
    expect(complete).toBeDefined();
    expect(complete!.accepted).toBe(1);
    expect(complete!.rejected).toBe(1);
    expect(complete!.verdicts).toEqual([
      { file: 'plans/a.md', hunk: 1, action: 'accept', reason: 'Good fix' },
      { file: 'plans/b.md', action: 'reject', reason: 'Over-scoped' },
    ]);
  });

  it('wires structured evaluation tools and mutation-tool denylist', async () => {
    const backend = new StubHarness([{
      toolCalls: [{
        tool: 'submit_evaluation_verdicts',
        toolUseId: 'eval-1',
        input: { verdicts: [{ file: 'eforge/plans/my-plan/a.md', hunk: 1, action: 'accept', reason: 'Correct' }] },
        output: '',
      }],
    }]);

    const events = await collectEvents(runPlanEvaluate({
      harness: backend,
      planSetName: 'my-plan',
      sourceContent: 'PRD content',
      cwd: '/tmp',
      evaluationSnapshot: makePlanEvaluationSnapshot(),
      allowedPathPrefix: 'eforge/plans/my-plan',
    }));

    expect(backend.customToolSets[0]?.map(tool => tool.name).sort()).toEqual([
      'get_evaluation_diff',
      'list_evaluation_files',
      'submit_evaluation_verdicts',
    ]);
    // Denylist must include both Claude-cased and Pi-lowercase mutation tool names.
    expect(backend.calls[0].disallowedTools).toEqual(expect.arrayContaining(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'write', 'edit', 'bash']));
    expect(events.find(e => e.type === 'planning:error')).toBeDefined();
  });

  // runPlanEvaluate re-throws after yielding a zero-count complete event —
  // the engine's plan() method catches this and reports it as non-fatal.
  // Contrast with builderEvaluate which swallows errors into build:failed.
  it('emits zero counts and re-throws on error', async () => {
    const backend = new StubHarness([{ error: new Error('Evaluate crash') }]);

    let thrown: Error | undefined;
    const events: EforgeEvent[] = [];
    try {
      for await (const event of runPlanEvaluate({
        harness: backend,
        planSetName: 'my-plan',
        sourceContent: 'PRD content',
        cwd: '/tmp',
      })) {
        events.push(event);
      }
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toBe('Evaluate crash');

    const complete = findEvent(events, 'planning:evaluate:complete');
    expect(complete).toBeDefined();
    expect(complete!.accepted).toBe(0);
    expect(complete!.rejected).toBe(0);
  });
});

// --- Module Planner ---

describe('runModulePlanner wiring', () => {
  it('emits expedition module lifecycle events', async () => {
    const backend = new StubHarness([{ text: 'Module plan written.' }]);

    const events = await collectEvents(runModulePlanner({
      harness: backend,
      cwd: '/tmp',
      planSetName: 'my-expedition',
      moduleId: 'auth',
      moduleDescription: 'Authentication system',
      moduleDependsOn: ['foundation'],
      architectureContent: '# Architecture\nModular design.',
      sourceContent: 'PRD content',
    }));

    const start = findEvent(events, 'expedition:module:start');
    expect(start).toBeDefined();
    expect(start!.moduleId).toBe('auth');

    const complete = findEvent(events, 'expedition:module:complete');
    expect(complete).toBeDefined();
    expect(complete!.moduleId).toBe('auth');

    // agent:result always yielded
    expect(findEvent(events, 'agent:result')).toBeDefined();
  });

  it('suppresses agent:message when verbose is false', async () => {
    const backend = new StubHarness([{ text: 'Module details.' }]);

    const events = await collectEvents(runModulePlanner({
      harness: backend,
      cwd: '/tmp',
      planSetName: 'my-expedition',
      moduleId: 'auth',
      moduleDescription: 'Auth',
      moduleDependsOn: [],
      architectureContent: '',
      sourceContent: 'PRD',
    }));

    // agent:message suppressed when verbose is false (default)
    expect(filterEvents(events, 'agent:message')).toHaveLength(0);
  });

  it('emits agent:message when verbose is true', async () => {
    const backend = new StubHarness([{ text: 'Module details.' }]);

    const events = await collectEvents(runModulePlanner({
      harness: backend,
      cwd: '/tmp',
      planSetName: 'my-expedition',
      moduleId: 'auth',
      moduleDescription: 'Auth',
      moduleDependsOn: [],
      architectureContent: '',
      sourceContent: 'PRD',
      verbose: true,
    }));

    expect(filterEvents(events, 'agent:message').length).toBeGreaterThan(0);
  });

  it('includes dependencyPlanContent in prompt when provided', async () => {
    const backend = new StubHarness([{ text: 'Module plan written.' }]);
    const depContent = '# Foundation\n\nCreates auth tables and user model.';

    await collectEvents(runModulePlanner({
      harness: backend,
      cwd: '/tmp',
      planSetName: 'my-expedition',
      moduleId: 'auth',
      moduleDescription: 'Auth',
      moduleDependsOn: ['foundation'],
      architectureContent: '',
      sourceContent: 'PRD',
      dependencyPlanContent: depContent,
    }));

    expect(backend.prompts[0]).toContain(depContent);
  });

  it('uses fallback text when dependencyPlanContent is omitted', async () => {
    const backend = new StubHarness([{ text: 'Module plan written.' }]);

    await collectEvents(runModulePlanner({
      harness: backend,
      cwd: '/tmp',
      planSetName: 'my-expedition',
      moduleId: 'foundation',
      moduleDescription: 'Foundation',
      moduleDependsOn: [],
      architectureContent: '',
      sourceContent: 'PRD',
    }));

    expect(backend.prompts[0]).toContain('No dependencies');
  });

  it('uses fallback text when dependencyPlanContent is undefined', async () => {
    const backend = new StubHarness([{ text: 'Module plan written.' }]);

    await collectEvents(runModulePlanner({
      harness: backend,
      cwd: '/tmp',
      planSetName: 'my-expedition',
      moduleId: 'foundation',
      moduleDescription: 'Foundation',
      moduleDependsOn: [],
      architectureContent: '',
      sourceContent: 'PRD',
      dependencyPlanContent: undefined,
    }));

    expect(backend.prompts[0]).toContain('No dependencies');
  });
});

// --- Architecture Reviewer ---

describe('runArchitectureReview wiring', () => {
  it('emits architecture review lifecycle events with parsed issues', async () => {
    const backend = new StubHarness([{
      text: `<review-issues>
  <issue severity="warning" category="completeness" file="plans/my-plan/architecture.md">Missing integration contract between auth and api modules</issue>
</review-issues>`,
    }]);

    const events = await collectEvents(runArchitectureReview({
      harness: backend,
      sourceContent: 'PRD content',
      planSetName: 'my-plan',
      architectureContent: '# Architecture\nModules: auth, api',
      cwd: '/tmp',
    }));

    expect(findEvent(events, 'planning:architecture:review:start')).toBeDefined();
    const complete = findEvent(events, 'planning:architecture:review:complete');
    expect(complete).toBeDefined();
    expect(complete!.issues).toHaveLength(1);
    expect(complete!.issues[0].category).toBe('completeness');
    expect(complete!.issues[0].severity).toBe('warning');
  });

  it('yields empty issues for clean architecture', async () => {
    const backend = new StubHarness([{
      text: 'Architecture looks solid. <review-issues></review-issues>',
    }]);

    const events = await collectEvents(runArchitectureReview({
      harness: backend,
      sourceContent: 'PRD content',
      planSetName: 'my-plan',
      architectureContent: '# Architecture\nWell defined.',
      cwd: '/tmp',
    }));

    const complete = findEvent(events, 'planning:architecture:review:complete');
    expect(complete).toBeDefined();
    expect(complete!.issues).toHaveLength(0);
  });
});

// --- Architecture Evaluator ---

describe('runArchitectureEvaluate wiring', () => {
  it('counts evaluation verdicts correctly', async () => {
    const backend = new StubHarness([{
      text: `<evaluation>
  <verdict file="plans/my-plan/architecture.md" action="accept">Good clarification</verdict>
  <verdict file="plans/my-plan/architecture.md" action="reject">Changes module decomposition</verdict>
  <verdict file="plans/my-plan/architecture.md" action="accept">Missing contract added</verdict>
</evaluation>`,
    }]);

    const events = await collectEvents(runArchitectureEvaluate({
      harness: backend,
      planSetName: 'my-plan',
      sourceContent: 'PRD content',
      cwd: '/tmp',
    }));

    expect(findEvent(events, 'planning:architecture:evaluate:start')).toBeDefined();
    const complete = findEvent(events, 'planning:architecture:evaluate:complete');
    expect(complete).toBeDefined();
    expect(complete!.accepted).toBe(2);
    expect(complete!.rejected).toBe(1);
    expect(complete!.verdicts).toEqual([
      { file: 'plans/my-plan/architecture.md', action: 'accept', reason: 'Good clarification' },
      { file: 'plans/my-plan/architecture.md', action: 'reject', reason: 'Changes module decomposition' },
      { file: 'plans/my-plan/architecture.md', action: 'accept', reason: 'Missing contract added' },
    ]);
  });

  it('emits zero counts and re-throws on error (architecture)', async () => {
    const backend = new StubHarness([{ error: new Error('Architecture evaluate crash') }]);

    let thrown: Error | undefined;
    const events: EforgeEvent[] = [];
    try {
      for await (const event of runArchitectureEvaluate({
        harness: backend,
        planSetName: 'my-plan',
        sourceContent: 'PRD content',
        cwd: '/tmp',
      })) {
        events.push(event);
      }
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toBe('Architecture evaluate crash');

    const complete = findEvent(events, 'planning:architecture:evaluate:complete');
    expect(complete).toBeDefined();
    expect(complete!.accepted).toBe(0);
    expect(complete!.rejected).toBe(0);
  });
});

// --- PRD Validator ---

describe('runPrdValidator wiring', () => {
  it('emits prd_validation:start and prd_validation:complete with no gaps when agent finds none', async () => {
    const backend = new StubHarness([{
      text: '```json\n{ "gaps": [], "acceptanceVerdicts": [{"criterion": "Add a login page", "verdict": "pass", "evidence": "Login page component found at src/login.ts"}] }\n```',
    }]);

    const events = await collectEvents(runPrdValidator({
      harness: backend,
      cwd: '/tmp',
      prdContent: '# PRD\n\nAdd a login page.',
      diff: 'diff --git a/src/login.ts b/src/login.ts\n+export function LoginPage() {}',
    }));

    expect(findEvent(events, 'prd_validation:start')).toBeDefined();
    const complete = findEvent(events, 'prd_validation:complete');
    expect(complete).toBeDefined();
    expect(complete!.passed).toBe(true);
    expect(complete!.gaps).toEqual([]);
    const acceptance = findEvent(events, 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    expect(acceptance!.passed).toBe(true);
    expect(acceptance!.source).toBe('prd');
  });

  it('emits prd_validation:complete with gaps when agent finds issues', async () => {
    const backend = new StubHarness([{
      text: `\`\`\`json
{
  "gaps": [
    {
      "requirement": "Login page should support OAuth",
      "explanation": "No OAuth integration found in the diff"
    },
    {
      "requirement": "Error messages should be user-friendly",
      "explanation": "Error handling uses raw error messages without user-friendly formatting"
    }
  ],
  "acceptanceVerdicts": [
    {"criterion": "Supports OAuth login", "verdict": "fail", "evidence": "No OAuth integration found in diff"},
    {"criterion": "User-friendly error messages", "verdict": "unknown", "evidence": "Cannot verify error message formatting from diff alone"}
  ]
}
\`\`\``,
    }]);

    const events = await collectEvents(runPrdValidator({
      harness: backend,
      cwd: '/tmp',
      prdContent: '# PRD\n\nAdd a login page with OAuth and friendly errors.',
      diff: 'diff --git a/src/login.ts b/src/login.ts\n+export function LoginPage() {}',
    }));

    const complete = findEvent(events, 'prd_validation:complete');
    expect(complete).toBeDefined();
    expect(complete!.passed).toBe(false);
    expect(complete!.gaps).toHaveLength(2);
    expect(complete!.gaps[0].requirement).toBe('Login page should support OAuth');
    expect(complete!.gaps[1].explanation).toContain('Error handling');
    const acceptance = findEvent(events, 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    expect(acceptance!.passed).toBe(false);
    expect(acceptance!.verdicts).toHaveLength(2);
    expect(acceptance!.source).toBe('prd');
  });

  it('re-throws non-abort agent errors (fail-closed)', async () => {
    const backend = new StubHarness([{ error: new Error('Agent crashed') }]);

    // Fail-closed: a crashed validator must not silently certify a build.
    await expect(async () => {
      for await (const _event of runPrdValidator({
        harness: backend,
        cwd: '/tmp',
        prdContent: 'PRD content',
        diff: 'some diff',
      })) {
        // drain
      }
    }).rejects.toThrow('Agent crashed');
  });

  it('yields agent:result event (always yielded)', async () => {
    const backend = new StubHarness([{
      text: '```json\n{ "gaps": [], "acceptanceVerdicts": [{"criterion": "PRD satisfied", "verdict": "pass", "evidence": "All requirements met per diff"}] }\n```',
    }]);

    const events = await collectEvents(runPrdValidator({
      harness: backend,
      cwd: '/tmp',
      prdContent: 'PRD',
      diff: 'diff',
    }));

    expect(findEvent(events, 'agent:result')).toBeDefined();
  });

  it('passes expectedAcceptanceCriteria and emits per-criterion verdicts from agent response', async () => {
    const expectedCriteria: ExpectedAcceptanceCriterion[] = [
      { id: 'ac-001', text: 'Must support login', raw: '- Must support login' },
      { id: 'ac-002', text: 'Must support OAuth', raw: '- Must support OAuth' },
    ];
    // Stub returns a verdict for each expected criterion
    const backend = new StubHarness([{
      text: `\`\`\`json
{
  "gaps": [],
  "acceptanceVerdicts": [
    {"criterion": "Must support login", "verdict": "pass", "evidence": "Login component found at src/login.ts"},
    {"criterion": "Must support OAuth", "verdict": "pass", "evidence": "OAuth flow found at src/oauth.ts"}
  ]
}
\`\`\``,
    }]);

    const events = await collectEvents(runPrdValidator({
      harness: backend,
      cwd: '/tmp',
      prdContent: '# PRD\n\nAdd a login page with OAuth.',
      diff: 'diff --git a/src/login.ts b/src/login.ts\n+export function LoginPage() {}',
      expectedAcceptanceCriteria: expectedCriteria,
    }));

    expect(backend.prompts[0]).toContain('ac-001');
    expect(backend.prompts[0]).toContain('Must support login');
    expect(backend.prompts[0]).toContain('ac-002');
    expect(backend.prompts[0]).toContain('Must support OAuth');

    const complete = findEvent(events, 'prd_validation:complete');
    expect(complete).toBeDefined();
    expect(complete!.passed).toBe(true);

    const acceptance = findEvent(events, 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    expect(acceptance!.verdicts).toHaveLength(2);
    expect(acceptance!.verdicts[0]).toMatchObject({ criterion: 'Must support login', verdict: 'pass' });
    expect(acceptance!.verdicts[1]).toMatchObject({ criterion: 'Must support OAuth', verdict: 'pass' });
    expect(acceptance!.passed).toBe(true);
  });

  it('emits unknown synthetic verdict when agent omits acceptanceVerdicts and expectedAcceptanceCriteria are present', async () => {
    const expectedCriteria: ExpectedAcceptanceCriterion[] = [
      { id: 'ac-001', text: 'Must support login', raw: '- Must support login' },
    ];
    // Stub returns no acceptanceVerdicts field — fail-closed
    const backend = new StubHarness([{
      text: '```json\n{"gaps": []}\n```',
    }]);

    const events = await collectEvents(runPrdValidator({
      harness: backend,
      cwd: '/tmp',
      prdContent: '# PRD\n\nAdd login.',
      diff: 'diff',
      expectedAcceptanceCriteria: expectedCriteria,
    }));

    const acceptance = findEvent(events, 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    // When no acceptanceVerdicts, runPrdValidator synthesizes a single unknown verdict (fail-closed)
    expect(acceptance!.passed).toBe(false);
    expect(acceptance!.verdicts[0]).toMatchObject({ verdict: 'unknown' });
  });
});

// --- eforge:endregion build-evaluate-wiring ---

// --- Stage Descriptor Metadata ---
