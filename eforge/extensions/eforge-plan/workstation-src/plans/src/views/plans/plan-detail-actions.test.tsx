import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import type { EforgeBridge, PlanData, PlanDetail } from '@/types';
import { PlanDetailCard } from './plan-detail';

const sections = {
  'problem-statement': 'Problem',
  scope: 'Scope',
  'acceptance-criteria': 'Done means it works.',
};

function renderPlan(plan: Partial<PlanData>) {
  const invokeAction = vi.fn(async (actionId: string) => {
    if (actionId === 'get-plan-revision-session') throw new Error('revision session not found');
    return {};
  });
  window.eforge = { invokeAction: invokeAction as EforgeBridge['invokeAction'] };
  const fullPlan: PlanData = {
    session: 'session-one',
    topic: 'Session one',
    status: 'planning',
    planning_type: 'feature',
    planning_depth: 'focused',
    required_dimensions: Object.keys(sections),
    sections,
    ...plan,
  };
  const detail: PlanDetail & { plan: PlanData } = {
    plan: fullPlan,
    readiness: { ready: true, coveredDimensions: Object.keys(sections), missingDimensions: [], skippedDimensions: [] },
  };
  render(<ToastProvider><PlanDetailCard detail={detail} revision={{ busy: false, loading: false, hasRunningTurn: false } as any} locked={false} onSelectAnnotationTarget={vi.fn()} onApply={vi.fn()} onRefresh={vi.fn(async () => undefined)} onDeleted={vi.fn(async () => undefined)} /></ToastProvider>);
  return { invokeAction };
}

describe('PlanDetailCard handoff actions', () => {
  it('asks for ready status before enabling handoff when checks pass', () => {
    renderPlan({ status: 'planning' });

    expect(screen.queryByRole('button', { name: /Check readiness/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Set ready/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Mark ready/i })).toBeTruthy();
    expect((screen.getByRole('button', { name: /Handoff/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Checks pass · mark ready to hand off/i)).toBeTruthy();
  });

  it('enables handoff without duplicate ready badges once the plan is ready', () => {
    renderPlan({ status: 'ready' });

    expect(screen.queryByRole('button', { name: /Check readiness/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mark ready|Set ready/i })).toBeNull();
    expect((screen.getByRole('button', { name: /Handoff/i }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('Ready for handoff')).toBeTruthy();
    expect(screen.queryByText(/^ready$/i)).toBeNull();
  });
});
