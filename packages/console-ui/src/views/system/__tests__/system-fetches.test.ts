// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { API_ROUTES } from '@eforge-build/client/browser';
import {
  fetchSystemHealth,
  fetchSystemVersion,
  fetchSystemProjectContext,
  fetchSystemConfigShow,
  fetchSystemConfigValidate,
  fetchSystemProfileList,
  fetchSystemProfileShow,
  fetchSystemExtensionList,
  fetchSystemExtensionValidate,
  fetchSystemExtensionContributionManifest,
  fetchSystemPlaybookList,
  fetchSystemModelProviders,
  fetchSystemModelList,
  trustSystemExtension,
  untrustSystemExtension,
  promoteSystemExtension,
  demoteSystemExtension,
  reloadSystemExtensions,
  validateSelectedSystemExtension,
} from '../system-fetches';

function makeFetchMock(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 500 ? 'Internal Server Error' : 'Error',
    json: () => Promise.resolve(body),
  });
}

describe('system-fetches', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('successful GET helpers call their API_ROUTES path or query and return the response body', async () => {
    const successfulGetCases: Array<{
      name: string;
      body: unknown;
      run: () => Promise<unknown>;
      assertUrl: (url: string) => void;
    }> = [
      {
        name: 'fetchSystemHealth',
        body: { status: 'ok', pid: 1234 },
        run: fetchSystemHealth,
        assertUrl: (url) => expect(url).toBe(API_ROUTES.health),
      },
      {
        name: 'fetchSystemVersion',
        body: { version: 17, eforgeVersion: '1.2.3 (abc)' },
        run: fetchSystemVersion,
        assertUrl: (url) => expect(url).toBe(API_ROUTES.version),
      },
      {
        name: 'fetchSystemProjectContext',
        body: { cwd: '/home/user/project', gitRemote: 'git@github.com:foo/bar.git' },
        run: fetchSystemProjectContext,
        assertUrl: (url) => expect(url).toBe(API_ROUTES.projectContext),
      },
      {
        name: 'fetchSystemConfigShow',
        body: { resolved: {}, sources: {} },
        run: fetchSystemConfigShow,
        assertUrl: (url) => {
          const parsed = new URL(url, 'http://localhost');
          expect(parsed.pathname).toBe(API_ROUTES.configShow);
          expect(parsed.searchParams.get('verbose')).toBe('true');
        },
      },
      {
        name: 'fetchSystemConfigValidate',
        body: { configFound: true, valid: true },
        run: fetchSystemConfigValidate,
        assertUrl: (url) => expect(url).toBe(API_ROUTES.configValidate),
      },
      {
        name: 'fetchSystemProfileList',
        body: { profiles: [], active: null, source: 'none' as const },
        run: fetchSystemProfileList,
        assertUrl: (url) => expect(url).toBe(API_ROUTES.profileList),
      },
      {
        name: 'fetchSystemProfileShow',
        body: { active: null, source: 'none' as const, resolved: { harness: undefined, profile: null } },
        run: fetchSystemProfileShow,
        assertUrl: (url) => expect(url).toBe(API_ROUTES.profileShow),
      },
      {
        name: 'fetchSystemExtensionList',
        body: { extensions: [], diagnostics: [], totals: { eventHooks: 0, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0, reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0, actions: 0, consoleContributions: 0, consoleWorkstations: 0, integrationCommands: 0, deepLinks: 0 } },
        run: fetchSystemExtensionList,
        assertUrl: (url) => expect(url).toBe(API_ROUTES.extensionList),
      },
      {
        name: 'fetchSystemExtensionValidate',
        body: { valid: true, extensions: [], diagnostics: [] },
        run: fetchSystemExtensionValidate,
        assertUrl: (url) => expect(url).toBe(API_ROUTES.extensionValidate),
      },
      {
        name: 'fetchSystemExtensionContributionManifest',
        body: { schemaVersion: 1, generatedAt: '2026-01-01T00:00:00.000Z', actions: [], consoleContributions: [], consoleWorkstations: [], integrationCommands: [], deepLinks: [], diagnostics: [] },
        run: fetchSystemExtensionContributionManifest,
        assertUrl: (url) => expect(url).toBe(API_ROUTES.extensionContributionManifest),
      },
      {
        name: 'fetchSystemPlaybookList',
        body: { playbooks: [], warnings: [] },
        run: fetchSystemPlaybookList,
        assertUrl: (url) => expect(url).toBe(API_ROUTES.playbookList),
      },
    ];

    for (const testCase of successfulGetCases) {
      globalThis.fetch = makeFetchMock(200, testCase.body);
      const result = await testCase.run();
      expect(globalThis.fetch, testCase.name).toHaveBeenCalledOnce();
      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      testCase.assertUrl(url);
      expect(result, testCase.name).toEqual(testCase.body);
    }
  });

  it('model catalog helpers include harness query params and return the response body', async () => {
    const harnessQueryCases: Array<{
      name: string;
      route: string;
      harness: 'pi' | 'claude-sdk';
      body: unknown;
      run: () => Promise<unknown>;
    }> = [
      {
        name: 'fetchSystemModelProviders pi',
        route: API_ROUTES.modelProviders,
        harness: 'pi',
        body: { providers: ['anthropic'] },
        run: () => fetchSystemModelProviders('pi'),
      },
      {
        name: 'fetchSystemModelProviders claude-sdk',
        route: API_ROUTES.modelProviders,
        harness: 'claude-sdk',
        body: { providers: ['anthropic'] },
        run: () => fetchSystemModelProviders('claude-sdk'),
      },
      {
        name: 'fetchSystemModelList pi',
        route: API_ROUTES.modelList,
        harness: 'pi',
        body: { models: [] },
        run: () => fetchSystemModelList('pi'),
      },
      {
        name: 'fetchSystemModelList claude-sdk',
        route: API_ROUTES.modelList,
        harness: 'claude-sdk',
        body: { models: [] },
        run: () => fetchSystemModelList('claude-sdk'),
      },
    ];

    for (const testCase of harnessQueryCases) {
      globalThis.fetch = makeFetchMock(200, testCase.body);
      const result = await testCase.run();
      expect(globalThis.fetch, testCase.name).toHaveBeenCalledOnce();
      const rawUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      const url = new URL(rawUrl, 'http://localhost');
      expect(url.pathname, testCase.name).toBe(testCase.route);
      expect(url.searchParams.get('harness'), testCase.name).toBe(testCase.harness);
      expect(result, testCase.name).toEqual(testCase.body);
    }
  });

  it('trustSystemExtension POSTs path and console-ui provenance to the trust route', async () => {
    const mockBody = { extension: { name: 'policy', path: '/repo/eforge/extensions/policy.ts' }, message: 'Trusted policy.' };
    globalThis.fetch = makeFetchMock(200, mockBody);
    const result = await trustSystemExtension('/repo/eforge/extensions/policy.ts');

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    expect(url).toBe(API_ROUTES.extensionTrust);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      path: '/repo/eforge/extensions/policy.ts',
      trustedBy: 'console-ui',
    });
    expect(result).toEqual(mockBody);
  });

  it('trustSystemExtension rejects with the daemon error message on a non-2xx response', async () => {
    globalThis.fetch = makeFetchMock(409, { error: 'Ambiguous' });
    await expect(trustSystemExtension('/repo/eforge/extensions/policy.ts')).rejects.toThrow('Ambiguous');
  });

  it('reloadSystemExtensions POSTs an empty JSON body to the reload route', async () => {
    const mockBody = { extensions: [], diagnostics: [], totals: {}, wasRunning: true, restarted: true, running: true, previousSessionId: 'a', sessionId: 'b', message: 'Reloaded.', watcher: { wasRunning: true, restarted: true, running: true, previousSessionId: 'a', sessionId: 'b', message: 'Watcher restarted.' } };
    globalThis.fetch = makeFetchMock(200, mockBody);
    const result = await reloadSystemExtensions();

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = call[0] as string;
    const init = call[1] as RequestInit;
    expect(url).toBe(API_ROUTES.extensionReload);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({});
    expect(result).toEqual(mockBody);
  });

  it('reloadSystemExtensions surfaces the daemon error on a non-2xx response', async () => {
    globalThis.fetch = makeFetchMock(500, { error: 'watcher restart failed' });
    await expect(reloadSystemExtensions()).rejects.toThrow('watcher restart failed');
  });

  it('validateSelectedSystemExtension uses a single path query param and no body', async () => {
    const mockBody = { valid: true, extensions: [], diagnostics: [] };
    globalThis.fetch = makeFetchMock(200, mockBody);
    await validateSelectedSystemExtension({ path: '/repo/eforge/extensions/policy.ts' });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = new URL(call[0] as string, 'http://localhost');
    expect(url.pathname).toBe(API_ROUTES.extensionValidate);
    expect(url.searchParams.get('path')).toBe('/repo/eforge/extensions/policy.ts');
    expect(url.searchParams.has('name')).toBe(false);
    // GET read: no request init / body.
    expect(call[1]).toBeUndefined();
  });

  it('validateSelectedSystemExtension uses a single name query param for user/external targets', async () => {
    const mockBody = { valid: false, extensions: [], diagnostics: [{ severity: 'error', code: 'E', message: 'bad' }] };
    globalThis.fetch = makeFetchMock(200, mockBody);
    const result = await validateSelectedSystemExtension({ name: 'user-ext' });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const url = new URL(call[0] as string, 'http://localhost');
    expect(url.searchParams.get('name')).toBe('user-ext');
    expect(url.searchParams.has('path')).toBe(false);
    expect(result).toEqual(mockBody);
  });

  it('untrustSystemExtension POSTs { path } to the untrust route', async () => {
    const mockBody = { extension: { name: 'policy' }, message: 'Untrusted policy.' };
    globalThis.fetch = makeFetchMock(200, mockBody);
    const result = await untrustSystemExtension('/repo/eforge/extensions/policy.ts');

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(API_ROUTES.extensionUntrust);
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(((call[1] as RequestInit).headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ path: '/repo/eforge/extensions/policy.ts' });
    expect(result).toEqual(mockBody);
  });

  it('promoteSystemExtension POSTs { path } to the promote route in default mode', async () => {
    const mockBody = { extension: { name: 'policy' }, message: 'Promoted policy.' };
    globalThis.fetch = makeFetchMock(200, mockBody);
    await promoteSystemExtension('/repo/eforge/extensions/policy.ts');

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(API_ROUTES.extensionPromote);
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ path: '/repo/eforge/extensions/policy.ts' });
  });

  it('demoteSystemExtension POSTs { path } to the demote route in default mode', async () => {
    const mockBody = { extension: { name: 'policy' }, message: 'Demoted policy.' };
    globalThis.fetch = makeFetchMock(200, mockBody);
    await demoteSystemExtension('/repo/eforge/extensions/policy.ts');

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(API_ROUTES.extensionDemote);
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ path: '/repo/eforge/extensions/policy.ts' });
  });

  it('untrust/promote/demote surface daemon errors verbatim on non-2xx responses', async () => {
    globalThis.fetch = makeFetchMock(409, { error: 'Ambiguous extension' });
    await expect(untrustSystemExtension('/p.ts')).rejects.toThrow('Ambiguous extension');
    globalThis.fetch = makeFetchMock(409, { error: 'Already at project-team' });
    await expect(promoteSystemExtension('/p.ts')).rejects.toThrow('Already at project-team');
    globalThis.fetch = makeFetchMock(409, { error: 'Not project-team' });
    await expect(demoteSystemExtension('/p.ts')).rejects.toThrow('Not project-team');
  });

  it('returns error message from HTTP status text on 500 response', async () => {
    globalThis.fetch = makeFetchMock(500, {});
    await expect(fetchSystemHealth()).rejects.toThrow('HTTP 500 Internal Server Error');
  });

});
