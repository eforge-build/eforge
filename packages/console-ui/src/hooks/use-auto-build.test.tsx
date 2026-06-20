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

describe('useAutoBuild scheduler controls', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pauses the scheduler through the client route helper and updates state from the response', async () => {
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
      result.current.pauseScheduler();
    });

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(paused));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.schedulerToggling).toBe(false));
    expect(result.current.schedulerError).toBeNull();
  });

  it('resumes the scheduler through the client route helper and updates state from the response', async () => {
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
      result.current.resumeScheduler();
    });

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(resumed));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not call scheduler helpers when desired auto-build is disabled', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onUpdate = vi.fn();

    const { result } = renderHook(() => useAutoBuild(autoBuild({ enabled: false, desired: 'disabled', mode: 'disabled' }), onUpdate));

    act(() => {
      result.current.pauseScheduler();
      result.current.resumeScheduler();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(result.current.schedulerToggling).toBe(false);
  });

  it('records scheduler helper errors and clears them after a later success', async () => {
    const resumed = autoBuild({ scheduler: { alive: true, paused: false } });
    const fetchMock = vi.fn(async () => jsonResponse(resumed));
    fetchMock.mockResolvedValueOnce(new Response('route unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const onUpdate = vi.fn();

    const { result } = renderHook(() => useAutoBuild(autoBuild(), onUpdate));

    act(() => {
      result.current.pauseScheduler();
    });

    await waitFor(() => expect(result.current.schedulerError).toContain('Scheduler request failed (503): route unavailable'));
    expect(onUpdate).not.toHaveBeenCalled();

    act(() => {
      result.current.resumeScheduler();
    });

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(resumed));
    expect(result.current.schedulerError).toBeNull();
  });
});
