import { describe, it, expect, vi } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { useActiveSessionStreams } from '@/hooks/use-active-session-streams';
import type { SubscribeFn } from '@/hooks/use-active-session-streams';
import { API_ROUTES, buildPath } from '@eforge-build/client/browser';

// ---------------------------------------------------------------------------
// Fake subscribe generator factory
// ---------------------------------------------------------------------------

interface FakeFrame {
  kind: 'snapshot' | 'event' | 'named';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

type ChannelMap = Map<string, { frames: FakeFrame[]; signal: AbortSignal; resolve: () => void }>;

const capturedCalls: { url: string; signal: AbortSignal }[] = [];

function makeFakeSubscribeFn(
  channels: ChannelMap,
  framesToEmit: Record<string, FakeFrame[]> = {},
): SubscribeFn {
  return async function* fakeSubscribe(url: string, opts: { signal?: AbortSignal } = {}) {
    const signal = opts.signal ?? new AbortController().signal;
    capturedCalls.push({ url, signal });
    const frames = framesToEmit[url] ?? [];
    for (const frame of frames) {
      if (signal.aborted) return;
      yield frame as never;
    }
    // Wait for abort or indefinitely
    await new Promise<void>((resolve) => {
      if (signal.aborted) { resolve(); return; }
      signal.addEventListener('abort', () => resolve(), { once: true });
      channels.set(url, { frames, signal, resolve });
    });
  } as unknown as SubscribeFn;
}

// ---------------------------------------------------------------------------
// Test component wrapper
// ---------------------------------------------------------------------------

function TestComponent({
  initialIds,
  subscribeFn,
}: {
  initialIds: string[];
  subscribeFn: SubscribeFn;
}) {
  const [ids, setIds] = useState<string[]>(initialIds);
  const result = useActiveSessionStreams(ids, subscribeFn);
  return (
    <div>
      <div data-testid="sub-count">{result.subscriptionCount}</div>
      <div data-testid="session-ids">{result.activeSessionIds.sort().join(',')}</div>
      <button
        data-testid="remove-first"
        onClick={() => setIds((prev) => prev.slice(1))}
      />
      <button
        data-testid="set-empty"
        onClick={() => setIds([])}
      />
      <button
        data-testid="set-ids"
        data-ids=""
        onClick={(e) => {
          const el = e.currentTarget;
          setIds(el.dataset.ids?.split(',').filter(Boolean) ?? []);
        }}
      />
    </div>
  );
}

describe('useActiveSessionStreams', () => {
  it('starts one stream per active session ID', async () => {
    capturedCalls.length = 0;
    const channels: ChannelMap = new Map();
    const id1 = 'session-aaa';
    const id2 = 'session-bbb';
    const url1 = buildPath(API_ROUTES.events, { runId: id1 });
    const url2 = buildPath(API_ROUTES.events, { runId: id2 });
    const fakeSub = makeFakeSubscribeFn(channels);

    const { unmount } = render(
      <TestComponent initialIds={[id1, id2]} subscribeFn={fakeSub} />,
    );

    await waitFor(() => {
      const urls = capturedCalls.map((c) => c.url);
      expect(urls).toContain(url1);
      expect(urls).toContain(url2);
    });

    unmount();
  });

  it('aborts a removed session stream when the active ID list shrinks', async () => {
    capturedCalls.length = 0;
    const channels: ChannelMap = new Map();
    const id1 = 'session-ccc';
    const id2 = 'session-ddd';
    const url1 = buildPath(API_ROUTES.events, { runId: id1 });
    const fakeSub = makeFakeSubscribeFn(channels);

    const { getByTestId, unmount } = render(
      <TestComponent initialIds={[id1, id2]} subscribeFn={fakeSub} />,
    );

    // Wait for subscriptions to start
    await waitFor(() => {
      expect(capturedCalls.map((c) => c.url)).toContain(url1);
    });

    // Find the signal for id1
    const callForId1 = capturedCalls.find((c) => c.url === url1);
    expect(callForId1).toBeDefined();

    // Remove id1 by keeping only id2
    act(() => {
      getByTestId('remove-first').click();
    });

    // The signal for id1 should be aborted
    await waitFor(() => {
      expect(callForId1!.signal.aborted).toBe(true);
    });

    unmount();
  });

  it('starts zero streams when active ID list is empty', async () => {
    capturedCalls.length = 0;
    const channels: ChannelMap = new Map();
    const fakeSub = makeFakeSubscribeFn(channels);

    const { unmount } = render(
      <TestComponent initialIds={[]} subscribeFn={fakeSub} />,
    );

    // Small delay — no subscriptions should start
    await new Promise((r) => setTimeout(r, 20));
    expect(capturedCalls).toHaveLength(0);

    unmount();
  });

  it('builds session stream URLs with buildPath(API_ROUTES.events, { runId })', async () => {
    capturedCalls.length = 0;
    const channels: ChannelMap = new Map();
    const sessionId = 'my-test-session';
    const expectedUrl = buildPath(API_ROUTES.events, { runId: sessionId });
    const fakeSub = makeFakeSubscribeFn(channels);

    const { unmount } = render(
      <TestComponent initialIds={[sessionId]} subscribeFn={fakeSub} />,
    );

    await waitFor(() => {
      expect(capturedCalls.map((c) => c.url)).toContain(expectedUrl);
    });

    unmount();
  });

  it('marks session as terminal and aborts when snapshot status is completed', async () => {
    capturedCalls.length = 0;
    const channels: ChannelMap = new Map();
    const sessionId = 'session-terminal';
    const url = buildPath(API_ROUTES.events, { runId: sessionId });

    const fakeSub = makeFakeSubscribeFn(channels, {
      [url]: [
        {
          kind: 'snapshot',
          snapshot: { cursor: 1, status: 'completed', events: [] },
        },
      ],
    });

    const { unmount } = render(
      <TestComponent initialIds={[sessionId]} subscribeFn={fakeSub} />,
    );

    await waitFor(() => {
      // Signal should be aborted because session is terminal
      const call = capturedCalls.find((c) => c.url === url);
      expect(call).toBeDefined();
      expect(call!.signal.aborted).toBe(true);
    });

    unmount();
  });
});
