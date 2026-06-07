import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SystemViewContent } from '../system-view-content';
import type { SystemSurfacesState } from '../system-types';
import { initialConsoleProjectState } from '@/lib/project-state';
import type { ConsoleProjectState } from '@/lib/project-state';

function success<T>(data: T) {
  return { status: 'success' as const, data, updatedAt: 1 };
}

function empty<T>(data?: T) {
  return { status: 'empty' as const, data, updatedAt: 1 };
}

function makeState(overrides: Partial<SystemSurfacesState> = {}): SystemSurfacesState {
  const state: SystemSurfacesState = {
    daemon: {
      health: success({ status: 'ok', pid: 42 }),
      version: success({ version: 17, eforgeVersion: '1.0.0' }),
      projectContext: success({ cwd: '/home/user/my-project', gitRemote: 'git@example.com:repo.git' }),
    },
    config: {
      show: success({
        resolved: { concurrency: 2 },
        sources: {
          local: { path: '/project/.eforge/config.yaml', found: true },
          user: { path: '/home/user/.config/eforge/config.yaml', found: false },
        },
      }),
      validate: success({ configFound: true, valid: true }),
    },
    profiles: {
      list: success({
        profiles: [
          { name: 'local-profile', harness: 'claude-sdk', path: '/profiles/local-profile.yaml', scope: 'local' },
        ],
        active: 'local-profile',
        source: 'local',
      }),
      active: success({
        active: 'local-profile',
        source: 'local',
        resolved: { harness: 'claude-sdk', profile: { effort: 'high' }, scope: 'local' },
      }),
    },
    extensions: {
      list: empty({
        extensions: [],
        diagnostics: [],
        totals: emptyTotals(),
      }),
      validate: success({ valid: true, extensions: [], diagnostics: [] }),
      contributions: empty(emptyManifest()),
    },
    playbooks: {
      list: empty({ playbooks: [], warnings: [] }),
    },
    models: {
      catalogs: {
        pi: {
          providers: empty({ providers: [] }),
          models: empty({ models: [] }),
        },
        'claude-sdk': {
          providers: success({ providers: ['anthropic'] }),
          models: success({
            models: [
              { id: 'claude-3-5-sonnet-20241022', provider: 'anthropic', contextWindow: 200000 },
            ],
          }),
        },
      },
    },
  };

  return {
    ...state,
    ...overrides,
    daemon: { ...state.daemon, ...overrides.daemon },
    config: { ...state.config, ...overrides.config },
    profiles: { ...state.profiles, ...overrides.profiles },
    extensions: { ...state.extensions, ...overrides.extensions },
    playbooks: { ...state.playbooks, ...overrides.playbooks },
    models: { ...state.models, ...overrides.models },
  };
}

function emptyManifest() {
  return {
    schemaVersion: 1 as const,
    generatedAt: '2026-01-01T00:00:00.000Z',
    actions: [],
    consoleContributions: [],
    consoleWorkstations: [],
    integrationCommands: [],
    deepLinks: [],
    diagnostics: [],
  };
}

function manifestWithContribution() {
  return {
    ...emptyManifest(),
    consoleContributions: [{
      id: 'demo.panel',
      localId: 'panel',
      extensionName: 'demo',
      extensionPath: '/demo.js',
      title: 'Demo contribution',
      schemaVersion: 1 as const,
      blocks: [{ rendererId: 'text' as const, content: 'Contribution body' }],
    }],
  };
}

function emptyTotals() {
  return { eventHooks: 0, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0, reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0, actions: 0, consoleContributions: 0, consoleWorkstations: 0, integrationCommands: 0, deepLinks: 0 };
}

function makeProjectStateWithTelemetry(): ConsoleProjectState {
  return {
    ...initialConsoleProjectState,
    connectionStatus: 'connected',
    latestHeartbeat: {
      at: Date.now(),
      payload: {
        uptime: 65_000,
        queueDepth: 3,
        runningBuilds: 1,
        autoBuild: {
          enabled: true,
          paused: false,
          scheduler: { alive: true, paused: false, runningCount: 1, limit: 5 },
        },
        subscribers: 4,
      },
    },
  };
}

describe('SystemViewContent', () => {
  it('renders the system page with representative daemon, config, profile, and model data', () => {
    render(<SystemViewContent state={makeState()} onRefresh={() => {}} />);

    expect(screen.getByRole('heading', { name: /system configuration/i })).toBeDefined();
    expect(screen.getByText('/home/user/my-project')).toBeDefined();
    expect(screen.getAllByText('local-profile').length).toBeGreaterThan(0);
    expect(screen.getByText('17')).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Session Plans' })).toBeNull();
  });

  it('calls onRefresh from the single refresh control', () => {
    const onRefresh = vi.fn();
    render(<SystemViewContent state={makeState()} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole('button', { name: /refresh system data/i }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders extension contributions immediately after the Extensions section', () => {
    const state = makeState();
    state.extensions.contributions = success(manifestWithContribution());
    render(<SystemViewContent state={state} onRefresh={() => {}} />);

    const extensionsHeading = screen.getByRole('heading', { name: 'Extensions' });
    const contributionsHeading = screen.getByRole('heading', { name: 'Extension Console contributions' });
    expect(extensionsHeading.compareDocumentPosition(contributionsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Demo contribution')).toBeDefined();
    expect(screen.getByText('Contribution body')).toBeDefined();
  });

  it('renders stale contribution data alongside manifest refresh errors', () => {
    const state = makeState();
    state.extensions.contributions = { status: 'error', error: 'manifest refresh failed', data: manifestWithContribution() };
    render(<SystemViewContent state={state} onRefresh={() => {}} />);

    expect(screen.getByRole('alert').textContent).toContain('manifest refresh failed');
    expect(screen.getByText('Demo contribution')).toBeDefined();
  });

  it('shows section errors without blanking successful sections', () => {
    const state = makeState({
      profiles: {
        list: { status: 'error', error: 'HTTP 500 fetching profiles' },
        active: success({ active: null, source: 'none', resolved: { harness: undefined, profile: null } }),
      },
    });

    render(<SystemViewContent state={state} onRefresh={() => {}} />);

    expect(screen.getByText(/HTTP 500 fetching profiles/)).toBeDefined();
    expect(screen.getByText('/home/user/my-project')).toBeDefined();
  });

  it('opens the activity drawer from the header control', () => {
    render(
      <SystemViewContent
        state={makeState()}
        projectState={makeProjectStateWithTelemetry()}
        onRefresh={() => {}}
      />,
    );

    // Drawer is closed until the header control is clicked.
    expect(screen.queryByText('Activity')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /open activity log/i }));

    expect(screen.getByText('Activity')).toBeDefined();
  });

  it('renders live daemon telemetry when project state is provided', () => {
    render(
      <SystemViewContent
        state={makeState()}
        projectState={makeProjectStateWithTelemetry()}
        onRefresh={() => {}}
      />,
    );

    expect(screen.getByText('Subscribers')).toBeDefined();
    expect(screen.getByText('4')).toBeDefined();
    expect(screen.getByText('Uptime')).toBeDefined();
    expect(screen.getByText('1m 5s')).toBeDefined();
    expect(screen.getByText('Scheduler limit')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
  });
});
