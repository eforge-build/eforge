import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  API_ROUTES,
  CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN,
  type ConsoleWorkstationFrameBundleManifestEntry,
  type ConsoleWorkstationFrameBundleAssetRef,
} from '@eforge-build/client';
import { defineRoute, type RequestContext, type RouteDefinition } from '../../http/router.js';
import { sendJsonError, sendText } from '../../http/response.js';
import { localOnly, rejectCrossSiteBrowser } from '../../http/security.js';
import { loadContributionRuntime } from './contribution-service.js';

const security = [localOnly('Extension workstation content reads'), rejectCrossSiteBrowser('Extension workstation content reads')];
const workstationAssetIdPattern = new RegExp(CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN);
const workstationAssetIdHashPattern = /^sha256-([a-f0-9]{64})-path-[a-f0-9]{64}$/;

export function createExtensionWorkstationRoutes(): RouteDefinition[] {
  return [
    defineRoute({
      routeKey: 'extensionWorkstationFrame',
      method: 'GET',
      pattern: API_ROUTES.extensionWorkstationFrame,
      security,
      handler: sendWorkstationFrame,
    }),
    defineRoute({
      routeKey: 'extensionWorkstationAsset',
      method: 'GET',
      pattern: API_ROUTES.extensionWorkstationAsset,
      security,
      handler: sendWorkstationAsset,
    }),
  ];
}

async function sendWorkstationFrame(ctx: RequestContext): Promise<void> {
  const workstation = await findFrameBundleWorkstation(ctx);
  if (!workstation) {
    sendJsonError(ctx.res, 404, 'Extension workstation frame bundle not found');
    return;
  }
  sendText(ctx.res, 200, renderFrameHtml(workstation), {
    contentType: 'text/html; charset=utf-8',
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function sendWorkstationAsset(ctx: RequestContext): Promise<void> {
  const assetId = ctx.params.assetId ?? '';
  if (!workstationAssetIdPattern.test(assetId)) {
    sendJsonError(ctx.res, 400, 'Malformed extension workstation asset id');
    return;
  }

  const workstation = await findFrameBundleWorkstation(ctx);
  if (!workstation) {
    sendJsonError(ctx.res, 404, 'Extension workstation frame bundle not found');
    return;
  }

  const asset = findAsset(workstation, assetId);
  if (!asset) {
    sendJsonError(ctx.res, 404, 'Extension workstation asset not found');
    return;
  }

  const expectedSha256 = contentSha256ForAsset(asset);
  if (!expectedSha256) {
    sendJsonError(ctx.res, 409, 'Extension workstation asset hash mismatch');
    return;
  }

  const assetPath = await resolveAssetPath(ctx.monitor.cwd, workstation.extensionPath, asset.relativePath);
  if (!assetPath) {
    sendJsonError(ctx.res, 404, 'Extension workstation asset not found');
    return;
  }

  const body = await readFile(assetPath);
  if (createHash('sha256').update(body).digest('hex') !== expectedSha256) {
    sendJsonError(ctx.res, 409, 'Extension workstation asset hash mismatch');
    return;
  }

  sendText(ctx.res, 200, body, {
    contentType: contentTypeForPath(asset.relativePath),
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function findFrameBundleWorkstation(ctx: RequestContext): Promise<ConsoleWorkstationFrameBundleManifestEntry | undefined> {
  const workstationId = ctx.params.workstationId ?? '';
  if (workstationId.length === 0) return undefined;
  const { manifest } = await loadContributionRuntime(ctx.monitor);
  const workstation = manifest.consoleWorkstations.find((entry) => entry.id === workstationId);
  return workstation !== undefined && 'frameBundle' in workstation ? workstation : undefined;
}

function findAsset(workstation: ConsoleWorkstationFrameBundleManifestEntry, assetId: string): ConsoleWorkstationFrameBundleAssetRef | undefined {
  const assets = [workstation.frameBundle.entrypoint, ...workstation.frameBundle.styles, ...workstation.frameBundle.assets];
  return assets.find((asset) => asset.id === assetId);
}

function contentSha256ForAsset(asset: ConsoleWorkstationFrameBundleAssetRef): string | undefined {
  const idHash = workstationAssetIdHashPattern.exec(asset.id)?.[1];
  return idHash !== undefined && idHash === asset.sha256 ? idHash : undefined;
}

async function resolveAssetPath(cwd: string | undefined, extensionPath: string, relativePath: string): Promise<string | undefined> {
  if (!cwd || relativePath.includes('\0') || isAbsolute(relativePath)) return undefined;
  const extensionRoot = await resolveExtensionRoot(cwd, extensionPath);
  if (!extensionRoot) return undefined;
  const candidate = resolve(extensionRoot, relativePath);
  if (!isWithinDir(candidate, extensionRoot)) return undefined;
  try {
    const [realRoot, realCandidate] = await Promise.all([realpath(extensionRoot), realpath(candidate)]);
    if (!isWithinDir(realCandidate, realRoot)) return undefined;
    const info = await lstat(realCandidate);
    return info.isFile() && !info.isSymbolicLink() ? realCandidate : undefined;
  } catch {
    return undefined;
  }
}

async function resolveExtensionRoot(cwd: string, extensionPath: string): Promise<string | undefined> {
  if (extensionPath.includes('\0')) return undefined;
  const resolved = resolve(cwd, extensionPath);
  if (!isWithinDir(resolved, cwd)) return undefined;
  try {
    const info = await lstat(resolved);
    return info.isDirectory() ? resolved : resolve(resolved, '..');
  } catch {
    return undefined;
  }
}

function renderFrameHtml(workstation: ConsoleWorkstationFrameBundleManifestEntry): string {
  const styles = workstation.frameBundle.styles.map((asset) => `<link rel="stylesheet" href="${escapeHtmlAttribute(asset.url)}">`).join('\n');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtmlText(workstation.title)}</title>
${styles}
</head>
<body>
<div id="root"></div>
<script type="module" src="${escapeHtmlAttribute(workstation.frameBundle.entrypoint.url)}"></script>
</body>
</html>`;
}

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.css': return 'text/css; charset=utf-8';
    case '.html': return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

function isWithinDir(path: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..'));
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replace(/`/g, '&#96;');
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
