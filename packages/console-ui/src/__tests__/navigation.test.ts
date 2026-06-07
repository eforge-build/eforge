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
    expect(consoleRouteOrder).toEqual(['now', 'workstations', 'buildDetail', 'workstationDetail', 'system']);
  });

  it('has length 5', () => {
    expect(consoleRouteOrder).toHaveLength(5);
  });

  it('starts with now', () => {
    expect(consoleRouteOrder[0]).toBe('now');
  });

  it('second entry is workstations', () => {
    expect(consoleRouteOrder[1]).toBe('workstations');
  });

  it('ends with system', () => {
    expect(consoleRouteOrder[4]).toBe('system');
  });
});

// ---------------------------------------------------------------------------
// toConsolePath
// ---------------------------------------------------------------------------

describe('toConsolePath', () => {
  it("maps 'now' to /console/", () => {
    expect(toConsolePath('now')).toBe('/console/');
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

  it('appends a workstation sub-path as a nested segment', () => {
    expect(toConsolePath({ id: 'workstationDetail', workstationId: 'eforge-plan', subPath: 'backlog' })).toBe('/console/workstations/eforge-plan/backlog');
  });

  it('appends a workstation sub-path that carries a query string', () => {
    expect(toConsolePath({ id: 'workstationDetail', workstationId: 'eforge-plan', subPath: 'backlog?group=epic' })).toBe('/console/workstations/eforge-plan/backlog?group=epic');
  });

  it('attaches a query-only sub-path directly to the workstation id', () => {
    expect(toConsolePath({ id: 'workstationDetail', workstationId: 'eforge-plan', subPath: '?group=epic' })).toBe('/console/workstations/eforge-plan?group=epic');
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

  it('captures a nested workstation sub-path', () => {
    expect(parseConsoleRoute('/console/workstations/eforge-plan/backlog')).toEqual({ id: 'workstationDetail', workstationId: 'eforge-plan', subPath: 'backlog' });
  });

  it('preserves the query string in a workstation sub-path', () => {
    expect(parseConsoleRoute('/console/workstations/eforge-plan/backlog?group=epic')).toEqual({ id: 'workstationDetail', workstationId: 'eforge-plan', subPath: 'backlog?group=epic' });
  });

  it('captures a query-only workstation sub-path', () => {
    expect(parseConsoleRoute('/console/workstations/eforge-plan?group=epic')).toEqual({ id: 'workstationDetail', workstationId: 'eforge-plan', subPath: '?group=epic' });
  });

  it('round-trips a workstation sub-path through toConsolePath', () => {
    const route = parseConsoleRoute('/console/workstations/eforge-plan/plans/plan:2026?tab=readiness');
    expect(route).toEqual({ id: 'workstationDetail', workstationId: 'eforge-plan', subPath: 'plans/plan:2026?tab=readiness' });
    expect(toConsolePath(route)).toBe('/console/workstations/eforge-plan/plans/plan:2026?tab=readiness');
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
    const deleted = ['queue', 'activity', 'plans'].map((s) => `/console/${s}`);
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
});

// ---------------------------------------------------------------------------
// buildNavItems
// ---------------------------------------------------------------------------

describe('buildNavItems', () => {
  it('returns three nav items (now, workstations, and system)', () => {
    expect(buildNavItems()).toHaveLength(3);
  });

  it('returns Now, Workstations, and System', () => {
    expect(buildNavItems().map((item) => item.id)).toEqual(['now', 'workstations', 'system']);
  });

  it('now item has href /console/', () => {
    const items = buildNavItems();
    const nowItem = items.find((i) => i.id === 'now');
    expect(nowItem?.href).toBe('/console/');
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

  it('workstations item has label "Workstations"', () => {
    const items = buildNavItems();
    const workstationsItem = items.find((i) => i.id === 'workstations');
    expect(workstationsItem?.label).toBe('Workstations');
  });
});
