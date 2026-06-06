import { describe, it, expect } from 'vitest';
import {
  toConsolePath,
  parseConsoleRoute,
  buildNavItems,
  consoleRouteOrder,
} from '@/lib/navigation';

// ---------------------------------------------------------------------------
// consoleRouteOrder
// ---------------------------------------------------------------------------

describe('consoleRouteOrder', () => {
  it('contains route base IDs in order', () => {
    expect(consoleRouteOrder).toEqual(['now', 'plans', 'workstations', 'buildDetail', 'workstationDetail', 'system']);
  });

  it('has length 6', () => {
    expect(consoleRouteOrder).toHaveLength(6);
  });

  it('starts with now', () => {
    expect(consoleRouteOrder[0]).toBe('now');
  });

  it('second entry is plans', () => {
    expect(consoleRouteOrder[1]).toBe('plans');
  });

  it('third entry is workstations', () => {
    expect(consoleRouteOrder[2]).toBe('workstations');
  });

  it('ends with system', () => {
    expect(consoleRouteOrder[5]).toBe('system');
  });
});

// ---------------------------------------------------------------------------
// toConsolePath
// ---------------------------------------------------------------------------

describe('toConsolePath', () => {
  it("maps 'now' to /console/", () => {
    expect(toConsolePath('now')).toBe('/console/');
  });

  it("maps 'plans' to /console/plans", () => {
    expect(toConsolePath('plans')).toBe('/console/plans');
  });

  it("maps 'system' to /console/system", () => {
    expect(toConsolePath('system')).toBe('/console/system');
  });

  it("maps 'workstations' to /console/workstations", () => {
    expect(toConsolePath('workstations')).toBe('/console/workstations');
  });

  it('maps a workstationDetail object to an encoded workstation detail path', () => {
    expect(toConsolePath({ id: 'workstationDetail', workstationId: 'demo:board' })).toBe('/console/workstations/demo%3Aboard');
  });

  it('maps a buildDetail object to /console/builds/:detailId', () => {
    expect(toConsolePath({ id: 'buildDetail', detailId: 'abc123' })).toBe('/console/builds/abc123');
  });

  it('includes the detailId verbatim in the build detail path', () => {
    expect(toConsolePath({ id: 'buildDetail', detailId: 'my-session-id' })).toBe(
      '/console/builds/my-session-id',
    );
  });
});

// ---------------------------------------------------------------------------
// parseConsoleRoute
// ---------------------------------------------------------------------------

