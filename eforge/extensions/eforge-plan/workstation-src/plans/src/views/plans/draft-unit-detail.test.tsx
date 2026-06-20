import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/toast';
import type { DraftPlanUnit, PromoteDraftUnitResponse, UpdateDraftUnitInput } from '@/types';
import { DraftUnitDetailCard } from './draft-unit-detail';
import { deleteMockDraftUnit, forkMockDraftUnit, getMockDraftUnit, listMockDraftUnits, promoteMockDraftUnit, resetMockDraftUnits, updateMockDraftUnit } from '@/fixtures/mock-draft-units';

const baseUnit: DraftPlanUnit = {
  unitId: 'u1',
  title: 'Lane A',
  intent: 'Independent and ready.',
  provenance: 'recommendation',
  sourceRecommendationRef: 'lane-a',
  profile: 'excursion',
  items: [{ itemId: 'a', origin: 'recommendation' }, { itemId: 'b', origin: 'user' }],
  status: 'draft',
  createdAt: '2026-06-19T00:00:00.000Z',
  updatedAt: '2026-06-19T00:00:00.000Z',
};
const titles = new Map([['a', 'Item A'], ['b', 'Item B']]);

afterEach(cleanup);

function renderCard(unit: DraftPlanUnit) {
  const onUpdate = vi.fn<(input: UpdateDraftUnitInput) => Promise<DraftPlanUnit>>(async () => unit);
  const onDelete = vi.fn<(unitId: string) => Promise<void>>(async () => undefined);
  const onPromote = vi.fn<(unitId: string) => Promise<PromoteDraftUnitResponse>>(async () => ({ unit: { ...unit, status: 'promoted', promotedSession: 'sess-1' }, promotion: { session: 'sess-1', sessionPlanPath: '.eforge/session-plans/sess-1.md', itemIds: ['a', 'b'] } }));
  const onOpenPlan = vi.fn<(key: string) => void>();
  render(<ToastProvider><DraftUnitDetailCard unit={unit} titles={titles} onUpdate={onUpdate} onDelete={onDelete} onPromote={onPromote} onOpenPlan={onOpenPlan} /></ToastProvider>);
  return { onUpdate, onDelete, onPromote, onOpenPlan };
}

describe('DraftUnitDetailCard', () => {
  it('renders each item title with the badge for its own origin and removes an item through onUpdate', async () => {
    const { onUpdate } = renderCard(baseUnit);
    // Scope each origin badge to its own row so a badge rendered against the wrong
    // item would fail (item a is 'recommendation' -> AI, item b is 'user' -> you).
    const rowA = screen.getByText('Item A').closest('li');
    const rowB = screen.getByText('Item B').closest('li');
    expect(rowA).not.toBeNull();
    expect(rowB).not.toBeNull();
    expect(within(rowA as HTMLElement).getByText('AI')).toBeDefined();
    expect(within(rowA as HTMLElement).queryByText('you')).toBeNull();
    expect(within(rowB as HTMLElement).getByText('you')).toBeDefined();
    expect(within(rowB as HTMLElement).queryByText('AI')).toBeNull();

    fireEvent.click(screen.getAllByTitle('Remove from unit')[0]);
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ unitId: 'u1', removeItemIds: ['a'] }));
  });

  it('reorders items by moving the first item down', async () => {
    const { onUpdate } = renderCard(baseUnit);
    fireEvent.click(screen.getAllByTitle('Move down')[0]);
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ unitId: 'u1', itemOrder: ['b', 'a'] }));
  });

  it('commits a renamed title on blur and ignores an unchanged value', async () => {
    const { onUpdate } = renderCard(baseUnit);
    const title = screen.getByDisplayValue('Lane A');
    fireEvent.blur(title, { target: { value: 'Lane A' } });
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.blur(title, { target: { value: '  Renamed  ' } });
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ unitId: 'u1', title: 'Renamed' }));
  });

  it('deletes the unit through onDelete', async () => {
    const { onDelete } = renderCard(baseUnit);
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('u1'));
  });

  it('promotes the unit and opens the resulting session plan', async () => {
    const { onPromote, onOpenPlan } = renderCard(baseUnit);
    fireEvent.click(screen.getByRole('button', { name: /Promote to a build plan/ }));
    await waitFor(() => expect(onPromote).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(onOpenPlan).toHaveBeenCalledWith('plan:sess-1'));
  });

  it('locks editing once promoted', () => {
    renderCard({ ...baseUnit, status: 'promoted', promotedSession: 'sess-1' });
    expect((screen.getByRole('button', { name: /Promote to a build plan/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTitle('Remove from unit')).toBeNull();
  });
});

describe('mock draft-unit fixtures', () => {
  beforeEach(resetMockDraftUnits);

  it('forks a known lane, edits it, and promotes it through the shared in-memory store', () => {
    const { unit } = forkMockDraftUnit({ recommendationRef: 'planning-foundations' });
    expect(unit.provenance).toBe('recommendation');
    expect(unit.sourceRecommendationRef).toBe('planning-foundations');
    expect(unit.items.length).toBeGreaterThan(0);
    expect(listMockDraftUnits().units).toHaveLength(1);

    const removeId = unit.items[0].itemId;
    const edited = updateMockDraftUnit({ unitId: unit.unitId, removeItemIds: [removeId] }).unit;
    expect(edited.items.some((item) => item.itemId === removeId)).toBe(false);

    const promoted = promoteMockDraftUnit({ unitId: unit.unitId, session: 'sess-x' });
    expect(promoted.unit.status).toBe('promoted');
    expect(promoted.promotion.session).toBe('sess-x');
  });

  it('rejects forking an unknown lane', () => {
    expect(() => forkMockDraftUnit({ recommendationRef: 'nope' })).toThrow();
  });

  it('gets a unit by id and throws for an unknown id', () => {
    const { unit } = forkMockDraftUnit({ recommendationRef: 'planning-foundations' });
    expect(getMockDraftUnit({ unitId: unit.unitId }).unit.unitId).toBe(unit.unitId);
    expect(() => getMockDraftUnit({ unitId: 'ghost' })).toThrow();
  });

  it('deletes a unit idempotently', () => {
    const { unit } = forkMockDraftUnit({ recommendationRef: 'planning-foundations' });
    expect(deleteMockDraftUnit({ unitId: unit.unitId }).deleted).toBe(true);
    expect(deleteMockDraftUnit({ unitId: unit.unitId }).deleted).toBe(false);
    expect(listMockDraftUnits().units).toHaveLength(0);
  });
});
