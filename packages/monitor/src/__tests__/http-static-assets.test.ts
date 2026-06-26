import { createServer, request } from 'node:http';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveStaticUiRequest } from '../http/static-assets.js';

const CONSOLE_INDEX = '<!-- console -->';
let baseUrl: string;
let consoleUiDir: string;
let symlinksAvailable = true;
let closeServer: () => Promise<void>;

beforeAll(async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'eforge-static-http-'));
  consoleUiDir = join(tmp, 'console-ui');
  mkdirSync(join(consoleUiDir, 'assets'), { recursive: true });
  writeFileSync(join(consoleUiDir, 'index.html'), CONSOLE_INDEX);
  writeFileSync(join(consoleUiDir, 'assets', 'app.js'), 'console-asset');
  writeFileSync(join(tmp, 'sentinel.txt'), 'outside');
  try {
    symlinkSync(join(tmp, 'sentinel.txt'), join(consoleUiDir, 'assets', 'escape.js'));
  } catch {
    symlinksAvailable = false;
  }

  const server = createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0] || '/';
    void serveStaticUiRequest({ req, res, pathname, consoleUiDir });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closeServer = () => new Promise((resolve) => server.close(() => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await closeServer?.();
});

const get = (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init);

interface RawResponse {
  status: number;
  body: string;
}

function getRaw(path: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl);
    const req = request({ hostname: url.hostname, port: url.port, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function getRawStatus(path: string): Promise<number> {
  return (await getRaw(path)).status;
}

describe('serveStaticUiRequest', () => {
  it('redirects root UI paths to Console', async () => {
    for (const path of ['/', '/index.html', '/deep/link']) {
      const res = await get(path, { redirect: 'manual' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/console/');
    }
  });

  it('serves Console root and assets', async () => {
    const root = await get('/console/');
    expect(await root.text()).toBe(CONSOLE_INDEX);
    expect(root.headers.get('cache-control')).toBe('no-cache');
    const asset = await get('/console/assets/app.js');
    expect(await asset.text()).toBe('console-asset');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('falls back to Console SPA index for non-assets under /console', async () => {
    const res = await get('/console/deep/link');
    expect(await res.text()).toBe(CONSOLE_INDEX);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('returns 404 for Console asset misses', async () => {
    expect((await get('/console/assets/missing.js')).status).toBe(404);
  });

  it.each([
    ['malformed percent escape', '/console/%E0%A4%A', 400, get],
    ['encoded traversal', '/console/assets/%2e%2e/index.html', 404, getRawStatus],
    ['multiple leading slash rejection', '/console//assets/missing.js', 400, getRawStatus],
    ['encoded slash rejection', '/console/%2Fassets/missing.js', 400, getRawStatus],
  ] as const)('rejects %s under Console', async (_label, path, expectedStatus, requester) => {
    const result = await requester(path);
    const status = typeof result === 'number' ? result : result.status;
    expect(status).toBe(expectedStatus);
  });

  it('rejects encoded traversal attempts escaping the Console root', async () => {
    const res = await getRaw('/console/assets/%2e%2e%2f%2e%2e%2fsentinel.txt');
    expect(res.status).toBe(404);
    expect(res.body).not.toContain('outside');
  });

  it.skipIf(!symlinksAvailable)('rejects symlink escapes from the Console root', async () => {
    expect((await get('/console/assets/escape.js')).status).toBe(404);
  });
});
