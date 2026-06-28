import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { QueueCascadePreviewResponse } from '@eforge-build/client/browser';
import { AttentionPanel } from '../attention-panel';
import type { NowAttentionItem } from '@/lib/selectors/now';

function systemItem(): NowAttentionItem {
  return { id: 'stream-error', severity: 'critical', message: 'Daemon stream disconnected' };
}

function failedItem(): NowAttentionItem {
  return {
    id: 'queue-failed-verdict-my-prd',
    severity: 'warning',
    message: 'Failed: My PRD',
    detail: 'retry / high',
    recovery: { prdId: 'my-prd', prdTitle: 'My PRD', verdict: 'retry', confidence: 'high' },
  };
}

function preview(overrides: Partial<QueueCascadePreviewResponse> = {}): QueueCascadePreviewResponse {
  return {
    operation: 'remove',
    target: { prdId: 'my-prd', title: 'My PRD', status: 'failed', effect: 'remove', depth: 0, blockers: [] },
    dependents: [],
    expectedAffected: { prdIds: ['my-prd'] },
    warnings: [],
    blockers: [],
    ...overrides,
  };
}

function cleanupItem(capabilities: NonNullable<NowAttentionItem['queueCleanup']>['capabilities']): NowAttentionItem {
  return {
    ...failedItem(),
    queueCleanup: { prdId: 'my-prd', prdTitle: 'My PRD', capabilities },
  };
}

function cleanupControls(overrides: Partial<NonNullable<Parameters<typeof AttentionPanel>[0]['queueCleanupControls']>> = {}) {
  return {
    previewCascade: vi.fn().mockResolvedValue(preview()),
    applyCascade: vi.fn().mockResolvedValue({ applied: true, operation: 'remove', strategy: 'target-only', affected: { prdIds: ['my-prd'] }, warnings: [], blockers: [] }),
    ...overrides,
  };
}

