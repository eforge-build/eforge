import { randomBytes } from 'node:crypto';
import {
  API_ROUTES,
  CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN,
  type ConsoleWorkstationFrameBundleManifestEntry,
} from '@eforge-build/client';
import type { MonitorContext } from '../../context.js';
import { sendContainedStaticFile } from '../../http/contained-static-file.js';
import { sendJsonError, sendText } from '../../http/response.js';
import { defineRoute, type RequestContext, type RouteDefinition } from '../../http/router.js';
import { isLoopbackHostHeader, isLoopbackRemoteAddress, localOnly, rejectCrossSiteBrowser, type SecurityPolicy } from '../../http/security.js';
import { loadContributionRuntime, type LoadedContributionRuntime } from './contribution-service.js';
import { buildWorkstationFrameCsp, buildWorkstationFrameShell, renderBridgeScript } from './workstation-frame-shell.js';

const FRAME_SECURITY = [localOnly('Extension workstation content reads'), rejectCrossSiteBrowser('Extension workstation content reads')];
const ASSET_SECURITY = [localWorkstationAssetRead];
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const ASSET_ID_PATTERN = new RegExp(CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN);
type NativeExtensionRegistry = import('@eforge-build/engine/extensions/index').NativeExtensionRegistry;
type AssetLookupFailureReason = Extract<
  import('@eforge-build/engine/extensions/index').ConsoleWorkstationBundleAssetLookupResult,
  { ok: false }
>['reason'];

export { renderBridgeScript };

export function createExtensionWorkstationRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    defineRoute({
      routeKey: 'extensionWorkstationFrame',
      method: 'GET',
      pattern: API_ROUTES.extensionWorkstationFrame,
      security: FRAME_SECURITY,
      handler: (ctx) => sendWorkstationFrame(ctx, context),
    }),
    defineRoute({
      routeKey: 'extensionWorkstationAsset',
      method: 'GET',
      pattern: API_ROUTES.extensionWorkstationAsset,
      security: ASSET_SECURITY,
      handler: (ctx) => sendWorkstationAsset(ctx, context),
    }),
  ];
}

async function sendWorkstationFrame(ctx: RequestContext, context: MonitorContext): Promise<void> {
  const runtime = await loadRuntimeForRoute(ctx, context);
  if (!runtime) return;

  const workstation = findFrameBundleWorkstation(runtime, ctx.params.workstationId ?? '');
  if (!workstation) {
    sendText(ctx.res, 404, 'Not Found');
    return;
  }

  const nonce = randomBytes(16).toString('base64');
  sendText(ctx.res, 200, buildWorkstationFrameShell(workstation, nonce), {
    contentType: 'text/html; charset=utf-8',
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': buildWorkstationFrameCsp(nonce),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

async function sendWorkstationAsset(ctx: RequestContext, context: MonitorContext): Promise<void> {
  const assetId = ctx.params.assetId ?? '';
  if (!ASSET_ID_PATTERN.test(assetId)) {
    sendText(ctx.res, 400, 'Bad Request');
    return;
  }

  const runtime = await loadRuntimeForRoute(ctx, context);
  if (!runtime) return;

  const { findConsoleWorkstationBundleAsset } = await import('@eforge-build/engine/extensions/index');
  const lookup = findConsoleWorkstationBundleAsset(runtime.registry as NativeExtensionRegistry, ctx.params.workstationId ?? '', assetId);
  if (!lookup.ok) {
    sendAssetLookupError(ctx, lookup.reason);
    return;
  }

  await sendContainedStaticFile({
    res: ctx.res,
    rootDir: lookup.catalog.bundleRoot,
    filePath: lookup.asset.absolutePath,
    cacheControl: IMMUTABLE_CACHE_CONTROL,
    expectedSha256: lookup.asset.sha256,
    headers: { 'Access-Control-Allow-Origin': 'null' },
  });
}

function localWorkstationAssetRead(ctx: RequestContext): ReturnType<SecurityPolicy> {
  if (!isLoopbackRemoteAddress(ctx.req.socket.remoteAddress)) {
    sendJsonError(ctx.res, 403, 'Extension workstation asset reads must originate from the local machine');
    return true;
  }
  if (!isLoopbackHostHeader(firstHeader(ctx.req.headers.host))) {
    sendJsonError(ctx.res, 403, 'Extension workstation asset reads require a loopback Host header');
    return true;
  }
  const origin = firstHeader(ctx.req.headers.origin);
  if (origin === undefined || origin === 'null') return false;
  try {
    if (new URL(origin).host === firstHeader(ctx.req.headers.host)) return false;
  } catch {
    // fall through to the rejection below
  }
  sendJsonError(ctx.res, 403, 'Cross-origin extension workstation asset reads are not allowed');
  return true;
}

function findFrameBundleWorkstation(runtime: LoadedContributionRuntime, workstationId: string): ConsoleWorkstationFrameBundleManifestEntry | undefined {
  const workstation = runtime.manifest.consoleWorkstations.find((entry) => entry.id === workstationId);
  if (workstation === undefined || !('frameBundle' in workstation)) return undefined;
  return workstation;
}

async function loadRuntimeForRoute(ctx: RequestContext, context: MonitorContext): Promise<LoadedContributionRuntime | undefined> {
  if (!context.cwd) {
    sendText(ctx.res, 503, 'Working directory not configured');
    return undefined;
  }
  try {
    return await loadContributionRuntime(context);
  } catch {
    sendText(ctx.res, 500, 'Extension workstation runtime unavailable');
    return undefined;
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sendAssetLookupError(ctx: RequestContext, reason: AssetLookupFailureReason): void {
  if (reason === 'malformed-asset-id') {
    sendText(ctx.res, 400, 'Bad Request');
    return;
  }
  sendText(ctx.res, 404, 'Not Found');
}
