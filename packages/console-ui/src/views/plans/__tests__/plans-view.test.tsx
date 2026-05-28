// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { API_ROUTES } from '@eforge-build/client/browser';
import { PlansView } from '../plans-view';

global.ResizeObserver = vi.fn().mockImplementation(function (this: {
  observe: () => void;
  unobserve: () => void;
  disconnect: () => void;
}) {
  this.observe = vi.fn();
  this.unobserve = vi.fn();
  this.disconnect = vi.fn();
});

vi.mock('@/components/preview/plan-body-highlight', () => ({
  PlanBodyHighlight: ({ content }: { content: string }) => (
    <div data-testid="plan-body-highlight">{content}</div>
  ),
}));

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
      optional_dimensions: [],
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

function makeFetchMock(listResponse: unknown, showResponse: unknown = null) {
  return vi.fn((url: string) => {
    const body = url.includes(API_ROUTES.sessionPlanShow)
      ? showResponse
      : url.includes(API_ROUTES.sessionPlanList)
        ? listResponse
        : null;

    return Promise.resolve({
      ok: body !== null,
      status: body !== null ? 200 : 404,
      statusText: body !== null ? 'OK' : 'Not Found',
      json: () => Promise.resolve(body),
    });
  });
}

describe('PlansView', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches actionable plans by default and renders the empty state', async () => {
    const fetchMock = makeFetchMock({ plans: [] });
    globalThis.fetch = fetchMock;

    render(<PlansView />);

    await waitFor(() => {
      expect(screen.getByText('No actionable session plans found')).toBeDefined();
    });

    const listCalls = fetchMock.mock.calls
      .map((call) => call[0] as string)
      .filter((url) => url.includes(API_ROUTES.sessionPlanList));
    expect(listCalls[0]).not.toContain('includeSubmitted');
  });

  it('refetches with includeSubmitted=true when the handed-off toggle changes', async () => {
    const fetchMock = makeFetchMock({ plans: [] });
    globalThis.fetch = fetchMock;

    render(<PlansView />);
    await waitFor(() => screen.getByText('No actionable session plans found'));

    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: /include handed off/i }));
    });

    await waitFor(() => {
      const submittedCalls = fetchMock.mock.calls
        .map((call) => call[0] as string)
        .filter((url) => url.includes(API_ROUTES.sessionPlanList) && url.includes('includeSubmitted=true'));
      expect(submittedCalls.length).toBeGreaterThan(0);
      expect(screen.getByText('No session plans found')).toBeDefined();
    });
  });

  it('auto-selects the first returned plan and fetches its detail', async () => {
    const plan = makeActivePlan();
    const fetchMock = makeFetchMock({ plans: [plan] }, makeShowResponse());
    globalThis.fetch = fetchMock;

    render(<PlansView />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sess-active-1.*Add feature X/i })).toBeDefined();
      const showCalls = fetchMock.mock.calls
        .map((call) => call[0] as string)
        .filter((url) => url.includes(API_ROUTES.sessionPlanShow));
      expect(showCalls[0]).toContain('session=sess-active-1');
    });
  });

  it('selecting another plan fetches and displays that plan detail', async () => {
    const plan1 = makeActivePlan({ session: 'sess-plan-1', topic: 'Plan One' });
    const plan2 = makeActivePlan({ session: 'sess-plan-2', topic: 'Plan Two' });
    const fetchMock = vi.fn((url: string) => {
      const body = url.includes(API_ROUTES.sessionPlanShow) && url.includes('sess-plan-2')
        ? makeShowResponse({ session: 'sess-plan-2', topic: 'Plan Two' })
        : url.includes(API_ROUTES.sessionPlanShow)
          ? makeShowResponse({ session: 'sess-plan-1', topic: 'Plan One' })
          : { plans: [plan1, plan2] };

      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) });
    });
    globalThis.fetch = fetchMock;

    render(<PlansView />);
    await waitFor(() => screen.getByRole('button', { name: /sess-plan-2/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sess-plan-2/i }));
    });

    await waitFor(() => {
      const showCalls = fetchMock.mock.calls
        .map((call) => call[0] as string)
        .filter((url) => url.includes(API_ROUTES.sessionPlanShow) && url.includes('sess-plan-2'));
      expect(showCalls.length).toBeGreaterThan(0);
      expect(screen.getAllByText('Plan Two').length).toBeGreaterThan(0);
    });
  });

  it('routes submitted-plan build-session links through onNavigate', async () => {
    const submitted = makeSubmittedPlan();
    globalThis.fetch = makeFetchMock(
      { plans: [submitted] },
      makeShowResponse({
        session: 'sess-submitted-1',
        status: 'submitted',
        eforge_session: 'run-123',
      }),
    );
    const onNavigate = vi.fn();

    render(<PlansView onNavigate={onNavigate} />);

    await waitFor(() => expect(screen.getByRole('link', { name: 'run-123' })).toBeDefined());
    fireEvent.click(screen.getByRole('link', { name: 'run-123' }));

    expect(onNavigate).toHaveBeenCalledWith('/console/runs/run-123');
  });

  it('renders list errors as an alert', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.resolve({}),
    })) as never;

    render(<PlansView />);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('503');
    });
  });
});
