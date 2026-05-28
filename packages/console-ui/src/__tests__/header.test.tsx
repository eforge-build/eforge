import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ConsoleShell } from '@/components/shell/console-shell';
import { initialConsoleProjectState } from '@/lib/project-state';
import { EFORGE_LOGO_URL } from '@/lib/brand';

const FIXED_NOW = new Date('2025-01-15T12:00:30.000Z').getTime();

const stubState = {
  ...initialConsoleProjectState,
  connectionStatus: 'connected' as const,
  runs: [
    {
      id: 'r1',
      command: 'build',
      status: 'completed',
      startedAt: '2025-01-15T10:00:00Z',
      completedAt: '2025-01-15T11:00:00Z',
      cwd: '/home/user/my-project',
      planSet: 'test-plan',
    },
  ],
  lastSnapshotAt: FIXED_NOW - 30_000,
  latestHeartbeat: {
    at: FIXED_NOW - 10_000,
    payload: {
      queueDepth: 3,
      runningBuilds: 2,
      uptime: 60_000,
      autoBuild: { enabled: true, paused: false },
      subscribers: 1,
    },
  },
};

describe('header content in ConsoleShell', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a <header> element as first child of the shell root', () => {
    const { container } = render(
      <ConsoleShell projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    const shellRoot = container.firstElementChild;
    const firstChild = shellRoot?.firstElementChild;
    expect(firstChild?.tagName.toLowerCase()).toBe('header');
  });

  it('header contains the eforge logo image with correct src', () => {
    const { container } = render(
      <ConsoleShell projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    const header = container.querySelector('header');
    const img = header?.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.src).toBe(EFORGE_LOGO_URL);
    expect(img!.alt).toBeTruthy();
  });

  it('header contains project repo basename', () => {
    const { container } = render(
      <ConsoleShell projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    const header = container.querySelector('header');
    expect(header?.textContent).toContain('my-project');
  });

  it('header contains connection-status indicator', () => {
    const { getByLabelText } = render(
      <ConsoleShell projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    const indicator = getByLabelText(/connection status/i);
    expect(indicator).toBeDefined();
  });

  it('header contains auto-build toggle switch', () => {
    const { getByRole } = render(
      <ConsoleShell projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    const toggle = getByRole('switch', { name: /auto-build toggle/i });
    expect(toggle).toBeDefined();
  });

  it('header contains queue-count chip', () => {
    const { getByLabelText } = render(
      <ConsoleShell projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    const queueChip = getByLabelText(/queue count/i);
    expect(queueChip).toBeDefined();
  });

  it('header contains active-count chip', () => {
    const { getByLabelText } = render(
      <ConsoleShell projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    const activeChip = getByLabelText(/active builds count/i);
    expect(activeChip).toBeDefined();
  });

  it('header contains last-update timestamp', () => {
    const { getByLabelText } = render(
      <ConsoleShell projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    const timestamp = getByLabelText(/last update/i);
    expect(timestamp).toBeDefined();
  });

  it('does not render the legacy sidebar aside element', () => {
    const { queryByRole } = render(
      <ConsoleShell projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    expect(queryByRole('complementary', { name: /console navigation/i })).toBeNull();
  });

  it('does not render the legacy bottom status strip', () => {
    const { queryByLabelText } = render(
      <ConsoleShell projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    expect(queryByLabelText('connection and daemon status')).toBeNull();
  });

  it('renders a Plans navigation button in the header', () => {
    const { getByRole } = render(
      <ConsoleShell projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    const plansButton = getByRole('button', { name: /^plans$/i });
    expect(plansButton).toBeDefined();
  });

  it('clicking the Plans button calls onNavigate with /console/plans', () => {
    const onNavigate = vi.fn();
    const { getByRole } = render(
      <ConsoleShell projectState={stubState} onNavigate={onNavigate}>
        <div>content</div>
      </ConsoleShell>,
    );
    fireEvent.click(getByRole('button', { name: /^plans$/i }));
    expect(onNavigate).toHaveBeenCalledWith('/console/plans');
  });

  it('clicking the Plans button does not cause a page reload (uses onNavigate, not href)', () => {
    const onNavigate = vi.fn();
    const { getByRole } = render(
      <ConsoleShell projectState={stubState} onNavigate={onNavigate}>
        <div>content</div>
      </ConsoleShell>,
    );
    const plansButton = getByRole('button', { name: /^plans$/i });
    // Plans link is a button, not an anchor — no href-based navigation
    expect(plansButton.tagName.toLowerCase()).toBe('button');
    expect(plansButton.getAttribute('href')).toBeNull();
  });
});
