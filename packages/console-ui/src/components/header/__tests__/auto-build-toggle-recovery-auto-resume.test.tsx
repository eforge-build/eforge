// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutoBuildState } from '@eforge-build/client/browser';
import { AutoBuildToggle } from '../auto-build-toggle';

afterEach(cleanup);

function autoBuild(overrides: Partial<AutoBuildState> = {}): AutoBuildState {
  return {
    enabled: true,
    desired: 'enabled',
    mode: 'running',
    watcher: { running: true, pid: 1234, sessionId: 'watcher-1' },
    scheduler: { alive: true, paused: false, runningCount: 0, limit: 2 },
    ...overrides,
  };
}

describe('AutoBuildToggle recovery auto-resume visibility', () => {
  it('shows automatic queued decisions separately from the manual auto-start switch', () => {
    render(
      <AutoBuildToggle
        enabled
        autoBuild={autoBuild({
          recoveryAutoResume: {
            enabled: true,
            maxAttempts: 2,
            attempts: 1,
            lastDecision: 'queued',
            prdId: 'failed-prd',
            setName: 'failed-set',
          },
        })}
        toggling={false}
        onSetEnabled={vi.fn()}
      />,
    );

    expect(screen.getByRole('switch', { name: 'Auto-start queued builds On' })).toBeTruthy();
    expect(screen.getByText('Automatic recovery queued (1/2)')).toBeTruthy();
  });

  it('shows stopped decisions with the projected stop reason and attempt budget', () => {
    render(
      <AutoBuildToggle
        enabled
        autoBuild={autoBuild({
          recoveryAutoResume: {
            enabled: true,
            maxAttempts: 3,
            attempts: 2,
            lastDecision: 'stopped',
            stopReason: 'repeated-failure-signature',
          },
        })}
        toggling={false}
        onSetEnabled={vi.fn()}
      />,
    );

    expect(screen.getByRole('switch', { name: 'Auto-start queued builds On' })).toBeTruthy();
    expect(screen.getByText('Automatic recovery stopped: repeated-failure-signature (2/3)')).toBeTruthy();
  });

  it('shows disabled policy state without making the manual auto-start switch disappear', () => {
    render(
      <AutoBuildToggle
        enabled
        autoBuild={autoBuild({
          recoveryAutoResume: {
            enabled: false,
            maxAttempts: 1,
            attempts: 0,
            lastDecision: 'stopped',
            stopReason: 'disabled',
          },
        })}
        toggling={false}
        onSetEnabled={vi.fn()}
      />,
    );

    expect(screen.getByRole('switch', { name: 'Auto-start queued builds On' })).toBeTruthy();
    expect(screen.getByText('Automatic recovery stopped: disabled (0/1)')).toBeTruthy();
  });
});
