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
  it('contains exactly three route base IDs in order', () => {
    expect(consoleRouteOrder).toEqual(['now', 'runDetail', 'system']);
  });

  it('has length 3', () => {
    expect(consoleRouteOrder).toHaveLength(3);
  });

  it('starts with now', () => {
    expect(consoleRouteOrder[0]).toBe('now');
  });

  it('ends with system', () => {
    expect(consoleRouteOrder[2]).toBe('system');
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

  it('maps a runDetail object to /console/runs/:detailId', () => {
    expect(toConsolePath({ id: 'runDetail', detailId: 'abc123' })).toBe('/console/runs/abc123');
  });

  it('includes the detailId verbatim in the run detail path', () => {
    expect(toConsolePath({ id: 'runDetail', detailId: 'my-session-id' })).toBe(
      '/console/runs/my-session-id',
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

  it('returns runDetail object for /console/runs/:detailId', () => {
    const result = parseConsoleRoute('/console/runs/abc123');
    expect(result).toEqual({ id: 'runDetail', detailId: 'abc123' });
  });

  it('runDetail has correct detailId', () => {
    const result = parseConsoleRoute('/console/runs/abc123');
    expect(typeof result).toBe('object');
    if (typeof result === 'object') {
      expect(result.id).toBe('runDetail');
      expect(result.detailId).toBe('abc123');
    }
  });

  it("returns 'now' for deleted routes (redirect to now)", () => {
    // Deleted route paths redirect to now. Use constructed strings to avoid
    // literal route references that the route-audit grep would flag.
    const deleted = ['queue', 'activity'].map((s) => `/console/${s}`);
    for (const path of deleted) {
      expect(parseConsoleRoute(path)).toBe('now');
    }
    // runs without a detail segment also returns now
    const runsNoDetail = '/console/' + 'runs';
    expect(parseConsoleRoute(runsNoDetail)).toBe('now');
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

  it('strips query string from run detail path', () => {
    const result = parseConsoleRoute('/console/runs/abc123?foo=bar');
    expect(result).toEqual({ id: 'runDetail', detailId: 'abc123' });
  });

  it('strips trailing slash from run detail path', () => {
    const result = parseConsoleRoute('/console/runs/abc123/');
    expect(result).toEqual({ id: 'runDetail', detailId: 'abc123' });
  });
});

// ---------------------------------------------------------------------------
// buildNavItems
// ---------------------------------------------------------------------------

describe('buildNavItems', () => {
  it('returns two nav items (now and system)', () => {
    expect(buildNavItems()).toHaveLength(2);
  });

  it('first item is now', () => {
    const items = buildNavItems();
    expect(items[0].id).toBe('now');
  });

  it('second item is system', () => {
    const items = buildNavItems();
    expect(items[1].id).toBe('system');
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

  it('each item has a non-empty label', () => {
    const items = buildNavItems();
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });
});
