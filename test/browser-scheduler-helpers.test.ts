import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_ROUTES, pauseScheduler, resumeScheduler } from '@eforge-build/client/browser';

let captured: Array<{ url: string; method: string; body: unknown }> = [];
let nextResponse: { ok: boolean; status: number; json?: unknown; text?: string };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  captured = [];
  nextResponse = { ok: true, status: 200, json: { enabled: true, watcher: { running: false, pid: null, sessionId: null } } };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body });
    return { ok: nextResponse.ok, status: nextResponse.status, json: async () => nextResponse.json, text: async () => nextResponse.text ?? '' } as Response;
  }) as typeof fetch;
});

afterEach(() => { globalThis.fetch = originalFetch; });

describe('browser scheduler helpers', () => {
  it('POSTs pause and resume without bodies', async () => {
    await pauseScheduler({ body: 'ignored' });
    await resumeScheduler();
    expect(captured[0]).toEqual({ url: API_ROUTES.schedulerPause, method: 'POST', body: undefined });
    expect(captured[1]).toEqual({ url: API_ROUTES.schedulerResume, method: 'POST', body: undefined });
  });

  it('surfaces daemon response text on errors', async () => {
    nextResponse = { ok: false, status: 503, text: 'scheduler unavailable' };
    await expect(pauseScheduler()).rejects.toThrow('Scheduler request failed (503): scheduler unavailable');
  });
});
