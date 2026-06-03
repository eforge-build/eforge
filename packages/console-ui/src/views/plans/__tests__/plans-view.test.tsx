/**
 * Integration-ish tests for PlansView — combined flat/plan-set browsing.
 *
 * The fetch mock is path-aware: flat-plan routes and plan-set routes return
 * different fixture payloads so we can assert combined browsing behavior, detail
 * rendering, diagnostics, and the absence of mutation controls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import { PlansView } from '../plans-view';
import { API_ROUTES } from '@eforge-build/client/browser';
import type {
  SessionPlanListResponse,
  SessionPlanShowResponse,
  SessionPlanSetListResponse,
  SessionPlanSetShowResponse,
} from '@eforge-build/client/browser';

// Mock the markdown highlighter so PlansView tests assert body propagation
// without pulling in asynchronous Shiki/highlighter initialization (which is
// unrelated to combined browsing and would make these tests slow/flaky).
vi.mock('@/components/preview/plan-body-highlight', () => ({
  PlanBodyHighlight: ({ content }: { content: string }) => (
    <pre data-testid="plan-body">{content}</pre>
  ),
}));

// ResizeObserver is not implemented in jsdom; ResizablePanelGroup needs it.
global.ResizeObserver = vi.fn().mockImplementation(function (this: {
  observe: () => void;
  unobserve: () => void;
  disconnect: () => void;
}) {
  this.observe = vi.fn();
  this.unobserve = vi.fn();
  this.disconnect = vi.fn();
});

const FLAT_LIST: SessionPlanListResponse = {
  plans: [
    {
      session: 's1',
      topic: 'Topic one',
      status: 'draft',
      ready: true,
      missingDimensions: [],
      path: '/plans/s1.md',
    },
  ],
};

const FLAT_SHOW: SessionPlanShowResponse = {
  plan: {
    session: 's1',
    topic: 'Topic one',
    status: 'draft',
    planning_type: 'feature',
    planning_depth: 'standard',
    required_dimensions: [],
    optional_dimensions: [],
    skipped_dimensions: [],
    open_questions: [],
    body: 'Flat plan body text',
  },
  readiness: {
    ready: true,
    coveredDimensions: [],
    missingDimensions: [],
    skippedDimensions: [],
  },
  path: '/plans/s1.md',
};

const PLAN_SET_LIST: SessionPlanSetListResponse = {
  planSets: [
    {
      id: 'set-one',
      planSetId: 'ps1',
      title: 'Set One',
      status: 'ready',
      strategy: 'parallel',
      dir: '/plan-sets/ps1',
      manifestPath: '/plan-sets/ps1/plan-set.yaml',
      childCount: 1,
    },
    {
      id: 'set-two',
      planSetId: 'ps2',
      title: 'Set Two',
      status: 'planning',
      strategy: 'sequential',
      dir: '/plan-sets/ps2',
      manifestPath: '/plan-sets/ps2/plan-set.yaml',
      childCount: 0,
    },
  ],
};

const PS1_CHILD = {
  id: 'child-1',
  file: 'children/child-1.md',
  kind: 'plan' as const,
  buildable: true,
  status: 'ready' as const,
  profile: 'default-profile',
  dependsOn: ['child-0'],
  exists: true,
  externalRefs: [
    { kind: 'github', ref: 'issue-42', title: 'Issue 42', url: 'https://example.com/42' },
  ],
  // child-1 depends on a child id that is not declared in the set, producing a
  // single unknown-child-dependency diagnostic — surfaced as the child's
  // validation summary.
  validation: { ok: false, diagnosticCount: 1 },
};

const PS1_DIAGNOSTIC = {
  severity: 'error' as const,
  code: 'unknown-child-dependency' as const,
  message: 'Child "child-1" depends on unknown child "child-0"',
  childId: 'child-1',
  dependency: 'child-0',
};

const PS1_SUMMARY = {
  id: 'set-one',
  title: 'Set One',
  status: 'ready' as const,
  strategy: 'parallel' as const,
  anchor: { file: 'umbrella.md', path: '/plan-sets/ps1/umbrella.md', exists: true },
  children: [PS1_CHILD],
  diagnostics: [PS1_DIAGNOSTIC],
  externalRefs: [],
};

const PLAN_SET_SHOW_PS1: SessionPlanSetShowResponse = {
  planSet: PS1_SUMMARY,
  validation: { ok: false, diagnostics: [PS1_DIAGNOSTIC], summary: PS1_SUMMARY },
  dir: '/plan-sets/ps1',
  manifestPath: '/plan-sets/ps1/plan-set.yaml',
  anchorContent: 'Umbrella context body',
};

const PS2_SUMMARY = {
  id: 'set-two',
  title: 'Set Two',
  status: 'planning' as const,
  strategy: 'sequential' as const,
  anchor: { file: 'umbrella.md', path: '/plan-sets/ps2/umbrella.md', exists: false },
  children: [],
  diagnostics: [],
  externalRefs: [],
};

const PLAN_SET_SHOW_PS2: SessionPlanSetShowResponse = {
  planSet: PS2_SUMMARY,
  validation: {
    ok: false,
    diagnostics: [
      { severity: 'error', code: 'missing-anchor', message: 'Anchor file not found', file: 'umbrella.md' },
    ],
    summary: PS2_SUMMARY,
  },
  dir: '/plan-sets/ps2',
  manifestPath: '/plan-sets/ps2/plan-set.yaml',
};

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

function setupFetch() {
  const fetchMock = vi.fn((input: string) => {
    const [path, query = ''] = input.split('?');
    const params = new URLSearchParams(query);
    if (path === API_ROUTES.sessionPlanList) return Promise.resolve(jsonResponse(FLAT_LIST));
    if (path === API_ROUTES.sessionPlanShow) return Promise.resolve(jsonResponse(FLAT_SHOW));
    if (path === API_ROUTES.sessionPlanSetList) {
      return Promise.resolve(jsonResponse(PLAN_SET_LIST));
    }
    if (path === API_ROUTES.sessionPlanSetShow) {
      const id = params.get('planSetId');
      return Promise.resolve(
        jsonResponse(id === 'ps2' ? PLAN_SET_SHOW_PS2 : PLAN_SET_SHOW_PS1),
      );
    }
    return Promise.reject(new Error(`unexpected fetch ${input}`));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Path-aware fetch mock driven by an explicit route→payload map. `failPath`
 * forces that route to resolve as a non-2xx response so list/detail error paths
 * can be exercised.
 */
