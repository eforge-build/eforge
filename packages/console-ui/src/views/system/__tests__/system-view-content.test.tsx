import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SystemViewContent } from '../system-view-content';
import { SystemConfigurationView } from '../system-configuration-view';
import type { SystemSurfacesState } from '../system-types';
import { initialConsoleProjectState } from '@/lib/project-state';
import type { ConsoleProjectState } from '@/lib/project-state';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeLoadedState(): SystemSurfacesState {
  return {
    daemon: {
      health: { status: 'success', data: { status: 'ok', pid: 42 }, updatedAt: 1 },
      version: { status: 'success', data: { version: 17, eforgeVersion: '1.0.0 (abc)' }, updatedAt: 1 },
      projectContext: { status: 'success', data: { cwd: '/home/user/my-project', gitRemote: 'git@github.com:foo/bar.git' }, updatedAt: 1 },
    },
    config: {
      show: {
        status: 'success',
        data: {
          resolved: { concurrency: 2 },
          sources: {
            local: { path: '/my-project/.eforge/config.yaml', found: true },
            user: { path: '/home/user/.config/eforge/config.yaml', found: false },
          },
        },
        updatedAt: 1,
      },
      validate: { status: 'success', data: { configFound: true, valid: true }, updatedAt: 1 },
    },
    profiles: {
      list: {
        status: 'success',
        data: {
          profiles: [
            { name: 'my-profile', harness: 'claude-sdk', path: '/profiles/my-profile.yaml', scope: 'local' },
          ],
          active: 'my-profile',
          source: 'local',
        },
        updatedAt: 1,
      },
      active: {
        status: 'success',
        data: {
          active: 'my-profile',
          source: 'local',
          resolved: { harness: 'claude-sdk', profile: { effort: 'high' }, scope: 'local' },
        },
        updatedAt: 1,
      },
    },
    extensions: {
      list: {
        status: 'success',
        data: {
          extensions: [
            {
              name: 'my-extension',
              path: '/extensions/my-extension.ts',
              scope: 'project-local',
              source: 'auto',
              status: 'loaded',
              shadows: [],
              registrations: { eventHooks: 1, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0, reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0 },
              diagnostics: [],
            },
          ],
          diagnostics: [],
          totals: { eventHooks: 1, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0, reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0 },
        },
        updatedAt: 1,
      },
      validate: { status: 'success', data: { valid: true, extensions: [], diagnostics: [] }, updatedAt: 1 },
    },
    playbooks: {
      list: {
        status: 'success',
        data: {
          playbooks: [
            {
              name: 'my-playbook',
              description: 'A test playbook',
              scope: 'project-local',
              mode: 'autonomous',
              source: 'project-local',
              shadows: [],
              path: '/playbooks/my-playbook.md',
            },
          ],
          warnings: [],
        },
        updatedAt: 1,
      },
    },
    sessionPlans: {
      list: {
        status: 'success',
        data: {
          plans: [
            {
              session: 'sess-abc',
              topic: 'Add new feature',
              status: 'planning',
              path: '/session-plans/sess-abc.md',
              ready: false,
              missingDimensions: ['acceptance_criteria'],
            },
          ],
        },
        updatedAt: 1,
      },
    },
    models: {
      catalogs: {
        pi: {
          providers: { status: 'success', data: { providers: ['anthropic'] }, updatedAt: 1 },
          models: {
            status: 'success',
            data: {
              models: [
                { id: 'claude-3-5-sonnet-pi', provider: 'anthropic', contextWindow: 200000 },
              ],
            },
            updatedAt: 1,
          },
        },
        'claude-sdk': {
          providers: { status: 'success', data: { providers: ['anthropic'] }, updatedAt: 1 },
          models: {
            status: 'success',
            data: {
              models: [
                { id: 'claude-3-5-sonnet-20241022', provider: 'anthropic', contextWindow: 200000 },
              ],
            },
            updatedAt: 1,
          },
        },
      },
    },
  };
}

