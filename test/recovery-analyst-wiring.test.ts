// --- eforge:region recovery-analyst-wiring-suite ---
// Split from recovery.test.ts.
import { describe, it, expect } from 'vitest';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { EforgeEvent, BuildFailureSummary } from '@eforge-build/engine/events';
import { parseRecoveryVerdictBlock } from '@eforge-build/engine/agents/common';
import { recoveryVerdictSchema, getRecoveryVerdictSchemaYaml } from '@eforge-build/engine/schemas';
import { safeParseWithSchema, safeParseEforgeEvent } from '@eforge-build/client';
import { runRecoveryAnalyst } from '@eforge-build/engine/agents/recovery-analyst';
import { RECOVERY_ANALYST_PROMPT_INPUT_BUDGET_CHARS } from '@eforge-build/engine/recovery/analyst-context';
import { writeRecoverySidecar } from '@eforge-build/engine/recovery/sidecar';
import { buildFailureSummary } from '@eforge-build/engine/recovery/failure-summary';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { openDatabase } from '@eforge-build/monitor/db';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';

describe('runRecoveryAnalyst wiring', () => {
  const makeTempDir = useTempDir('eforge-recovery-analyst-test-');

  function makeSummary(): BuildFailureSummary {
    return {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [{ planId: 'plan-01', status: 'failed', error: 'Timeout' }],
      failingPlan: { planId: 'plan-01', errorMessage: 'Timeout' },
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2024-01-15T10:00:00.000Z',
    };
  }

  const SPLIT_OUTPUT = `Based on my analysis of the failure:

<recovery verdict="split" confidence="medium">
  <rationale>Foundation work is preserved; API work remains incomplete due to the timeout.</rationale>
  <completedWork>
    <item>Database schema merged</item>
  </completedWork>
  <remainingWork>
    <item>API endpoints not implemented</item>
  </remainingWork>
  <risks>
    <item>Timeout root cause unknown</item>
  </risks>
  <suggestedSuccessorPrd># Successor PRD\n\nContinue the API work.</suggestedSuccessorPrd>
</recovery>`;

  it('emits recovery:summary then recovery:complete for valid agent output', async () => {
    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD\n\nBuild a thing.',
      summary: makeSummary(),
      cwd,
    }));

    const summary = findEvent(events, 'recovery:summary');
    expect(summary).toBeDefined();
    expect(summary!.prdId).toBe('test-prd');
    expect(summary!.summary.setName).toBe('test-set');

    const complete = findEvent(events, 'recovery:complete');
    expect(complete).toBeDefined();
    expect(complete!.verdict.verdict).toBe('split');
    expect(complete!.verdict.confidence).toBe('medium');
    expect(complete!.prdId).toBe('test-prd');


    expect(findEvent(events, 'recovery:error')).toBeUndefined();
  });

  it('emits recovery:error when agent output has no valid block', async () => {
    const backend = new StubHarness([{ text: 'I am unable to determine the recovery path.' }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
    }));

    const error = findEvent(events, 'recovery:error');
    expect(error).toBeDefined();
    expect(error!.prdId).toBe('test-prd');
    expect(error!.error).toContain('parse');


    expect(findEvent(events, 'recovery:complete')).toBeUndefined();
    expect(findEvent(events, 'recovery:summary')).toBeUndefined();
  });

  it('invokes harness with tools: "none"', async () => {
    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const cwd = makeTempDir();

    await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
    }));

    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].tools).toBe('none');
  });

  it('suppresses agent:message when verbose is false (default)', async () => {
    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
    }));

    expect(filterEvents(events, 'agent:message')).toHaveLength(0);
  });

  it('emits agent:message when verbose is true', async () => {
    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
      verbose: true,
    }));

    expect(filterEvents(events, 'agent:message').length).toBeGreaterThan(0);
  });

  it('always emits agent:result', async () => {
    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
    }));

    expect(findEvent(events, 'agent:result')).toBeDefined();
  });

  it('prompt includes prdContent, summary JSON, and schema YAML', async () => {
    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const cwd = makeTempDir();

    await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# My PRD\n\nDo a thing.',
      summary: makeSummary(),
      cwd,
    }));

    const prompt = backend.prompts[0];
    expect(prompt).toContain('# My PRD');
    expect(prompt).toContain('"setName": "test-set"');
    expect(prompt).toContain(getRecoveryVerdictSchemaYaml());
    expect(prompt).toContain('unknown` verdicts dominate');
    expect(prompt).toContain('prefer `manual`');
  });

  it('prompt includes deterministic recommendation evidence, failed plan IDs, and coverage requirements', async () => {



    const backend = new StubHarness([{ text: SPLIT_OUTPUT }]);
    const cwd = makeTempDir();

    const summaryWithFailingPlans: BuildFailureSummary = {
      prdId: 'test-prd',
      setName: 'test-set',
      featureBranch: 'eforge/test-set',
      baseBranch: 'main',
      plans: [
        { planId: 'plan-01-alpha', status: 'failed', error: 'API error 529', terminalSubtype: 'error_transient_transport' },
        { planId: 'plan-02-beta', status: 'failed', error: 'API error 529', terminalSubtype: 'error_transient_transport' },
      ],
      failingPlan: { planId: 'plan-02-beta', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport' },
      failingPlans: [
        { planId: 'plan-01-alpha', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
        { planId: 'plan-02-beta', errorMessage: 'API error 529', terminalSubtype: 'error_transient_transport', toolUseCount: 0 },
      ],
      landedCommits: [],
      diffStat: '',
      modelsUsed: [],
      failedAt: '2026-05-26T06:15:10.000Z',
    };

    await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# My PRD\n\nDo a thing.',
      summary: summaryWithFailingPlans,
      cwd,
    }));

    const prompt = backend.prompts[0]!;

    expect(prompt).toContain('Deterministic policy recommendation:');

    expect(prompt).toMatch(/error_transient_transport|transient.*transport|retry/i);

    expect(prompt).toContain('plan-01-alpha');
    expect(prompt).toContain('plan-02-beta');

    expect(prompt).toMatch(/every plan.*ID|all.*plan.*ID|must.*mention.*plan|plan.*ID.*rationale/i);

    expect(prompt).toMatch(/split.*successor.*cover|successor.*PRD.*cover|split.*successor.*plan.*ID/i);
  });

  it('parses retry verdict correctly', async () => {
    const retryOutput = `<recovery verdict="retry" confidence="high">
  <rationale>Network timeout — transient failure.</rationale>
  <completedWork></completedWork>
  <remainingWork><item>All work remains</item></remainingWork>
  <risks><item>Network may timeout again</item></risks>
</recovery>`;
    const backend = new StubHarness([{ text: retryOutput }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
    }));

    const complete = findEvent(events, 'recovery:complete');
    expect(complete).toBeDefined();
    expect(complete!.verdict.verdict).toBe('retry');
  });

  it('parses abandon verdict correctly', async () => {
    const abandonOutput = `<recovery verdict="abandon" confidence="high">
  <rationale>Already shipped via hotfix.</rationale>
  <completedWork><item>Shipped via hotfix</item></completedWork>
  <remainingWork></remainingWork>
  <risks></risks>
</recovery>`;
    const backend = new StubHarness([{ text: abandonOutput }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
    }));

    const complete = findEvent(events, 'recovery:complete');
    expect(complete!.verdict.verdict).toBe('abandon');
  });

  it('parses manual verdict correctly', async () => {
    const manualOutput = `<recovery verdict="manual" confidence="low">
  <rationale>Ambiguous error with no clear cause.</rationale>
  <completedWork></completedWork>
  <remainingWork><item>All work remains</item></remainingWork>
  <risks><item>Unknown root cause</item></risks>
</recovery>`;
    const backend = new StubHarness([{ text: manualOutput }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
    }));

    const complete = findEvent(events, 'recovery:complete');
    expect(complete!.verdict.verdict).toBe('manual');
  });

  it('bounds oversized prompt inputs and still emits recovery:complete for valid agent output', async () => {
    // Fixed allowance for recovery-analyst.md prose, verdict schema YAML, and deterministic policy text.
    const TEST_RECOVERY_ANALYST_TEMPLATE_OVERHEAD_CHARS = 25_000;
    const rawValidationOutput = 'RAW_VALIDATION_OUTPUT_SENTINEL '.repeat(8_000);
    const oversizedPrd = [
      '# Oversized Recovery PRD',
      'intro filler '.repeat(8_000),
      '## Acceptance Criteria',
      '- The bounded prompt must preserve this acceptance criterion heading.',
      'tail filler '.repeat(8_000),
    ].join('\n\n');
    const oversizedSummary: BuildFailureSummary = {
      ...makeSummary(),
      plans: [
        { planId: 'plan-01', status: 'merged', completedAt: '2026-06-01T10:00:00.000Z' },
        { planId: 'plan-02', status: 'failed', error: 'validation failed '.repeat(1_000) },
      ],
      failingPlan: { planId: 'plan-02', errorMessage: 'validation failed '.repeat(1_000) },
      failingPlans: [{ planId: 'plan-02', errorMessage: 'validation failed '.repeat(1_000) }],
      terminalFailure: { scope: 'post-merge-validation', stage: 'validation', message: 'type-check failed '.repeat(1_000), authoritative: true },
      acceptanceValidation: {
        passed: false,
        total: 2,
        pass: 1,
        fail: 0,
        unknown: 1,
        verdicts: [
          { criterion: 'Criterion A', verdict: 'pass', evidence: 'pass evidence '.repeat(1_000) },
          { criterion: 'Criterion B', verdict: 'unknown', evidence: 'unknown evidence '.repeat(1_000) },
        ],
      },
      validationCommands: [{ command: 'pnpm type-check', exitCode: 1, output: rawValidationOutput }],
      landing: { status: 'skipped', reason: 'post-merge validation failed' },
      diffStat: 'diff stat line\n'.repeat(2_000),
      prdContent: oversizedPrd,
      modelsUsed: ['claude-sonnet-4-6'],
    };
    const recoveryOutput = `<recovery verdict="manual" confidence="low">
  <rationale>plan-02 failed during validation and the bounded context contains truncation notes, so manual review is safest.</rationale>
  <completedWork><item>plan-01 merged before the failure</item></completedWork>
  <remainingWork><item>plan-02 requires review</item></remainingWork>
  <risks><item>Truncated evidence may hide relevant details</item></risks>
</recovery>`;
    const backend = new StubHarness([{ text: recoveryOutput }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: oversizedPrd,
      summary: oversizedSummary,
      cwd,
    }));

    const prompt = backend.prompts[0]!;
    expect(prompt.length).toBeLessThanOrEqual(
      RECOVERY_ANALYST_PROMPT_INPUT_BUDGET_CHARS + TEST_RECOVERY_ANALYST_TEMPLATE_OVERHEAD_CHARS,
    );
    expect(prompt).toContain('Context Completeness Notes');
    expect(prompt).toContain('[truncated from');
    expect(prompt).toContain('context is incomplete');
    expect(prompt).toContain('Omitted evidence is not proof of absence');
    expect(prompt).not.toContain(rawValidationOutput);

    const complete = findEvent(events, 'recovery:complete');
    expect(complete).toBeDefined();
    expect(complete!.verdict.verdict).toBe('manual');
  });

  it('parses recovery block from agent:result.resultText when no agent:message content is emitted', async () => {




    const backend = new StubHarness([{ resultText: SPLIT_OUTPUT }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runRecoveryAnalyst({
      harness: backend,
      prdId: 'test-prd',
      prdContent: '# PRD',
      summary: makeSummary(),
      cwd,
    }));


    expect(filterEvents(events, 'agent:message')).toHaveLength(0);


    const complete = findEvent(events, 'recovery:complete');
    expect(complete).toBeDefined();
    expect(complete!.verdict.verdict).toBe('split');
    expect(complete!.prdId).toBe('test-prd');


    expect(findEvent(events, 'recovery:error')).toBeUndefined();
  });
});
// --- eforge:endregion recovery-analyst-wiring-suite ---
