import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { sendContainedStaticFile } from '../http/contained-static-file.js';

let closeServer: (() => Promise<void>) | undefined;
let tempRoots: string[] = [];

async function hit(handler: (res: ServerResponse) => void | Promise<void>): Promise<Response> {
  const server = createServer((_req, res) => { void handler(res); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closeServer = () => new Promise((resolve) => server.close(() => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return fetch(`http://127.0.0.1:${addr.port}`);
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eforge-contained-static-'));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await closeServer?.();
  closeServer = undefined;
  await Promise.all(tempRoots.map((dir) => rm(dir, { recursive: true, force: true })));
  tempRoots = [];
});

describe('sendContainedStaticFile', () => {
  it('serves contained files with shared MIME, cache, length, and nosniff headers', async () => {
    const root = await tempDir();
    const filePath = join(root, 'app.js');
    await writeFile(filePath, 'console.log("ok");\n');

    const res = await hit((serverResponse) => sendContainedStaticFile({
      res: serverResponse,
      rootDir: root,
      filePath,
      cacheControl: 'public, max-age=31536000, immutable',
      expectedSha256: createHash('sha256').update('console.log("ok");\n').digest('hex'),
    }));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.log("ok");\n');
    expect(res.headers.get('content-type')).toContain('application/javascript');
    expect(res.headers.get('content-length')).toBe(String('console.log("ok");\n'.length));
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('returns 404 without leaking paths for missing files and hash mismatches', async () => {
    const root = await tempDir();
    const filePath = join(root, 'style.css');
    await writeFile(filePath, 'body { color: red; }\n');

    const hashMismatch = await hit((serverResponse) => sendContainedStaticFile({
      res: serverResponse,
      rootDir: root,
      filePath,
      cacheControl: 'public, max-age=31536000, immutable',
      expectedSha256: createHash('sha256').update('different bytes').digest('hex'),
    }));

    expect(hashMismatch.status).toBe(404);
    expect(await hashMismatch.text()).toBe('Not Found');

    const missing = await hit((serverResponse) => sendContainedStaticFile({
      res: serverResponse,
      rootDir: root,
      filePath: join(root, 'missing.css'),
      cacheControl: 'public, max-age=31536000, immutable',
    }));

    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('Not Found');
  });

  it('rejects final symlinks and realpath escapes from the containing root', async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(outside, 'outside.js'), 'console.log("outside");\n');

    let symlinkAvailable = true;
    try {
      await symlink(join(outside, 'outside.js'), join(root, 'assets', 'linked.js'));
    } catch {
      symlinkAvailable = false;
    }

    if (symlinkAvailable) {
      const symlinkRes = await hit((serverResponse) => sendContainedStaticFile({
        res: serverResponse,
        rootDir: root,
        filePath: join(root, 'assets', 'linked.js'),
        cacheControl: 'public, max-age=31536000, immutable',
      }));

      expect(symlinkRes.status).toBe(404);
      expect(await symlinkRes.text()).toBe('Not Found');
    }

    const escapeRes = await hit((serverResponse) => sendContainedStaticFile({
      res: serverResponse,
      rootDir: root,
      filePath: join(outside, 'outside.js'),
      cacheControl: 'public, max-age=31536000, immutable',
    }));

    expect(escapeRes.status).toBe(404);
    expect(await escapeRes.text()).toBe('Not Found');
  });
});
