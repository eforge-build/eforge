import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderEvent, stopAllSpinners } from '../packages/eforge/src/cli/display.js';
import type { EforgeEvent } from '@eforge-build/client';

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
});

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
