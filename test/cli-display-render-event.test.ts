import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumeSpinnerEffectsForTesting, initDisplay, renderEvent, stopAllSpinners } from '../packages/eforge/src/cli/display.js';
import type { CompileScopeContextFailure, EforgeEvent, PlannerInspectionSummary } from '@eforge-build/client';

function captureConsoleLogs(run: () => void): string[] {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return lines.map(stripAnsi);
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

afterEach(() => {
  stopAllSpinners();
  consumeSpinnerEffectsForTesting();
  initDisplay();
});

const inspectionSummary: PlannerInspectionSummary = {
  kind: 'planner-inspection-handoff',
  version: 1,
  source: { sourceName: 'Queue cleanup', planSetName: 'set-a' },
  relevantFiles: ['packages/engine/src/queue/scheduler.ts'],
  observedFacts: ['Read scheduler cleanup code.'],
  importantFindings: ['Queue cleanup coverage was removed.'],
  inferredImplementationAreas: ['packages/engine/src/queue'],
  unresolvedQuestions: ['Confirm failed dispatch shape.'],
  sourceBuildContext: { sourceSummary: 'Fix removed queue coverage cleanup.' },
  budgetDiagnostics: {
    maxObservedInputTokens: 160000,
    softInputTokenThreshold: 115200,
    plannerMaxTurns: 80,
    inspectionTurnBudget: 60,
    softInputTokenRatio: 0.72,
    softTurnRatio: 0.75,
    observed: { inputTokens: 115200, outputTokens: 1200, turns: 44, promptBytes: 4096 },
    toolUseCount: 32,
    toolResultCount: 31,
  },
  caveats: ['Inspection is incomplete.'],
  omittedCounts: { toolResults: 1 },
};

const scopeFailure: CompileScopeContextFailure = {
  source: 'provider',
  failureKind: 'context-window',
  stage: 'planner',
  explanation: 'Provider context window exceeded.',
  observed: { promptBytes: 8192, inputTokens: 1234, turns: 3 },
  recovery: { action: 'manual-reduce-scope', eligible: true, attempted: false, attempt: 1, maxAttempts: 2, reason: 'Reduce scope before retrying.' },
  artifacts: { orchestrationExists: false, validPlanCount: 0, invalidPlanCount: 1, missingPlanFileCount: 2, missingPlanFiles: ['plan-01.md'], invalidPlanFiles: ['plan-02.md'] },
};

describe('renderEvent', () => {
  it('renders phase start details through the top-level dispatcher', () => {
    const lines = captureConsoleLogs(() => {
      renderEvent({
        type: 'phase:start',
        timestamp: '2025-01-01T00:00:00.000Z',
        runId: 'run-1',
        planSet: 'plan-set',
        command: 'build',
      });
    });

    expect(lines).toEqual(['', '⚒ eforge build', '  Run: run-1', '  Plan set: plan-set', '']);
  });

  it('renders PRD validation gap details and complexity summaries', () => {
    const lines = captureConsoleLogs(() => {
      renderEvent({
        type: 'prd_validation:complete',
        timestamp: '2025-01-01T00:00:00.000Z',
        passed: false,
        completionPercent: 67,
        gaps: [
          {
            requirement: 'Add audit logs',
            explanation: 'No audit log requirement was implemented',
            complexity: 'trivial',
          },
          {
            requirement: 'Add approval flow',
            explanation: 'Approval workflow is absent',
            complexity: 'significant',
          },
        ],
      });
    });

    expect(lines).toEqual([
      '  - Add audit logs: No audit log requirement was implemented',
      '  - Add approval flow: Approval workflow is absent',
      '  1 trivial, 1 significant',
    ]);
  });

  it('renders acceptance validation verdict summaries', () => {
    const lines = captureConsoleLogs(() => {
      renderEvent({
        type: 'acceptance_validation:complete',
        timestamp: '2025-01-01T00:00:00.000Z',
        passed: false,
        source: 'prd',
        verdicts: [
          { criterion: 'Login works', verdict: 'pass', evidence: 'Login test passed' },
          { criterion: 'OAuth works', verdict: 'fail', evidence: 'OAuth was not implemented' },
          { criterion: 'Audit logs exist', verdict: 'unknown', evidence: 'Cannot verify from diff' },
        ],
        waivers: ['OAuth deferred'],
      });
    });

    expect(lines).toEqual([
      '✗ Acceptance validation failed: 1 passed, 1 failed, 1 unknown',
      '  Waiver: OAuth deferred',
    ]);
  });

  it('renders compact planner inspection summaries through the top-level dispatcher', () => {
    const lines = captureConsoleLogs(() => {
      renderEvent({ type: 'planning:inspection-summary', timestamp: '2025-01-01T00:00:00.000Z', summary: inspectionSummary, artifactPath: '/tmp/planner-inspection-handoff.json' });
    });

    expect(lines.join('\n')).toContain('Planner compact inspection summary');
    expect(lines.join('\n')).toContain('packages/engine/src/queue/scheduler.ts');
    expect(lines.join('\n')).toContain('Queue cleanup coverage was removed');
    expect(lines.join('\n')).toContain('planner-inspection-handoff.json');
  });

  it('renders terminal compile scope/context failures through the top-level dispatcher', () => {
    const lines = captureConsoleLogs(() => {
      renderEvent({ type: 'planning:scope-context:failure', timestamp: '2025-01-01T00:00:00.000Z', failure: scopeFailure });
    });

    expect(lines.join('\n')).toContain('Compile scope/context failure');
    expect(lines.join('\n')).toContain('context-window');
    expect(lines.join('\n')).toContain('provider');
    expect(lines.join('\n')).toContain('planner');
    expect(lines.join('\n')).toContain('manual scope reduction');
    expect(lines.join('\n')).toContain('attempt 1/2');
  });


  it('renders direct PR base-sync success progress events through the top-level dispatcher', () => {
    renderEvent({ type: 'base-sync:start', timestamp: '2025-01-01T00:00:00.000Z', remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/test', maxAttempts: 2 });
    renderEvent({ type: 'base-sync:conflict:attempt', timestamp: '2025-01-01T00:00:01.000Z', remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/test', attempt: 1, maxAttempts: 2, conflictedFiles: ['src/a.ts'] });
    renderEvent({ type: 'base-sync:resolver:start', timestamp: '2025-01-01T00:00:02.000Z', remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/test', attempt: 1, maxAttempts: 2 });
    renderEvent({ type: 'base-sync:resolver:complete', timestamp: '2025-01-01T00:00:03.000Z', remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/test', attempt: 1, maxAttempts: 2, resolved: true, remainingConflicts: 0 });
    renderEvent({ type: 'base-sync:rebase:continue', timestamp: '2025-01-01T00:00:04.000Z', remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/test', attempt: 1, maxAttempts: 2 });
    renderEvent({ type: 'base-sync:success', timestamp: '2025-01-01T00:00:05.000Z', remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/test', baseSha: 'abc123', featureSha: 'def456', rebased: true });

    expect(consumeSpinnerEffectsForTesting()).toEqual([
      { action: 'start', key: 'base-sync', text: 'Syncing direct PR base origin/main...' },
      { action: 'text', key: 'base-sync', text: 'Direct PR base sync conflict attempt 1/2 (1 file(s))...' },
      { action: 'text', key: 'base-sync', text: 'Resolving direct PR base sync conflicts (1/2)...' },
      { action: 'text', key: 'base-sync', text: 'Resolved direct PR base sync conflicts (1/2)...' },
      { action: 'text', key: 'base-sync', text: 'Continuing direct PR base rebase (1/2)...' },
      { action: 'succeed', key: 'base-sync', text: 'Direct PR base sync rebased onto origin/main' },
    ]);
  });

  it('renders direct PR base-sync exhausted budget with an active spinner', () => {
    renderEvent({ type: 'base-sync:start', timestamp: '2025-01-01T00:00:00.000Z', remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/test', maxAttempts: 2 });
    renderEvent({ type: 'base-sync:budget:exhausted', timestamp: '2025-01-01T00:00:06.000Z', remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/test', attempts: 2, maxAttempts: 2, conflictedFiles: ['src/a.ts'] });

    expect(consumeSpinnerEffectsForTesting()).toEqual([
      { action: 'start', key: 'base-sync', text: 'Syncing direct PR base origin/main...' },
      { action: 'fail', key: 'base-sync', text: 'Direct PR base sync exhausted 2/2 conflict attempts' },
    ]);
  });

  it('fails an active direct PR base-sync spinner when landing is skipped for sync failure', () => {
    renderEvent({ type: 'base-sync:start', timestamp: '2025-01-01T00:00:00.000Z', remote: 'origin', baseBranch: 'main', featureBranch: 'eforge/test', maxAttempts: 2 });
    renderEvent({ type: 'landing:skipped', timestamp: '2025-01-01T00:00:01.000Z', action: 'pr', featureBranch: 'eforge/test', baseBranch: 'main', reason: "Direct PR base sync failed for baseBranch 'main': fetch failed" });

    expect(consumeSpinnerEffectsForTesting()).toEqual([
      { action: 'start', key: 'base-sync', text: 'Syncing direct PR base origin/main...' },
      { action: 'fail', key: 'base-sync', text: "Direct PR base sync failed for baseBranch 'main': fetch failed" },
    ]);
  });

  it('falls back to the client event summary for unhandled event domains', () => {
    const lines = captureConsoleLogs(() => {
      renderEvent({
        type: 'extension:action:start',
        timestamp: '2025-01-01T00:00:00.000Z',
        invocationId: 'inv-1',
        actionId: 'tools:refresh',
        extensionName: 'tooling',
        extensionPath: '/extensions/tooling',
        requestedBy: 'user',
      } as EforgeEvent);
    });

    expect(lines).toEqual(['  Extension action tools:refresh started for tooling']);
  });
});
