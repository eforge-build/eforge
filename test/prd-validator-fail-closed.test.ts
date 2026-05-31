import { describe, it, expect } from 'vitest';
import { runPrdValidator } from '@eforge-build/engine/agents/prd-validator';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent } from './test-events.js';

function makeOptions(backend: StubHarness) {
  return {
    harness: backend,
    cwd: process.cwd(),
    prdContent: 'A PRD',
    diff: 'diff --git a/x b/x',
  };
}

describe('runPrdValidator fail-closed behavior', () => {
  it('re-throws non-abort errors from the backend', async () => {
    const backend = new StubHarness([
      { error: new Error('connect ECONNREFUSED') },
    ]);

    await expect(async () => {
      for await (const _ of runPrdValidator(makeOptions(backend))) {
        // drain
      }
    }).rejects.toThrow('connect ECONNREFUSED');
  });

  it('re-throws AbortError from the backend', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const backend = new StubHarness([
      { error: abortErr },
    ]);

    await expect(async () => {
      for await (const _ of runPrdValidator(makeOptions(backend))) {
        // drain
      }
    }).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('throws when the backend produces no accumulated text', async () => {
    const backend = new StubHarness([
      { /* no text, no tool calls */ },
    ]);

    await expect(async () => {
      for await (const _ of runPrdValidator(makeOptions(backend))) {
        // drain
      }
    }).rejects.toThrow(/PRD validator produced no output/);
  });

  it('yields passed=false with a synthetic gap when output contains no JSON block', async () => {
    const backend = new StubHarness([
      { text: 'Here are my thoughts but no JSON block anywhere.' },
    ]);

    const events = await collectEvents(runPrdValidator(makeOptions(backend)));
    const complete = findEvent(events, 'prd_validation:complete');
    expect(complete).toBeDefined();
    expect(complete!.passed).toBe(false);
    expect(complete!.gaps).toHaveLength(1);
    expect(complete!.gaps[0].requirement).toBe('PRD validator output unparseable');
  });

  it('yields passed=true for valid JSON with empty gaps array', async () => {
    const backend = new StubHarness([
      { text: '```json\n{"completionPercent": 100, "gaps": []}\n```' },
    ]);

    const events = await collectEvents(runPrdValidator(makeOptions(backend)));
    const complete = findEvent(events, 'prd_validation:complete');
    expect(complete).toBeDefined();
    expect(complete!.passed).toBe(true);
    expect(complete!.gaps).toHaveLength(0);
    expect(complete!.completionPercent).toBe(100);
  });
});

// --- eforge:region plan-02-engine-acceptance-gates ---
describe('runPrdValidator malformed gap entries behavior', () => {
  it('produces synthetic failure gaps for malformed gap entries instead of silently dropping them', async () => {
    const backend = new StubHarness([
      { text: '```json\n{"completionPercent": 80, "gaps": [null, {"requirement": "valid req", "explanation": "valid exp"}, 42]}\n```' },
    ]);

    const events = await collectEvents(runPrdValidator(makeOptions(backend)));
    const complete = findEvent(events, 'prd_validation:complete');
    expect(complete).toBeDefined();
    // All 3 entries are preserved: 2 malformed → synthetic failure gap, 1 valid
    expect(complete!.gaps).toHaveLength(3);
    expect(complete!.gaps[0]).toMatchObject({ requirement: 'Malformed PRD validation gap entry' });
    expect(complete!.gaps[1]).toMatchObject({ requirement: 'valid req', explanation: 'valid exp' });
    expect(complete!.gaps[2]).toMatchObject({ requirement: 'Malformed PRD validation gap entry' });
    // Build must fail because gaps are present
    expect(complete!.passed).toBe(false);
  });
});

describe('runPrdValidator expectedAcceptanceCriteria synthesis behavior', () => {
  it('synthesizes unknown verdicts for expected criteria not covered by the validator output', async () => {
    const backend = new StubHarness([
      {
        text: '```json\n{"completionPercent": 100, "gaps": [], "acceptanceVerdicts": [{"criterion": "Must support login", "verdict": "pass", "evidence": "Login found at src/login.ts"}]}\n```',
      },
    ]);

    const events = await collectEvents(runPrdValidator({
      ...makeOptions(backend),
      expectedAcceptanceCriteria: [
        { id: 'ac-001', text: 'Must support login', raw: 'Must support login' },
        { id: 'ac-002', text: 'Must support OAuth', raw: 'Must support OAuth' },
      ],
    }));

    // prd_validation:complete should pass (no gaps)
    const complete = findEvent(events, 'prd_validation:complete');
    expect(complete).toBeDefined();
    expect(complete!.passed).toBe(true);

    // acceptance_validation:complete — runPrdValidator itself only emits raw validator output.
    // Synthesis is the orchestrator's responsibility (prdValidate phase).
    // The emitted acceptance event should only have the single verdict the validator returned.
    const acceptance = findEvent(events, 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    expect(acceptance!.verdicts).toHaveLength(1);
    expect(acceptance!.verdicts[0]).toMatchObject({ criterion: 'Must support login', verdict: 'pass' });
  });
});
// --- eforge:endregion plan-02-engine-acceptance-gates ---

// --- eforge:region plan-01-validation-evidence-contract ---
describe('runPrdValidator acceptance_validation:complete behavior', () => {
  it('emits acceptance_validation:complete with passed=false and unknown verdict when agent JSON omits the verdict array', async () => {
    const backend = new StubHarness([
      { text: '```json\n{"completionPercent": 100, "gaps": []}\n```' },
    ]);

    const events = await collectEvents(runPrdValidator(makeOptions(backend)));
    const acceptance = findEvent(events, 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    expect(acceptance!.passed).toBe(false);
    expect(acceptance!.verdicts).toHaveLength(1);
    expect(acceptance!.verdicts[0].verdict).toBe('unknown');
    expect(acceptance!.verdicts[0].evidence).toBeTruthy();
    expect(acceptance!.source).toBe('prd');
  });

  it('emits acceptance_validation:complete with passed=false when the verdict array is empty', async () => {
    const backend = new StubHarness([
      { text: '```json\n{"completionPercent": 100, "gaps": [], "acceptanceVerdicts": []}\n```' },
    ]);

    const events = await collectEvents(runPrdValidator(makeOptions(backend)));
    const acceptance = findEvent(events, 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    expect(acceptance!.passed).toBe(false);
    expect(acceptance!.verdicts).toHaveLength(1);
    expect(acceptance!.verdicts[0]).toMatchObject({
      criterion: 'Acceptance criteria',
      verdict: 'unknown',
    });
  });

  it('emits acceptance_validation:complete with passed=false when verdict array entries are malformed', async () => {
    const backend = new StubHarness([
      { text: '```json\n{"completionPercent": 100, "gaps": [], "acceptanceVerdicts": [null, "not an object"]}\n```' },
    ]);

    const events = await collectEvents(runPrdValidator(makeOptions(backend)));
    const acceptance = findEvent(events, 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    expect(acceptance!.passed).toBe(false);
    expect(acceptance!.verdicts.length).toBeGreaterThan(0);
    expect(acceptance!.verdicts.some((verdict) => verdict.verdict === 'unknown')).toBe(true);
    expect(acceptance!.verdicts.every((verdict) => verdict.evidence.length > 0)).toBe(true);
  });

  it('emits acceptance_validation:complete with passed=true when all verdicts are pass', async () => {
    const backend = new StubHarness([
      {
        text: '```json\n{"completionPercent": 100, "gaps": [], "acceptanceVerdicts": [{"criterion": "Must support login", "verdict": "pass", "evidence": "Login component found at src/login.ts"}]}\n```',
      },
    ]);

    const events = await collectEvents(runPrdValidator(makeOptions(backend)));
    const acceptance = findEvent(events, 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    expect(acceptance!.passed).toBe(true);
    expect(acceptance!.verdicts).toHaveLength(1);
    expect(acceptance!.verdicts[0].verdict).toBe('pass');
    expect(acceptance!.source).toBe('prd');
  });

  it('emits acceptance_validation:complete with passed=false and unknown verdict when criterion has no evidence', async () => {
    const backend = new StubHarness([
      {
        text: '```json\n{"completionPercent": 100, "gaps": [], "acceptanceVerdicts": [{"criterion": "Must support login", "verdict": "pass", "evidence": ""}]}\n```',
      },
    ]);

    const events = await collectEvents(runPrdValidator(makeOptions(backend)));
    const acceptance = findEvent(events, 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    expect(acceptance!.passed).toBe(false);
    expect(acceptance!.verdicts[0].verdict).toBe('unknown');
    expect(acceptance!.verdicts[0].evidence).toBe('No evidence provided for this criterion.');
  });

  it('emits acceptance_validation:complete with passed=false when any verdict is fail', async () => {
    const backend = new StubHarness([
      {
        text: '```json\n{"completionPercent": 90, "gaps": [], "acceptanceVerdicts": [{"criterion": "Must support login", "verdict": "pass", "evidence": "Found"}, {"criterion": "Must support OAuth", "verdict": "fail", "evidence": "Not found"}]}\n```',
      },
    ]);

    const events = await collectEvents(runPrdValidator(makeOptions(backend)));
    const acceptance = findEvent(events, 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    expect(acceptance!.passed).toBe(false);
    expect(acceptance!.verdicts).toHaveLength(2);
  });

  it('emits acceptanceConflicts when the validator reports a rigid criterion conflict', async () => {
    const backend = new StubHarness([
      {
        text: '```json\n{"completionPercent": 100, "gaps": [], "acceptanceVerdicts": [{"criterion": "ac-002", "verdict": "fail", "evidence": "monitor-ui touched"}], "acceptanceConflicts": [{"criterion": "ac-002", "evidence": "monitor-ui reducer needed a new event ignore case", "conflictsWith": "type-checking the new client event", "scope": "narrow", "recommendedAction": "revise_acceptance_criteria"}]}\n```',
      },
    ]);

    const events = await collectEvents(runPrdValidator(makeOptions(backend)));
    const acceptance = findEvent(events, 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    expect(acceptance!.passed).toBe(false);
    expect(acceptance!.acceptanceConflicts).toEqual([
      {
        criterion: 'ac-002',
        evidence: 'monitor-ui reducer needed a new event ignore case',
        conflictsWith: 'type-checking the new client event',
        scope: 'narrow',
        recommendedAction: 'revise_acceptance_criteria',
      },
    ]);
  });

  it('emits acceptance_validation:complete with passed=false for unparseable output', async () => {
    const backend = new StubHarness([
      { text: 'Here are my thoughts but no JSON block anywhere.' },
    ]);

    const events = await collectEvents(runPrdValidator(makeOptions(backend)));
    const acceptance = findEvent(events, 'acceptance_validation:complete');
    expect(acceptance).toBeDefined();
    expect(acceptance!.passed).toBe(false);
    expect(acceptance!.verdicts).toHaveLength(1);
    expect(acceptance!.verdicts[0].verdict).toBe('unknown');
  });
});
// --- eforge:endregion plan-01-validation-evidence-contract ---

// --- eforge:region plan-01-recovery-and-acceptance-reporting ---
describe('runPrdValidator — deterministic validation command evidence', () => {
  it('includes command evidence in the prompt when validationCommandEvidence is provided', async () => {
    const backend = new StubHarness([
      { text: '```json\n{"completionPercent": 100, "gaps": [], "acceptanceVerdicts": [{"criterion": "pnpm type-check passes", "verdict": "pass", "evidence": "Exit code 0 confirmed by validation command"}]}\n```' },
    ]);

    await collectEvents(runPrdValidator({
      ...makeOptions(backend),
      validationCommandEvidence: [
        { command: 'pnpm type-check', exitCode: 0, output: 'Type checking complete — no errors' },
      ],
    }));

    const prompt = backend.prompts[0];
    expect(prompt).toContain('pnpm type-check');
    // formatValidationCommandEvidence labels exit 0 as PASSED and includes exact exit code evidence.
    expect(prompt).toContain('PASSED');
    expect(prompt).toContain('exitCode: 0');
    expect(prompt).toContain('Type checking complete');
  });

  it('includes PASSED status label for exit code 0 in the prompt', async () => {
    const backend = new StubHarness([
      { text: '```json\n{"completionPercent": 100, "gaps": []}\n```' },
    ]);

    await collectEvents(runPrdValidator({
      ...makeOptions(backend),
      validationCommandEvidence: [
        { command: 'pnpm type-check', exitCode: 0, output: 'No errors found' },
      ],
    }));

    const prompt = backend.prompts[0];
    expect(prompt).toContain('PASSED');
    expect(prompt).toContain('exitCode: 0');
    expect(prompt).toContain('pnpm type-check');
  });

  it('includes FAILED status label for non-zero exit code in the prompt', async () => {
    const backend = new StubHarness([
      { text: '```json\n{"completionPercent": 80, "gaps": [{"requirement": "Type errors", "explanation": "Types fail"}]}\n```' },
    ]);

    await collectEvents(runPrdValidator({
      ...makeOptions(backend),
      validationCommandEvidence: [
        { command: 'pnpm type-check', exitCode: 1, output: 'error TS2345: Type mismatch' },
      ],
    }));

    const prompt = backend.prompts[0];
    expect(prompt).toContain('FAILED (exit 1)');
    expect(prompt).toContain('exitCode: 1');
  });

  it('truncates long output to bounded length in the prompt', async () => {
    const longOutput = 'A'.repeat(1000);
    const backend = new StubHarness([
      { text: '```json\n{"completionPercent": 100, "gaps": []}\n```' },
    ]);

    await collectEvents(runPrdValidator({
      ...makeOptions(backend),
      validationCommandEvidence: [
        { command: 'pnpm type-check', exitCode: 0, output: longOutput },
      ],
    }));

    const prompt = backend.prompts[0];
    // Truncated output should contain the truncation marker
    expect(prompt).toContain('[...truncated]');
    // But the full 1000-char string should NOT appear (it was truncated)
    expect(prompt).not.toContain('A'.repeat(600));
  });

  it('omits the evidence section entirely when no commands are provided', async () => {
    const backend = new StubHarness([
      { text: '```json\n{"completionPercent": 100, "gaps": []}\n```' },
    ]);

    await collectEvents(runPrdValidator(makeOptions(backend)));

    const prompt = backend.prompts[0];
    expect(prompt).not.toContain('Deterministic Validation Command Evidence');
  });
});
// --- eforge:endregion plan-01-recovery-and-acceptance-reporting ---