describe('AttentionPanel', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(<AttentionPanel items={[]} hiddenCount={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a Recover button for items with a recovery payload and invokes onRecover', () => {
    const onRecover = vi.fn();
    render(
      <AttentionPanel
        items={[failedItem()]}
        hiddenCount={0}
        title="Needs attention"
        onRecover={onRecover}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /recover/i }));

    expect(onRecover).toHaveBeenCalledWith({
      prdId: 'my-prd',
      prdTitle: 'My PRD',
      verdict: 'retry',
      confidence: 'high',
    });
  });

  it('renders dispatch blocker text and passes dispatchFailure through Recover payloads', () => {
    const onRecover = vi.fn();
    const dispatchFailure = { reason: 'stack_parent is required', stage: 'stacking-validation' as const, timestamp: '2026-01-01T00:00:00.000Z' };
    render(
      <AttentionPanel
        items={[{ ...failedItem(), detail: 'Dispatch blocked before session:start (stacking-validation): stack_parent is required', recovery: { ...failedItem().recovery!, dispatchFailure } }]}
        hiddenCount={0}
        title="Needs attention"
        onRecover={onRecover}
      />,
    );

    expect(screen.getByText(/Dispatch blocked before session:start \(stacking-validation\): stack_parent is required/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /recover/i }));
    expect(onRecover).toHaveBeenCalledWith({
      prdId: 'my-prd',
      prdTitle: 'My PRD',
      verdict: 'retry',
      confidence: 'high',
      dispatchFailure,
    });
  });

  it('does not render a Recover button for system items without a recovery payload', () => {
    render(
      <AttentionPanel items={[systemItem()]} hiddenCount={0} onRecover={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: /recover/i })).toBeNull();
    expect(screen.getByText('Daemon stream disconnected')).toBeDefined();
  });

  it('omits the Recover button when no onRecover handler is provided', () => {
    render(<AttentionPanel items={[failedItem()]} hiddenCount={0} />);
    expect(screen.queryByRole('button', { name: /recover/i })).toBeNull();
  });

  it('renders Recover and Remove controls on the same failed queue row', () => {
    render(
      <AttentionPanel
        items={[cleanupItem({ remove: { allowed: true }, cascadeRemove: { allowed: true } })]}
        hiddenCount={0}
        onRecover={vi.fn()}
        queueCleanupControls={cleanupControls()}
      />,
    );

    expect(screen.getByRole('button', { name: /recover/i })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Remove…' })).toBeDefined();
  });

  it('renders direct remove cleanup when remove is allowed', () => {
    render(
      <AttentionPanel
        items={[cleanupItem({ remove: { allowed: true }, cascadeRemove: { allowed: false, reason: 'No dependents allowed' } })]}
        hiddenCount={0}
        queueCleanupControls={cleanupControls()}
      />,
    );

    expect((screen.getByRole('button', { name: 'Remove…' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders cascade-only cleanup when cascadeRemove is allowed', () => {
    render(
      <AttentionPanel
        items={[cleanupItem({ remove: { allowed: false, reason: 'Dependents require cascade' }, cascadeRemove: { allowed: true } })]}
        hiddenCount={0}
        queueCleanupControls={cleanupControls()}
      />,
    );

    expect((screen.getByRole('button', { name: 'Remove…' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('Dependents require cascade')).toBeDefined();
  });

  it('renders denied cleanup capability reason inline', () => {
    render(
      <AttentionPanel
        items={[cleanupItem({ remove: { allowed: false, reason: 'Remove denied by daemon' }, cascadeRemove: { allowed: false, reason: 'Cascade denied by daemon' } })]}
        hiddenCount={0}
        queueCleanupControls={cleanupControls()}
      />,
    );

    expect((screen.getByRole('button', { name: 'Remove…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Remove denied by daemon')).toBeDefined();
  });

  it('does not apply cleanup when the confirmation dialog is canceled', async () => {
    const controls = cleanupControls();
    render(
      <AttentionPanel
        items={[cleanupItem({ remove: { allowed: true }, cascadeRemove: { allowed: true } })]}
        hiddenCount={0}
        queueCleanupControls={controls}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
    const dialog = screen.getByRole('alertdialog');
    await screen.findByText('Affects 1 PRD.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(controls.applyCascade).not.toHaveBeenCalled();
  });

  it('renders preview failures as alert text and keeps the dialog open', async () => {
    render(
      <AttentionPanel
        items={[cleanupItem({ remove: { allowed: true }, cascadeRemove: { allowed: true } })]}
        hiddenCount={0}
        queueCleanupControls={cleanupControls({ previewCascade: vi.fn().mockRejectedValue(new Error('Preview refused')) })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Preview refused');
    expect(screen.getByRole('alertdialog')).toBeDefined();
  });

  it('renders apply failures as alert text and keeps the dialog open', async () => {
    const controls = cleanupControls({ applyCascade: vi.fn().mockRejectedValue(new Error('Apply refused')) });
    render(
      <AttentionPanel
        items={[cleanupItem({ remove: { allowed: true }, cascadeRemove: { allowed: true } })]}
        hiddenCount={0}
        queueCleanupControls={controls}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
    await screen.findByText('Affects 1 PRD.');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(controls.applyCascade).toHaveBeenCalled());
    expect((await screen.findByRole('alert')).textContent).toContain('Apply refused');
    expect(screen.getByRole('alertdialog')).toBeDefined();
  });
});

function untrustedExtensionItem(): NowAttentionItem {
  return {
    id: 'extension-trust-/repo/a.ts',
    severity: 'warning',
    message: 'Untrusted extension: alpha',
    detail: 'Trust this project-team extension to enable it',
    extensionTrust: { name: 'alpha', path: '/repo/a.ts', trustState: 'untrusted', actionLabel: 'Trust' },
  };
}

function changedExtensionItem(): NowAttentionItem {
  return {
    id: 'extension-trust-/repo/b.ts',
    severity: 'warning',
    message: 'Extension changed since trusted: beta',
    detail: 'Re-trust to apply the updated project-team extension',
    extensionTrust: { name: 'beta', path: '/repo/b.ts', trustState: 'changed', actionLabel: 'Re-trust' },
  };
}

function staticTrust(overrides: Partial<NonNullable<Parameters<typeof AttentionPanel>[0]['extensionTrust']>> = {}) {
  return { pendingPath: null, errors: {}, onTrust: vi.fn(), ...overrides };
}

describe('AttentionPanel — extension trust', () => {
  it('renders Trust and Re-trust controls from the action labels', () => {
    render(
      <AttentionPanel
        items={[untrustedExtensionItem(), changedExtensionItem()]}
        hiddenCount={0}
        title="Needs attention"
        extensionTrust={staticTrust()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Trust' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Re-trust' })).toBeDefined();
  });

  it('invokes the trust handler with the full extensionTrust payload only after confirmation', () => {
    const onTrust = vi.fn();
    render(
      <AttentionPanel
        items={[untrustedExtensionItem()]}
        hiddenCount={0}
        extensionTrust={staticTrust({ onTrust })}
      />,
    );
    // Clicking the row control opens the confirmation dialog; it must NOT trust yet.
    fireEvent.click(screen.getByRole('button', { name: 'Trust' }));
    expect(onTrust).not.toHaveBeenCalled();
    // Confirming in the dialog trusts the extension.
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('/repo/a.ts')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Trust' }));
    expect(onTrust).toHaveBeenCalledWith({
      name: 'alpha',
      path: '/repo/a.ts',
      trustState: 'untrusted',
      actionLabel: 'Trust',
    });
  });

  it('disables the control while its path is pending', () => {
    render(
      <AttentionPanel
        items={[untrustedExtensionItem()]}
        hiddenCount={0}
        extensionTrust={staticTrust({ pendingPath: '/repo/a.ts' })}
      />,
    );
    const button = screen.getByRole('button', { name: 'Trusting…' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders a per-path error in a role=alert while the control stays visible', () => {
    render(
      <AttentionPanel
        items={[untrustedExtensionItem()]}
        hiddenCount={0}
        extensionTrust={staticTrust({ errors: { '/repo/a.ts': 'Ambiguous trust target' } })}
      />,
    );
    const alerts = screen.getAllByRole('alert').map((el) => el.textContent);
    expect(alerts.some((t) => t?.includes('Ambiguous trust target'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Trust' })).toBeDefined();
  });
});
