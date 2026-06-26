import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../db.js';
import { startServer, type MonitorServer } from '../server.js';

const CONSOLE_INDEX_MARKER = '<!-- console-ui-index -->';
const CONSOLE_ASSET_CONTENT = '// console-asset-content';

let server: MonitorServer;
let baseUrl: string;

beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'eforge-static-test-'));
  const consoleUiDir = join(tmp, 'console-ui');
  mkdirSync(join(consoleUiDir, 'assets'), { recursive: true });
  writeFileSync(join(consoleUiDir, 'index.html'), CONSOLE_INDEX_MARKER);
  writeFileSync(join(consoleUiDir, 'assets', 'console.js'), CONSOLE_ASSET_CONTENT);


  const db = openDatabase(':memory:');
  server = await startServer(db, 0, {
    uiDirs: { consoleUiDir },
  });
  baseUrl = server.url;
});

afterAll(async () => {
  await server?.stop();
});

async function get(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, init);
}

describe('root UI redirects', () => {
  it.each(['/', '/index.html', '/queue/deep/link'])('redirects GET %s to /console/', async (path) => {
    const res = await get(path, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/console/');
  });
});

describe('Console UI serving', () => {
  it('serves GET /console/ with the Console index marker and no-cache', async () => {
    const res = await get('/console/');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const body = await res.text();
    expect(body).toContain(CONSOLE_INDEX_MARKER);
  });

  it('serves Console assets with immutable cache control', async () => {
    const res = await get('/console/assets/console.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await res.text()).toBe(CONSOLE_ASSET_CONTENT);
  });

  it('serves the Console index as SPA fallback under /console', async () => {
    const res = await get('/console/runs/deep/link');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const body = await res.text();
    expect(body).toContain(CONSOLE_INDEX_MARKER);
  });

});

describe('GET /api/not-a-route', () => {
  it('returns JSON 404 without serving the Console index', async () => {
    const res = await get('/api/not-a-route');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.text();
    expect(body).not.toContain(CONSOLE_INDEX_MARKER);
  });
});
