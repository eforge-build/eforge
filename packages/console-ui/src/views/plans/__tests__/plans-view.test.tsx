// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { API_ROUTES } from '@eforge-build/client/browser';
import { PlansView } from '../plans-view';

// ---------------------------------------------------------------------------
// jsdom compatibility
// ---------------------------------------------------------------------------

global.ResizeObserver = vi.fn().mockImplementation(function (this: {
  observe: () => void;
  unobserve: () => void;
  disconnect: () => void;
}) {
  this.observe = vi.fn();
  this.unobserve = vi.fn();
  this.disconnect = vi.fn();
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Stub shiki-dependent renderer to avoid heavy async deps in tests
vi.mock('@/components/preview/plan-body-highlight', () => ({
  PlanBodyHighlight: ({ content }: { content: string }) => (
    <div data-testid="plan-body-highlight">{content}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeActivePlan(overrides: Record<string, unknown> = {}) {
  return {
    session: 'sess-active-1',
    topic: 'Add feature X',
    status: 'planning',
    path: '/plans/sess-active-1.md',
    ready: false,
    missingDimensions: ['acceptance_criteria'],
    ...overrides,
  };
}

function makeSubmittedPlan(overrides: Record<string, unknown> = {}) {
  return {
    session: 'sess-submitted-1',
    topic: 'Build complete',
    status: 'submitted',
    path: '/plans/sess-submitted-1.md',
    ready: true,
    missingDimensions: [],
    eforge_session: 'run-123',
    ...overrides,
  };
}

function makeShowResponse(planOverrides: Record<string, unknown> = {}) {
  return {
    plan: {
      session: 'sess-active-1',
      topic: 'Add feature X',
      status: 'planning',
      planning_type: 'feature',
      planning_depth: 'focused',
      required_dimensions: ['problem_statement', 'acceptance_criteria'],
      optional_dimensions: ['performance'],
      skipped_dimensions: [],
      open_questions: [],
      profile: null,
      body: '# Session Plan\n\nThis is the plan body.',
      ...planOverrides,
    },
    readiness: {
      ready: false,
      missingDimensions: ['acceptance_criteria'],
      coveredDimensions: ['problem_statement'],
      skippedDimensions: [],
    },
    path: '/plans/sess-active-1.md',
  };
}

function makeFetchMock(
  listResponse: unknown,
  showResponse: unknown = null,
) {
  return vi.fn((url: string) => {
    let body: unknown;
    if (url.includes(API_ROUTES.sessionPlanShow)) {
      body = showResponse;
    } else if (url.includes(API_ROUTES.sessionPlanList)) {
      body = listResponse;
    } else {
      body = null;
    }
    return Promise.resolve({
      ok: body !== null,
      status: body !== null ? 200 : 404,
      statusText: body !== null ? 'OK' : 'Not Found',
      json: () => Promise.resolve(body),
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlansView', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Header and controls
  // ---------------------------------------------------------------------------

  it('renders the Planning Workspace heading', () => {
    globalThis.fetch = makeFetchMock({ plans: [] });
    render(<PlansView />);
    expect(screen.getByText('Planning Workspace')).toBeDefined();
  });

  it('renders the Include handed off toggle switch', () => {
    globalThis.fetch = makeFetchMock({ plans: [] });
    render(<PlansView />);
    expect(screen.getByRole('switch', { name: /include handed off/i })).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Default filtering (no includeSubmitted)
  // ---------------------------------------------------------------------------

  it('shows empty-active text when list returns no plans', async () => {
    globalThis.fetch = makeFetchMock({ plans: [] });
    render(<PlansView />);
    await waitFor(() => {
      expect(screen.getByText('No actionable session plans found')).toBeDefined();
    });
  });

  it('fetches list without includeSubmitted by default', async () => {
    const fetchMock = makeFetchMock({ plans: [] });
    globalThis.fetch = fetchMock;
    render(<PlansView />);
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => c[0] as string);
      const listCalls = calls.filter((u) => u.includes(API_ROUTES.sessionPlanList));
      expect(listCalls.length).toBeGreaterThan(0);
      expect(listCalls[0]).not.toContain('includeSubmitted');
    });
  });

  it('renders an active plan row when list returns plans', async () => {
    const plan = makeActivePlan();
    globalThis.fetch = makeFetchMock({ plans: [plan] }, makeShowResponse());
    render(<PlansView />);
    await waitFor(() => {
      // Session ID appears in both the list row and the auto-selected detail panel.
      const matches = screen.getAllByText(plan.session);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('list row button has accessible name with session ID and topic', async () => {
    const plan = makeActivePlan();
    globalThis.fetch = makeFetchMock({ plans: [plan] }, makeShowResponse());
    render(<PlansView />);
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /sess-active-1.*Add feature X/i });
      expect(btn).toBeDefined();
    });
  });

  it('list row renders the file path for an active plan', async () => {
    const plan = makeActivePlan();
    globalThis.fetch = makeFetchMock({ plans: [plan] }, makeShowResponse());
    render(<PlansView />);
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /sess-active-1/i });
      expect(btn.textContent).toContain('/plans/sess-active-1.md');
    });
  });

  it('list row renders the eforge_session value for a submitted plan', async () => {
    const submitted = makeSubmittedPlan({ eforge_session: 'run-999' });
    const showResponse = makeShowResponse({
      session: 'sess-submitted-1',
      status: 'submitted',
      eforge_session: 'run-999',
    });
    globalThis.fetch = makeFetchMock({ plans: [submitted] }, showResponse);
    render(<PlansView />);
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /sess-submitted-1/i });
      expect(btn.textContent).toContain('run-999');
    });
  });

  // ---------------------------------------------------------------------------
  // Include-submitted filter
  // ---------------------------------------------------------------------------

  it('fetches list with includeSubmitted=true after toggling the switch', async () => {
    const fetchMock = makeFetchMock({ plans: [] });
    globalThis.fetch = fetchMock;
    render(<PlansView />);
    await waitFor(() => screen.getByText('No actionable session plans found'));

    const toggle = screen.getByRole('switch', { name: /include handed off/i });
    await act(async () => {
      fireEvent.click(toggle);
    });

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => c[0] as string);
      const submittedCalls = calls.filter(
        (u) => u.includes(API_ROUTES.sessionPlanList) && u.includes('includeSubmitted=true'),
      );
      expect(submittedCalls.length).toBeGreaterThan(0);
    });
  });

  it('shows "No session plans found" after toggling include-submitted when list is empty', async () => {
    const fetchMock = makeFetchMock({ plans: [] });
    globalThis.fetch = fetchMock;
    render(<PlansView />);
    await waitFor(() => screen.getByText('No actionable session plans found'));

    const toggle = screen.getByRole('switch', { name: /include handed off/i });
    await act(async () => {
      fireEvent.click(toggle);
    });

    await waitFor(() => {
      expect(screen.getByText('No session plans found')).toBeDefined();
    });
  });

  it('renders a submitted plan in the list when include-submitted is on', async () => {
    const submitted = makeSubmittedPlan();
    const showResponse = makeShowResponse({
      session: 'sess-submitted-1',
      status: 'submitted',
      eforge_session: 'run-123',
    });
    // First call: empty list; second call: submitted plan
    const fetchMock = vi.fn((url: string) => {
      const callCount = fetchMock.mock.calls.length;
      const isSubmittedCall =
        url.includes(API_ROUTES.sessionPlanList) && url.includes('includeSubmitted=true');
      let body: unknown;
      if (url.includes(API_ROUTES.sessionPlanShow)) {
        body = showResponse;
      } else if (isSubmittedCall) {
        body = { plans: [submitted] };
      } else {
        body = { plans: [] };
      }
      void callCount; // suppress unused var
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(body),
      });
    });
    globalThis.fetch = fetchMock;
    render(<PlansView />);
    await waitFor(() => screen.getByText('No actionable session plans found'));

    const toggle = screen.getByRole('switch', { name: /include handed off/i });
    await act(async () => {
      fireEvent.click(toggle);
    });

    await waitFor(() => {
      // Session ID appears in both the list row and the auto-selected detail panel.
      const matches = screen.getAllByText(submitted.session);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Detail panel
  // ---------------------------------------------------------------------------

  it('auto-fetches plan detail for the first plan after list loads', async () => {
    const plan = makeActivePlan();
    const fetchMock = makeFetchMock({ plans: [plan] }, makeShowResponse());
    globalThis.fetch = fetchMock;
    render(<PlansView />);
    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => c[0] as string);
      const showCalls = calls.filter((u) => u.includes(API_ROUTES.sessionPlanShow));
      expect(showCalls.length).toBeGreaterThan(0);
      expect(showCalls[0]).toContain('session=sess-active-1');
    });
  });

  it('clicking a second plan row fetches detail for that plan and renders its data', async () => {
    const plan1 = makeActivePlan({ session: 'sess-plan-1', topic: 'Plan One' });
    const plan2 = makeActivePlan({ session: 'sess-plan-2', topic: 'Plan Two' });
    const showPlan1 = makeShowResponse({ session: 'sess-plan-1', topic: 'Plan One' });
    const showPlan2 = makeShowResponse({ session: 'sess-plan-2', topic: 'Plan Two' });
    const fetchMock = vi.fn((url: string) => {
      let body: unknown;
      if (url.includes(API_ROUTES.sessionPlanShow) && url.includes('sess-plan-2')) {
        body = showPlan2;
      } else if (url.includes(API_ROUTES.sessionPlanShow)) {
        body = showPlan1;
      } else {
        body = { plans: [plan1, plan2] };
      }
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) });
    });
    globalThis.fetch = fetchMock;
    render(<PlansView />);

    // Wait for the first plan to be auto-selected
    await waitFor(() => screen.getByRole('button', { name: /sess-plan-2/i }));

    // Click the second plan row
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sess-plan-2/i }));
    });

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => c[0] as string);
      const showCalls = calls.filter((u) => u.includes(API_ROUTES.sessionPlanShow) && u.includes('sess-plan-2'));
      expect(showCalls.length).toBeGreaterThan(0);
    });

    // The detail panel should show plan2's topic (may appear in both list and detail panel)
    await waitFor(() => {
      const matches = screen.getAllByText('Plan Two');
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('renders lifecycle status in detail panel', async () => {
    const plan = makeActivePlan();
    globalThis.fetch = makeFetchMock({ plans: [plan] }, makeShowResponse());
    render(<PlansView />);
    await waitFor(() => {
      // "planning" appears as a status badge in the detail panel
      const badges = screen.getAllByText('planning');
      expect(badges.length).toBeGreaterThan(0);
    });
  });

  it('renders planning type in detail panel', async () => {
    const plan = makeActivePlan();
    globalThis.fetch = makeFetchMock({ plans: [plan] }, makeShowResponse());
    render(<PlansView />);
    await waitFor(() => {
      expect(screen.getByText('feature')).toBeDefined();
    });
  });

  it('renders planning depth in detail panel', async () => {
    const plan = makeActivePlan();
    globalThis.fetch = makeFetchMock({ plans: [plan] }, makeShowResponse());
    render(<PlansView />);
    await waitFor(() => {
      expect(screen.getByText('focused')).toBeDefined();
    });
  });

  it('renders path in detail panel', async () => {
    const plan = makeActivePlan();
    globalThis.fetch = makeFetchMock({ plans: [plan] }, makeShowResponse());
    render(<PlansView />);
    await waitFor(() => {
      // Path appears in both the list row and the detail panel
      const matches = screen.getAllByText('/plans/sess-active-1.md');
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('renders profile, required/optional/skipped dimensions, open questions, and readiness detail in detail panel', async () => {
    const plan = makeActivePlan();
    const richShowResponse = {
      plan: {
        session: 'sess-active-1',
        topic: 'Rich Plan',
        status: 'planning',
        planning_type: 'feature',
        planning_depth: 'focused',
        profile: 'analytics-heavy',
        required_dimensions: ['scope', 'acceptance_criteria'],
        optional_dimensions: ['performance'],
        skipped_dimensions: [{ name: 'migration', reason: 'not needed' }],
        open_questions: ['What is the rollout plan?'],
        body: '# Rich Plan',
      },
      readiness: {
        ready: false,
        missingDimensions: ['acceptance_criteria'],
        coveredDimensions: ['problem_statement_covered'],
        skippedDimensions: ['low_priority_skipped'],
      },
      path: '/plans/sess-active-1.md',
    };
    globalThis.fetch = makeFetchMock({ plans: [plan] }, richShowResponse);
    render(<PlansView />);
    await waitFor(() => {
      // Profile
      expect(screen.getByText('analytics-heavy')).toBeDefined();
      // Required dimensions
      expect(screen.getByText('scope')).toBeDefined();
      // acceptance_criteria appears in required_dimensions and missing_dimensions badges
      expect(screen.getAllByText('acceptance_criteria').length).toBeGreaterThan(0);
      // Optional dimensions
      expect(screen.getByText('performance')).toBeDefined();
      // Skipped dimensions (plan-level)
      expect(screen.getByText('migration')).toBeDefined();
      // Open questions
      expect(screen.getByText('What is the rollout plan?')).toBeDefined();
      // Readiness - covered dimensions section
      expect(screen.getByText('Covered dimensions')).toBeDefined();
      expect(screen.getByText('problem_statement_covered')).toBeDefined();
      // Readiness - missing dimensions section
      expect(screen.getByText('Missing dimensions')).toBeDefined();
      const allMissing = screen.getAllByText('acceptance_criteria');
      expect(allMissing.length).toBeGreaterThan(0);
      // Readiness - skipped dimensions section
      expect(screen.getByText('Skipped dimensions (readiness)')).toBeDefined();
      expect(screen.getByText('low_priority_skipped')).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Build session link
  // ---------------------------------------------------------------------------

  it('renders build session link with correct href for a submitted plan', async () => {
    const submitted = makeSubmittedPlan();
    const showResponse = makeShowResponse({
      session: 'sess-submitted-1',
      status: 'submitted',
      eforge_session: 'run-123',
    });
    globalThis.fetch = makeFetchMock({ plans: [submitted] }, showResponse);
    render(<PlansView />);
    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'run-123' });
      expect(link).toBeDefined();
      expect(link.getAttribute('href')).toBe('/console/runs/run-123');
    });
  });

  it('calls onNavigate with /console/runs/{id} when build session link is clicked', async () => {
    const submitted = makeSubmittedPlan();
    const showResponse = makeShowResponse({
      session: 'sess-submitted-1',
      status: 'submitted',
      eforge_session: 'run-123',
    });
    globalThis.fetch = makeFetchMock({ plans: [submitted] }, showResponse);
    const onNavigate = vi.fn();
    render(<PlansView onNavigate={onNavigate} />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'run-123' })).toBeDefined();
    });
    fireEvent.click(screen.getByRole('link', { name: 'run-123' }));
    expect(onNavigate).toHaveBeenCalledWith('/console/runs/run-123');
  });

  // ---------------------------------------------------------------------------
  // Markdown preview
  // ---------------------------------------------------------------------------

  it('renders the plan body text inside the markdown preview container', async () => {
    const plan = makeActivePlan();
    const showResponse = makeShowResponse({ body: '# My Plan\n\nSome content here.' });
    globalThis.fetch = makeFetchMock({ plans: [plan] }, showResponse);
    render(<PlansView />);
    await waitFor(() => {
      const preview = screen.getByTestId('plan-body-highlight');
      expect(preview.textContent).toContain('# My Plan');
    });
  });
});
