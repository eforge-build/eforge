import { describe, it, expect } from 'vitest';
import {
  toConsolePath,
  parseConsoleRoute,
  buildNavItems,
  consoleRouteOrder,
  type ConsoleRouteId,
} from '@/lib/navigation';

// ---------------------------------------------------------------------------
// consoleRouteOrder
// ---------------------------------------------------------------------------

describe('consoleRouteOrder', () => {
  it('contains all five route ids', () => {
    const expected: ConsoleRouteId[] = ['now', 'queue', 'runs', 'system', 'activity'];
    expect(consoleRouteOrder).toHaveLength(5);
    for (const id of expected) {
      expect(consoleRouteOrder).toContain(id);
    }
  });

  it('starts with now', () => {
    expect(consoleRouteOrder[0]).toBe('now');
  });
});

// ---------------------------------------------------------------------------
// toConsolePath
// ---------------------------------------------------------------------------

describe('toConsolePath', () => {
  it("maps 'now' to /console/", () => {
    expect(toConsolePath('now')).toBe('/console/');
  });

  it("maps 'queue' to /console/queue", () => {
    expect(toConsolePath('queue')).toBe('/console/queue');
  });

  it("maps 'runs' to /console/runs", () => {
    expect(toConsolePath('runs')).toBe('/console/runs');
  });

  it("maps 'system' to /console/system", () => {
    expect(toConsolePath('system')).toBe('/console/system');
  });

  it("maps 'activity' to /console/activity", () => {
    expect(toConsolePath('activity')).toBe('/console/activity');
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

  it("returns 'queue' for /console/queue", () => {
    expect(parseConsoleRoute('/console/queue')).toBe('queue');
  });

  it("returns 'runs' for /console/runs", () => {
    expect(parseConsoleRoute('/console/runs')).toBe('runs');
  });

  it("returns 'system' for /console/system", () => {
    expect(parseConsoleRoute('/console/system')).toBe('system');
  });

  it("returns 'activity' for /console/activity", () => {
    expect(parseConsoleRoute('/console/activity')).toBe('activity');
  });

  it("returns 'now' for unrecognized path", () => {
    expect(parseConsoleRoute('/console/unknown')).toBe('now');
  });

  it('strips query string before matching', () => {
    expect(parseConsoleRoute('/console/runs?foo=bar')).toBe('runs');
  });

  it('strips hash before matching', () => {
    expect(parseConsoleRoute('/console/queue#section')).toBe('queue');
  });

  it('strips trailing slash before matching non-now routes', () => {
    expect(parseConsoleRoute('/console/runs/')).toBe('runs');
  });
});

// ---------------------------------------------------------------------------
// buildNavItems
// ---------------------------------------------------------------------------

describe('buildNavItems', () => {
  it('returns five nav items', () => {
    expect(buildNavItems()).toHaveLength(5);
  });

  it('returns items in consoleRouteOrder', () => {
    const items = buildNavItems();
    items.forEach((item, i) => {
      expect(item.id).toBe(consoleRouteOrder[i]);
    });
  });

  it('each item has a valid href matching toConsolePath', () => {
    const items = buildNavItems();
    for (const item of items) {
      expect(item.href).toBe(toConsolePath(item.id));
    }
  });

  it('each item has a non-empty label', () => {
    const items = buildNavItems();
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  it('now item has href /console/', () => {
    const items = buildNavItems();
    const nowItem = items.find((i) => i.id === 'now');
    expect(nowItem?.href).toBe('/console/');
  });
});
