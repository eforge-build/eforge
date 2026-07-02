import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decidePlanningSatisfactionSkip,
  deriveSourceInventory,
  runPlanningSatisfactionGate,
  SATISFACTION_GATE_PLAN_ID,
  type SatisfactionGateSubmission,
} from '@eforge-build/engine/planner-compiler';
import { StubHarness, type StubScriptedEvent } from './stub-harness.js';

const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

const CONTENT = ['# Health Check', '', '## Acceptance Criteria', '- The server exposes a `/health` route in `src/app.ts`.', '- Tests cover the health route in `test/health.test.ts`.'].join('\n');

function inventoryFixture() {
  return deriveSourceInventory({ content: CONTENT, hash: hash(CONTENT) });
}

function satisfiedSubmission(inventory = inventoryFixture(), overrides: Partial<SatisfactionGateSubmission> = {}): SatisfactionGateSubmission {
  return {
    alreadySatisfied: true,
    reason: 'All acceptance criteria are already implemented.',
    verdicts: inventory.criteria.map((criterion) => ({
      criterionId: criterion.id,
      satisfied: true,
      evidencePaths: ['src/app.ts'],
      explanation: 'Implemented and covered.',
    })),
    ...overrides,
  };
}

describe('satisfaction skip decision', () => {
  const exists = () => true;

  it('skips only when every criterion has a grounded satisfied verdict', () => {
    const inventory = inventoryFixture();
    const decision = decidePlanningSatisfactionSkip(inventory, satisfiedSubmission(inventory), exists);

    expect(decision).toEqual({ skip: true, reason: 'All acceptance criteria are already implemented.' });
  });

  it('does not skip when the source has no acceptance criteria', () => {
    const inventory = deriveSourceInventory({ content: '# Just prose\n\nNothing enumerable here.', hash: hash('prose') });

    const decision = decidePlanningSatisfactionSkip(inventory, satisfiedSubmission(), exists);

    expect(decision.skip).toBe(false);
    expect(decision.reason).toContain('no acceptance criteria');
  });

  it('does not skip without a submission or when the agent reports unsatisfied', () => {
    const inventory = inventoryFixture();

    expect(decidePlanningSatisfactionSkip(inventory, undefined, exists).skip).toBe(false);

    const unsatisfied = decidePlanningSatisfactionSkip(inventory, satisfiedSubmission(inventory, { alreadySatisfied: false, reason: 'route missing' }), exists);
    expect(unsatisfied).toEqual({ skip: false, reason: 'route missing' });
  });

  it('does not skip when a criterion verdict is missing or unsatisfied', () => {
    const inventory = inventoryFixture();
    const submission = satisfiedSubmission(inventory);

    const missing = decidePlanningSatisfactionSkip(inventory, { ...submission, verdicts: submission.verdicts.slice(0, 1) }, exists);
    expect(missing.skip).toBe(false);
    expect(missing.reason).toContain('no satisfaction verdict');

    const unsatisfiedVerdicts = submission.verdicts.map((verdict, index) => index === 1 ? { ...verdict, satisfied: false } : verdict);
    const unsatisfied = decidePlanningSatisfactionSkip(inventory, { ...submission, verdicts: unsatisfiedVerdicts }, exists);
    expect(unsatisfied.skip).toBe(false);
    expect(unsatisfied.reason).toContain('is not satisfied');
  });

  it('does not skip on ungrounded evidence: empty, nonexistent, or non-repo-relative paths', () => {
    const inventory = inventoryFixture();
    const submission = satisfiedSubmission(inventory);

    const empty = decidePlanningSatisfactionSkip(inventory, { ...submission, verdicts: submission.verdicts.map((verdict) => ({ ...verdict, evidencePaths: [] })) }, exists);
    expect(empty.skip).toBe(false);
    expect(empty.reason).toContain('cites no evidence paths');

    const nonexistent = decidePlanningSatisfactionSkip(inventory, submission, () => false);
    expect(nonexistent.skip).toBe(false);
    expect(nonexistent.reason).toContain('nonexistent evidence path');

    for (const badPath of ['/etc/passwd', '../outside.ts', 'src\\app.ts', 'C:/Windows/system32']) {
      const escaped = decidePlanningSatisfactionSkip(inventory, { ...submission, verdicts: submission.verdicts.map((verdict) => ({ ...verdict, evidencePaths: [badPath] })) }, exists);
      expect(escaped.skip).toBe(false);
      expect(escaped.reason).toContain('non-repository-relative');
    }
  });
});

