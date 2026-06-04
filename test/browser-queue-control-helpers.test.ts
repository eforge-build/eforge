/**
 * Route-selection tests for the browser-safe queue-control fetch helpers in
 * `@eforge-build/client/browser`. A stubbed `fetch` captures the request so we
 * can assert the helper targets the correct `API_ROUTES` path (resolved via
 * `buildPath`) with the correct method and body, and that non-2xx responses
 * throw a status-bearing Error carrying the daemon response text.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  API_ROUTES,
  buildPath,
  updateQueuePriority,
  removeQueueItem,
} from '@eforge-build/client/browser';

interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
  headers: Headers;
}

let captured: CapturedRequest[];
let nextResponse: { ok: boolean; status: number; json?: unknown; text?: string };
const originalFetch = globalThis.fetch;

function installStubFetch(): void {
  captured = [];
  nextResponse = { ok: true, status: 200, json: {} };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: typeof input === 'string' ? input : String(input),
      method: init?.method ?? 'GET',
      body: init?.body !== undefined ? JSON.parse(init.body as string) : undefined,
      headers: new Headers(init?.headers),
    });
    return {
      ok: nextResponse.ok,
      status: nextResponse.status,
      json: async () => nextResponse.json,
      text: async () => nextResponse.text ?? '',
    } as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  installStubFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('browser queue-control helpers — route selection', () => {
  it('updateQueuePriority POSTs the priority body to the queuePriority route', async () => {
    nextResponse = { ok: true, status: 200, json: { id: 'prd-1', previousStatus: 'pending', currentStatus: 'pending', priority: 5 } };
    const result = await updateQueuePriority('prd-1', { priority: 5 });
    expect(result).toEqual({ id: 'prd-1', previousStatus: 'pending', currentStatus: 'pending', priority: 5 });
    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url).toBe(buildPath(API_ROUTES.queuePriority, { prdId: 'prd-1' }));
    expect(captured[0].body).toEqual({ priority: 5 });
    expect(captured[0].headers.get('Content-Type')).toBe('application/json');
  });

  it('removeQueueItem DELETEs the queueRemove route with no body', async () => {
    nextResponse = { ok: true, status: 200, json: { id: 'prd-2', previousStatus: 'failed', currentStatus: 'removed', removedSidecars: [] } };
    const result = await removeQueueItem('prd-2');
    expect(result).toEqual({ id: 'prd-2', previousStatus: 'failed', currentStatus: 'removed', removedSidecars: [] });
    expect(captured[0].method).toBe('DELETE');
    expect(captured[0].url).toBe(buildPath(API_ROUTES.queueRemove, { prdId: 'prd-2' }));
    expect(captured[0].body).toBeUndefined();
  });
});

describe('browser queue-control helpers — error surfacing', () => {
  it('throws a status-bearing Error for non-2xx priority responses', async () => {
    nextResponse = { ok: false, status: 409, text: 'Queue item is running' };
    await expect(updateQueuePriority('prd-3', { priority: 1 })).rejects.toThrow('Queue priority request failed (409)');
  });

  it('throws a status-bearing Error for non-2xx removal responses', async () => {
    nextResponse = { ok: false, status: 404, text: 'Queue item not found' };
    await expect(removeQueueItem('prd-4')).rejects.toThrow('Queue removal request failed (404)');
  });
});
