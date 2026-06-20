import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import type { DraftPlanUnit, DraftUnitAdvisory, MergeDraftUnitsInput, MergeDraftUnitsResponse, SplitDraftUnitInput, SplitDraftUnitResponse } from '@/types';
import { adviseMergeMockDraftUnits, adviseSplitMockDraftUnit, forkMockDraftUnit, listMockDraftUnits, mergeMockDraftUnits, resetMockDraftUnits, splitMockDraftUnit } from '@/fixtures/mock-draft-units';
import { DraftMergePanel } from './draft-merge-panel';
import { DraftUnitSplitPanel } from './draft-unit-split-panel';

const okAdvisory: DraftUnitAdvisory = { severity: 'ok', findings: [{ code: 'merge-justified-by-dependency', message: 'Coupled by dependencies.', itemIds: ['a'] }] };
const cautionAdvisory: DraftUnitAdvisory = { severity: 'caution', findings: [{ code: 'split-crosses-dependency', message: 'A depends on B; splitting separates them.', itemIds: ['a', 'b'] }] };

afterEach(cleanup);

describe('mock draft merge/split fixtures', () => {
  beforeEach(resetMockDraftUnits);

  it('merges two units into one, pooling items and consuming the sources', () => {
    // Fork one lane, split it into two units, then merge them back together.
    const forked = forkMockDraftUnit({ recommendationRef: 'planning-foundations' }).unit;
    const { original, created } = splitMockDraftUnit({ unitId: forked.unitId, itemIds: ['recommend-next-work'], title: 'B' });
    expect(listMockDraftUnits().units).toHaveLength(2);

    const { unit, removedUnitIds, advisory } = mergeMockDraftUnits({ unitIds: [original.unitId, created.unitId] });
    expect(unit.provenance).toBe('user');
    expect(unit.items.map((item) => item.itemId).sort()).toEqual(['add-import-preview', 'recommend-next-work']);
    expect(removedUnitIds).toEqual([original.unitId, created.unitId]);
    expect(advisory.severity).toBeDefined();
    expect(listMockDraftUnits().units).toHaveLength(1);
  });

  it('splits a forked lane into two units and previews advisories without mutating', () => {
    const unit = forkMockDraftUnit({ recommendationRef: 'planning-foundations' }).unit;
    // Preview is read-only.
    expect(adviseSplitMockDraftUnit({ unitId: unit.unitId, itemIds: ['recommend-next-work'] }).advisory.severity).toBeDefined();
    expect(listMockDraftUnits().units).toHaveLength(1);

    const { original, created } = splitMockDraftUnit({ unitId: unit.unitId, itemIds: ['recommend-next-work'], title: 'Peeled' });
    expect(original.items.map((item) => item.itemId)).toEqual(['add-import-preview']);
    expect(created).toMatchObject({ title: 'Peeled', provenance: 'user' });
    expect(created.items.map((item) => item.itemId)).toEqual(['recommend-next-work']);
    expect(listMockDraftUnits().units).toHaveLength(2);
  });

  it('previews a merge advisory without consuming the units', () => {
    const forked = forkMockDraftUnit({ recommendationRef: 'planning-foundations' }).unit;
    const { original, created } = splitMockDraftUnit({ unitId: forked.unitId, itemIds: ['recommend-next-work'], title: 'B' });
    expect(adviseMergeMockDraftUnits({ unitIds: [original.unitId, created.unitId] }).advisory.severity).toBeDefined();
    expect(listMockDraftUnits().units).toHaveLength(2);
  });
});

const unitA: DraftPlanUnit = { unitId: 'u1', title: 'Lane A', provenance: 'recommendation', items: [{ itemId: 'a', origin: 'recommendation' }], status: 'draft', createdAt: 't', updatedAt: 't' };
const unitB: DraftPlanUnit = { unitId: 'u2', title: 'Lane B', provenance: 'user', items: [{ itemId: 'b', origin: 'user' }], status: 'draft', createdAt: 't', updatedAt: 't' };

describe('DraftMergePanel', () => {
  it('loads the advisory on mount and merges with the chosen title, opening the new unit', async () => {
    const onAdvise = vi.fn<(unitIds: string[]) => Promise<DraftUnitAdvisory>>(async () => okAdvisory);
    const onMerge = vi.fn<(input: MergeDraftUnitsInput) => Promise<MergeDraftUnitsResponse>>(async () => ({ unit: { ...unitA, unitId: 'merged-1', title: 'Lane A' }, removedUnitIds: ['u1', 'u2'], advisory: okAdvisory }));
    const onClose = vi.fn();
    const onOpenUnit = vi.fn<(key: string) => void>();
    render(<ToastProvider><DraftMergePanel units={[unitA, unitB]} onAdvise={onAdvise} onMerge={onMerge} onClose={onClose} onOpenUnit={onOpenUnit} /></ToastProvider>);

    await waitFor(() => expect(onAdvise).toHaveBeenCalledWith(['u1', 'u2']));
    expect(screen.getByText('Dependencies look consistent')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Merge units/ }));
    await waitFor(() => expect(onMerge).toHaveBeenCalledWith({ unitIds: ['u1', 'u2'], title: 'Lane A' }));
    await waitFor(() => expect(onOpenUnit).toHaveBeenCalledWith('draft:merged-1'));
  });
});

describe('DraftUnitSplitPanel', () => {
  const splitUnit: DraftPlanUnit = { unitId: 'u1', title: 'Whole', provenance: 'recommendation', items: [{ itemId: 'a', origin: 'recommendation' }, { itemId: 'b', origin: 'user' }], status: 'draft', createdAt: 't', updatedAt: 't' };
  const titles = new Map([['a', 'Item A'], ['b', 'Item B']]);

  it('previews the advisory for a valid strict subset and splits the selected items', async () => {
    const onAdvise = vi.fn<(unitId: string, itemIds: string[]) => Promise<DraftUnitAdvisory>>(async () => cautionAdvisory);
    const onSplit = vi.fn<(input: SplitDraftUnitInput) => Promise<SplitDraftUnitResponse>>(async () => ({ original: { ...splitUnit, items: [{ itemId: 'a', origin: 'recommendation' }] }, created: { ...splitUnit, unitId: 'split-1', title: 'Peeled', items: [{ itemId: 'b', origin: 'user' }] }, advisory: cautionAdvisory }));
    const onClose = vi.fn();
    const onOpenUnit = vi.fn<(key: string) => void>();
    render(<ToastProvider><DraftUnitSplitPanel unit={splitUnit} titles={titles} onAdvise={onAdvise} onSplit={onSplit} onClose={onClose} onOpenUnit={onOpenUnit} /></ToastProvider>);

    // No advisory until a valid strict subset is selected.
    expect(screen.queryByText('Dependency caution')).toBeNull();
    fireEvent.click(screen.getByLabelText('Item B'));
    // Selecting only 'b' (a stays) is a valid strict subset.
    await waitFor(() => expect(onAdvise).toHaveBeenCalledWith('u1', ['b']));
    expect(screen.getByText('Dependency caution')).toBeDefined();

    fireEvent.change(screen.getByPlaceholderText('Title for the new unit'), { target: { value: 'Peeled' } });
    fireEvent.click(screen.getByRole('button', { name: /Split off/ }));
    await waitFor(() => expect(onSplit).toHaveBeenCalledWith({ unitId: 'u1', itemIds: ['b'], title: 'Peeled' }));
    await waitFor(() => expect(onOpenUnit).toHaveBeenCalledWith('draft:split-1'));
  });
});
