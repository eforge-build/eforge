import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { QueueCascadeApplyRequest, QueueCascadePreviewResponse } from '@eforge-build/client/browser';
import { QueueCascadeAction } from '../queue-cascade-action';

const allow = { allowed: true };

function preview(overrides: Partial<QueueCascadePreviewResponse> = {}): QueueCascadePreviewResponse {
  return {
    target: { prdId: 'parent', title: 'Parent', status: 'pending', location: 'queue', dependsOn: [], depth: 0, effect: 'target-remove', blockers: [] },
    dependents: [
      { prdId: 'child', title: 'Child', status: 'waiting', location: 'waiting', dependsOn: ['parent'], depth: 1, effect: 'dependent-remove', blockers: [] },
    ],
    defaultRefusalReason: 'Dependents exist; choose cascade to mutate them.',
    safeStrategies: ['cascade-dependents'],
    warnings: [],
    blockers: [],
    expectedAffected: { token: 'opaque-token', prdIds: ['parent', 'child'] },
    ...overrides,
  };
}

function renderAction(overrides: Partial<Parameters<typeof QueueCascadeAction>[0]> = {}) {
  const onPreviewCascade = overrides.onPreviewCascade ?? vi.fn().mockResolvedValue(preview());
  const onApplyCascade = overrides.onApplyCascade ?? vi.fn().mockResolvedValue({ applied: true, operation: 'remove', strategy: 'target-only', target: { prdId: 'parent', previousStatus: 'pending', status: 'removed' }, dependents: [], warnings: [], blockers: [] });
  const utils = render(
    <QueueCascadeAction
      itemId="parent"
      itemTitle="Parent"
      operation="remove"
      capability={allow}
      cascadeCapability={allow}
      {...overrides}
      onPreviewCascade={onPreviewCascade}
      onApplyCascade={onApplyCascade}
    />,
  );
  return { ...utils, onPreviewCascade, onApplyCascade };
}

describe('QueueCascadeAction', () => {
  it('does not preview during render and loads preview only when opened', async () => {
    const { onPreviewCascade } = renderAction();
    expect(onPreviewCascade).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));

    await screen.findByText('Affects 2 PRDs.');
    expect(onPreviewCascade).toHaveBeenCalledWith('parent', 'remove');
    expect(screen.getByText('child · Child')).toBeDefined();
    expect(screen.getByText('waiting · dependent-remove · depth 1')).toBeDefined();
  });

  it('sends target-only apply by default and surfaces daemon refusal while keeping the dialog open', async () => {
    const refused = { applied: false, operation: 'remove' as const, strategy: 'target-only' as const, target: { prdId: 'parent', previousStatus: 'pending' as const, status: 'pending' as const }, dependents: [], warnings: [], blockers: ['Target has dependents'] };
    const { onApplyCascade } = renderAction({ onApplyCascade: vi.fn().mockResolvedValue(refused) });

    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
    await screen.findByText('Affects 2 PRDs.');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(onApplyCascade).toHaveBeenCalledWith('parent', expect.objectContaining({ strategy: 'target-only', confirmDependents: false })));
    expect(screen.getByRole('alert').textContent).toContain('Target has dependents');
    expect(screen.getByRole('alertdialog')).toBeDefined();
  });

  it('requires explicit cascade confirmation before sending cascade-dependents', async () => {
    const applied = { applied: true, operation: 'remove' as const, strategy: 'cascade-dependents' as const, target: { prdId: 'parent', previousStatus: 'pending' as const, status: 'removed' as const }, dependents: [], warnings: [], blockers: [] };
    const { onApplyCascade } = renderAction({ onApplyCascade: vi.fn().mockResolvedValue(applied) });

    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
    await screen.findByText('Affects 2 PRDs.');
    fireEvent.click(screen.getByText('Cascade to dependents'));
    expect((within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText('Confirm dependent mutation'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(onApplyCascade).toHaveBeenCalledWith('parent', expect.objectContaining({ strategy: 'cascade-dependents', confirmDependents: true } satisfies Partial<QueueCascadeApplyRequest>)));
  });

  it('renders disabled reason from denied capability', () => {
    renderAction({ capability: { allowed: false, reason: 'Remove denied by daemon' } });

    expect((screen.getByRole('button', { name: 'Remove…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Remove denied by daemon')).toBeDefined();
  });
});
