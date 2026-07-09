import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import type { EforgeBridge, PlanData, PlanDetail } from '@/types';
import { PlanDetailCard } from './plan-detail';

function renderPartialPlan() {
  window.eforge = { invokeAction: vi.fn(async () => ({})) as EforgeBridge['invokeAction'] };
  const plan: PlanData = {
    session: 'partial-plan',
    topic: 'Partial plan',
    status: 'ready',
    planning_type: 'feature',
    planning_depth: 'focused',
    required_dimensions: ['problem-statement'],
    sections: { 'problem statement': 'Problem details.' },
    partialReasons: [{ code: 'mixed-source-states', message: 'Lifecycle projection is partial because linked source items have mixed lifecycle states: planned, shipped.' }],
    statusSourceDisclosure: 'status source = canonical eforge-plan SQLite session-plan status records in the eforge-plan extension store; lifecycle/projection records, monitor events, event-tail output, and status fields are derived evidence or diagnostics.',
  };
  const detail: PlanDetail & { plan: PlanData } = {
    plan,
    readiness: { ready: true, coveredDimensions: ['problem-statement'], missingDimensions: [], skippedDimensions: [] },
    statusSourceDisclosure: plan.statusSourceDisclosure,
    lifecycle: {
      sourceRefs: { sourceItemIds: ['planned', 'shipped'], sourceEpicIds: [] },
      lifecycleState: 'partial',
      partialReasons: plan.partialReasons,
      itemRows: [],
      linkRows: [],
      failureEvidence: [],
    },
  };

  render(
    <ToastProvider>
      <PlanDetailCard
        detail={detail}
        artifact={null}
        revision={{ busy: false, loading: false, hasRunningTurn: false } as any}
        locked={false}
        onSelectAnnotationTarget={vi.fn()}
        onApply={vi.fn()}
        onRefresh={vi.fn(async () => undefined)}
        onHandoff={vi.fn(async () => undefined)}
        onDeleted={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />
    </ToastProvider>,
  );
}

describe('PlanDetailCard partial lifecycle explanation', () => {
  it('renders partial reason metadata and canonical status-source disclosure', () => {
    renderPartialPlan();

    expect(screen.getByText('partial lifecycle')).toBeTruthy();
    expect(screen.getByText('Partial lifecycle projection')).toBeTruthy();
    expect(screen.getAllByText('Lifecycle projection is partial because linked source items have mixed lifecycle states: planned, shipped.').length).toBeGreaterThan(0);
    expect(screen.getByText(/status source = canonical eforge-plan SQLite session-plan status records/)).toBeTruthy();
  });

  it('renders a two-step resubmit action for recoverable submitted plans', async () => {
    const invokeAction = vi.fn(async (actionId: string) => actionId === 'resubmit-session-plan' ? { kind: 'enqueued', message: 'Resubmitted.' } : {});
    window.eforge = { invokeAction: invokeAction as EforgeBridge['invokeAction'] };
    const plan: PlanData = {
      session: 'recoverable-plan',
      topic: 'Recoverable plan',
      status: 'submitted',
      planning_type: 'feature',
      planning_depth: 'focused',
      sections: { 'problem statement': 'Problem details.' },
      failureEvidence: [{ kind: 'queue-prd', status: 'failed', session: 'recoverable-plan', id: 'old-queue' } as any],
    };
    const detail: PlanDetail & { plan: PlanData } = {
      plan,
      readiness: { ready: true, coveredDimensions: ['problem-statement'], missingDimensions: [], skippedDimensions: [] },
      lifecycle: { sourceRefs: { sourceItemIds: [], sourceEpicIds: [] }, lifecycleState: 'failed', partialReasons: [], itemRows: [], linkRows: [], failureEvidence: plan.failureEvidence },
    };

    render(
      <ToastProvider>
        <PlanDetailCard
          detail={detail}
          artifact={null}
          revision={{ busy: false, loading: false, hasRunningTurn: false } as any}
          locked={false}
          onSelectAnnotationTarget={vi.fn()}
          onApply={vi.fn()}
          onRefresh={vi.fn(async () => undefined)}
          onHandoff={vi.fn(async () => undefined)}
          onDeleted={vi.fn(async () => undefined)}
          onClose={vi.fn()}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Resubmit/ }));
    const confirm = await screen.findByRole('button', { name: /Confirm resubmit/ });
    fireEvent.click(confirm);

    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('resubmit-session-plan', { session: 'recoverable-plan' }));
  });
});
