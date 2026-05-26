/**
 * Real HTTP tests for the dual-root static UI serving behavior.
 *
 * Creates temporary fixture directories for monitor UI and Console UI,
 * starts a real server with uiDirs overrides, and verifies routing,
 * cache headers, SPA fallbacks, traversal protection, and asset 404s.
 *
 * Follows AGENTS.md conventions:
 * - No mocks. Real SQLite DB via openDatabase. Real HTTP via startServer.
 * - Constructs inputs inline.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../db.js';
import { startServer, type MonitorServer } from '../server.js';

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

const MONITOR_INDEX_MARKER = '<!-- monitor-ui-index -->';
const CONSOLE_INDEX_MARKER = '<!-- console-ui-index -->';
const LEGACY_ASSET_CONTENT = '// legacy-asset-content';
const CONSOLE_ASSET_CONTENT = '// console-asset-content';
const SENTINEL_CONTENT = 'SENTINEL-OUTSIDE-ROOTS';

let server: MonitorServer;
let baseUrl: string;
let monitorUiDir: string;
let consoleUiDir: string;

beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'eforge-static-test-'));

  // Monitor UI fixture
  monitorUiDir = join(tmp, 'monitor-ui');
  mkdirSync(join(monitorUiDir, 'assets'), { recursive: true });
  writeFileSync(join(monitorUiDir, 'index.html'), MONITOR_INDEX_MARKER);
  writeFileSync(join(monitorUiDir, 'assets', 'legacy.js'), LEGACY_ASSET_CONTENT);

  // Console UI fixture
  consoleUiDir = join(tmp, 'console-ui');
  mkdirSync(join(consoleUiDir, 'assets'), { recursive: true });
  writeFileSync(join(consoleUiDir, 'index.html'), CONSOLE_INDEX_MARKER);
  writeFileSync(join(consoleUiDir, 'assets', 'console.js'), CONSOLE_ASSET_CONTENT);

  // Sentinel file outside both roots — used by traversal tests
  writeFileSync(join(tmp, 'sentinel.txt'), SENTINEL_CONTENT);

  const db = openDatabase(':memory:');
  server = await startServer(db, 0, {
    uiDirs: { monitorUiDir, consoleUiDir },
  });
  baseUrl = server.url;
});

afterAll(async () => {
  await server?.stop();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

// ---------------------------------------------------------------------------
// Monitor UI root — GET /
// ---------------------------------------------------------------------------

describe('GET / (monitor UI)', () => {
  it('returns 200 and monitor index marker', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(MONITOR_INDEX_MARKER);
    expect(body).not.toContain(CONSOLE_INDEX_MARKER);
  });

  it('responds with Cache-Control: no-cache', async () => {
    const res = await get('/');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });
});

// ---------------------------------------------------------------------------
// Monitor UI root — GET /index.html
// ---------------------------------------------------------------------------

describe('GET /index.html (monitor UI)', () => {
  it('returns 200 and monitor index marker', async () => {
    const res = await get('/index.html');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(MONITOR_INDEX_MARKER);
  });

  it('responds with Cache-Control: no-cache', async () => {
    const res = await get('/index.html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });
});

// ---------------------------------------------------------------------------
// Monitor UI assets
// ---------------------------------------------------------------------------

describe('GET /assets/legacy.js (monitor UI asset)', () => {
  it('returns 200 and asset content', async () => {
    const res = await get('/assets/legacy.js');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(LEGACY_ASSET_CONTENT);
  });

  it('responds with immutable Cache-Control', async () => {
    const res = await get('/assets/legacy.js');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });
});

describe('GET /assets/missing.js (monitor UI asset miss)', () => {
  it('returns 404 for a missing asset', async () => {
    const res = await get('/assets/missing.js');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Monitor UI SPA fallback
// ---------------------------------------------------------------------------

describe('GET /queue/deep/link (monitor UI SPA fallback)', () => {
  it('returns 200 and monitor index marker as SPA fallback', async () => {
    const res = await get('/queue/deep/link');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(MONITOR_INDEX_MARKER);
    expect(body).not.toContain(CONSOLE_INDEX_MARKER);
  });

  it('responds with Cache-Control: no-cache for SPA fallback', async () => {
    const res = await get('/queue/deep/link');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });
});

// ---------------------------------------------------------------------------
// Console UI root — GET /console, /console/, /console/index.html
// ---------------------------------------------------------------------------

describe('GET /console (Console UI root)', () => {
  it('returns 200 and Console index marker', async () => {
    const res = await get('/console');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(CONSOLE_INDEX_MARKER);
    expect(body).not.toContain(MONITOR_INDEX_MARKER);
  });

  it('responds with Cache-Control: no-cache', async () => {
    const res = await get('/console');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });
});

describe('GET /console/ (Console UI root with trailing slash)', () => {
  it('returns 200 and Console index marker', async () => {
    const res = await get('/console/');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(CONSOLE_INDEX_MARKER);
  });

  it('responds with Cache-Control: no-cache', async () => {
    const res = await get('/console/');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });
});

describe('GET /console/index.html (Console UI index)', () => {
  it('returns 200 and Console index marker', async () => {
    const res = await get('/console/index.html');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(CONSOLE_INDEX_MARKER);
  });

  it('responds with Cache-Control: no-cache', async () => {
    const res = await get('/console/index.html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });
});

// ---------------------------------------------------------------------------
// Console UI assets
// ---------------------------------------------------------------------------

describe('GET /console/assets/console.js (Console UI asset)', () => {
  it('returns 200 and Console asset content', async () => {
    const res = await get('/console/assets/console.js');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(CONSOLE_ASSET_CONTENT);
  });

  it('responds with immutable Cache-Control', async () => {
    const res = await get('/console/assets/console.js');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });
});

describe('GET /console/assets/missing.js (Console UI asset miss)', () => {
  it('returns 404 for a missing Console asset', async () => {
    const res = await get('/console/assets/missing.js');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Console UI SPA fallback
// ---------------------------------------------------------------------------

describe('GET /console/runs/deep/link (Console UI SPA fallback)', () => {
  it('returns 200 and Console index marker as SPA fallback', async () => {
    const res = await get('/console/runs/deep/link');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(CONSOLE_INDEX_MARKER);
    expect(body).not.toContain(MONITOR_INDEX_MARKER);
  });

  it('responds with Cache-Control: no-cache for SPA fallback', async () => {
    const res = await get('/console/runs/deep/link');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });
});

// ---------------------------------------------------------------------------
// Unknown API route — must not fall through to static serving
// ---------------------------------------------------------------------------

describe('GET /api/not-a-route', () => {
  it('returns 404 with a JSON content type', async () => {
    const res = await get('/api/not-a-route');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('body does not contain monitor or Console SPA markers', async () => {
    const res = await get('/api/not-a-route');
    const body = await res.text();
    expect(body).not.toContain(MONITOR_INDEX_MARKER);
    expect(body).not.toContain(CONSOLE_INDEX_MARKER);
  });
});

// ---------------------------------------------------------------------------
// Malformed percent escapes — must return 400
// ---------------------------------------------------------------------------

describe('Malformed percent escape under / (monitor UI)', () => {
  it('returns 400 for a path with an invalid percent sequence', async () => {
    // %80 is a valid percent-escape syntax but invalid UTF-8 — decodeURIComponent throws
    const res = await get('/%80%80');
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).not.toContain(MONITOR_INDEX_MARKER);
  });
});

describe('Malformed percent escape under /console/ (Console UI)', () => {
  it('returns 400 for a Console path with an invalid percent sequence', async () => {
    const res = await get('/console/%80%80');
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).not.toContain(CONSOLE_INDEX_MARKER);
  });
});

// ---------------------------------------------------------------------------
// Traversal protection — monitor UI root
// ---------------------------------------------------------------------------

describe('Encoded traversal under / (monitor UI root)', () => {
  it('does not return sentinel file contents for traversal above monitor UI root', async () => {
    // %2e%2e%2f is ../ — multiple levels to ensure we escape the fixture dir
    const res = await get('/%2e%2e%2f%2e%2e%2fsentinel.txt');
    const body = await res.text();
    expect(body).not.toContain(SENTINEL_CONTENT);
  });
});

describe('Encoded traversal under /console/ (Console UI root)', () => {
  it('does not return sentinel file contents for traversal above Console UI root', async () => {
    const res = await get('/console/%2e%2e%2f%2e%2e%2fsentinel.txt');
    const body = await res.text();
    expect(body).not.toContain(SENTINEL_CONTENT);
  });
});

// ---------------------------------------------------------------------------
// Traversal protection — asset paths must return 404 when escaping root
// ---------------------------------------------------------------------------

describe('Encoded traversal under /assets/ (monitor UI)', () => {
  it('returns 404 when the traversal path escapes the monitor UI root', async () => {
    // /assets/../../sentinel.txt escapes monitorUiDir into the parent tmp dir
    const res = await get('/assets/%2e%2e%2f%2e%2e%2fsentinel.txt');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain(SENTINEL_CONTENT);
  });
});

describe('Encoded traversal under /console/assets/ (Console UI)', () => {
  it('returns 404 when the traversal path escapes the Console UI root', async () => {
    const res = await get('/console/assets/%2e%2e%2f%2e%2e%2fsentinel.txt');
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain(SENTINEL_CONTENT);
  });
});
