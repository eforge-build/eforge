import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueueHoldAction } from '../queue-hold-action';

const allowed = { allowed: true };

describe('QueueHoldAction', () => {
  it('passes trimmed hold reason only after confirmation', async () => {
    const onHold = vi.fn().mockResolvedValue(undefined);
    render(<QueueHoldAction itemId="prd-1" itemTitle="PRD One" held={false} capability={allowed} onHold={onHold} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hold…' }));
    expect(onHold).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Hold reason for PRD One'), { target: { value: '  operator pause  ' } });
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Hold' }));

    await waitFor(() => expect(onHold).toHaveBeenCalledWith('prd-1', 'operator pause'));
  });

  it('calls onUnhold only after confirmation', async () => {
    const onUnhold = vi.fn().mockResolvedValue(undefined);
    render(<QueueHoldAction itemId="prd-1" itemTitle="PRD One" held capability={allowed} onUnhold={onUnhold} />);

    fireEvent.click(screen.getByRole('button', { name: 'Unhold…' }));
    expect(onUnhold).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Unhold' }));

    await waitFor(() => expect(onUnhold).toHaveBeenCalledWith('prd-1'));
  });

  it('disables controls and renders capability reasons when denied', () => {
    render(<QueueHoldAction itemId="prd-1" itemTitle="PRD One" held={false} capability={{ allowed: false, reason: 'Already running' }} onHold={vi.fn()} />);

    expect((screen.getByRole('button', { name: 'Hold…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Already running')).toBeDefined();
  });

  it('keeps the dialog open and renders callback errors', async () => {
    const onHold = vi.fn().mockRejectedValue(new Error('hold failed'));
    render(<QueueHoldAction itemId="prd-1" itemTitle="PRD One" held={false} capability={allowed} onHold={onHold} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hold…' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Hold' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('hold failed'));
    expect(screen.getByRole('alertdialog')).toBeDefined();
  });
});
