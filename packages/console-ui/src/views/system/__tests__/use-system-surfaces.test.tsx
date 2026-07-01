// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { API_ROUTES, type ExtensionContributionManifestResponse } from '@eforge-build/client/browser';
import { useSystemSurfaces } from '../use-system-surfaces';

function emptyTotals() {
  return {
    eventHooks: 0,
    agentRunHooks: 0,
    policyGates: 0,
    profileRouters: 0, runtimeChoiceRouters: 0,
    inputSources: 0,
    reviewerPerspectives: 0,
    validationProviders: 0,
    tools: 0,
    prdEnrichers: 0,
    actions: 0,
    consoleContributions: 0,
    consoleWorkstations: 0,
    integrationCommands: 0,
    deepLinks: 0,
  };
}

function emptyManifest(): ExtensionContributionManifestResponse {
  return {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    actions: [],
    consoleContributions: [],
    consoleWorkstations: [],
    integrationCommands: [],
    deepLinks: [],
    diagnostics: [],
  };
}

function populatedManifest(): ExtensionContributionManifestResponse {
  return {
    ...emptyManifest(),
    actions: [{
      id: 'demo.echo',
      localId: 'echo',
      extensionName: 'demo',
      extensionPath: '/demo.js',
      title: 'Echo',
      inputSchema: { type: 'object', properties: {} },
    }],
    consoleContributions: [{
      id: 'demo.panel',
      localId: 'panel',
      extensionName: 'demo',
      extensionPath: '/demo.js',
      title: 'Demo panel',
      schemaVersion: 1,
      blocks: [{ rendererId: 'text', content: 'hello' }],
    }],
  };
}

function response(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Internal Server Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

function installSystemFetch(manifestState: { value: ExtensionContributionManifestResponse; fail: boolean }) {
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input).split('?')[0];

    if (url === API_ROUTES.extensionContributionManifest) {
      return manifestState.fail ? response(500, 'manifest down') : response(200, manifestState.value);
    }

    const bodies = new Map<string, unknown>([
      [API_ROUTES.health, { status: 'ok', pid: 1 }],
      [API_ROUTES.version, { version: 17, eforgeVersion: '1.0.0' }],
      [API_ROUTES.projectContext, { cwd: '/repo', gitRemote: null }],
      [API_ROUTES.configShow, { resolved: {}, sources: {} }],
      [API_ROUTES.configValidate, { configFound: false, valid: true }],
      [API_ROUTES.profileList, { profiles: [], active: null, source: 'none' }],
      [API_ROUTES.profileShow, { active: null, source: 'none', resolved: { profile: null } }],
      [API_ROUTES.extensionList, { extensions: [], diagnostics: [], totals: emptyTotals() }],
      [API_ROUTES.extensionValidate, { valid: true, extensions: [], diagnostics: [] }],
      [API_ROUTES.modelProviders, { providers: [] }],
      [API_ROUTES.modelList, { models: [] }],
    ]);

    if (!bodies.has(url)) {
      return response(404, { error: `unhandled ${url}` });
    }
    return response(200, bodies.get(url));
  }) as typeof globalThis.fetch;
}

describe('useSystemSurfaces extension contribution manifest state', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('loads extension contributions independently and marks non-empty manifests as success', async () => {
    installSystemFetch({ value: populatedManifest(), fail: false });

    const { result } = renderHook(() => useSystemSurfaces());

    await waitFor(() => expect(result.current.state.extensions.contributions.status).toBe('success'));
    const recordedUrls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]));
    expect(recordedUrls.some((url) => url.includes(`play${'book'}`))).toBe(false);
    expect(result.current.state.extensions.contributions.data?.consoleContributions).toHaveLength(1);
    expect(result.current.state.extensions.list.status).toBe('empty');
  });

  it('marks all-empty contribution manifests as empty', async () => {
    installSystemFetch({ value: emptyManifest(), fail: false });

    const { result } = renderHook(() => useSystemSurfaces());

    await waitFor(() => expect(result.current.state.extensions.contributions.status).toBe('empty'));
    expect(result.current.state.extensions.contributions.data).toMatchObject({
      actions: [],
      consoleContributions: [],
      consoleWorkstations: [],
      integrationCommands: [],
      deepLinks: [],
      diagnostics: [],
    });
  });

  it('preserves stale contribution manifest data when a refresh fails', async () => {
    const manifestState = { value: populatedManifest(), fail: false };
    installSystemFetch(manifestState);
    const { result } = renderHook(() => useSystemSurfaces());
    await waitFor(() => expect(result.current.state.extensions.contributions.status).toBe('success'));

    manifestState.fail = true;
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.state.extensions.contributions.status).toBe('error'));
    expect(result.current.state.extensions.contributions.error).toContain('manifest down');
    expect(result.current.state.extensions.contributions.data?.consoleContributions[0]?.id).toBe('demo.panel');
  });
});
