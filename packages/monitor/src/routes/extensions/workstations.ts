import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  API_ROUTES,
  CONSOLE_WORKSTATION_BROWSER_SDK_VERSION,
  CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN,
  type ConsoleWorkstationFrameBundleManifestEntry,
} from '@eforge-build/client';
import { defineRoute, type RequestContext, type RouteDefinition } from '../../http/router.js';
import { sendJsonError, sendText } from '../../http/response.js';
import { localOnly, rejectCrossSiteBrowser } from '../../http/security.js';
import { loadContributionRuntime } from './contribution-service.js';

const security = [localOnly('Extension workstation content reads'), rejectCrossSiteBrowser('Extension workstation content reads')];
const workstationAssetIdPattern = new RegExp(CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN);
type ConsoleWorkstationBundleAssetLookupResult = import('@eforge-build/engine/extensions/index').ConsoleWorkstationBundleAssetLookupResult;
type NativeExtensionRegistry = import('@eforge-build/engine/extensions/index').NativeExtensionRegistry;

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
  if (workstation === null) return;
  if (!workstation) {
    sendJsonError(ctx.res, 404, 'Extension workstation frame bundle not found');
    return;
  }
  const bridgeScriptHash = createHash('sha256').update(renderBridgeScript()).digest('base64');
  sendText(ctx.res, 200, renderFrameHtml(workstation), {
    contentType: 'text/html; charset=utf-8',
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `sandbox allow-scripts; default-src 'none'; script-src 'self' 'sha256-${bridgeScriptHash}'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'`,
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

  const runtime = await loadWorkstationRuntime(ctx);
  if (runtime === null) return;

  const { findConsoleWorkstationBundleAsset } = await import('@eforge-build/engine/extensions/index');
  const lookup = findConsoleWorkstationBundleAsset(runtime.registry as NativeExtensionRegistry, ctx.params.workstationId ?? '', assetId);
  if (!lookup.ok) {
    sendAssetLookupError(ctx, lookup.reason);
    return;
  }

  let body: Buffer;
  try {
    body = await readFile(lookup.asset.absolutePath);
  } catch {
    sendJsonError(ctx.res, 404, 'Extension workstation asset not found');
    return;
  }
  if (createHash('sha256').update(body).digest('hex') !== lookup.asset.sha256) {
    sendJsonError(ctx.res, 409, 'Extension workstation asset hash mismatch');
    return;
  }

  sendText(ctx.res, 200, body, {
    contentType: contentTypeForPath(lookup.asset.extensionRelativePath),
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function findFrameBundleWorkstation(ctx: RequestContext): Promise<ConsoleWorkstationFrameBundleManifestEntry | undefined | null> {
  const workstationId = ctx.params.workstationId ?? '';
  if (workstationId.length === 0) return undefined;
  if (!ctx.monitor.cwd) {
    sendJsonError(ctx.res, 503, 'Working directory not configured');
    return null;
  }
  try {
    const { manifest } = await loadContributionRuntime(ctx.monitor);
    const workstation = manifest.consoleWorkstations.find((entry) => entry.id === workstationId);
    return workstation !== undefined && 'frameBundle' in workstation ? workstation : undefined;
  } catch (err) {
    const detail = err instanceof Error ? `: ${err.message}` : '';
    sendJsonError(ctx.res, 500, `Failed to load extension workstation runtime${detail}`);
    return null;
  }
}

async function loadWorkstationRuntime(ctx: RequestContext): Promise<{ registry: unknown } | null> {
  if (!ctx.monitor.cwd) {
    sendJsonError(ctx.res, 503, 'Working directory not configured');
    return null;
  }
  try {
    return await loadContributionRuntime(ctx.monitor);
  } catch (err) {
    const detail = err instanceof Error ? `: ${err.message}` : '';
    sendJsonError(ctx.res, 500, `Failed to load extension workstation runtime${detail}`);
    return null;
  }
}

function sendAssetLookupError(ctx: RequestContext, reason: Extract<ConsoleWorkstationBundleAssetLookupResult, { ok: false }>['reason']): void {
  switch (reason) {
    case 'malformed-asset-id':
      sendJsonError(ctx.res, 400, 'Malformed extension workstation asset id');
      return;
    case 'unknown-workstation':
    case 'not-frame-bundle':
      sendJsonError(ctx.res, 404, 'Extension workstation frame bundle not found');
      return;
    case 'unknown-asset-id':
      sendJsonError(ctx.res, 404, 'Extension workstation asset not found');
      return;
    default:
      sendJsonError(ctx.res, 404, 'Extension workstation asset not found');
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
<script>${renderBridgeScript()}</script>
<script type="module" src="${escapeHtmlAttribute(workstation.frameBundle.entrypoint.url)}"></script>
</body>
</html>`;
}

export function renderBridgeScript(): string {
  return `(function(){var bridgeToken=new URLSearchParams(window.location.hash.slice(1)).get('bridgeToken')||'';var pending=new Map();function nextRequestId(){if(window.crypto&&typeof window.crypto.randomUUID==='function')return window.crypto.randomUUID();return 'req-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}window.addEventListener('message',function(event){var message=event.data;if(!message||message.type!=='eforge:workstation:action-result'||typeof message.requestId!=='string')return;var entry=pending.get(message.requestId);if(!entry)return;pending.delete(message.requestId);if(message.error){var error=new Error(message.error.message||'Workstation action failed');error.code=message.error.code;entry.reject(error);return}if(!message.response||message.response.ok!==true){var responseError=message.response&&message.response.error;var failure=new Error((responseError&&responseError.message)||'Workstation action failed');failure.code=responseError&&responseError.code;entry.reject(failure);return}entry.resolve(message.response.output)});window.eforge=Object.freeze({version:${CONSOLE_WORKSTATION_BROWSER_SDK_VERSION},invokeAction:function(actionId,input){return new Promise(function(resolve,reject){if(typeof actionId!=='string'||actionId.length===0){reject(new Error('actionId must be a non-empty string'));return}var requestId=nextRequestId();var safeInput=input&&typeof input==='object'&&!Array.isArray(input)?input:{};pending.set(requestId,{resolve:resolve,reject:reject});try{window.parent.postMessage({type:'eforge:workstation:invoke-action',requestId:requestId,bridgeToken:bridgeToken,actionId:actionId,input:safeInput},'*')}catch(err){pending.delete(requestId);reject(err)}})}})}());`;
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

function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replace(/`/g, '&#96;');
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
