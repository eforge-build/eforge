import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_ROUTES, buildPath, fetchFailedEnqueues, reenqueueFailedEnqueue } from '@eforge-build/client/browser';

let captured: Array<{ url: string; method: string; body: unknown; headers: Headers }> = [];
let nextResponse: { ok: boolean; status: number; json?: unknown; text?: string };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  captured = [];
  nextResponse = { ok: true, status: 200, json: [] };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined, headers: new Headers(init?.headers) });
    return { ok: nextResponse.ok, status: nextResponse.status, json: async () => nextResponse.json, text: async () => nextResponse.text ?? '' } as Response;
  }) as typeof fetch;
});

afterEach(() => { globalThis.fetch = originalFetch; });

describe('browser failed-enqueue helpers', () => {
  it('GETs failed enqueue projections', async () => {
    nextResponse = { ok: true, status: 200, json: [{ runId: 'run-1', sourceLabel: 'prd.md', failureReason: 'boom', failedAt: 'now', canReenqueue: true }] };
    await expect(fetchFailedEnqueues()).resolves.toEqual(nextResponse.json);
    expect(captured[0]).toMatchObject({ method: 'GET', url: API_ROUTES.failedEnqueues });
  });

  it('POSTs explicit confirmation to the encoded re-enqueue route', async () => {
    nextResponse = { ok: true, status: 200, json: { enqueued: false, failedEnqueue: { runId: 'run/1', sourceLabel: 'prd.md', failureReason: 'boom', failedAt: 'now', canReenqueue: false }, queue: [], runs: [] } };
    await reenqueueFailedEnqueue('run/1', { confirm: true });
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url).toBe(buildPath(API_ROUTES.failedEnqueueReenqueue, { runId: 'run/1' }));
    expect(captured[0].body).toEqual({ confirm: true });
    expect(captured[0].headers.get('Content-Type')).toBe('application/json');
  });

  it('surfaces daemon response text on errors', async () => {
    nextResponse = { ok: false, status: 409, text: 'not allowed' };
    await expect(reenqueueFailedEnqueue('run-1', { confirm: true })).rejects.toThrow('Failed enqueue request failed (409): not allowed');
  });
});
