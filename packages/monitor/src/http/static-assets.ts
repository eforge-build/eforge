import type { IncomingMessage, ServerResponse } from 'node:http';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { sendText } from './response.js';

export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
};

export interface StaticUiRequest {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  consoleUiDir: string;
}

export async function serveStaticUiRequest(input: StaticUiRequest): Promise<void> {
  if (input.pathname === '/console') {
    redirectToConsole(input.res);
    return;
  }
  if (input.pathname === '/console/' || input.pathname.startsWith('/console/')) {
    await serveStaticFile(input.res, input.pathname, input.consoleUiDir, '/console');
    return;
  }
  redirectToConsole(input.res);
}

function redirectToConsole(res: ServerResponse): void {
  if (!res.headersSent) {
    res.writeHead(302, {
      Location: '/console/',
      'Cache-Control': 'no-cache',
    });
  }
  res.end();
}

export async function serveStaticFile(
  res: ServerResponse,
  pathname: string,
  rootDir: string,
  basePath: string,
): Promise<void> {
  const rawRelPath = basePath.length > 0 && pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;
  let relPath: string;
  try {
    relPath = decodeURIComponent(rawRelPath);
  } catch {
    sendText(res, 400, 'Bad Request', { contentType: 'text/plain' });
    return;
  }

  if (relPath.startsWith('//')) {
    sendText(res, 400, 'Bad Request', { contentType: 'text/plain' });
    return;
  }

  const normalizedRel = !relPath || relPath === '/' ? '/index.html' : relPath;
  const isAsset = normalizedRel.startsWith('/assets/');
  const candidate = resolve(rootDir, `.${normalizedRel}`);
  const rel = relative(rootDir, candidate);
  if (isAbsolute(rel) || rel.startsWith('..')) {
    sendText(res, 404, 'Not Found', { contentType: 'text/plain' });
    return;
  }

  if (isAsset) {
    const assetsDir = resolve(rootDir, 'assets');
    const assetRel = relative(assetsDir, candidate);
    if (isAbsolute(assetRel) || assetRel.startsWith('..')) {
      sendText(res, 404, 'Not Found', { contentType: 'text/plain' });
      return;
    }
  }

  let realRoot: string;
  try {
    realRoot = await realpath(rootDir);
  } catch {
    sendText(res, 500, 'Internal Server Error', { contentType: 'text/plain' });
    return;
  }

  let filePath = candidate;
  try {
    const fileLstat = await lstat(filePath);
    if (fileLstat.isSymbolicLink()) {
      sendText(res, 404, 'Not Found', { contentType: 'text/plain' });
      return;
    }
    if (!fileLstat.isFile()) {
      if (isAsset) {
        sendText(res, 404, 'Not Found', { contentType: 'text/plain' });
        return;
      }
      filePath = join(rootDir, 'index.html');
    }
  } catch {
    if (isAsset) {
      sendText(res, 404, 'Not Found', { contentType: 'text/plain' });
      return;
    }
    filePath = join(rootDir, 'index.html');
  }

  try {
    const realFile = await realpath(filePath);
    const realRel = relative(realRoot, realFile);
    if (isAbsolute(realRel) || realRel.startsWith('..')) {
      sendText(res, 404, 'Not Found', { contentType: 'text/plain' });
      return;
    }
  } catch {
    sendText(res, 404, 'Not Found', { contentType: 'text/plain' });
    return;
  }

  try {
    const content = await readFile(filePath);
    sendText(res, 200, content, {
      contentType: MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
      headers: {
        'Content-Length': content.length,
        'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
    });
  } catch {
    sendText(res, 500, 'Internal Server Error', { contentType: 'text/plain' });
  }
}