describe('satisfaction gate agent', () => {
  const workspaceWithEvidence = async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-satisfaction-'));
    await mkdir(path.join(cwd, 'src'), { recursive: true });
    await writeFile(path.join(cwd, 'src/app.ts'), 'export const app = true;\n', 'utf8');
    return cwd;
  };

  it('runs read-only and skips on a grounded all-satisfied submission', async () => {
    const cwd = await workspaceWithEvidence();
    const inventory = inventoryFixture();
    const harness = new StubHarness([
      { toolCalls: [{ tool: 'submit_satisfaction_assessment', toolUseId: 'submit-1', input: satisfiedSubmission(inventory), output: 'ok' }] },
    ]);

    const result = await runPlanningSatisfactionGate({ cwd, harness, inventory, maxToolUses: 8 });

    expect(result.decision).toEqual({ skip: true, reason: 'All acceptance criteria are already implemented.' });
    expect(harness.calls[0].tools).toBe('read-only');
    expect(harness.prompts[0]).toContain('submit_satisfaction_assessment');
    expect(harness.prompts[0]).toContain(inventory.criteria[0].id);
    for (const toolName of ['Bash', 'Write(', 'Read tool', 'Grep tool', 'Glob tool']) expect(harness.prompts[0]).not.toContain(toolName);
    expect(result.events.some((event) => event.type === 'agent:start' && event.planId === SATISFACTION_GATE_PLAN_ID)).toBe(true);
  });

  it('does not skip when the submission cites paths missing from the workspace', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-satisfaction-empty-'));
    const inventory = inventoryFixture();
    const harness = new StubHarness([
      { toolCalls: [{ tool: 'submit_satisfaction_assessment', toolUseId: 'submit-1', input: satisfiedSubmission(inventory), output: 'ok' }] },
    ]);

    const result = await runPlanningSatisfactionGate({ cwd, harness, inventory, maxToolUses: 8 });

    expect(result.decision.skip).toBe(false);
    expect(result.decision.reason).toContain('nonexistent evidence path');
  });

  it('fails open when the harness errors mid-run', async () => {
    const cwd = await workspaceWithEvidence();
    const harness = new StubHarness([{ error: new Error('backend exploded') }]);

    const result = await runPlanningSatisfactionGate({ cwd, harness, inventory: inventoryFixture(), maxToolUses: 8 });

    expect(result.decision.skip).toBe(false);
    expect(result.decision.reason).toContain('backend exploded');
  });

  it('fails open when the submission is schema-invalid or never arrives', async () => {
    const cwd = await workspaceWithEvidence();
    const invalidHarness = new StubHarness([
      { toolCalls: [{ tool: 'submit_satisfaction_assessment', toolUseId: 'submit-1', input: { alreadySatisfied: 'yes' }, output: 'ok' }] },
    ]);
    const invalid = await runPlanningSatisfactionGate({ cwd, harness: invalidHarness, inventory: inventoryFixture(), maxToolUses: 8 });
    expect(invalid.decision.skip).toBe(false);
    expect(invalid.decision.reason).toContain('did not call');

    const silentHarness = new StubHarness([{ events: [] }]);
    const silent = await runPlanningSatisfactionGate({ cwd, harness: silentHarness, inventory: inventoryFixture(), maxToolUses: 8 });
    expect(silent.decision.skip).toBe(false);
    expect(silent.decision.reason).toContain('did not call');
  });

  it('fails open when the tool budget is exhausted without a submission', async () => {
    const cwd = await workspaceWithEvidence();
    const maxToolUses = 3;
    const events: StubScriptedEvent[] = Array.from({ length: maxToolUses + 2 }, (_, index) => ({ kind: 'tool_call' as const, tool: 'inspect_repository', toolUseId: `inspect-${index}`, input: {}, output: 'listing' }));
    const harness = new StubHarness([{ events }]);

    const result = await runPlanningSatisfactionGate({ cwd, harness, inventory: inventoryFixture(), maxToolUses });

    expect(result.decision.skip).toBe(false);
    expect(result.toolUses).toBeGreaterThan(maxToolUses);
    expect(result.decision.reason).toContain('budget exhausted');
  });
});