function makeEmptyState(): SystemSurfacesState {
  return {
    daemon: {
      health: { status: 'success', data: { status: 'ok', pid: 1 }, updatedAt: 1 },
      version: { status: 'success', data: { version: 1 }, updatedAt: 1 },
      projectContext: { status: 'success', data: { cwd: '/project', gitRemote: null }, updatedAt: 1 },
    },
    config: {
      show: { status: 'success', data: {}, updatedAt: 1 },
      validate: { status: 'success', data: { configFound: false, valid: false }, updatedAt: 1 },
    },
    profiles: {
      list: { status: 'empty', data: { profiles: [], active: null, source: 'none' }, updatedAt: 1 },
      active: { status: 'success', data: { active: null, source: 'none', resolved: { harness: undefined, profile: null } }, updatedAt: 1 },
    },
    extensions: {
      list: { status: 'empty', data: { extensions: [], diagnostics: [], totals: { eventHooks: 0, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0, reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0 } }, updatedAt: 1 },
      validate: { status: 'success', data: { valid: true, extensions: [], diagnostics: [] }, updatedAt: 1 },
    },
    playbooks: {
      list: { status: 'empty', data: { playbooks: [], warnings: [] }, updatedAt: 1 },
    },
    sessionPlans: {
      list: { status: 'empty', data: { plans: [] }, updatedAt: 1 },
    },
    models: {
      catalogs: {
        pi: {
          providers: { status: 'empty', data: { providers: [] }, updatedAt: 1 },
          models: { status: 'empty', data: { models: [] }, updatedAt: 1 },
        },
        'claude-sdk': {
          providers: { status: 'empty', data: { providers: [] }, updatedAt: 1 },
          models: { status: 'empty', data: { models: [] }, updatedAt: 1 },
        },
      },
    },
  };
}

function makeLoadingState(): SystemSurfacesState {
  return {
    daemon: {
      health: { status: 'loading' },
      version: { status: 'loading' },
      projectContext: { status: 'loading' },
    },
    config: {
      show: { status: 'loading' },
      validate: { status: 'loading' },
    },
    profiles: {
      list: { status: 'loading' },
      active: { status: 'loading' },
    },
    extensions: {
      list: { status: 'loading' },
      validate: { status: 'loading' },
    },
    playbooks: {
      list: { status: 'loading' },
    },
    sessionPlans: {
      list: { status: 'loading' },
    },
    models: {
      catalogs: {
        pi: { providers: { status: 'loading' }, models: { status: 'loading' } },
        'claude-sdk': { providers: { status: 'loading' }, models: { status: 'loading' } },
      },
    },
  };
}

