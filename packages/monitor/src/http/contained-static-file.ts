import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative } from 'node:path';
import type { ServerResponse } from 'node:http';
import { sendText } from './response.js';
import { MIME_TYPES } from './static-assets.js';

export interface SendContainedStaticFileOptions {
  res: ServerResponse;
  rootDir: string;
  filePath: string;
  cacheControl: string;
  expectedSha256?: string;
  headers?: Record<string, string | number>;
}

export async function sendContainedStaticFile(options: SendContainedStaticFileOptions): Promise<void> {
  const contained = await verifyContainedFile(options.rootDir, options.filePath);
  if (contained === 'not-found') {
    sendText(options.res, 404, 'Not Found');
    return;
  }
  if (contained === 'error') {
    sendText(options.res, 500, 'Internal Server Error');
    return;
  }

  let content: Buffer;
  try {
    content = await readFile(options.filePath);
  } catch {
    sendText(options.res, 500, 'Internal Server Error');
    return;
  }

  if (options.expectedSha256 !== undefined) {
    const actualSha256 = createHash('sha256').update(content).digest('hex');
    if (actualSha256 !== options.expectedSha256) {
      sendText(options.res, 404, 'Not Found');
      return;
    }
  }

  const extension = extname(options.filePath).toLowerCase();
  if (extension === '.html' || extension === '.htm') {
    sendText(options.res, 404, 'Not Found');
    return;
  }
  sendText(options.res, 200, content, {
    contentType: MIME_TYPES[extension] ?? 'application/octet-stream',
    headers: {
      'Content-Length': content.length,
      'Cache-Control': options.cacheControl,
      'X-Content-Type-Options': 'nosniff',
      ...(extension === '.svg' ? { 'Content-Security-Policy': "sandbox; default-src 'none'; script-src 'none'; frame-ancestors 'none'" } : {}),
      ...options.headers,
    },
  });
}

async function verifyContainedFile(rootDir: string, filePath: string): Promise<'ok' | 'not-found' | 'error'> {
  try {
    const fileStat = await lstat(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) return 'not-found';
  } catch {
    return 'not-found';
  }

  let realRoot: string;
  let realFile: string;
  try {
    realRoot = await realpath(rootDir);
    realFile = await realpath(filePath);
  } catch {
    return 'not-found';
  }

  const rel = relative(realRoot, realFile);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return 'ok';
  return 'not-found';
}
