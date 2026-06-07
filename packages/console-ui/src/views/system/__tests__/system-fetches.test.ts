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

  it('fetchSystemHealth calls API_ROUTES.health', async () => {
    const mockBody = { status: 'ok', pid: 1234 };
    globalThis.fetch = makeFetchMock(200, mockBody);
    const result = await fetchSystemHealth();
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(API_ROUTES.health);
    expect(result).toEqual(mockBody);
  });

  it('fetchSystemVersion calls API_ROUTES.version', async () => {
    const mockBody = { version: 17, eforgeVersion: '1.2.3 (abc)' };
    globalThis.fetch = makeFetchMock(200, mockBody);
    const result = await fetchSystemVersion();
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(API_ROUTES.version);
    expect(result).toEqual(mockBody);
  });

  it('fetchSystemProjectContext calls API_ROUTES.projectContext', async () => {
    const mockBody = { cwd: '/home/user/project', gitRemote: 'git@github.com:foo/bar.git' };
    globalThis.fetch = makeFetchMock(200, mockBody);
    const result = await fetchSystemProjectContext();
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(API_ROUTES.projectContext);
    expect(result).toEqual(mockBody);
  });

  it('fetchSystemConfigShow includes verbose=true query param', async () => {
    const mockBody = { resolved: {}, sources: {} };
    globalThis.fetch = makeFetchMock(200, mockBody);
    await fetchSystemConfigShow();
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain(API_ROUTES.configShow);
    expect(url).toContain('verbose=true');
  });

  it('fetchSystemConfigValidate calls API_ROUTES.configValidate', async () => {
    const mockBody = { configFound: true, valid: true };
    globalThis.fetch = makeFetchMock(200, mockBody);
    await fetchSystemConfigValidate();
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(API_ROUTES.configValidate);
  });

  it('fetchSystemProfileList calls API_ROUTES.profileList', async () => {
    const mockBody = { profiles: [], active: null, source: 'none' as const };
    globalThis.fetch = makeFetchMock(200, mockBody);
    await fetchSystemProfileList();
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(API_ROUTES.profileList);
  });

  it('fetchSystemProfileShow calls API_ROUTES.profileShow', async () => {
    const mockBody = { active: null, source: 'none' as const, resolved: { harness: undefined, profile: null } };
    globalThis.fetch = makeFetchMock(200, mockBody);
    await fetchSystemProfileShow();
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(API_ROUTES.profileShow);
  });

  it('fetchSystemExtensionList calls API_ROUTES.extensionList', async () => {
    const mockBody = { extensions: [], diagnostics: [], totals: { eventHooks: 0, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0, reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0, actions: 0, consoleContributions: 0, consoleWorkstations: 0, integrationCommands: 0, deepLinks: 0 } };
    globalThis.fetch = makeFetchMock(200, mockBody);
    await fetchSystemExtensionList();
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(API_ROUTES.extensionList);
  });

  it('fetchSystemExtensionValidate calls API_ROUTES.extensionValidate', async () => {
    const mockBody = { valid: true, extensions: [], diagnostics: [] };
    globalThis.fetch = makeFetchMock(200, mockBody);
    await fetchSystemExtensionValidate();
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(API_ROUTES.extensionValidate);
  });

  it('fetchSystemExtensionContributionManifest calls API_ROUTES.extensionContributionManifest', async () => {
    const mockBody = { schemaVersion: 1, generatedAt: '2026-01-01T00:00:00.000Z', actions: [], consoleContributions: [], consoleWorkstations: [], integrationCommands: [], deepLinks: [], diagnostics: [] };
    globalThis.fetch = makeFetchMock(200, mockBody);
    await fetchSystemExtensionContributionManifest();
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(API_ROUTES.extensionContributionManifest);
  });

  it('fetchSystemPlaybookList calls API_ROUTES.playbookList', async () => {
    const mockBody = { playbooks: [], warnings: [] };
    globalThis.fetch = makeFetchMock(200, mockBody);
    await fetchSystemPlaybookList();
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(API_ROUTES.playbookList);
  });

  it('fetchSystemModelProviders includes harness=pi query param', async () => {
    const mockBody = { providers: ['anthropic'] };
    globalThis.fetch = makeFetchMock(200, mockBody);
    await fetchSystemModelProviders('pi');
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain(API_ROUTES.modelProviders);
    expect(url).toContain('harness=pi');
  });

  it('fetchSystemModelProviders includes harness=claude-sdk query param', async () => {
    const mockBody = { providers: ['anthropic'] };
    globalThis.fetch = makeFetchMock(200, mockBody);
    await fetchSystemModelProviders('claude-sdk');
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain(API_ROUTES.modelProviders);
    expect(url).toContain('harness=claude-sdk');
  });

  it('fetchSystemModelList includes harness=pi query param', async () => {
    const mockBody = { models: [] };
    globalThis.fetch = makeFetchMock(200, mockBody);
    await fetchSystemModelList('pi');
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain(API_ROUTES.modelList);
    expect(url).toContain('harness=pi');
  });

  it('fetchSystemModelList includes harness=claude-sdk query param', async () => {
    const mockBody = { models: [] };
    globalThis.fetch = makeFetchMock(200, mockBody);
    await fetchSystemModelList('claude-sdk');
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain(API_ROUTES.modelList);
    expect(url).toContain('harness=claude-sdk');
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

  it('500 response on one endpoint does not affect other endpoints', async () => {
    // First call: health fails
    // Second call: version succeeds
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve({ version: 17 }),
      });
    globalThis.fetch = fetchMock;

    let healthError: Error | undefined;
    try {
      await fetchSystemHealth();
    } catch (e) {
      healthError = e as Error;
    }
    expect(healthError).toBeDefined();
    expect(healthError?.message).toContain('500');

    // Version call should succeed independently
    const versionResult = await fetchSystemVersion();
    expect(versionResult).toEqual({ version: 17 });
  });
});
