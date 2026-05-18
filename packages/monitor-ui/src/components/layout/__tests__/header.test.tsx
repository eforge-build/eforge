// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Header } from '../header';
import type { AutoBuildState } from '@/lib/api';
import { initialDaemonState } from '@/lib/daemon-reducer';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAutoBuildState(overrides: Partial<AutoBuildState> = {}): AutoBuildState {
  return {
    enabled: true,
    watcher: { running: true, pid: 1234, sessionId: 'watcher-session-1' },
    desired: 'enabled',
    mode: 'running',
    scheduler: { alive: true, paused: false, lastMutationReason: 'enqueue' },
    lastTransition: {
      at: '2024-01-15T09:59:00.000Z',
      previousMode: 'starting',
      nextMode: 'running',
      desired: 'enabled',
      reason: 'startup complete',
      source: 'test',
    },
    reason: 'startup complete',
    ...overrides,
  };
}

const baseProps = {
  projectContext: null,
  sidebarCollapsed: false,
  onToggleSidebar: () => {},
  daemonState: initialDaemonState,
};

function renderHeader(
  autoBuildState: AutoBuildState | null,
  onSetAutoBuildEnabled: (enabled: boolean) => void,
  autoBuildToggling = false,
) {
  return render(
    <Header
      {...baseProps}
      autoBuildState={autoBuildState}
      autoBuildToggling={autoBuildToggling}
      onSetAutoBuildEnabled={onSetAutoBuildEnabled}
    />,
  );
}

// ---------------------------------------------------------------------------
// Status text — must not be an activation target
// ---------------------------------------------------------------------------

describe('Header auto-build status text — clicking does not trigger the setter', () => {
  it('clicking "Auto-build: running" leaves the handler call count at 0', () => {
    const onSetAutoBuildEnabled = vi.fn();
    renderHeader(makeAutoBuildState({ enabled: true, mode: 'running' }), onSetAutoBuildEnabled);

    fireEvent.click(screen.getByText('Auto-build: running'));

    expect(onSetAutoBuildEnabled).not.toHaveBeenCalled();
  });

  it('clicking "Auto-build: disabled" leaves the handler call count at 0', () => {
    const onSetAutoBuildEnabled = vi.fn();
    renderHeader(
      makeAutoBuildState({ enabled: false, mode: 'disabled' }),
      onSetAutoBuildEnabled,
    );

    fireEvent.click(screen.getByText('Auto-build: disabled'));

    expect(onSetAutoBuildEnabled).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Accessible switch name
// ---------------------------------------------------------------------------

describe('Header auto-build switch — accessible name', () => {
  it('switch is queryable by role with a name matching /auto-build/i', () => {
    renderHeader(makeAutoBuildState({ enabled: true }), vi.fn());

    expect(screen.getByRole('switch', { name: /auto-build/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Enabling auto-build (disabled → enabled) — requires confirmation
// ---------------------------------------------------------------------------

describe('Header auto-build switch — enabling requires confirmation', () => {
  it('clicking the switch when disabled shows the warning dialog before calling the setter', () => {
    const onSetAutoBuildEnabled = vi.fn();
    renderHeader(
      makeAutoBuildState({ enabled: false, mode: 'disabled' }),
      onSetAutoBuildEnabled,
    );

    fireEvent.click(screen.getByRole('switch', { name: /auto-build/i }));

    // Dialog must appear with a warning about queued builds
    expect(screen.getByText(/queued builds may start immediately/i)).toBeTruthy();
    // Setter must NOT be called before the user confirms
    expect(onSetAutoBuildEnabled).not.toHaveBeenCalled();
  });

  it('confirming the dialog calls the setter with true exactly once', () => {
    const onSetAutoBuildEnabled = vi.fn();
    renderHeader(
      makeAutoBuildState({ enabled: false, mode: 'disabled' }),
      onSetAutoBuildEnabled,
    );

    fireEvent.click(screen.getByRole('switch', { name: /auto-build/i }));
    fireEvent.click(screen.getByRole('button', { name: /enable/i }));

    expect(onSetAutoBuildEnabled).toHaveBeenCalledTimes(1);
    expect(onSetAutoBuildEnabled).toHaveBeenCalledWith(true);
  });

  it('canceling the dialog leaves the setter call count at 0', () => {
    const onSetAutoBuildEnabled = vi.fn();
    renderHeader(
      makeAutoBuildState({ enabled: false, mode: 'disabled' }),
      onSetAutoBuildEnabled,
    );

    fireEvent.click(screen.getByRole('switch', { name: /auto-build/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onSetAutoBuildEnabled).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Disabling auto-build (enabled → disabled) — immediate, no confirmation
// ---------------------------------------------------------------------------

describe('Header auto-build switch — disabling is immediate', () => {
  it('clicking the switch when enabled calls the setter with false without showing the dialog', () => {
    const onSetAutoBuildEnabled = vi.fn();
    renderHeader(makeAutoBuildState({ enabled: true, mode: 'running' }), onSetAutoBuildEnabled);

    fireEvent.click(screen.getByRole('switch', { name: /auto-build/i }));

    expect(onSetAutoBuildEnabled).toHaveBeenCalledTimes(1);
    expect(onSetAutoBuildEnabled).toHaveBeenCalledWith(false);
    expect(screen.queryByText(/queued builds may start immediately/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No native label wrapper — status text is not a switch activation target
// ---------------------------------------------------------------------------

describe('Header — no native label wrapping the auto-build control', () => {
  it('source file contains no <label> element around the auto-build status text and switch', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(__dirname, '../header.tsx'), 'utf-8');

    // Strip comment lines before grepping
    const stripped = source
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
      })
      .join('\n');

    // There must be no native <label> wrapping the auto-build area
    expect(stripped).not.toMatch(/<label[^>]*autoBuild/);
    expect(stripped).not.toMatch(/autoBuild[^}]*<label/);
    // More broadly: no <label> element at all in the auto-build section
    expect(stripped).not.toContain('<label');
  });
});
