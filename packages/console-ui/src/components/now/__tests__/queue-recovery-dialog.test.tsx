import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { QueueRecoveryDialog } from '../queue-recovery-dialog';
import {
  applyQueueRecovery,
  fetchQueueRecoveryAnalysis,
  QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE,
  type QueueRecoveryAnalyzeResponse,
  type QueueRecoveryApplyResponse,
} from '@eforge-build/client/browser';

vi.mock('@eforge-build/client/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@eforge-build/client/browser')>();
  return {
    ...actual,
    fetchQueueRecoveryAnalysis: vi.fn(),
    applyQueueRecovery: vi.fn(),
  };
});

function analysis(overrides: Partial<QueueRecoveryAnalyzeResponse> = {}): QueueRecoveryAnalyzeResponse {
  return {
    selectedPrdId: 'failed-upstream',
    strategy: QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE,
    eligible: true,
    nodes: [
      {
        id: 'failed-upstream',
        title: 'Failed upstream',
        location: 'failed',
        status: 'failed',
        dependsOn: [],
        role: 'selected-failed-upstream',
      },
      {
        id: 'child',
        title: 'Skipped child',
        location: 'skipped',
        status: 'skipped',
        dependsOn: ['failed-upstream'],
        role: 'skipped-descendant',
      },
      {
        id: 'grandchild',
        title: 'Skipped grandchild',
        location: 'skipped',
        status: 'skipped',
        dependsOn: ['child'],
        role: 'skipped-descendant',
      },
    ],
    edges: [
      { dependentId: 'child', dependencyId: 'failed-upstream' },
      { dependentId: 'grandchild', dependencyId: 'child' },
    ],
    operations: [
      {
        id: 'op-failed',
        kind: 'move-prd',
        prdId: 'failed-upstream',
        expectedSourceLocation: 'failed',
        targetLocation: 'queue',
        reason: 'retry failed upstream',
      },
      {
        id: 'op-child',
        kind: 'move-prd',
        prdId: 'child',
        expectedSourceLocation: 'skipped',
        targetLocation: 'waiting',
        reason: 'reactivate descendant',
      },
    ],
    warnings: [],
    blockers: [],
    ...overrides,
  };
}

function applyResponse(overrides: Partial<QueueRecoveryApplyResponse> = {}): QueueRecoveryApplyResponse {
  const base = analysis();
  return {
    selectedPrdId: base.selectedPrdId,
    strategy: base.strategy,
    applied: true,
    operationResults: base.operations.map((operation) => ({ operation, status: 'applied' })),
    warnings: [],
    blockers: [],
    ...overrides,
  };
}

function renderDialog(refreshQueue = vi.fn()) {
  render(
    <QueueRecoveryDialog
      open
      prdId="failed-upstream"
      prdTitle="Failed upstream"
      onOpenChange={vi.fn()}
      refreshQueue={refreshQueue}
    />,
  );
  return { refreshQueue };
}

beforeEach(() => {
  vi.mocked(fetchQueueRecoveryAnalysis).mockReset();
  vi.mocked(applyQueueRecovery).mockReset();
});

describe('QueueRecoveryDialog', () => {
  it('renders dry-run skipped descendants, edges, and planned operations before apply is enabled', async () => {
    vi.mocked(fetchQueueRecoveryAnalysis).mockResolvedValue(analysis());
    renderDialog();

    expect(screen.getByText(/Loading queue recovery analysis/)).toBeDefined();
    await screen.findByText('Skipped child');

    expect(screen.getByText('Skipped grandchild')).toBeDefined();
    expect(screen.getByText('child depends on failed-upstream')).toBeDefined();
    expect(screen.getByText(/failed-upstream: failed → queue/)).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply recovery' }).disabled).toBe(false);
  });

  it('requires warning acknowledgement before apply', async () => {
    vi.mocked(fetchQueueRecoveryAnalysis).mockResolvedValue(analysis({
      warnings: [{ code: 'low-confidence', message: 'Low confidence recovery verdict', severity: 'warning' }],
    }));
    renderDialog();

    await screen.findByText(/Low confidence recovery verdict/);
    const applyButton = screen.getByRole('button', { name: 'Apply recovery' });
    expect((applyButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Acknowledge queue recovery warnings'));
    expect((applyButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps apply disabled when blockers are present', async () => {
    vi.mocked(fetchQueueRecoveryAnalysis).mockResolvedValue(analysis({
      blockers: [{ code: 'missing-node', message: 'Descendant is no longer skipped', severity: 'blocker' }],
    }));
    renderDialog();

    await screen.findByText(/Descendant is no longer skipped/);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply recovery' }).disabled).toBe(true);
  });

  it('calls queue refresh once after apply success', async () => {
    vi.mocked(fetchQueueRecoveryAnalysis).mockResolvedValue(analysis());
    vi.mocked(applyQueueRecovery).mockResolvedValue(applyResponse());
    const refreshQueue = vi.fn();
    renderDialog(refreshQueue);

    await screen.findByText(/failed-upstream: failed → queue/);
    fireEvent.click(screen.getByRole('button', { name: 'Apply recovery' }));

    await screen.findByText('Queue recovery applied.');
    expect(refreshQueue).toHaveBeenCalledTimes(1);
  });

  it('keeps daemon apply failure visible', async () => {
    vi.mocked(fetchQueueRecoveryAnalysis).mockResolvedValue(analysis());
    vi.mocked(applyQueueRecovery).mockResolvedValue(applyResponse({
      applied: false,
      blockers: [{ code: 'source-moved', message: 'Expected skipped file was moved', severity: 'blocker' }],
      operationResults: [],
    }));
    renderDialog();

    await screen.findByText(/failed-upstream: failed → queue/);
    fireEvent.click(screen.getByRole('button', { name: 'Apply recovery' }));

    await waitFor(() => expect(screen.getByText('Queue recovery was not applied.')).toBeDefined());
    expect(screen.getByText(/Expected skipped file was moved/)).toBeDefined();
  });
});
