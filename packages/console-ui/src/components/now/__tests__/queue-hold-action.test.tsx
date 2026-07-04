import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueueHoldDialog } from '../queue-hold-action';

function Harness(props: { held: boolean; onHold?: (id: string, reason?: string) => Promise<void>; onUnhold?: (id: string) => Promise<void> }) {
  const [open, setOpen] = React.useState(true);
  return (
    <QueueHoldDialog
      open={open}
      onOpenChange={setOpen}
      itemId="prd-1"
      itemTitle="PRD One"
      held={props.held}
      onHold={props.onHold}
      onUnhold={props.onUnhold}
    />
  );
}

describe('QueueHoldDialog', () => {
  it('passes trimmed hold reason only after confirmation, then closes', async () => {
    const onHold = vi.fn().mockResolvedValue(undefined);
    render(<Harness held={false} onHold={onHold} />);

    expect(onHold).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Hold reason for PRD One'), { target: { value: '  operator pause  ' } });
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Hold' }));

    await waitFor(() => expect(onHold).toHaveBeenCalledWith('prd-1', 'operator pause'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('calls onUnhold only after confirmation', async () => {
    const onUnhold = vi.fn().mockResolvedValue(undefined);
    render(<Harness held onUnhold={onUnhold} />);

    expect(onUnhold).not.toHaveBeenCalled();
    // Releasing a hold needs no reason field.
    expect(screen.queryByLabelText('Hold reason for PRD One')).toBeNull();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Release hold' }));

    await waitFor(() => expect(onUnhold).toHaveBeenCalledWith('prd-1'));
  });

  it('keeps the dialog open and renders callback errors', async () => {
    const onHold = vi.fn().mockRejectedValue(new Error('hold failed'));
    render(<Harness held={false} onHold={onHold} />);

    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Hold' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('hold failed'));
    expect(screen.getByRole('alertdialog')).toBeDefined();
  });
});
