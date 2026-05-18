// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoBuild } from '../use-auto-build';
import { setAutoBuild, type AutoBuildState } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    setAutoBuild: vi.fn(),
  };
});

const mockedSetAutoBuild = vi.mocked(setAutoBuild);

function makeAutoBuild(overrides: Partial<AutoBuildState> = {}): AutoBuildState {
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

describe('useAutoBuild', () => {
  beforeEach(() => {
    mockedSetAutoBuild.mockReset();
  });

  it('setEnabled(false) calls setAutoBuild(false) and passes the server response to onUpdate', async () => {
    const currentState = makeAutoBuild({ enabled: true });
    const responseState = makeAutoBuild({
      enabled: false,
      watcher: { running: false, pid: null, sessionId: null },
      desired: 'disabled',
      mode: 'disabled',
      scheduler: { alive: false, paused: false, lastMutationReason: 'manual toggle' },
      lastTransition: {
        at: '2024-01-15T10:05:00.000Z',
        previousMode: 'running',
        nextMode: 'disabled',
        desired: 'disabled',
        reason: 'manual toggle',
        source: 'http',
      },
      reason: 'manual toggle',
    });
    mockedSetAutoBuild.mockResolvedValue(responseState);
    const onUpdate = vi.fn();

    const { result } = renderHook(() => useAutoBuild(currentState, onUpdate));

    act(() => {
      result.current.setEnabled(false);
    });

    await waitFor(() => expect(result.current.toggling).toBe(false));

    expect(mockedSetAutoBuild).toHaveBeenCalledTimes(1);
    expect(mockedSetAutoBuild).toHaveBeenCalledWith(false);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(responseState);
    expect(onUpdate.mock.calls[0][0].mode).toBe('disabled');
    expect(onUpdate.mock.calls[0][0].scheduler?.lastMutationReason).toBe('manual toggle');
    expect(onUpdate.mock.calls[0][0].lastTransition?.reason).toBe('manual toggle');
  });

  it('setEnabled(true) calls setAutoBuild(true) and passes the server response to onUpdate', async () => {
    const currentState = makeAutoBuild({ enabled: false, mode: 'disabled', desired: 'disabled' });
    const responseState = makeAutoBuild({
      enabled: true,
      desired: 'enabled',
      mode: 'running',
      reason: 'manual enable',
    });
    mockedSetAutoBuild.mockResolvedValue(responseState);
    const onUpdate = vi.fn();

    const { result } = renderHook(() => useAutoBuild(currentState, onUpdate));

    act(() => {
      result.current.setEnabled(true);
    });

    await waitFor(() => expect(result.current.toggling).toBe(false));

    expect(mockedSetAutoBuild).toHaveBeenCalledTimes(1);
    expect(mockedSetAutoBuild).toHaveBeenCalledWith(true);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(responseState);
    expect(onUpdate.mock.calls[0][0].mode).toBe('running');
    expect(onUpdate.mock.calls[0][0].enabled).toBe(true);
  });

  it('toggling guard prevents a second call while one is in-flight', async () => {
    const currentState = makeAutoBuild({ enabled: true });
    let resolveFirst!: (v: AutoBuildState | null) => void;
    mockedSetAutoBuild.mockReturnValue(
      new Promise<AutoBuildState | null>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const onUpdate = vi.fn();

    const { result } = renderHook(() => useAutoBuild(currentState, onUpdate));

    act(() => {
      const { setEnabled } = result.current;
      setEnabled(false);
      // Second call before React has a chance to re-render — should be ignored.
      setEnabled(false);
    });

    // Resolve the first call
    act(() => {
      resolveFirst(makeAutoBuild({ enabled: false }));
    });

    await waitFor(() => expect(result.current.toggling).toBe(false));

    expect(mockedSetAutoBuild).toHaveBeenCalledTimes(1);
  });

  it('does not call onUpdate when the server returns null', async () => {
    const currentState = makeAutoBuild({ enabled: true });
    mockedSetAutoBuild.mockResolvedValue(null);
    const onUpdate = vi.fn();

    const { result } = renderHook(() => useAutoBuild(currentState, onUpdate));

    act(() => {
      result.current.setEnabled(false);
    });

    await waitFor(() => expect(result.current.toggling).toBe(false));

    expect(mockedSetAutoBuild).toHaveBeenCalledTimes(1);
    expect(mockedSetAutoBuild).toHaveBeenCalledWith(false);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
