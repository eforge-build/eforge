import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
