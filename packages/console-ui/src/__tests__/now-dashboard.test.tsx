import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { API_ROUTES, buildPath } from '@eforge-build/client/browser';
import type { ExtensionEntry } from '@eforge-build/client/browser';
import { NowDashboard } from '@/views/now-dashboard';
import type { UseActiveSessionStreamsResult } from '@/hooks/use-active-session-streams';
import { createInitialRunState } from '@/lib/run-state';
import {
  makeRun,
  makeQueue,
  emptyActiveSessions,
  connectedState,
} from '@/test-support/factories';
import { removeQueueItem, updateQueuePriority } from '@eforge-build/client/browser';

// Mock only the queue-control browser helpers; everything else in the browser
// barrel (types, selectors' transitive imports) keeps its real implementation.
vi.mock('@eforge-build/client/browser', async (importActual) => {
  const actual = await importActual<typeof import('@eforge-build/client/browser')>();
  return {
    ...actual,
    updateQueuePriority: vi.fn(),
    removeQueueItem: vi.fn(),
  };
});

let replaceStateSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
});

afterEach(() => {
  replaceStateSpy.mockRestore();
});

describe('NowDashboard', () => {
  it('renders the core dashboard surfaces for connected project state', () => {
    const state = connectedState({
      queue: [makeQueue()],
      runs: [makeRun({ status: 'completed', completedAt: new Date().toISOString() })],
      recentActivity: [
        {
          id: 'activity-1',
          event: { type: 'session:start', sessionId: 'sess-1' } as never,
          receivedAt: Date.now(),
        },
      ],
    });

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    expect(screen.getByText('Queue')).toBeDefined();
    // The activity log moved to System; the Now rail is glance widgets only.
    expect(screen.getByText('Build health')).toBeDefined();
    expect(screen.queryByText('Open activity log →')).toBeNull();
    expect(screen.getByText('Build history')).toBeDefined();
  });

  it('surfaces failed PRDs in the Needs attention strip with a Recover action, not in the Queue card', () => {
    const state = connectedState({
      queue: [
        makeQueue({ id: 'ok-1', title: 'Pending Build', status: 'pending' }),
        makeQueue({
          id: 'bad-1',
          title: 'Broken Build',
          status: 'failed',
          recoveryVerdict: { verdict: 'retry', confidence: 'high' },
        }),
      ],
    });

    const { container } = render(
      <NowDashboard projectState={state} activeSessions={emptyActiveSessions} />,
    );

    // Failure is elevated to the Needs attention strip with the Recover action.
    expect(screen.getByText('Needs attention')).toBeDefined();
    expect(screen.getByText('Broken Build')).toBeDefined();
    expect(screen.getByRole('button', { name: /recover/i })).toBeDefined();

    // Queue card stays forward-only: the pending item shows there, the failure
    // does not (it lives only in the attention strip).
    const queueCard = container.querySelector('#queue');
    expect(queueCard?.textContent).toContain('Pending Build');
    expect(queueCard?.textContent).not.toContain('Broken Build');
  });

  it('renders dependency-linked queue stacks', () => {
    const state = connectedState({
      queue: [
        makeQueue({ id: 'base', title: 'Base Build', status: 'running' }),
        makeQueue({ id: 'api', title: 'API Build', status: 'waiting', dependsOn: ['base'] }),
        makeQueue({ id: 'handoff', title: 'Handoff Build', status: 'waiting', dependsOn: ['api'] }),
      ],
    });

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    expect(screen.getByText('Build stack')).toBeDefined();
    expect(screen.getAllByText('Base Build').length).toBeGreaterThan(0);
    expect(screen.getAllByText('API Build').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Handoff Build').length).toBeGreaterThan(0);
  });

  it('renders active build navigation for active session streams', () => {
    const onNavigate = vi.fn();
    const state = connectedState({ runs: [makeRun({ sessionId: 'sess-active' })] });
    const activeSessions: UseActiveSessionStreamsResult = {
      sessions: {
        'sess-active': {
          sessionId: 'sess-active',
          connectionStatus: 'connected',
          status: 'running',
          runState: createInitialRunState(),
          lastEventAt: Date.now(),
          error: null,
        },
      },
      activeSessionIds: ['sess-active'],
      subscriptionCount: 1,
    };

    render(
      <NowDashboard
        projectState={state}
        activeSessions={activeSessions}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByTitle('Open build detail'));

    expect(onNavigate).toHaveBeenCalledWith('/console/builds/sess-active');
  });

  it('shows a connection banner when the daemon stream is disconnected', () => {
    const state = connectedState({
      connectionStatus: 'disconnected',
      error: 'ECONNREFUSED',
      lastSnapshotAt: Date.now() - 5_000,
    });

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('Daemon stream disconnected');
    expect(banner.textContent).toContain('ECONNREFUSED');
  });

  it('does not render the stack sync card on Now for a normal (complete) outcome', () => {
    const state = connectedState({
      stackSync: {
        last: {
          id: 'sync-1',
          trigger: 'manual',
          startedAt: new Date(Date.now() - 5000).toISOString(),
          completedAt: new Date(Date.now() - 4000).toISOString(),
          outcome: 'complete',
          dryRun: false,
          restackCandidates: ['feat/x'],
        },
      } as never,
    });

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    // Stack sync status + controls live on System now, not on the Now glance view.
    expect(screen.queryByText('Stack sync')).toBeNull();
    expect(screen.queryByRole('button', { name: /sync.*now/i })).toBeNull();
  });

  describe('queue mutations', () => {
    const priorityMock = vi.mocked(updateQueuePriority);
    const removeMock = vi.mocked(removeQueueItem);

    beforeEach(() => {
      priorityMock.mockReset();
      removeMock.mockReset();
    });

    function pendingState() {
      return connectedState({
        queue: [makeQueue({ id: 'q-pending', title: 'Pending Build', status: 'pending' })],
      });
    }

    it('refreshes the queue only after the priority helper resolves', async () => {
      // Deferred helper: the refresh must not fire while the mutation is still
      // pending — only once the helper promise resolves.
      let resolvePriority!: (value: Awaited<ReturnType<typeof updateQueuePriority>>) => void;
      priorityMock.mockReturnValue(
        new Promise<Awaited<ReturnType<typeof updateQueuePriority>>>((resolve) => {
          resolvePriority = resolve;
        }),
      );
      const refreshQueue = vi.fn().mockResolvedValue(undefined);

      render(
        <NowDashboard
          projectState={pendingState()}
          activeSessions={emptyActiveSessions}
          refreshQueue={refreshQueue}
        />,
      );

      fireEvent.change(screen.getByLabelText('Priority for Pending Build'), {
        target: { value: '3' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Set priority' }));

      await waitFor(() => expect(priorityMock).toHaveBeenCalledWith('q-pending', { priority: 3 }));
      // The mutation has not resolved yet, so no refresh should have happened.
      expect(refreshQueue).not.toHaveBeenCalled();

      resolvePriority({
        id: 'q-pending',
        previousStatus: 'pending',
        currentStatus: 'pending',
        priority: 3,
      });

      await waitFor(() => expect(refreshQueue).toHaveBeenCalledTimes(1));
      // Order: helper resolved before refresh ran.
      expect(priorityMock.mock.invocationCallOrder[0]).toBeLessThan(
        refreshQueue.mock.invocationCallOrder[0],
      );
    });

    it('refreshes the queue only after the remove helper resolves', async () => {
      let resolveRemove!: (value: Awaited<ReturnType<typeof removeQueueItem>>) => void;
      removeMock.mockReturnValue(
        new Promise<Awaited<ReturnType<typeof removeQueueItem>>>((resolve) => {
          resolveRemove = resolve;
        }),
      );
      const refreshQueue = vi.fn().mockResolvedValue(undefined);

      render(
        <NowDashboard
          projectState={pendingState()}
          activeSessions={emptyActiveSessions}
          refreshQueue={refreshQueue}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      const dialog = screen.getByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

      await waitFor(() => expect(removeMock).toHaveBeenCalledWith('q-pending'));
      expect(refreshQueue).not.toHaveBeenCalled();

      resolveRemove({
        id: 'q-pending',
        previousStatus: 'pending',
        currentStatus: 'removed',
        removedSidecars: [],
      });

      await waitFor(() => expect(refreshQueue).toHaveBeenCalledTimes(1));
      expect(removeMock.mock.invocationCallOrder[0]).toBeLessThan(
        refreshQueue.mock.invocationCallOrder[0],
      );
    });

    it('shows row error text and does not refresh the queue when the priority helper fails', async () => {
      priorityMock.mockRejectedValue(new Error('Queue priority request failed (409): locked'));
      const refreshQueue = vi.fn().mockResolvedValue(undefined);

      render(
        <NowDashboard
          projectState={pendingState()}
          activeSessions={emptyActiveSessions}
          refreshQueue={refreshQueue}
        />,
      );

      fireEvent.change(screen.getByLabelText('Priority for Pending Build'), {
        target: { value: '2' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Set priority' }));

      await screen.findByText(/Queue priority request failed/);
      expect(refreshQueue).not.toHaveBeenCalled();
    });

    it('shows row error text and does not refresh the queue when the remove helper fails', async () => {
      // The remove failure path goes through the AlertDialog confirm flow and must
      // keep the row error visible without refreshing the queue.
      removeMock.mockRejectedValue(new Error('Queue removal request failed (409): locked'));
      const refreshQueue = vi.fn().mockResolvedValue(undefined);

      render(
        <NowDashboard
          projectState={pendingState()}
          activeSessions={emptyActiveSessions}
          refreshQueue={refreshQueue}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      const dialog = screen.getByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

      await waitFor(() => expect(removeMock).toHaveBeenCalledWith('q-pending'));
      await screen.findByText(/Queue removal request failed/);
      expect(refreshQueue).not.toHaveBeenCalled();
    });

    function dependencyState() {
      return connectedState({
        queue: [makeQueue({ id: 'q-blocked', title: 'Blocked Build', status: 'waiting', dependsOn: ['dep-a', 'dep-b'] })],
      });
    }

    it('refreshes the queue only after the dependency override helper resolves', async () => {
      const originalFetch = globalThis.fetch;
      const overridePath = buildPath(API_ROUTES.queueDependencyOverride, { prdId: 'q-blocked' });
      let resolveOverride!: (response: Response) => void;
      const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith(API_ROUTES.extensionList)) {
          return Promise.resolve(jsonResponse(extListBody([])));
        }
        if (url === overridePath && init?.method === 'POST') {
          return new Promise<Response>((resolve) => {
            resolveOverride = resolve;
          });
        }
        return Promise.resolve(jsonResponse({}, false, 500, 'Error'));
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
      const refreshQueue = vi.fn().mockResolvedValue(undefined);

      try {
        render(
          <NowDashboard
            projectState={dependencyState()}
            activeSessions={emptyActiveSessions}
            refreshQueue={refreshQueue}
          />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Override dependency' }));
        const dialog = screen.getByRole('alertdialog');
        fireEvent.change(within(dialog).getByLabelText('Dependency to override for Blocked Build'), {
          target: { value: 'dep-b' },
        });
        fireEvent.change(within(dialog).getByLabelText('Reason for overriding Blocked Build'), {
          target: { value: 'manual override' },
        });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Override dependency' }));

        await waitFor(() => {
          const post = fetchMock.mock.calls.find(
            ([url, init]) => url === overridePath && init?.method === 'POST',
          );
          expect(post).toBeDefined();
          expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
            dependencyId: 'dep-b',
            reason: 'manual override',
          });
        });
        expect(refreshQueue).not.toHaveBeenCalled();

        resolveOverride(jsonResponse({
          id: 'q-blocked',
          previousStatus: 'waiting',
          currentStatus: 'pending',
          removedDependency: 'dep-b',
          previousDependsOn: ['dep-a', 'dep-b'],
          currentDependsOn: ['dep-a'],
          movedToQueueRoot: false,
        }));

        await waitFor(() => expect(refreshQueue).toHaveBeenCalledTimes(1));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('shows row error text and does not refresh the queue when dependency override fails', async () => {
      const originalFetch = globalThis.fetch;
      const overridePath = buildPath(API_ROUTES.queueDependencyOverride, { prdId: 'q-blocked' });
      globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith(API_ROUTES.extensionList)) {
          return Promise.resolve(jsonResponse(extListBody([])));
        }
        if (url === overridePath && init?.method === 'POST') {
          return Promise.resolve({ ok: false, status: 409, text: () => Promise.resolve('dependency locked') } as Response);
        }
        return Promise.resolve(jsonResponse({}, false, 500, 'Error'));
      }) as typeof globalThis.fetch;
      const refreshQueue = vi.fn().mockResolvedValue(undefined);

      try {
        render(
          <NowDashboard
            projectState={dependencyState()}
            activeSessions={emptyActiveSessions}
            refreshQueue={refreshQueue}
          />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Override dependency' }));
        const dialog = screen.getByRole('alertdialog');
        fireEvent.change(within(dialog).getByLabelText('Dependency to override for Blocked Build'), {
          target: { value: 'dep-a' },
        });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Override dependency' }));

        await screen.findByText(/Queue dependency override request failed \(409\): dependency locked/);
        expect(refreshQueue).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it('escalates a conflict stack sync into the Now alert strip with a retry control', () => {
    const state = connectedState({
      stackSync: {
        last: {
          id: 'sync-2',
          trigger: 'after-build',
          startedAt: new Date(Date.now() - 5000).toISOString(),
          completedAt: new Date(Date.now() - 4000).toISOString(),
          outcome: 'conflict',
          dryRun: false,
          reason: 'restack conflict on feat/x',
          restackCandidates: ['feat/x'],
        },
      } as never,
    });

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    expect(screen.getByText('Stack sync conflict')).toBeDefined();
    expect(screen.getByText('restack conflict on feat/x')).toBeDefined();
    expect(screen.getByRole('button', { name: /retry/i })).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Extension trust attention (REST-backed)
// ---------------------------------------------------------------------------

function makeExt(overrides: Partial<ExtensionEntry> = {}): ExtensionEntry {
  return {
    name: 'alpha',
    path: '/repo/eforge/extensions/alpha.ts',
    scope: 'project-team',
    source: 'project-team',
    status: 'loaded',
    shadows: [],
    registrations: {
      eventHooks: 0, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0,
      reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0, actions: 0,
      consoleContributions: 0, integrationCommands: 0, deepLinks: 0,
    },
    diagnostics: [],
    ...overrides,
  };
}

function extListBody(extensions: ExtensionEntry[]) {
  return {
    extensions,
    diagnostics: [],
    totals: {
      eventHooks: 0, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0,
      reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0, actions: 0,
      consoleContributions: 0, integrationCommands: 0, deepLinks: 0,
    },
  };
}

function jsonResponse(body: unknown, ok = true, status = 200, statusText = 'OK') {
  return { ok, status, statusText, json: () => Promise.resolve(body) } as unknown as Response;
}

/** Open the trust confirmation dialog from the strip control and confirm it. */
async function confirmTrust(name: string = 'Trust'): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name }));
  const dialog = screen.getByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name }));
}

describe('NowDashboard — extension trust attention', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('surfaces an untrusted project-team extension as a warning in Needs attention', async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith(API_ROUTES.extensionList)) {
        return Promise.resolve(jsonResponse(extListBody([makeExt({ trustState: 'untrusted' })])));
      }
      return Promise.resolve(jsonResponse({}, false, 500, "Error"));
    }) as typeof globalThis.fetch;

    render(<NowDashboard projectState={connectedState()} activeSessions={emptyActiveSessions} />);

    await waitFor(() => expect(screen.getByText('Untrusted extension: alpha')).toBeDefined());
    expect(screen.getByRole('button', { name: 'Trust' })).toBeDefined();
  });

  it('POSTs to the trust route with the extension path and trustedBy console-ui', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith(API_ROUTES.extensionTrust) && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ extension: makeExt({ trustState: 'trusted' }), message: 'Trusted alpha.' }));
      }
      if (url.startsWith(API_ROUTES.extensionList)) {
        return Promise.resolve(jsonResponse(extListBody([makeExt({ trustState: 'untrusted' })])));
      }
      return Promise.resolve(jsonResponse({}, false, 500, "Error"));
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    render(<NowDashboard projectState={connectedState()} activeSessions={emptyActiveSessions} />);

    await confirmTrust();

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) =>
          typeof url === 'string' && url.startsWith(API_ROUTES.extensionTrust) && init?.method === 'POST',
      );
      expect(post).toBeDefined();
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body).toEqual({ path: '/repo/eforge/extensions/alpha.ts', trustedBy: 'console-ui' });
    });
  });

  it('drops the trust warning after a successful trust and refreshed trusted state', async () => {
    let current: ExtensionEntry[] = [makeExt({ trustState: 'untrusted' })];
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith(API_ROUTES.extensionTrust) && init?.method === 'POST') {
        current = [makeExt({ trustState: 'trusted' })];
        return Promise.resolve(jsonResponse({ extension: makeExt({ trustState: 'trusted' }), message: 'Trusted alpha.' }));
      }
      if (url.startsWith(API_ROUTES.extensionList)) {
        return Promise.resolve(jsonResponse(extListBody(current)));
      }
      return Promise.resolve(jsonResponse({}, false, 500, "Error"));
    }) as typeof globalThis.fetch;

    render(<NowDashboard projectState={connectedState()} activeSessions={emptyActiveSessions} />);

    await confirmTrust();

    await waitFor(() => expect(screen.queryByText('Untrusted extension: alpha')).toBeNull());
  });

  it('keeps the warning and shows the daemon error after a failed trust POST', async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith(API_ROUTES.extensionTrust) && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ error: 'Daemon refused trust' }, false, 409, 'Conflict'));
      }
      if (url.startsWith(API_ROUTES.extensionList)) {
        return Promise.resolve(jsonResponse(extListBody([makeExt({ trustState: 'untrusted' })])));
      }
      return Promise.resolve(jsonResponse({}, false, 500, "Error"));
    }) as typeof globalThis.fetch;

    render(<NowDashboard projectState={connectedState()} activeSessions={emptyActiveSessions} />);

    await confirmTrust();

    await waitFor(() => {
      const alerts = screen.getAllByRole('alert').map((el) => el.textContent);
      expect(alerts.some((t) => t?.includes('Daemon refused trust'))).toBe(true);
    });
    expect(screen.getByText('Untrusted extension: alpha')).toBeDefined();
  });
});
