import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
