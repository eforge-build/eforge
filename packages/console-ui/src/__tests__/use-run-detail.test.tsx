import { describe, it, expect, vi } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { useRunDetail } from '@/hooks/use-run-detail';
import type { FetchJsonFn, RunDetailResult } from '@/hooks/use-run-detail';
import { API_ROUTES, buildPath } from '@eforge-build/client/browser';
import type { RunSummary, RunState, PlansResponse } from '@eforge-build/client/browser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunSummary(): RunSummary {
  return {
    sessionId: 'sess-a',
    status: 'completed',
    runs: [],
    plans: [],
    currentPhase: null,
    currentAgent: null,
    eventCounts: { total: 5, errors: 0 },
    duration: { startedAt: '2024-01-01T10:00:00Z', completedAt: '2024-01-01T11:00:00Z', seconds: 3600 },
  };
}

function makeRunState(): RunState {
  return {
    status: 'completed',
    events: [
      { id: 1, runId: 'r1', type: 'plan:queued', planId: 'p1', agent: undefined, data: '{}', timestamp: '2024-01-01T10:00:00Z' },
    ],
  };
}

function makePlansResponse(): PlansResponse {
  return [
    { id: 'p1', name: 'Plan One', body: 'body text', dependsOn: [], type: 'plan' },
  ];
}

