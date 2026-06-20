import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_ROUTES, prepareRecoveryGuidance } from '@eforge-build/client/browser';

let captured: Array<{ url: string; method: string; body: unknown; headers: Headers }> = [];
let nextResponse: { ok: boolean; status: number; json?: unknown; text?: string };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  captured = [];
  nextResponse = { ok: true, status: 200, json: { prdId: 'prd-1', setName: 'set', featureBranch: 'f', baseBranch: 'main', outputDir: 'out', sidecarPath: 'sidecar', sidecarGeneratedAt: 'now', plans: [] } };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : undefined, headers: new Headers(init?.headers) });
    return { ok: nextResponse.ok, status: nextResponse.status, json: async () => nextResponse.json, text: async () => nextResponse.text ?? '' } as Response;
  }) as typeof fetch;
});

afterEach(() => { globalThis.fetch = originalFetch; });

describe('browser recovery guidance helper', () => {
  it('POSTs to the prepare route with JSON body', async () => {
    await prepareRecoveryGuidance({ prdId: 'prd-1', setName: 'set' });
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url).toBe(API_ROUTES.recoveryGuidancePrepare);
    expect(captured[0].body).toEqual({ prdId: 'prd-1', setName: 'set' });
    expect(captured[0].headers.get('Content-Type')).toBe('application/json');
  });

  it('surfaces daemon response text on errors', async () => {
    nextResponse = { ok: false, status: 500, text: 'recovery failed' };
    await expect(prepareRecoveryGuidance({ prdId: 'prd-1' })).rejects.toThrow('Recovery request failed (500): recovery failed');
  });
});
