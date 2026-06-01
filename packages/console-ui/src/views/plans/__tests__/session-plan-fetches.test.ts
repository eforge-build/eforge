// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { API_ROUTES } from '@eforge-build/client/browser';
import {
  fetchSessionPlanList,
  fetchSessionPlanShow,
  fetchSessionPlanSetList,
  fetchSessionPlanSetShow,
  fetchSessionPlanSetValidate,
} from '../session-plan-fetches';

function makeFetchMock(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  });
}

describe('session-plan-fetches', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // fetchSessionPlanList
  // ---------------------------------------------------------------------------

  describe('fetchSessionPlanList', () => {
    it('calls API_ROUTES.sessionPlanList without query when includeSubmitted is not set', async () => {
      const mockBody = { plans: [] };
      globalThis.fetch = makeFetchMock(200, mockBody);
      const result = await fetchSessionPlanList({});
      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toBe(API_ROUTES.sessionPlanList);
      expect(result).toEqual(mockBody);
    });

    it('includes includeSubmitted=true query param when requested', async () => {
      const mockBody = { plans: [] };
      globalThis.fetch = makeFetchMock(200, mockBody);
      await fetchSessionPlanList({ includeSubmitted: true });
      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain(API_ROUTES.sessionPlanList);
      expect(url).toContain('includeSubmitted=true');
    });

    it('does not append any query string when includeSubmitted is false', async () => {
      const mockBody = { plans: [] };
      globalThis.fetch = makeFetchMock(200, mockBody);
      await fetchSessionPlanList({ includeSubmitted: false });
      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).not.toContain('includeSubmitted');
      expect(url).not.toContain('?');
    });

    it('does not include includeSubmitted when option is omitted', async () => {
      const mockBody = { plans: [] };
      globalThis.fetch = makeFetchMock(200, mockBody);
      await fetchSessionPlanList({});
      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).not.toContain('includeSubmitted');
    });

    it('throws on non-2xx response', async () => {
      globalThis.fetch = makeFetchMock(500, {});
      await expect(fetchSessionPlanList({})).rejects.toThrow('HTTP 500');
    });
  });

  // ---------------------------------------------------------------------------
  // fetchSessionPlanShow
  // ---------------------------------------------------------------------------

  describe('fetchSessionPlanShow', () => {
    it('calls API_ROUTES.sessionPlanShow with session query param', async () => {
      const mockBody = {
        plan: {
          session: 'test-session',
          topic: 'Test topic',
          status: 'planning',
          planning_type: 'feature',
          planning_depth: 'focused',
          required_dimensions: [],
          optional_dimensions: [],
          skipped_dimensions: [],
          open_questions: [],
          profile: null,
          body: '',
        },
        readiness: {
          ready: false,
          missingDimensions: [],
          coveredDimensions: [],
          skippedDimensions: [],
        },
        path: '/plans/test-session.md',
      };
      globalThis.fetch = makeFetchMock(200, mockBody);
      const result = await fetchSessionPlanShow({ session: 'test-session' });
      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain(API_ROUTES.sessionPlanShow);
      expect(url).toContain('session=test-session');
      expect(result).toEqual(mockBody);
    });

    it('URL-encodes special characters in the session parameter', async () => {
      const mockBody = {
        plan: {
          session: 'my session',
          topic: '',
          status: 'planning',
          planning_type: 'feature',
          planning_depth: 'focused',
          required_dimensions: [],
          optional_dimensions: [],
          skipped_dimensions: [],
          open_questions: [],
          profile: null,
          body: '',
        },
        readiness: { ready: false, missingDimensions: [], coveredDimensions: [], skippedDimensions: [] },
        path: '/plans/my-session.md',
      };
      globalThis.fetch = makeFetchMock(200, mockBody);
      await fetchSessionPlanShow({ session: 'my session' });
      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      // URLSearchParams encodes spaces as '+'
      expect(url).toContain('session=my+session');
    });

    it('throws on non-2xx response', async () => {
      globalThis.fetch = makeFetchMock(404, {});
      await expect(fetchSessionPlanShow({ session: 'missing' })).rejects.toThrow('HTTP 404');
    });
  });

  // ---------------------------------------------------------------------------
  // fetchSessionPlanSetList
  // ---------------------------------------------------------------------------

  describe('fetchSessionPlanSetList', () => {
    it('calls API_ROUTES.sessionPlanSetList without query when includeSubmitted is not set', async () => {
      const mockBody = { planSets: [] };
      globalThis.fetch = makeFetchMock(200, mockBody);
      const result = await fetchSessionPlanSetList({});
      expect(globalThis.fetch).toHaveBeenCalledOnce();
      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toBe(API_ROUTES.sessionPlanSetList);
      expect(result).toEqual(mockBody);
    });

    it('appends includeSubmitted=true when requested', async () => {
      globalThis.fetch = makeFetchMock(200, { planSets: [] });
      await fetchSessionPlanSetList({ includeSubmitted: true });
      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain(API_ROUTES.sessionPlanSetList);
      expect(url).toContain('includeSubmitted=true');
    });

    it('does not append any query string when includeSubmitted is false', async () => {
      globalThis.fetch = makeFetchMock(200, { planSets: [] });
      await fetchSessionPlanSetList({ includeSubmitted: false });
      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).not.toContain('includeSubmitted');
      expect(url).not.toContain('?');
    });

    it('forwards the AbortSignal to fetch', async () => {
      globalThis.fetch = makeFetchMock(200, { planSets: [] });
      const controller = new AbortController();
      await fetchSessionPlanSetList({ signal: controller.signal });
      const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as
        | { signal?: AbortSignal }
        | undefined;
      expect(init?.signal).toBe(controller.signal);
    });

    it('throws on non-2xx response', async () => {
      globalThis.fetch = makeFetchMock(500, {});
      await expect(fetchSessionPlanSetList({})).rejects.toThrow('HTTP 500');
    });
  });

  // ---------------------------------------------------------------------------
  // fetchSessionPlanSetShow
  // ---------------------------------------------------------------------------

  describe('fetchSessionPlanSetShow', () => {
    it('calls API_ROUTES.sessionPlanSetShow with the planSetId query param', async () => {
      const mockBody = { planSet: {}, validation: {}, dir: '/d', manifestPath: '/d/plan-set.yaml' };
      globalThis.fetch = makeFetchMock(200, mockBody);
      const result = await fetchSessionPlanSetShow({ planSetId: 'set-one' });
      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain(API_ROUTES.sessionPlanSetShow);
      expect(url).toContain('planSetId=set-one');
      expect(result).toEqual(mockBody);
    });

    it('URL-encodes special characters in the planSetId parameter', async () => {
      globalThis.fetch = makeFetchMock(200, {});
      await fetchSessionPlanSetShow({ planSetId: 'a b/c' });
      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      // URLSearchParams encodes spaces as '+' and '/' as '%2F'.
      expect(url).toContain('planSetId=a+b%2Fc');
    });

    it('throws on non-2xx response', async () => {
      globalThis.fetch = makeFetchMock(404, {});
      await expect(fetchSessionPlanSetShow({ planSetId: 'missing' })).rejects.toThrow('HTTP 404');
    });
  });

  // ---------------------------------------------------------------------------
  // fetchSessionPlanSetValidate
  // ---------------------------------------------------------------------------

  describe('fetchSessionPlanSetValidate', () => {
    it('calls API_ROUTES.sessionPlanSetValidate with the planSetId query param', async () => {
      const mockBody = { ok: true, diagnostics: [], summary: {} };
      globalThis.fetch = makeFetchMock(200, mockBody);
      const result = await fetchSessionPlanSetValidate({ planSetId: 'set-one' });
      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain(API_ROUTES.sessionPlanSetValidate);
      expect(url).toContain('planSetId=set-one');
      expect(result).toEqual(mockBody);
    });

    it('URL-encodes special characters in the planSetId parameter', async () => {
      globalThis.fetch = makeFetchMock(200, {});
      await fetchSessionPlanSetValidate({ planSetId: 'a b/c' });
      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain('planSetId=a+b%2Fc');
    });

    it('throws on non-2xx response', async () => {
      globalThis.fetch = makeFetchMock(500, {});
      await expect(fetchSessionPlanSetValidate({ planSetId: 'x' })).rejects.toThrow('HTTP 500');
    });
  });
});
