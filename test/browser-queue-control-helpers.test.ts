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
  overrideQueueDependency,
  holdQueueItem,
  unholdQueueItem,
  previewQueueCascade,
  applyQueueCascade,
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

  it('overrideQueueDependency POSTs the dependency body to the queueDependencyOverride route', async () => {
    nextResponse = { ok: true, status: 200, json: { id: 'prd-5', previousStatus: 'waiting', currentStatus: 'pending', removedDependency: 'prd-1', previousDependsOn: ['prd-1'], currentDependsOn: [], movedToQueueRoot: true } };
    const result = await overrideQueueDependency('prd-5', { dependencyId: 'prd-1', reason: 'manual unblock' });
    expect(result).toEqual({ id: 'prd-5', previousStatus: 'waiting', currentStatus: 'pending', removedDependency: 'prd-1', previousDependsOn: ['prd-1'], currentDependsOn: [], movedToQueueRoot: true });
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url).toBe(buildPath(API_ROUTES.queueDependencyOverride, { prdId: 'prd-5' }));
    expect(captured[0].body).toEqual({ dependencyId: 'prd-1', reason: 'manual unblock' });
    expect(captured[0].headers.get('Content-Type')).toBe('application/json');
  });
});

describe('browser queue-control helpers — error surfacing', () => {
  it('throws a status-bearing Error carrying the daemon response text for non-2xx priority responses', async () => {
    nextResponse = { ok: false, status: 409, text: 'Queue item is running' };
    // The contract is that both the status prefix and the daemon response body
    // are preserved in the Error message, so assert the full composed message.
    await expect(updateQueuePriority('prd-3', { priority: 1 })).rejects.toThrow(
      'Queue priority request failed (409): Queue item is running',
    );
  });

  it('throws a status-bearing Error carrying the daemon response text for non-2xx removal responses', async () => {
    nextResponse = { ok: false, status: 404, text: 'Queue item not found' };
    await expect(removeQueueItem('prd-4')).rejects.toThrow(
      'Queue removal request failed (404): Queue item not found',
    );
  });

  it('throws a status-bearing Error carrying the daemon response text for non-2xx dependency override responses', async () => {
    nextResponse = { ok: false, status: 409, text: 'Queue item does not depend on parent' };
    await expect(overrideQueueDependency('prd-6', { dependencyId: 'parent' })).rejects.toThrow(
      'Queue dependency override request failed (409): Queue item does not depend on parent',
    );
  });
});


describe('browser queue-control helpers — hold and cascade route selection', () => {
  it('holdQueueItem and unholdQueueItem POST JSON bodies to encoded routes', async () => {
    nextResponse = { ok: true, status: 200, json: { status: 'held', item: { id: 'prd-7', title: 'PRD', status: 'pending', capabilities: { priority: { allowed: true }, remove: { allowed: true }, dependencyOverride: { allowed: true }, hold: { allowed: true }, unhold: { allowed: true }, cascadeRemove: { allowed: true }, cancel: { allowed: true }, cascadeCancel: { allowed: true } } } } };
    await holdQueueItem('prd/7', { reason: 'manual' });
    await unholdQueueItem('prd/7');
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url).toBe(buildPath(API_ROUTES.queueHold, { prdId: 'prd/7' }));
    expect(captured[0].body).toEqual({ reason: 'manual' });
    expect(captured[1].method).toBe('POST');
    expect(captured[1].url).toBe(buildPath(API_ROUTES.queueUnhold, { prdId: 'prd/7' }));
    expect(captured[1].body).toEqual({});
  });

  it('previewQueueCascade and applyQueueCascade POST JSON bodies to encoded routes', async () => {
    nextResponse = { ok: true, status: 200, json: { target: {}, dependents: [], safeStrategies: [], warnings: [], blockers: [], expectedAffected: { token: 't', prdIds: [] } } };
    await previewQueueCascade('prd/8', { operation: 'remove' });
    await applyQueueCascade('prd/8', { operation: 'remove', strategy: 'cascade-dependents', expectedAffected: { token: 't', prdIds: ['prd/8'] }, confirmDependents: true });
    expect(captured[0].url).toBe(buildPath(API_ROUTES.queueCascadePreview, { prdId: 'prd/8' }));
    expect(captured[0].body).toEqual({ operation: 'remove' });
    expect(captured[1].url).toBe(buildPath(API_ROUTES.queueCascadeApply, { prdId: 'prd/8' }));
    expect(captured[1].body).toEqual({ operation: 'remove', strategy: 'cascade-dependents', expectedAffected: { token: 't', prdIds: ['prd/8'] }, confirmDependents: true });
  });

  it('surfaces daemon text for hold and cascade errors', async () => {
    nextResponse = { ok: false, status: 409, text: 'blocked' };
    await expect(holdQueueItem('prd-9', {})).rejects.toThrow('Queue hold request failed (409): blocked');
    await expect(previewQueueCascade('prd-9', { operation: 'cancel' })).rejects.toThrow('Queue cascade preview request failed (409): blocked');
  });
});
