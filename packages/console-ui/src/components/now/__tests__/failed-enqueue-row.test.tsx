import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { FailedEnqueueInfo } from '@eforge-build/client/browser';
import { FailedEnqueueRow } from '../failed-enqueue-row';

function failed(overrides: Partial<FailedEnqueueInfo> = {}): FailedEnqueueInfo {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    sourceLabel: 'docs/prd.md',
    provenance: { label: 'enqueue:start source' },
    failureReason: 'Invalid acceptance criteria',
    failedAt: '2026-06-19T10:00:00.000Z',
    canReenqueue: true,
    nextCommand: { executable: 'eforge', args: ['enqueue', '<redacted-source>'] },
    ...overrides,
  };
}

describe('FailedEnqueueRow', () => {
  it('renders failure identity, source, reason, timestamp, run id, and session id', () => {
    render(<ul><FailedEnqueueRow failedEnqueue={failed()} /></ul>);

    expect(screen.getByText('Enqueue failed')).toBeDefined();
    expect(screen.getByText('docs/prd.md')).toBeDefined();
    expect(screen.getByText('Invalid acceptance criteria')).toBeDefined();
    expect(screen.getByText('2026-06-19T10:00:00.000Z')).toBeDefined();
    expect(screen.getByText('run-1')).toBeDefined();
    expect(screen.getByText('session-1')).toBeDefined();
  });

  it('calls onReenqueue only after the confirmation action is clicked', () => {
    const onReenqueue = vi.fn();
    const item = failed();
    render(<ul><FailedEnqueueRow failedEnqueue={item} onReenqueue={onReenqueue} /></ul>);

    fireEvent.click(screen.getByRole('button', { name: 'Re-enqueue…' }));
    expect(onReenqueue).not.toHaveBeenCalled();

    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Re-enqueue' }));
    expect(onReenqueue).toHaveBeenCalledWith(item);
  });

  it('renders disabled fallback reason and next command when one-click re-enqueue is unavailable', () => {
    render(<ul><FailedEnqueueRow failedEnqueue={failed({ canReenqueue: false, disabledReason: 'Source data is unavailable.', nextCommand: { executable: 'eforge', args: ['history', 'show', 'run-1'] } })} /></ul>);

    expect(screen.getByText(/Source data is unavailable/)).toBeDefined();
    expect(screen.getByText('eforge history show run-1')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Re-enqueue/ })).toBeNull();
  });

  it('shows pending label and row-local errors', () => {
    render(<ul><FailedEnqueueRow failedEnqueue={failed()} pending error="Daemon refused re-enqueue" onReenqueue={vi.fn()} /></ul>);

    expect((screen.getByRole('button', { name: 'Re-enqueuing…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Daemon refused re-enqueue');
  });
});
