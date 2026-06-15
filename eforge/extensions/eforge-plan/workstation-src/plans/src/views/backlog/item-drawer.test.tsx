import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import { getMockCompactItemDetail, mockBoard } from '@/fixtures/mock-data';
import type { EforgeBridge } from '@/types';
import { ItemDrawer } from './item-drawer';

function setBridge(bridge: EforgeBridge) {
  (window as Window & { eforge?: EforgeBridge }).eforge = bridge;
}

function renderDrawer(bridge: EforgeBridge, item = mockBoard.items[0]) {
  setBridge(bridge);
  return render(
    <ToastProvider>
      <ItemDrawer item={item} epics={mockBoard.epics ?? []} onClose={() => {}} onRefresh={async () => {}} />
    </ToastProvider>,
  );
}

describe('ItemDrawer compact detail loading', () => {
  it('fetches get-item lazily after the drawer opens and renders sections/dependencies', async () => {
    const calls: Array<{ actionId: string; input: unknown }> = [];
    const bridge: EforgeBridge = {
      async invokeAction<TOutput>(actionId: string, input?: unknown): Promise<TOutput> {
        calls.push({ actionId, input });
        if (actionId === 'get-item') return getMockCompactItemDetail('auto-mode') as TOutput;
        if (actionId === 'update-item') return { itemId: 'auto-mode', status: 'planned' } as TOutput;
        throw new Error(actionId);
      },
    };

    expect(calls).toEqual([]);
    renderDrawer(bridge, mockBoard.items.find((item) => item.id === 'auto-mode')!);

    expect(await screen.findByText(/Explore auto-mode draining claim/)).toBeTruthy();
    expect(screen.getByText('Depends on')).toBeTruthy();
    expect(screen.getByText('Trace sidecars')).toBeTruthy();
    expect(screen.getAllByText('planned').length).toBeGreaterThan(1);
    expect(screen.getByText('traceability').className).toContain('lane-blocked');
    expect(calls).toEqual([{ actionId: 'get-item', input: { id: 'auto-mode' } }]);
  });

  it('renders loading and error states', async () => {
    const bridge: EforgeBridge = {
      async invokeAction<TOutput>(actionId: string): Promise<TOutput> {
        if (actionId === 'get-item') throw new Error('detail failed');
        throw new Error(actionId);
      },
    };

    renderDrawer(bridge);

    expect(screen.getByText('Loading item details…')).toBeTruthy();
    expect(await screen.findByText('detail failed')).toBeTruthy();
  });

  it('preserves edit flow and update-item save inputs after detail arrives', async () => {
    let resolveDetail: (value: unknown) => void = () => {};
    const calls: Array<{ actionId: string; input: unknown }> = [];
    const bridge: EforgeBridge = {
      async invokeAction<TOutput>(actionId: string, input?: unknown): Promise<TOutput> {
        calls.push({ actionId, input });
        if (actionId === 'get-item') return await new Promise<TOutput>((resolve) => { resolveDetail = resolve as (value: unknown) => void; });
        if (actionId === 'update-item') return { itemId: 'add-import-preview', status: 'planned' } as TOutput;
        throw new Error(actionId);
      },
    };

    renderDrawer(bridge);
    fireEvent.change(screen.getByLabelText(/Priority/), { target: { value: 'low' } });
    resolveDetail(getMockCompactItemDetail('add-import-preview'));
    await waitFor(() => expect(screen.getByText(/Users want a dry-run preview/)).toBeTruthy());
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(calls).toContainEqual({ actionId: 'update-item', input: { id: 'add-import-preview', priority: 'low' } }));
  });

  it('saves only changed status and epic fields after detail arrives', async () => {
    async function saveField(label: RegExp, value: string, expectedInput: Record<string, unknown>) {
      const calls: Array<{ actionId: string; input: unknown }> = [];
      const bridge: EforgeBridge = {
        async invokeAction<TOutput>(actionId: string, input?: unknown): Promise<TOutput> {
          calls.push({ actionId, input });
          if (actionId === 'get-item') return getMockCompactItemDetail('add-import-preview') as TOutput;
          if (actionId === 'update-item') return { itemId: 'add-import-preview', status: 'planned' } as TOutput;
          throw new Error(actionId);
        },
      };

      const view = renderDrawer(bridge);
      await waitFor(() => expect(screen.getByText(/Users want a dry-run preview/)).toBeTruthy());
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      fireEvent.click(screen.getByText('Save'));
      await waitFor(() => expect(calls.filter((call) => call.actionId === 'update-item')).toEqual([{ actionId: 'update-item', input: expectedInput }]));
      view.unmount();
    }

    await saveField(/Status/, 'active', { id: 'add-import-preview', status: 'active' });
    await saveField(/Epic/, 'extensions', { id: 'add-import-preview', epic: 'extensions' });
    await saveField(/Epic/, '', { id: 'add-import-preview', epic: '' });
  });
});