function setupFetchWith(
  routes: Record<string, unknown>,
  opts: { failPath?: string } = {},
) {
  const fetchMock = vi.fn((input: string) => {
    const [path] = input.split('?');
    if (opts.failPath === path) {
      return Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        json: async () => ({}),
      });
    }
    if (path in routes) return Promise.resolve(jsonResponse(routes[path]));
    return Promise.reject(new Error(`unexpected fetch ${input}`));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function urls(fetchMock: ReturnType<typeof setupFetch>): string[] {
  return fetchMock.mock.calls.map((call) => call[0] as string);
}

describe('PlansView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('requests both list routes with no includeSubmitted query on initial load', async () => {
    const fetchMock = setupFetch();
    render(<PlansView />);
    await waitFor(() => expect(screen.getAllByText('Topic one')[0]).toBeTruthy());
    const called = urls(fetchMock);
    expect(called).toContain(API_ROUTES.sessionPlanList);
    expect(called).toContain(API_ROUTES.sessionPlanSetList);
    expect(called.some((u) => u.includes('includeSubmitted'))).toBe(false);
  });

  it('appends includeSubmitted=true to both list routes when toggled', async () => {
    const fetchMock = setupFetch();
    render(<PlansView />);
    await waitFor(() => expect(screen.getAllByText('Topic one')[0]).toBeTruthy());
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => {
      const called = urls(fetchMock);
      expect(called).toContain(`${API_ROUTES.sessionPlanList}?includeSubmitted=true`);
      expect(called).toContain(`${API_ROUTES.sessionPlanSetList}?includeSubmitted=true`);
    });
  });

  it('renders the flat plan row and detail with session, topic, status, readiness, and body', async () => {
    setupFetch();
    render(<PlansView />);
    await waitFor(() => expect(screen.getByText('Flat plan body text')).toBeTruthy());
    // Row + detail both reference the session id.
    expect(screen.getAllByText('s1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Topic one').length).toBeGreaterThan(0);
    expect(screen.getAllByText('draft').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ready').length).toBeGreaterThan(0);
  });

  it('renders plan-set rows with title, status, and child count', async () => {
    setupFetch();
    render(<PlansView />);
    await waitFor(() => expect(screen.getByText('Set One')).toBeTruthy());
    expect(screen.getByText('Set Two')).toBeTruthy();
    expect(screen.getByText('1 children')).toBeTruthy();
    expect(screen.getByText('0 children')).toBeTruthy();
  });

  it('requests sessionPlanSetShow with the selected planSetId when a plan set is selected', async () => {
    const fetchMock = setupFetch();
    render(<PlansView />);
    await waitFor(() => expect(screen.getByText('Set One')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /plan set Set One/ }));
    await waitFor(() => {
      expect(urls(fetchMock)).toContain(`${API_ROUTES.sessionPlanSetShow}?planSetId=ps1`);
    });
  });

  it('renders umbrella anchor content before the child list', async () => {
    setupFetch();
    render(<PlansView />);
    await waitFor(() => expect(screen.getByText('Set One')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /plan set Set One/ }));
    const anchor = await screen.findByText('Umbrella context body');
    const childHeading = screen.getByText(/Children \(1\)/);
    // Anchor must appear before the children heading in document order.
    expect(anchor.compareDocumentPosition(childHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('renders a missing-anchor diagnostic naming the anchor file', async () => {
    setupFetch();
    render(<PlansView />);
    await waitFor(() => expect(screen.getByText('Set Two')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /plan set Set Two/ }));
    await waitFor(() => expect(screen.getAllByText('missing-anchor').length).toBeGreaterThan(0));
    expect(screen.getAllByText('umbrella.md').length).toBeGreaterThan(0);
  });

  it('renders full child metadata for a plan set child', async () => {
    setupFetch();
    render(<PlansView />);
    await waitFor(() => expect(screen.getByText('Set One')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /plan set Set One/ }));
    await screen.findByText('Umbrella context body');

    // Scope status/state assertions to the child card so they don't match the
    // flat-plan readiness badge or set-level header text elsewhere on screen.
    const fileEl = screen.getByText('children/child-1.md');
    const card = fileEl.closest('.rounded-md');
    expect(card).not.toBeNull();
    const inCard = within(card as HTMLElement);

    expect(inCard.getByText('child-1')).toBeTruthy();
    expect(inCard.getByText('plan')).toBeTruthy();
    // Exact child status, buildability, and file presence.
    expect(inCard.getByText('ready')).toBeTruthy();
    expect(inCard.getByText('buildable')).toBeTruthy();
    expect(inCard.getByText('file present')).toBeTruthy();
    // Readiness/validation summary for the child.
    expect(inCard.getByText('validation: 1 error')).toBeTruthy();
    expect(inCard.getByText('profile: default-profile')).toBeTruthy();
    expect(inCard.getByText('child-0')).toBeTruthy();
    expect(inCard.getByText('github: issue-42')).toBeTruthy();
    expect(inCard.getByText('Issue 42', { exact: false })).toBeTruthy();
  });

  it('renders the plan-set detail header with identity, paths, and validation state', async () => {
    setupFetch();
    render(<PlansView />);
    await waitFor(() => expect(screen.getByText('Set One')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /plan set Set One/ }));
    // Manifest id is header-only, so its appearance signals the header rendered.
    await screen.findByText('set-one');

    // Title appears in both the list row and the header.
    expect(screen.getAllByText('Set One').length).toBeGreaterThan(0);
    // Manifest id and directory id (derived from the dir basename).
    expect(screen.getByText('set-one')).toBeTruthy();
    expect(screen.getByText('ps1')).toBeTruthy();
    // Strategy and manifest path are header-only.
    expect(screen.getByText('parallel')).toBeTruthy();
    expect(screen.getByText('/plan-sets/ps1/plan-set.yaml')).toBeTruthy();
    // The dir path also appears in the list row, so allow multiple matches.
    expect(screen.getAllByText('/plan-sets/ps1').length).toBeGreaterThan(0);
    // Status badge ('ready') and validation state badge.
    expect(screen.getAllByText('ready').length).toBeGreaterThan(0);
    expect(screen.getByText('validation: errors')).toBeTruthy();
    // 'plan set' badge appears in both the list row and the header.
    expect(screen.getAllByText('plan set').length).toBeGreaterThan(0);
  });

  it('renders the empty state when both lists are empty', async () => {
    setupFetchWith({
      [API_ROUTES.sessionPlanList]: { plans: [] },
      [API_ROUTES.sessionPlanSetList]: { planSets: [] },
    });
    render(<PlansView />);
    await waitFor(() =>
      expect(screen.getByText('No actionable session plans found')).toBeTruthy(),
    );
  });

  it('renders a list error alert when a list route fails', async () => {
    setupFetchWith(
      {
        [API_ROUTES.sessionPlanList]: { plans: [] },
        [API_ROUTES.sessionPlanSetList]: { planSets: [] },
      },
      { failPath: API_ROUTES.sessionPlanList },
    );
    render(<PlansView />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('HTTP 500');
  });

  it('navigates to the build session for a submitted flat plan via onNavigate', async () => {
    const submittedShow: SessionPlanShowResponse = {
      plan: {
        session: 's-sub',
        topic: 'Submitted topic',
        status: 'submitted',
        planning_type: 'feature',
        planning_depth: 'standard',
        required_dimensions: [],
        optional_dimensions: [],
        skipped_dimensions: [],
        open_questions: [],
        eforge_session: 'build-xyz',
        body: 'Body',
      },
      readiness: {
        ready: true,
        coveredDimensions: [],
        missingDimensions: [],
        skippedDimensions: [],
      },
      path: '/plans/s-sub.md',
    };
    setupFetchWith({
      [API_ROUTES.sessionPlanList]: {
        plans: [
          {
            session: 's-sub',
            topic: 'Submitted topic',
            status: 'submitted',
            ready: true,
            missingDimensions: [],
            path: '/plans/s-sub.md',
          },
        ],
      },
      [API_ROUTES.sessionPlanSetList]: { planSets: [] },
      [API_ROUTES.sessionPlanShow]: submittedShow,
    });
    const onNavigate = vi.fn();
    render(<PlansView onNavigate={onNavigate} />);
    const link = await screen.findByText('build-xyz');
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith('/console/builds/build-xyz');
  });

  it('shows no mutation controls for plan sets or children', async () => {
    setupFetch();
    render(<PlansView />);
    await waitFor(() => expect(screen.getByText('Set One')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /plan set Set One/ }));
    await screen.findByText('Umbrella context body');
    expect(screen.queryByText('Create plan set')).toBeNull();
    expect(screen.queryByText('Update plan set')).toBeNull();
    expect(screen.queryByText('Enqueue child')).toBeNull();
    expect(screen.queryByText('Submit child')).toBeNull();
  });
});
