import { act, renderHook } from '@testing-library/react';
import * as React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { RouterProvider, useRouter } from '@/router';
import type { Artifact } from '@/types';
import { buildItemPlanIndex, usePlanNavigation } from './plan-links';

function plan(key: string, sourceItemIds: string[], overrides: Partial<Artifact> = {}): Artifact {
  return { key, kind: 'plan', sourceRefs: { sourceItemIds }, ...overrides };
}

describe('buildItemPlanIndex', () => {
  it('maps each source item id to the covering plan', () => {
    const index = buildItemPlanIndex([
      plan('plan:a', ['item-1', 'item-2'], { title: 'Plan A', status: 'ready' }),
    ]);
    expect([...index.keys()].sort()).toEqual(['item-1', 'item-2']);
    expect(index.get('item-1')).toEqual([{ key: 'plan:a', title: 'Plan A', status: 'ready', lifecycleState: undefined }]);
  });

  it('lists every plan that names the same item', () => {
    const index = buildItemPlanIndex([
      plan('plan:a', ['shared'], { title: 'Plan A' }),
      plan('plan:b', ['shared'], { title: 'Plan B' }),
    ]);
    expect(index.get('shared')?.map((link) => link.key)).toEqual(['plan:a', 'plan:b']);
  });

  it('falls back to legacy itemIds when sourceItemIds is absent', () => {
    const index = buildItemPlanIndex([{ key: 'plan:a', kind: 'plan', sourceRefs: { itemIds: ['legacy-1'] } }]);
    expect(index.has('legacy-1')).toBe(true);
  });

  it('prefers sourceItemIds over legacy itemIds when both are present', () => {
    const index = buildItemPlanIndex([
      { key: 'plan:a', kind: 'plan', sourceRefs: { sourceItemIds: ['new-1'], itemIds: ['legacy-1'] } },
    ]);
    expect([...index.keys()]).toEqual(['new-1']);
    expect(index.has('legacy-1')).toBe(false);
  });

  it('produces no entries for empty inputs or empty source id lists', () => {
    expect(buildItemPlanIndex([]).size).toBe(0);
    expect(buildItemPlanIndex([plan('plan:a', [])]).size).toBe(0);
  });

  it('derives a readable title from the session when none is set', () => {
    const index = buildItemPlanIndex([{ key: 'plan:x', kind: 'plan', session: 'recovery-console-control', sourceRefs: { sourceItemIds: ['i'] } }]);
    expect(index.get('i')?.[0].title).toBe('Recovery Console Control');
  });

  it('ignores plan-sets and plans without source refs', () => {
    const index = buildItemPlanIndex([
      { key: 'set:1', kind: 'plan-set', sourceRefs: { sourceItemIds: ['skip'] } },
      { key: 'plan:empty', kind: 'plan' },
    ]);
    expect(index.size).toBe(0);
  });
});

describe('usePlanNavigation', () => {
  // RouterProvider falls back to the standalone adapter (window.location +
  // pushState) under jsdom; reset the URL between tests so pushed query state
  // does not leak across cases.
  beforeEach(() => window.history.replaceState(null, '', '/'));

  // Drive the navigation hook and the live router together so we can read the
  // query the hook produced.
  function setup() {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(RouterProvider, null, children);
    return renderHook(() => ({ nav: usePlanNavigation(), router: useRouter() }), { wrapper });
  }

  it('openItem points the item drawer at the id and drops focus back to the board', () => {
    const { result } = setup();
    act(() => result.current.router.setQuery((params) => params.set('focus', 'plans')));
    act(() => result.current.nav.openItem('item-7'));
    expect(result.current.router.query.get('item')).toBe('item-7');
    expect(result.current.router.query.has('focus')).toBe(false);
  });

  it('openPlan switches to the plans focus and selects the plan', () => {
    const { result } = setup();
    act(() => result.current.nav.openPlan('plan:a'));
    expect(result.current.router.query.get('focus')).toBe('plans');
    expect(result.current.router.query.get('plan')).toBe('plan:a');
  });

  it('no-ops silently when rendered without a router', () => {
    const { result } = renderHook(() => usePlanNavigation());
    // Outside a RouterProvider useOptionalRouter returns null; calls must not throw.
    expect(() => {
      result.current.openItem('item-1');
      result.current.openPlan('plan:a');
    }).not.toThrow();
  });
});