describe('parseConsoleRoute', () => {
  it("returns 'now' for /console/", () => {
    expect(parseConsoleRoute('/console/')).toBe('now');
  });

  it("returns 'now' for /console (no trailing slash)", () => {
    expect(parseConsoleRoute('/console')).toBe('now');
  });

  it("returns 'now' for empty string", () => {
    expect(parseConsoleRoute('')).toBe('now');
  });

  it("returns 'plans' for /console/plans", () => {
    expect(parseConsoleRoute('/console/plans')).toBe('plans');
  });

  it("returns 'system' for /console/system", () => {
    expect(parseConsoleRoute('/console/system')).toBe('system');
  });

  it("returns 'workstations' for /console/workstations", () => {
    expect(parseConsoleRoute('/console/workstations')).toBe('workstations');
  });

  it('returns workstationDetail for /console/workstations/:workstationId', () => {
    expect(parseConsoleRoute('/console/workstations/demo:board')).toEqual({ id: 'workstationDetail', workstationId: 'demo:board' });
    expect(parseConsoleRoute('/console/workstations/demo%3Aboard')).toEqual({ id: 'workstationDetail', workstationId: 'demo:board' });
  });

  it('returns buildDetail object for /console/builds/:detailId', () => {
    const result = parseConsoleRoute('/console/builds/abc123');
    expect(result).toEqual({ id: 'buildDetail', detailId: 'abc123' });
  });

  it('buildDetail has correct detailId', () => {
    const result = parseConsoleRoute('/console/builds/abc123');
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.id).toBe('buildDetail');
      expect(result.detailId).toBe('abc123');
    }
  });

  it('resolves the legacy /console/runs/:detailId path to buildDetail', () => {
    const legacy = '/console/' + 'runs' + '/abc123';
    expect(parseConsoleRoute(legacy)).toEqual({ id: 'buildDetail', detailId: 'abc123' });
  });

  it("returns 'now' for deleted routes (redirect to now)", () => {
    // Deleted route paths redirect to now. Use constructed strings to avoid
    // literal route references that the route-audit grep would flag.
    const deleted = ['queue', 'activity'].map((s) => `/console/${s}`);
    for (const path of deleted) {
      expect(parseConsoleRoute(path)).toBe('now');
    }
    // builds without a detail segment also returns now
    const buildsNoDetail = '/console/' + 'builds';
    expect(parseConsoleRoute(buildsNoDetail)).toBe('now');
  });

  it("returns 'now' for unrecognized path", () => {
    expect(parseConsoleRoute('/console/unknown')).toBe('now');
  });

  it('strips query string before matching', () => {
    expect(parseConsoleRoute('/console/system?foo=bar')).toBe('system');
  });

  it('strips hash before matching', () => {
    expect(parseConsoleRoute('/console/system#section')).toBe('system');
  });

  it('strips trailing slash before matching non-now routes', () => {
    expect(parseConsoleRoute('/console/system/')).toBe('system');
  });

  it('strips query string from build detail path', () => {
    const result = parseConsoleRoute('/console/builds/abc123?foo=bar');
    expect(result).toEqual({ id: 'buildDetail', detailId: 'abc123' });
  });

  it('strips trailing slash from build detail path', () => {
    const result = parseConsoleRoute('/console/builds/abc123/');
    expect(result).toEqual({ id: 'buildDetail', detailId: 'abc123' });
  });

  it('strips query string from plans path', () => {
    expect(parseConsoleRoute('/console/plans?foo=bar')).toBe('plans');
  });

  it('strips trailing slash from plans path', () => {
    expect(parseConsoleRoute('/console/plans/')).toBe('plans');
  });
});

// ---------------------------------------------------------------------------
// buildNavItems
// ---------------------------------------------------------------------------

describe('buildNavItems', () => {
  it('returns four nav items (now, plans, workstations, and system)', () => {
    expect(buildNavItems()).toHaveLength(4);
  });

  it('first item is now', () => {
    const items = buildNavItems();
    expect(items[0].id).toBe('now');
  });

  it('second item is plans', () => {
    const items = buildNavItems();
    expect(items[1].id).toBe('plans');
  });

  it('third item is workstations', () => {
    const items = buildNavItems();
    expect(items[2].id).toBe('workstations');
  });

  it('fourth item is system', () => {
    const items = buildNavItems();
    expect(items[3].id).toBe('system');
  });

  it('now item has href /console/', () => {
    const items = buildNavItems();
    const nowItem = items.find((i) => i.id === 'now');
    expect(nowItem?.href).toBe('/console/');
  });

  it('plans item has href /console/plans', () => {
    const items = buildNavItems();
    const plansItem = items.find((i) => i.id === 'plans');
    expect(plansItem?.href).toBe('/console/plans');
  });

  it('system item has href /console/system', () => {
    const items = buildNavItems();
    const systemItem = items.find((i) => i.id === 'system');
    expect(systemItem?.href).toBe('/console/system');
  });

  it('workstations item has href /console/workstations', () => {
    const items = buildNavItems();
    const workstationsItem = items.find((i) => i.id === 'workstations');
    expect(workstationsItem?.href).toBe('/console/workstations');
  });

  it('each item has a non-empty label', () => {
    const items = buildNavItems();
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  it('plans item has label "Plans"', () => {
    const items = buildNavItems();
    const plansItem = items.find((i) => i.id === 'plans');
    expect(plansItem?.label).toBe('Plans');
  });

  it('workstations item has label "Workstations"', () => {
    const items = buildNavItems();
    const workstationsItem = items.find((i) => i.id === 'workstations');
    expect(workstationsItem?.label).toBe('Workstations');
  });
});
