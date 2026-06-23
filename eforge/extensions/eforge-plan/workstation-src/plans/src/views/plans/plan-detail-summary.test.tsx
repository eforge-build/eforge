import * as React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import type { EforgeBridge, PlanData, PlanDetail } from '@/types';
import { PlanDetailCard } from './plan-detail';

function renderPlan(plan: Partial<PlanData>) {
  const invokeAction = vi.fn(async () => ({}));
  window.eforge = { invokeAction: invokeAction as EforgeBridge['invokeAction'] };
  const fullPlan: PlanData = {
    session: 'session-one',
    topic: 'Session one',
    status: 'planning',
    planning_type: 'feature',
    planning_depth: 'focused',
    required_dimensions: ['problem-statement', 'scope'],
    sections: {},
    ...plan,
  };
  const detail: PlanDetail & { plan: PlanData } = {
    plan: fullPlan,
    readiness: { ready: false, coveredDimensions: ['problem-statement'], missingDimensions: ['scope'], skippedDimensions: [] },
  };
  render(
    <ToastProvider>
      <PlanDetailCard
        detail={detail}
        revision={{ busy: false, loading: false, hasRunningTurn: false } as any}
        locked={false}
        onSelectAnnotationTarget={vi.fn()}
        onApply={vi.fn()}
        onRefresh={vi.fn(async () => undefined)}
        onDeleted={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />
    </ToastProvider>,
  );
}

describe('PlanDetailCard executive summary', () => {
  it('renders the executive summary before readiness diagnostics', () => {
    renderPlan({ sections: { 'executive summary': 'Fast sign-off summary.', 'problem statement': 'Detailed problem.' } });

    const summary = screen.getByText('Fast sign-off summary.');
    const readiness = screen.getByText('Readiness');
    expect(summary.compareDocumentPosition(readiness) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders plans without an executive summary without throwing', () => {
    renderPlan({ sections: { 'problem statement': 'Detailed problem.' } });

    expect(screen.queryByText('Executive Summary')).toBeNull();
    expect(screen.getByText('Readiness')).toBeTruthy();
  });

  it('collapses detailed sections until expanded, then shows edit and annotation controls', () => {
    renderPlan({ sections: { 'executive summary': 'Summary.', 'problem statement': 'Problem details hidden until expanded.' } });

    expect(screen.queryByText('Problem details hidden until expanded.')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Toggle Problem Statement section' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    const section = toggle.closest('section');
    expect(section).toBeTruthy();
    const scoped = within(section as HTMLElement);
    expect(scoped.getByText('Problem details hidden until expanded.')).toBeTruthy();
    expect(scoped.getByRole('button', { name: /Edit Problem Statement/i })).toBeTruthy();
    expect(scoped.getByRole('button', { name: /Annotate section Problem Statement/i })).toBeTruthy();
  });
});
