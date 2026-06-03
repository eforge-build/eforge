/**
 * Focused tests for validation provider recovery-stage behavior.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { EforgeEvent, ReviewIssue } from '../packages/engine/src/events.js';
import type { BuildStageContext } from '../packages/engine/src/pipeline/types.js';
import type { ValidationProviderRegistration } from '../packages/engine/src/extensions/types.js';
import {
  runValidationProviderRecoveryStage,
  validationFailureSignatures,
  validationFailureToReviewIssues,
  type ValidationRecoveryRepairContext,
} from '../packages/engine/src/pipeline/stages/validation-provider-recovery.js';
import type { NormalizedValidationResult } from '../packages/engine/src/extensions/validation-provider-runtime.js';

function makeProvider(spec: {
  name?: string;
  validate?: (...args: unknown[]) => unknown;
  commands?: string[];
}): ValidationProviderRegistration {
  return {
    kind: 'validationProvider',
    extensionName: 'test-ext',
    extensionPath: '/ext/path',
    name: spec.name ?? 'test-validator',
    value: {
      name: spec.name ?? 'test-validator',
      description: 'Test validator',
      ...(spec.validate ? { validate: spec.validate as never } : {}),
      ...(spec.commands ? { commands: spec.commands } : {}),
    },
  };
}

function makeCtx(providers: ValidationProviderRegistration[], maxRounds = 1): BuildStageContext {
  return {
    planId: 'plan-test-01',
    worktreePath: tmpdir(),
    config: { extensions: { validationProviderTimeoutMs: 1000 } },
    extensionValidationProviders: providers,
    reviewIssues: [],
    review: {
      strategy: 'single',
      perspectives: [],
      maxRounds,
      evaluatorStrictness: 'standard',
    },
  } as unknown as BuildStageContext;
}

function makeCallbacks(log: string[] = []) {
  return {
    runReviewFix: async function* (): AsyncGenerator<EforgeEvent> {
      log.push('review-fix');
      yield { timestamp: new Date().toISOString(), type: 'plan:build:progress', planId: 'plan-test-01', message: 'review-fix' };
    },
    runStructuralValidationFix: async function* (): AsyncGenerator<EforgeEvent> {
      log.push('structural-fix');
      yield { timestamp: new Date().toISOString(), type: 'plan:build:progress', planId: 'plan-test-01', message: 'structural-fix' };
    },
    runEvaluate: async function* (overrides?: { strictness?: 'strict' | 'standard' | 'lenient'; validationRepairContext?: ValidationRecoveryRepairContext }): AsyncGenerator<EforgeEvent> {
      log.push(`evaluate:${overrides?.strictness ?? 'none'}`);
      yield { timestamp: new Date().toISOString(), type: 'plan:build:progress', planId: 'plan-test-01', message: 'evaluate' };
    },
  };
}

async function collect(
  ctx: BuildStageContext,
  callbacks = makeCallbacks(),
  getChangedFiles?: () => Promise<string[] | undefined>,
): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of runValidationProviderRecoveryStage(ctx, callbacks, getChangedFiles)) {
    events.push(event);
  }
  return events;
}

function terminalFailedIndex(events: EforgeEvent[]): number {
  return events.findIndex((event) => event.type === 'plan:build:failed');
}

describe('runValidationProviderRecoveryStage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns without events when no providers are registered', async () => {
    const ctx = makeCtx([]);
    await expect(collect(ctx)).resolves.toEqual([]);
  });

  it('non-empty string failure is a hard unexpected-return failure', async () => {
    const log: string[] = [];
    const ctx = makeCtx([makeProvider({ validate: () => 'lint error' })]);
    const events = await collect(ctx, makeCallbacks(log));

    expect(log).toEqual([]);
    expect(events.some((event) => event.type === 'plan:build:failed')).toBe(true);
    expect(ctx.buildFailed).toBe(true);
  });

  it('structured failed result invokes review-fix and evaluate before terminal failure', async () => {
    const log: string[] = [];
    const ctx = makeCtx([makeProvider({ validate: () => ({ status: 'failed' as const, message: 'type errors' }) })]);
    const events = await collect(ctx, makeCallbacks(log));

    expect(log).toEqual(['review-fix', 'evaluate:standard']);
    expect(terminalFailedIndex(events)).toBeGreaterThan(events.findIndex((event) => event.type === 'plan:build:progress' && event.message === 'evaluate'));
  });

  it('command-form failure invokes review-fix and evaluate before terminal failure', async () => {
    const log: string[] = [];
    const ctx = makeCtx([makeProvider({ commands: ['node -e process.exit(2)'] })]);
    const events = await collect(ctx, makeCallbacks(log));

    expect(log).toEqual(['review-fix', 'evaluate:standard']);
    expect(terminalFailedIndex(events)).toBeGreaterThan(events.findIndex((event) => event.type === 'plan:build:progress' && event.message === 'evaluate'));
  });

  it('sets reviewIssues and emits recovery progress before running callbacks', async () => {
    let calls = 0;
    const ctx = makeCtx([makeProvider({ name: 'lint/provider', validate: () => calls++ === 0 ? { status: 'failed' as const, message: 'lint error' } : null })]);
    ctx.review.evaluatorStrictness = 'strict';
    const callbacks = {
      runReviewFix: async function* (): AsyncGenerator<EforgeEvent> {
        expect(ctx.reviewIssues).toHaveLength(1);
        expect(ctx.reviewIssues[0]).toMatchObject({
          severity: 'critical',
          category: 'validation-provider',
          file: '.eforge/validation-providers/lint-provider.txt',
          description: expect.stringContaining('lint error'),
        });
        yield { timestamp: new Date().toISOString(), type: 'plan:build:progress', planId: 'plan-test-01', message: 'review-fix-marker' };
      },
      runEvaluate: async function* (overrides?: { strictness?: 'strict' | 'standard' | 'lenient' }): AsyncGenerator<EforgeEvent> {
        expect(overrides?.strictness).toBe('strict');
        yield { timestamp: new Date().toISOString(), type: 'plan:build:progress', planId: 'plan-test-01', message: 'evaluate-marker' };
      },
    };

    const events = await collect(ctx, callbacks);

    const recoveryAttemptIndex = events.findIndex((event) => event.type === 'plan:build:progress' && event.message.includes('running recovery attempt 1 of 1'));
    const reviewFixMarkerIndex = events.findIndex((event) => event.type === 'plan:build:progress' && event.message === 'review-fix-marker');
    const evaluateMarkerIndex = events.findIndex((event) => event.type === 'plan:build:progress' && event.message === 'evaluate-marker');
    expect(recoveryAttemptIndex).toBeGreaterThanOrEqual(0);
    expect(reviewFixMarkerIndex).toBeGreaterThan(recoveryAttemptIndex);
    expect(evaluateMarkerIndex).toBeGreaterThan(recoveryAttemptIndex);
    expect(ctx.buildFailed).toBeUndefined();
  });

  it('restarts from provider A after provider B recovery', async () => {
    const invocations: string[] = [];
    let bCalls = 0;
    const ctx = makeCtx([
      makeProvider({ name: 'A', validate: () => { invocations.push('A'); return null; } }),
      makeProvider({ name: 'B', validate: () => { invocations.push('B'); return bCalls++ === 0 ? { status: 'failed' as const, message: 'B failed' } : null; } }),
    ]);

    await collect(ctx);

    expect(invocations).toEqual(['A', 'B', 'A', 'B']);
    expect(ctx.buildFailed).toBeUndefined();
  });

  it('keeps ctx.buildFailed unset when providers pass after recovery', async () => {
    let calls = 0;
    const ctx = makeCtx([makeProvider({ validate: () => calls++ === 0 ? { status: 'failed' as const, message: 'first failure' } : null })]);

    await collect(ctx);

    expect(ctx.buildFailed).toBeUndefined();
  });

  it('runs exactly two recovery rounds when maxRounds is 2 and providers then pass', async () => {
    const log: string[] = [];
    let calls = 0;
    const ctx = makeCtx([makeProvider({ validate: () => calls++ < 2 ? { status: 'failed' as const, message: 'temporary failure' } : null })], 2);

    await collect(ctx, makeCallbacks(log));

    expect(log).toEqual(['review-fix', 'evaluate:standard', 'structural-fix', 'evaluate:standard']);
    expect(calls).toBe(3);
    expect(ctx.buildFailed).toBeUndefined();
  });

  it('routes narrow validation guidance to review-fix and evaluator context', async () => {
    const log: string[] = [];
    let calls = 0;
    const ctx = makeCtx([makeProvider({
      name: 'narrow-provider',
      validate: () => calls++ === 0
        ? {
            status: 'failed' as const,
            message: 'narrow failure',
            annotations: [{ severity: 'error' as const, message: 'broken narrow', file: 'src/a.ts', fix: 'Edit src/a.ts only', retryGuidance: 'Retry in src/a.ts', repairClass: 'narrow' as const }],
          }
        : null,
    })]);

    await collect(ctx, {
      runReviewFix: async function* (context): AsyncGenerator<EforgeEvent> {
        log.push(`review:${context.repairStrategy}:${context.repairClass}`);
        expect(context.promptContext).toContain('Provider: narrow-provider');
        expect(context.promptContext).toContain('Fix guidance: Edit src/a.ts only');
      },
      runStructuralValidationFix: async function* (): AsyncGenerator<EforgeEvent> {
        throw new Error('structural should not run');
      },
      runEvaluate: async function* (overrides): AsyncGenerator<EforgeEvent> {
        log.push(`evaluate:${overrides?.validationRepairContext?.repairStrategy}`);
      },
    });

    expect(log).toEqual(['review:narrow:narrow', 'evaluate:narrow']);
  });

  it('routes structural validation guidance to the structural validation-fixer callback', async () => {
    const log: string[] = [];
    let calls = 0;
    const ctx = makeCtx([makeProvider({
      name: 'structural-provider',
      validate: () => calls++ === 0
        ? {
            status: 'failed' as const,
            message: 'structural failure',
            annotations: [{ severity: 'error' as const, message: 'needs structure', file: 'src/shape.ts', fix: 'Extract shared shape', retryGuidance: 'Keep the refactor focused', repairClass: 'structural' as const, metadata: { rule: 'shape' } }],
          }
        : null,
    })]);

    await collect(ctx, {
      runReviewFix: async function* (): AsyncGenerator<EforgeEvent> {
        throw new Error('review-fix should not run');
      },
      runStructuralValidationFix: async function* (context): AsyncGenerator<EforgeEvent> {
        log.push(`structural:${context.repairStrategy}:${context.repairClass}`);
        expect(context.promptContext).toContain('Metadata:');
        expect(context.promptContext).toContain('shape');
      },
      runEvaluate: async function* (overrides): AsyncGenerator<EforgeEvent> {
        log.push(`evaluate:${overrides?.validationRepairContext?.repairStrategy}`);
      },
    });

    expect(log).toEqual(['structural:structural:structural', 'evaluate:structural']);
  });

  it('routes manual validation guidance to terminal failure without automated edits', async () => {
    const ctx = makeCtx([makeProvider({
      name: 'manual-provider',
      validate: () => ({
        status: 'failed' as const,
        message: 'manual failure',
        annotations: [{ severity: 'error' as const, message: 'needs a human', repairClass: 'manual' as const }],
      }),
    })]);

    const events = await collect(ctx, {
      runReviewFix: async function* (): AsyncGenerator<EforgeEvent> {
        throw new Error('review-fix should not run');
      },
      runStructuralValidationFix: async function* (): AsyncGenerator<EforgeEvent> {
        throw new Error('structural should not run');
      },
      runEvaluate: async function* (): AsyncGenerator<EforgeEvent> {
        throw new Error('evaluate should not run');
      },
    });

    expect(events.some((event) => event.type === 'plan:build:progress' && event.message.includes('no automated validation recovery'))).toBe(true);
    expect(events.some((event) => event.type === 'plan:build:failed')).toBe(true);
    expect(ctx.buildFailed).toBe(true);
  });

  it('routes mixed manual validation guidance to terminal failure without automated edits', async () => {
    const ctx = makeCtx([makeProvider({
      name: 'mixed-manual-provider',
      validate: () => ({
        status: 'failed' as const,
        message: 'mixed manual failure',
        annotations: [
          { severity: 'error' as const, message: 'needs a human', repairClass: 'manual' as const },
          { severity: 'error' as const, message: 'narrow clue', repairClass: 'narrow' as const },
        ],
      }),
    })]);

    await collect(ctx, {
      runReviewFix: async function* (): AsyncGenerator<EforgeEvent> {
        throw new Error('review-fix should not run');
      },
      runStructuralValidationFix: async function* (): AsyncGenerator<EforgeEvent> {
        throw new Error('structural should not run');
      },
      runEvaluate: async function* (): AsyncGenerator<EforgeEvent> {
        throw new Error('evaluate should not run');
      },
    });

    expect(ctx.buildFailed).toBe(true);
  });

  it('passes a fresh changedFiles snapshot on each validation provider pass', async () => {
    const seen: Array<string[] | undefined> = [];
    let calls = 0;
    const ctx = makeCtx([makeProvider({
      validate: (_dir: unknown, providerCtx?: unknown) => {
        seen.push((providerCtx as { changedFiles?: string[] } | undefined)?.changedFiles);
        return calls++ === 0 ? { status: 'failed' as const, message: 'first failure' } : null;
      },
    })]);
    const snapshots = [['src/initial.ts'], ['src/repaired.ts']];

    await collect(ctx, makeCallbacks(), async () => snapshots.shift());

    expect(seen).toEqual([['src/initial.ts'], ['src/repaired.ts']]);
  });

  it('writes checkpoint artifacts before automated validation repair callbacks', async () => {
    let calls = 0;
    let checkpointMetadata = '';
    const ctx = makeCtx([makeProvider({
      name: 'checkpoint-provider',
      validate: () => calls++ === 0 ? { status: 'failed' as const, message: 'checkpoint failure' } : null,
    })]);

    const events = await collect(ctx, {
      runReviewFix: async function* (context): AsyncGenerator<EforgeEvent> {
        checkpointMetadata = await readFile(context.checkpoint.metadataPath, 'utf8');
        expect(await readFile(context.checkpoint.patchPath, 'utf8')).toContain('validation repair');
      },
      runStructuralValidationFix: async function* (): AsyncGenerator<EforgeEvent> {
        throw new Error('structural should not run');
      },
      runEvaluate: async function* (): AsyncGenerator<EforgeEvent> {},
    });

    expect(events.some((event) => event.type === 'plan:build:progress' && event.message.includes('Validation recovery checkpoint written'))).toBe(true);
    expect(checkpointMetadata).toContain('checkpoint-provider');
  });

  it('includes the latest checkpoint reference when recovery attempts are exhausted', async () => {
    const ctx = makeCtx([makeProvider({ validate: () => ({ status: 'failed' as const, message: 'persistent checkpoint failure' }) })], 1);
    const events = await collect(ctx);
    const failed = events.find((event): event is Extract<EforgeEvent, { type: 'plan:build:failed' }> => event.type === 'plan:build:failed');

    expect(failed?.error).toContain('Latest validation recovery checkpoint:');
  });

  it('restores injected validation-provider issues after successful recovery when unchanged', async () => {
    let calls = 0;
    const originalIssues: ReviewIssue[] = [{ severity: 'warning', category: 'review', file: 'src/existing.ts', description: 'pre-existing' }];
    const ctx = makeCtx([makeProvider({ validate: () => calls++ === 0 ? { status: 'failed' as const, message: 'first failure' } : null })]);
    ctx.reviewIssues = originalIssues;

    await collect(ctx);

    expect(ctx.reviewIssues).toBe(originalIssues);
    expect(ctx.buildFailed).toBeUndefined();
  });

  it('emits plan:build:failed and sets ctx.buildFailed when recoverable failures exhaust the budget', async () => {
    const ctx = makeCtx([makeProvider({ validate: () => ({ status: 'failed' as const, message: 'persistent failure' }) })], 1);
    const events = await collect(ctx);

    expect(events.some((event) => event.type === 'plan:build:progress' && event.message.includes('recovery exhausted'))).toBe(true);
    expect(events.some((event) => event.type === 'plan:build:failed')).toBe(true);
    expect(ctx.buildFailed).toBe(true);
  });

  it('function throw is a hard failure and does not invoke recovery callbacks', async () => {
    const log: string[] = [];
    const ctx = makeCtx([makeProvider({ validate: () => { throw new Error('boom'); } })]);
    const events = await collect(ctx, makeCallbacks(log));

    expect(log).toEqual([]);
    expect(events.some((event) => event.type === 'plan:build:failed')).toBe(true);
    expect(ctx.buildFailed).toBe(true);
  });

  it('function timeout is a hard failure and does not invoke recovery callbacks', async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const ctx = makeCtx([makeProvider({ validate: () => new Promise(() => { /* never resolves */ }) })]);
    ctx.config.extensions.validationProviderTimeoutMs = 50;

    const runPromise = collect(ctx, makeCallbacks(log));
    vi.advanceTimersByTime(100);
    const events = await runPromise;

    expect(log).toEqual([]);
    expect(events.some((event) => event.type === 'plan:build:failed')).toBe(true);
    expect(ctx.buildFailed).toBe(true);
  });

  it('unexpected return is a hard failure and does not invoke recovery callbacks', async () => {
    const log: string[] = [];
    const ctx = makeCtx([makeProvider({ validate: () => 42 })]);
    const events = await collect(ctx, makeCallbacks(log));

    expect(log).toEqual([]);
    expect(events.some((event) => event.type === 'plan:build:failed')).toBe(true);
    expect(ctx.buildFailed).toBe(true);
  });

  it('returns immediately when callbacks set ctx.buildFailed', async () => {
    const ctx = makeCtx([makeProvider({ validate: () => ({ status: 'failed' as const, message: 'recoverable' }) })], 2);
    const callbacks = {
      runReviewFix: async function* (): AsyncGenerator<EforgeEvent> {
        ctx.buildFailed = true;
      },
      runEvaluate: async function* (): AsyncGenerator<EforgeEvent> {
        throw new Error('evaluate should not run');
      },
    };

    const events = await collect(ctx, callbacks);

    expect(events.some((event) => event.type === 'plan:build:failed')).toBe(false);
    expect(ctx.buildFailed).toBe(true);
  });

  it('returns immediately when evaluate sets ctx.buildFailed', async () => {
    const log: string[] = [];
    let validateCalls = 0;
    const ctx = makeCtx([makeProvider({ validate: () => { validateCalls += 1; return { status: 'failed' as const, message: 'recoverable' }; } })], 2);
    const callbacks = {
      runReviewFix: async function* (): AsyncGenerator<EforgeEvent> {
        log.push('review-fix');
      },
      runEvaluate: async function* (): AsyncGenerator<EforgeEvent> {
        log.push('evaluate');
        ctx.buildFailed = true;
      },
    };

    const events = await collect(ctx, callbacks);

    expect(log).toEqual(['review-fix', 'evaluate']);
    expect(validateCalls).toBe(1);
    expect(events.some((event) => event.type === 'plan:build:failed')).toBe(false);
    expect(ctx.buildFailed).toBe(true);
  });
});

