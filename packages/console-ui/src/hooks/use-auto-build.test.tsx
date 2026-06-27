import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_ROUTES } from '@eforge-build/client/browser';
import type { AutoBuildState } from '@eforge-build/client/browser';
import { useAutoBuild } from './use-auto-build';

function autoBuild(overrides: Partial<AutoBuildState> = {}): AutoBuildState {
  return {
    enabled: true,
    desired: 'enabled',
    mode: 'running',
    watcher: { running: false, pid: null, sessionId: null },
    scheduler: { alive: true, paused: false },
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('useAutoBuild auto-start toggle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('turns an active scheduler off by pausing it', async () => {
    const paused = autoBuild({ mode: 'paused', scheduler: { alive: true, paused: true } });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBe(API_ROUTES.schedulerPause);
      expect(init?.method).toBe('POST');
      return jsonResponse(paused);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onUpdate = vi.fn();

    const { result } = renderHook(() => useAutoBuild(autoBuild(), onUpdate));

    act(() => {
      result.current.setEnabled(false);
    });

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(paused));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.toggling).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it('turns a paused scheduler on by resuming it', async () => {
    const resumed = autoBuild({ mode: 'running', scheduler: { alive: true, paused: false } });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBe(API_ROUTES.schedulerResume);
      expect(init?.method).toBe('POST');
      return jsonResponse(resumed);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onUpdate = vi.fn();

    const { result } = renderHook(() => useAutoBuild(autoBuild({ mode: 'paused', scheduler: { alive: true, paused: true } }), onUpdate));

    act(() => {
      result.current.setEnabled(true);
    });

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(resumed));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('turns on from disabled by enabling daemon auto-start', async () => {
    const enabled = autoBuild({ mode: 'starting', desired: 'enabled' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBe(API_ROUTES.autoBuildSet);
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(JSON.stringify({ enabled: true }));
      return jsonResponse(enabled);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onUpdate = vi.fn();

    const { result } = renderHook(() => useAutoBuild(autoBuild({ enabled: false, desired: 'disabled', mode: 'disabled' }), onUpdate));

    act(() => {
      result.current.setEnabled(true);
    });

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(enabled));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when asked to turn off an already-disabled scheduler', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onUpdate = vi.fn();

    const { result } = renderHook(() => useAutoBuild(autoBuild({ enabled: false, desired: 'disabled', mode: 'disabled' }), onUpdate));

    act(() => {
      result.current.setEnabled(false);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('records scheduler errors and clears them after a later success', async () => {
    const resumed = autoBuild({ scheduler: { alive: true, paused: false } });
    const fetchMock = vi.fn(async () => jsonResponse(resumed));
    fetchMock.mockResolvedValueOnce(new Response('route unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const onUpdate = vi.fn();

    const { result, rerender } = renderHook(
      ({ state }) => useAutoBuild(state, onUpdate),
      { initialProps: { state: autoBuild() } },
    );

    act(() => {
      result.current.setEnabled(false);
    });

    await waitFor(() => expect(result.current.error).toContain('Scheduler request failed (503): route unavailable'));
    expect(onUpdate).not.toHaveBeenCalled();

    rerender({ state: autoBuild({ mode: 'paused', scheduler: { alive: true, paused: true } }) });

    act(() => {
      result.current.setEnabled(true);
    });

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(resumed));
    expect(result.current.error).toBeNull();
  });
});
