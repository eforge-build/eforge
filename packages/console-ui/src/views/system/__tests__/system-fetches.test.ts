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
  fetchSystemSessionPlanList,
  fetchSystemModelProviders,
  fetchSystemModelList,
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
    const mockBody = { extensions: [], diagnostics: [], totals: { eventHooks: 0, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0, reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0, actions: 0, consoleContributions: 0, integrationCommands: 0, deepLinks: 0 } };
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
    const mockBody = { schemaVersion: 1, generatedAt: '2026-01-01T00:00:00.000Z', actions: [], consoleContributions: [], integrationCommands: [], deepLinks: [], diagnostics: [] };
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

  it('fetchSystemSessionPlanList calls API_ROUTES.sessionPlanList', async () => {
    const mockBody = { plans: [] };
    globalThis.fetch = makeFetchMock(200, mockBody);
    await fetchSystemSessionPlanList();
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toBe(API_ROUTES.sessionPlanList);
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