function makeErrorState(): SystemSurfacesState {
  return {
    ...makeLoadedState(),
    profiles: {
      list: { status: 'error', error: 'HTTP 500 Internal Server Error fetching /api/profile/list' },
      active: { status: 'success', data: { active: 'ok-profile', source: 'local', resolved: { harness: 'claude-sdk', profile: null } }, updatedAt: 1 },
    },
    playbooks: {
      list: { status: 'error', error: 'HTTP 503 Service Unavailable fetching /api/playbook/list' },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SystemViewContent', () => {
  it('renders all section headings in loaded state', () => {
    const { getByText } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(getByText('Daemon')).toBeDefined();
    expect(getByText('Config')).toBeDefined();
    expect(getByText('Profiles')).toBeDefined();
    expect(getByText('Extensions')).toBeDefined();
    expect(getByText('Playbooks')).toBeDefined();
    expect(getByText('Session Plans')).toBeDefined();
    expect(getByText('Models')).toBeDefined();
  });

  it('renders project cwd from daemon section', () => {
    const { getByText } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(getByText('/home/user/my-project')).toBeDefined();
  });

  it('renders daemon API version', () => {
    const { getByText } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(getByText('17')).toBeDefined();
  });

  it('renders active profile name', () => {
    const { getAllByText } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    const matches = getAllByText('my-profile');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders extension name', () => {
    const { getByText } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(getByText('my-extension')).toBeDefined();
  });

  it('renders playbook name', () => {
    const { getByText } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(getByText('my-playbook')).toBeDefined();
  });

  it('renders session-plan topic', () => {
    const { getByText } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(getByText('Add new feature')).toBeDefined();
  });

  it('renders model id', () => {
    const { getByText } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(getByText('claude-3-5-sonnet-20241022')).toBeDefined();
  });

  it('renders empty state messages for all empty sections', () => {
    const { getByText } = render(
      <SystemViewContent state={makeEmptyState()} onRefresh={() => {}} />,
    );
    expect(getByText('No profiles discovered')).toBeDefined();
    expect(getByText('No extensions discovered')).toBeDefined();
    expect(getByText('No playbooks discovered')).toBeDefined();
    expect(getByText('No session plans discovered')).toBeDefined();
    expect(getByText('No config file found')).toBeDefined();
  });

  it('renders per-harness model empty text', () => {
    const { getAllByText } = render(
      <SystemViewContent state={makeEmptyState()} onRefresh={() => {}} />,
    );
    // Both harnesses should show "No providers reported" and "No models reported"
    const noProviders = getAllByText('No providers reported');
    expect(noProviders.length).toBeGreaterThanOrEqual(1);
    const noModels = getAllByText('No models reported');
    expect(noModels.length).toBeGreaterThanOrEqual(1);
  });

  it('renders loading text when sections are in loading state', () => {
    const { getAllByText } = render(
      <SystemViewContent state={makeLoadingState()} onRefresh={() => {}} />,
    );
    // Should show loading text in sections
    const loadingTexts = getAllByText(/loading/i);
    expect(loadingTexts.length).toBeGreaterThan(0);
  });

  it('renders error section error messages while success sections remain visible', () => {
    const { getByText, queryByText } = render(
      <SystemViewContent state={makeErrorState()} onRefresh={() => {}} />,
    );
    // The profiles error should appear
    expect(getByText(/HTTP 500/)).toBeDefined();
    // The playbooks error should appear
    expect(getByText(/HTTP 503/)).toBeDefined();
    // But daemon section data should still be visible
    expect(getByText('/home/user/my-project')).toBeDefined();
    // Extensions should still be visible
    expect(getByText('my-extension')).toBeDefined();
    // Session plans should still be visible
    expect(queryByText('sess-abc')).toBeDefined();
  });

  it('renders exactly one Refresh system data button', () => {
    const { getAllByRole } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    const refreshButtons = getAllByRole('button', { name: /refresh system data/i });
    expect(refreshButtons).toHaveLength(1);
  });

  it('renders no Use profile mutation control', () => {
    const { queryByRole } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(queryByRole('button', { name: /use profile/i })).toBeNull();
    expect(queryByRole('link', { name: /use profile/i })).toBeNull();
  });

  it('renders no Create profile mutation control', () => {
    const { queryByRole } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(queryByRole('button', { name: /create profile/i })).toBeNull();
    expect(queryByRole('link', { name: /create profile/i })).toBeNull();
  });

  it('renders no Delete profile mutation control', () => {
    const { queryByRole } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(queryByRole('button', { name: /delete profile/i })).toBeNull();
    expect(queryByRole('link', { name: /delete profile/i })).toBeNull();
  });

  it('renders no Run playbook mutation control', () => {
    const { queryByRole } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(queryByRole('button', { name: /run playbook/i })).toBeNull();
    expect(queryByRole('link', { name: /run playbook/i })).toBeNull();
  });

  it('renders no Promote mutation control', () => {
    const { queryByRole } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(queryByRole('button', { name: /^promote$/i })).toBeNull();
    expect(queryByRole('link', { name: /^promote$/i })).toBeNull();
  });

  it('renders no Demote mutation control', () => {
    const { queryByRole } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(queryByRole('button', { name: /^demote$/i })).toBeNull();
    expect(queryByRole('link', { name: /^demote$/i })).toBeNull();
  });

  it('renders no Trust mutation control', () => {
    const { queryByRole } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(queryByRole('button', { name: /^trust$/i })).toBeNull();
    expect(queryByRole('link', { name: /^trust$/i })).toBeNull();
  });

  it('renders no Untrust mutation control', () => {
    const { queryByRole } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(queryByRole('button', { name: /^untrust$/i })).toBeNull();
    expect(queryByRole('link', { name: /^untrust$/i })).toBeNull();
  });

  it('renders no Install mutation control', () => {
    const { queryByRole } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(queryByRole('button', { name: /^install$/i })).toBeNull();
    expect(queryByRole('link', { name: /^install$/i })).toBeNull();
  });

  it('renders no Remove mutation control', () => {
    const { queryByRole } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(queryByRole('button', { name: /^remove$/i })).toBeNull();
    expect(queryByRole('link', { name: /^remove$/i })).toBeNull();
  });

  it('renders no Reload mutation control', () => {
    const { queryByRole } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(queryByRole('button', { name: /^reload$/i })).toBeNull();
    expect(queryByRole('link', { name: /^reload$/i })).toBeNull();
  });

  it('renders no Save mutation control', () => {
    const { queryByRole } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(queryByRole('button', { name: /^save$/i })).toBeNull();
    expect(queryByRole('link', { name: /^save$/i })).toBeNull();
  });

  it('renders no Validate raw mutation control', () => {
    const { queryByRole } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(queryByRole('button', { name: /validate raw/i })).toBeNull();
    expect(queryByRole('link', { name: /validate raw/i })).toBeNull();
  });

  it('renders no Sync stack mutation control', () => {
    const { queryByRole } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(queryByRole('button', { name: /sync stack/i })).toBeNull();
    expect(queryByRole('link', { name: /sync stack/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Daemon telemetry rows from project state
// ---------------------------------------------------------------------------

describe('SystemViewContent – daemon telemetry from project state', () => {
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

  it('renders Subscribers row when project state has subscriber count', () => {
    const { getByText } = render(
      <SystemViewContent
        state={makeLoadedState()}
        projectState={makeProjectStateWithTelemetry()}
        onRefresh={() => {}}
      />,
    );
    expect(getByText('Subscribers')).toBeDefined();
    expect(getByText('4')).toBeDefined();
  });

  it('renders Uptime row when project state has uptime', () => {
    const { getByText } = render(
      <SystemViewContent
        state={makeLoadedState()}
        projectState={makeProjectStateWithTelemetry()}
        onRefresh={() => {}}
      />,
    );
    expect(getByText('Uptime')).toBeDefined();
    // 65000ms = 1m 5s
    expect(getByText('1m 5s')).toBeDefined();
  });

  it('renders Scheduler limit row when project state has scheduler limit', () => {
    const { getByText } = render(
      <SystemViewContent
        state={makeLoadedState()}
        projectState={makeProjectStateWithTelemetry()}
        onRefresh={() => {}}
      />,
    );
    expect(getByText('Scheduler limit')).toBeDefined();
    expect(getByText('5')).toBeDefined();
  });

  it('does not render telemetry rows when project state is absent', () => {
    const { queryByText } = render(
      <SystemViewContent state={makeLoadedState()} onRefresh={() => {}} />,
    );
    expect(queryByText('Subscribers')).toBeNull();
    expect(queryByText('Uptime')).toBeNull();
    expect(queryByText('Scheduler limit')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SystemConfigurationView — route wrapper passes projectState into content
// ---------------------------------------------------------------------------

vi.mock('../use-system-surfaces', () => ({
  useSystemSurfaces: vi.fn(() => ({
    state: {
      daemon: {
        health: { status: 'success', data: { status: 'ok', pid: 1 }, updatedAt: 1 },
        version: { status: 'success', data: { version: 1, eforgeVersion: '1.0.0' }, updatedAt: 1 },
        projectContext: { status: 'success', data: { cwd: '/project', gitRemote: null }, updatedAt: 1 },
      },
      config: {
        show: {
          status: 'success',
          data: {
            resolved: { concurrency: 2 },
            sources: {
              local: { path: '/project/.eforge/config.yaml', found: true },
              user: { path: '/home/user/.config/eforge/config.yaml', found: false },
            },
          },
          updatedAt: 1,
        },
        validate: { status: 'success', data: { configFound: true, valid: true }, updatedAt: 1 },
      },
      profiles: {
        list: {
          status: 'empty',
          data: { profiles: [], active: null, source: 'none' },
          updatedAt: 1,
        },
        active: {
          status: 'success',
          data: { active: null, source: 'none', resolved: { harness: undefined, profile: null } },
          updatedAt: 1,
        },
      },
      extensions: {
        list: { status: 'empty', data: { extensions: [], diagnostics: [], totals: { eventHooks: 0, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0, reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0 } }, updatedAt: 1 },
        validate: { status: 'success', data: { valid: true, extensions: [], diagnostics: [] }, updatedAt: 1 },
      },
      playbooks: {
        list: { status: 'empty', data: { playbooks: [], warnings: [] }, updatedAt: 1 },
      },
      sessionPlans: {
        list: { status: 'empty', data: { plans: [] }, updatedAt: 1 },
      },
      models: {
        catalogs: {
          pi: {
            providers: { status: 'success', data: { providers: ['anthropic'] }, updatedAt: 1 },
            models: { status: 'success', data: { models: [] }, updatedAt: 1 },
          },
          'claude-sdk': {
            providers: { status: 'success', data: { providers: ['anthropic'] }, updatedAt: 1 },
            models: { status: 'success', data: { models: [] }, updatedAt: 1 },
          },
        },
      },
    } as SystemSurfacesState,
    refresh: vi.fn(),
  })),
}));

describe('SystemConfigurationView – route wrapper passes projectState into content', () => {
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

  it('renders Subscribers, Uptime, and Scheduler limit from projectState in the Daemon section', () => {
    const { getByText } = render(
      <SystemConfigurationView projectState={makeProjectStateWithTelemetry()} />,
    );
    expect(getByText('Subscribers')).toBeDefined();
    expect(getByText('4')).toBeDefined();
    expect(getByText('Uptime')).toBeDefined();
    expect(getByText('1m 5s')).toBeDefined();
    expect(getByText('Scheduler limit')).toBeDefined();
    expect(getByText('5')).toBeDefined();
  });
});
