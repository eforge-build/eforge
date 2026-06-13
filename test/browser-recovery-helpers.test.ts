/**
 * Route-selection tests for the browser-safe recovery/continue-repair fetch helpers in
 * `@eforge-build/client/browser`. A stubbed `fetch` captures the request so we
 * can assert the helper targets the correct `API_ROUTES` path with the correct
 * method and body, and that non-2xx responses throw an Error carrying the
 * daemon response text.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  API_ROUTES,
  fetchRecoverySidecar,
  triggerRecoveryAnalysis,
  applySidecarRecovery,
  startContinueRepair,
  fetchContinueRepairEligibility,
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

// ---------------------------------------------------------------------------
// Route + method selection
// ---------------------------------------------------------------------------

describe('browser recovery helpers — route selection', () => {
  it('fetchRecoverySidecar GETs readRecoverySidecar with a URLSearchParams query', async () => {
    nextResponse = { ok: true, status: 200, json: { markdown: '#', json: {} } };
    await fetchRecoverySidecar({ prdId: 'prd-1' });
    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe('GET');
    expect(captured[0].url).toBe(`${API_ROUTES.readRecoverySidecar}?prdId=prd-1`);
  });

  it('fetchContinueRepairEligibility GETs continueRepairEligibility with a URLSearchParams query', async () => {
    nextResponse = { ok: true, status: 200, json: { eligible: false } };
    await fetchContinueRepairEligibility({ prdId: 'prd-2', setName: 'set-a' });
    expect(captured[0].method).toBe('GET');
    expect(captured[0].url).toBe(`${API_ROUTES.continueRepairEligibility}?prdId=prd-2&setName=set-a`);
  });

  it('fetchContinueRepairEligibility omits setName from the query when not provided', async () => {
    nextResponse = { ok: true, status: 200, json: { eligible: false } };
    await fetchContinueRepairEligibility({ prdId: 'prd-3' });
    expect(captured[0].url).toBe(`${API_ROUTES.continueRepairEligibility}?prdId=prd-3`);
  });

  it('applySidecarRecovery POSTs ApplyRecoveryRequest to applyRecovery', async () => {
    nextResponse = { ok: true, status: 200, json: { verdict: 'retry' } };
    await applySidecarRecovery({ prdId: 'prd-4' });
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url).toBe(API_ROUTES.applyRecovery);
    expect(captured[0].body).toEqual({ prdId: 'prd-4' });
    expect(captured[0].headers.get('Content-Type')).toBe('application/json');
  });

  it('startContinueRepair POSTs ContinueRepairRequest to continueRepair', async () => {
    nextResponse = { ok: true, status: 200, json: { kind: 'queued', prdId: 'prd-5', setName: 'set-b', featureBranch: 'eforge/set-b', baseBranch: 'main', movedDescendantIds: [] } };
    await startContinueRepair({ prdId: 'prd-5', setName: 'set-b' });
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url).toBe(API_ROUTES.continueRepair);
    expect(captured[0].body).toEqual({ prdId: 'prd-5', setName: 'set-b' });
  });

  it('triggerRecoveryAnalysis POSTs RecoverRequest to recover', async () => {
    nextResponse = { ok: true, status: 200, json: { sessionId: 's', pid: 2 } };
    await triggerRecoveryAnalysis({ setName: 'set-c', prdId: 'prd-6' });
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url).toBe(API_ROUTES.recover);
    expect(captured[0].body).toEqual({ setName: 'set-c', prdId: 'prd-6' });
  });
});

// ---------------------------------------------------------------------------
// Error surfacing
// ---------------------------------------------------------------------------

describe('browser recovery helpers — error surfacing', () => {
  it('throws an Error including the daemon response text on a non-2xx GET', async () => {
    nextResponse = { ok: false, status: 404, text: 'No recovery sidecar found for prd-x' };
    await expect(fetchRecoverySidecar({ prdId: 'prd-x' })).rejects.toThrow(
      'No recovery sidecar found for prd-x',
    );
  });

  it('throws an Error including the daemon response text on a non-2xx POST', async () => {
    nextResponse = { ok: false, status: 500, text: 'Failed to queue continue-repair build' };
    await expect(startContinueRepair({ prdId: 'prd-y' })).rejects.toThrow('Failed to queue continue-repair build');
  });
});
