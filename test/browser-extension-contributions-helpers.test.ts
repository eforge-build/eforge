import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  API_ROUTES,
  EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
  fetchExtensionContributionManifest,
  invokeExtensionAction,
  type ExtensionActionInvokeFailureResponse,
} from '@eforge-build/client/browser';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('browser extension contribution helpers', () => {
  it('keeps browser contribution exports free of Node-only daemon modules', () => {
    const browserSource = readFileSync('packages/client/src/browser.ts', 'utf8');
    const helperSource = readFileSync('packages/client/src/browser-extension-contributions.ts', 'utf8');
    const importLines = `${browserSource}\n${helperSource}`
      .split('\n')
      .filter((line) => /^\s*import\b|^\s*export\b.*\bfrom\b/.test(line))
      .join('\n');

    for (const forbidden of ['daemon-client', 'lockfile', './api-version.js', 'node:']) {
      expect(importLines).not.toContain(forbidden);
    }
  });

  it('fetches the contribution manifest from the route constant with GET', async () => {
    const manifest = {
      schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
      generatedAt: '2026-06-03T00:00:00.000Z',
      actions: [],
      consoleContributions: [],
      consoleWorkstations: [],
      integrationCommands: [],
      deepLinks: [],
    };
    const fetchSpy = vi.fn(async () => jsonResponse(manifest));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(fetchExtensionContributionManifest()).resolves.toEqual(manifest);

    expect(fetchSpy).toHaveBeenCalledWith(API_ROUTES.extensionContributionManifest, { method: 'GET' });
  });

  it('throws manifest HTTP status and body on non-2xx responses', async () => {
    const fetchSpy = vi.fn(async () => new Response('not found', { status: 404 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(fetchExtensionContributionManifest()).rejects.toThrow(
      'Failed to fetch extension contribution manifest: HTTP 404 not found',
    );
  });

  it('invokes an action with POST JSON and parses typed non-2xx failure bodies', async () => {
    const failure: ExtensionActionInvokeFailureResponse = {
      ok: false,
      invocationId: 'invoke-1',
      error: { code: 'invalid-input', message: 'Bad input' },
    };
    const fetchSpy = vi.fn(async () => jsonResponse(failure, { status: 400 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const body = { actionId: 'example.action', input: { ok: true }, requestedBy: { host: 'console' as const } };
    await expect(invokeExtensionAction(body)).resolves.toEqual(failure);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(API_ROUTES.extensionActionInvoke);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(body));
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('throws action HTTP status and body on untyped non-2xx responses', async () => {
    const fetchSpy = vi.fn(async () => new Response('not found', { status: 404 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const body = { actionId: 'example.action', input: {}, requestedBy: { host: 'console' as const } };
    await expect(invokeExtensionAction(body)).rejects.toThrow(
      'Failed to invoke extension action: HTTP 404 not found',
    );
  });
});