describe('validationFailureToReviewIssues', () => {
  it('maps annotations to validation-provider review issues', () => {
    const provider = makeProvider({ name: 'ann-provider', validate: () => null });
    const outcome: NormalizedValidationResult = {
      status: 'failed',
      message: 'annotated failure',
      runtimeFailureKind: 'result',
      annotations: [
        {
          severity: 'error',
          message: 'broken',
          file: 'src/a.ts',
          line: 3,
          fix: 'Fix the broken validator target',
          retryGuidance: 'Retry narrowly in src/a.ts',
          failureKind: 'domain-signature',
          repairClass: 'structural',
          metadata: { rule: 'guardrail', count: 1 },
        },
        { severity: 'warning', message: 'risky', file: 'src/b.ts', line: 4 },
        { severity: 'info', message: 'consider', file: 'src/c.ts', line: 5 },
      ],
    };

    const issues = validationFailureToReviewIssues(provider, outcome);

    expect(issues.map((issue) => issue.category)).toEqual(['validation-provider', 'validation-provider', 'validation-provider']);
    expect(issues.map((issue) => issue.severity)).toEqual(['critical', 'warning', 'suggestion']);
    expect(issues.map((issue) => issue.file)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(issues.map((issue) => issue.line)).toEqual([3, 4, 5]);
    expect(issues[0]).toMatchObject({
      fix: 'Fix the broken validator target',
      retryGuidance: 'Retry narrowly in src/a.ts',
      failureKind: 'domain-signature',
      repairClass: 'structural',
      metadata: { rule: 'guardrail', count: 1 },
      validationProviderName: 'ann-provider',
      runtimeFailureKind: 'result',
    });
  });

  it('generates stable signatures from provider, file, failure kind, message, and metadata', () => {
    const provider = makeProvider({ name: 'ann-provider', validate: () => null });
    const outcome: NormalizedValidationResult = {
      status: 'failed',
      runtimeFailureKind: 'result',
      annotations: [{
        severity: 'error',
        message: 'Broken   Guardrail',
        file: 'src/a.ts',
        failureKind: 'domain-signature',
        metadata: { z: 2, a: { nested: true } },
      }],
    };

    const signatures = validationFailureSignatures(provider, outcome);

    expect(signatures).toHaveLength(1);
    expect(signatures[0]).toContain('"providerName": "ann-provider"');
    expect(signatures[0]).toContain('"file": "src/a.ts"');
    expect(signatures[0]).toContain('"failureKind": "domain-signature"');
    expect(signatures[0]).toContain('"message": "broken guardrail"');
    expect(signatures[0]).toContain('"nested": true');
    expect(signatures[0].indexOf('"a"')).toBeLessThan(signatures[0].indexOf('"z"'));
  });

  it('synthesizes one critical file-less issue with provider details', () => {
    const provider = makeProvider({ name: 'cmd/provider', validate: () => null });
    const outcome: NormalizedValidationResult = {
      status: 'failed',
      message: 'failed command',
      details: 'stderr output',
      command: 'pnpm lint',
      exitCode: 1,
      runtimeFailureKind: 'command',
    };

    const issues: ReviewIssue[] = validationFailureToReviewIssues(provider, outcome);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'critical',
      category: 'validation-provider',
      file: '.eforge/validation-providers/cmd-provider.txt',
      description: expect.stringContaining('failed command'),
    });
    expect(issues[0].description).toContain('Validation provider "cmd/provider" failed.');
    expect(issues[0].description).toContain('stderr output');
    expect(issues[0].description).toContain('pnpm lint');
    expect(issues[0].description).toContain('Exit code: 1');
  });

  it('uses a stable pseudo-file for annotation issues without a file', () => {
    const provider = makeProvider({ name: 'ann/provider', validate: () => null });
    const outcome: NormalizedValidationResult = {
      status: 'failed',
      message: 'annotated failure',
      command: 'pnpm check',
      exitCode: 2,
      runtimeFailureKind: 'result',
      annotations: [{ severity: 'warning', message: 'risky', details: 'more context' }],
    };

    const issues = validationFailureToReviewIssues(provider, outcome);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'warning',
      category: 'validation-provider',
      file: '.eforge/validation-providers/ann-provider.txt',
      description: expect.stringContaining('Validation provider "ann/provider" reported: risky'),
    });
    expect(issues[0].description).toContain('more context');
    expect(issues[0].description).toContain('pnpm check');
    expect(issues[0].description).toContain('Exit code: 2');
  });
});