/** Test harness component that renders hook result into a testid div. */
function TestHook({
  initialId,
  fetchFn,
  onResult,
}: {
  initialId: string | null;
  fetchFn: FetchJsonFn;
  onResult: (r: RunDetailResult) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const result = useRunDetail(selectedId, fetchFn);
  onResult(result);
  return (
    <div>
      <div data-testid="summary-status">{result.summary.status}</div>
      <div data-testid="state-status">{result.state.status}</div>
      <div data-testid="plans-status">{result.plans.status}</div>
      <button
        data-testid="change-selection"
        onClick={() => setSelectedId('session-b')}
      >
        change
      </button>
      <button
        data-testid="clear-selection"
        onClick={() => setSelectedId(null)}
      >
        clear
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useRunDetail', () => {
  it('keeps all resources idle when selectedId is null', async () => {
    const fetchFn = vi.fn().mockResolvedValue(null);
    const resultRef: RunDetailResult[] = [];

    render(
      <TestHook
        initialId={null}
        fetchFn={fetchFn as unknown as FetchJsonFn}
        onResult={(r) => resultRef.push(r)}
      />,
    );

    await waitFor(() => {
      const last = resultRef[resultRef.length - 1];
      expect(last.summary.status).toBe('idle');
      expect(last.state.status).toBe('idle');
      expect(last.plans.status).toBe('idle');
    });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('calls fetcher with the correct URLs for the selected id', async () => {
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      if (url.includes('run-summary')) return Promise.resolve(makeRunSummary());
      if (url.includes('run-state')) return Promise.resolve(makeRunState());
      if (url.includes('plans')) return Promise.resolve(makePlansResponse());
      return Promise.resolve(null);
    });

    render(
      <TestHook
        initialId="abc"
        fetchFn={fetchFn as unknown as FetchJsonFn}
        onResult={() => {}}
      />,
    );

    await waitFor(() => {
      const urls = fetchFn.mock.calls.map((c) => c[0] as string);
      expect(urls).toContain(buildPath(API_ROUTES.runSummary, { id: 'abc' }));
      expect(urls).toContain(buildPath(API_ROUTES.runState, { id: 'abc' }));
      expect(urls).toContain(buildPath(API_ROUTES.plans, { runId: 'abc' }));
    });
  });

  it('sets all resources to success when all fetches resolve', async () => {
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      if (url.includes('run-summary')) return Promise.resolve(makeRunSummary());
      if (url.includes('run-state')) return Promise.resolve(makeRunState());
      if (url.includes('plans')) return Promise.resolve(makePlansResponse());
      return Promise.resolve(null);
    });

    const resultRef: RunDetailResult[] = [];

    render(
      <TestHook
        initialId="abc"
        fetchFn={fetchFn as unknown as FetchJsonFn}
        onResult={(r) => resultRef.push(r)}
      />,
    );

    await waitFor(() => {
      const last = resultRef[resultRef.length - 1];
      expect(last.summary.status).toBe('success');
      expect(last.state.status).toBe('success');
      expect(last.plans.status).toBe('success');
    });
  });

  it('records summary success and plans error independently when only plans rejects', async () => {
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      if (url.includes('run-summary')) return Promise.resolve(makeRunSummary());
      if (url.includes('run-state')) return Promise.resolve(makeRunState());
      if (url.includes('plans')) return Promise.reject(new Error('plans failed'));
      return Promise.resolve(null);
    });

    const resultRef: RunDetailResult[] = [];

    render(
      <TestHook
        initialId="abc"
        fetchFn={fetchFn as unknown as FetchJsonFn}
        onResult={(r) => resultRef.push(r)}
      />,
    );

    await waitFor(() => {
      const last = resultRef[resultRef.length - 1];
      expect(last.summary.status).toBe('success');
      expect(last.plans.status).toBe('error');
      if (last.plans.status === 'error') {
        expect(last.plans.error).toContain('plans failed');
      }
    });
  });

  it('records empty status for a fetch that resolves null', async () => {
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      if (url.includes('run-summary')) return Promise.resolve(null);
      if (url.includes('run-state')) return Promise.resolve(makeRunState());
      if (url.includes('plans')) return Promise.resolve(makePlansResponse());
      return Promise.resolve(null);
    });

    const resultRef: RunDetailResult[] = [];

    render(
      <TestHook
        initialId="abc"
        fetchFn={fetchFn as unknown as FetchJsonFn}
        onResult={(r) => resultRef.push(r)}
      />,
    );

    await waitFor(() => {
      const last = resultRef[resultRef.length - 1];
      expect(last.summary.status).toBe('empty');
    });
  });

  it('resets to idle when selection is cleared', async () => {
    const fetchFn = vi.fn().mockResolvedValue(null);
    const resultRef: RunDetailResult[] = [];

    const { getByTestId } = render(
      <TestHook
        initialId="abc"
        fetchFn={fetchFn as unknown as FetchJsonFn}
        onResult={(r) => resultRef.push(r)}
      />,
    );

    // Wait for loading to start
    await waitFor(() => {
      const last = resultRef[resultRef.length - 1];
      // Should be loading or idle or empty since fetch resolves null
      expect(['loading', 'empty', 'idle']).toContain(last.summary.status);
    });

    act(() => {
      getByTestId('clear-selection').click();
    });

    await waitFor(() => {
      const last = resultRef[resultRef.length - 1];
      expect(last.summary.status).toBe('idle');
      expect(last.state.status).toBe('idle');
      expect(last.plans.status).toBe('idle');
    });
  });

  it('ignores a slow response for session-a after selection changes to session-b', async () => {
    // Track resolve callbacks keyed by session id
    const resolvers: Record<string, ((v: unknown) => void)[]> = {};

    const fetchFn = vi.fn().mockImplementation((url: string) => {
      return new Promise((resolve) => {
        const sessionA = url.includes('/abc/') || url.endsWith('/abc') || url.includes('id=abc') || (url.includes('abc') && !url.includes('def'));
        const key = sessionA ? 'abc' : 'def';
        resolvers[key] = resolvers[key] ?? [];
        resolvers[key].push(resolve as (v: unknown) => void);
      });
    });

    const resultRef: RunDetailResult[] = [];

    const { getByTestId } = render(
      <TestHook
        initialId="abc"
        fetchFn={fetchFn as unknown as FetchJsonFn}
        onResult={(r) => resultRef.push(r)}
      />,
    );

    // Change selection to session-b before abc resolves
    act(() => {
      getByTestId('change-selection').click();
    });

    // Resolve all def (session-b) fetches with data identifiable as belonging to session-b
    const defSummary: RunSummary = { ...makeRunSummary(), sessionId: 'result-for-def' };
    await act(async () => {
      for (const resolve of (resolvers['def'] ?? [])) {
        resolve(defSummary);
      }
    });

    // Wait for session-b data to be reflected in the hook
    await waitFor(() => {
      const last = resultRef[resultRef.length - 1];
      expect(last.summary.status).toBe('success');
    });

    // Now resolve the stale abc fetches with data identifiable as belonging to session-a
    const abcSummary: RunSummary = { ...makeRunSummary(), sessionId: 'result-for-abc' };
    await act(async () => {
      for (const resolve of (resolvers['abc'] ?? [])) {
        resolve(abcSummary);
      }
    });

    // The final state must still reflect session-b data — stale abc data must not overwrite it
    await waitFor(() => {
      const last = resultRef[resultRef.length - 1];
      expect(last.summary.status).toBe('success');
      // Verify the payload belongs to def (session-b), not the stale abc response
      if (last.summary.status === 'success') {
        expect(last.summary.data.sessionId).toBe('result-for-def');
      }
    });
  });
});
