import { isIP } from 'node:net';
import type { RequestContext } from './router.js';
import { sendJsonError } from './response.js';

export interface LocalOnlyInput {
  remoteAddress?: string;
  hostHeader?: string;
  originHeader?: string;
  operationLabel: string;
}

export interface CrossSiteBrowserInput {
  secFetchSite?: string;
  operationLabel: string;
}

export type SecurityPolicy = (ctx: RequestContext) => boolean | Promise<boolean>;

export function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  if (remoteAddress === undefined) return false;
  const ipVersion = isIP(remoteAddress);
  if (ipVersion === 4) return remoteAddress.split('.')[0] === '127';
  if (ipVersion !== 6) return false;
  const normalized = remoteAddress.toLowerCase();
  if (normalized === '::1') return true;
  if (!normalized.startsWith('::ffff:')) return false;
  return isLoopbackRemoteAddress(normalized.slice('::ffff:'.length));
}

export function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return hostHeader.toLowerCase() === '::1';
  }
  if (hostname.startsWith('[') && hostname.endsWith(']')) hostname = hostname.slice(1, -1);
  if (hostname.endsWith('.')) hostname = hostname.slice(0, -1);
  const ipVersion = isIP(hostname);
  return hostname === 'localhost' || hostname === '::1' || (ipVersion === 4 && hostname.startsWith('127.'));
}

export function getLocalOnlyRejection(input: LocalOnlyInput): string | null {
  if (!isLoopbackRemoteAddress(input.remoteAddress)) {
    return `${input.operationLabel} must originate from the local machine`;
  }
  if (!isLoopbackHostHeader(input.hostHeader)) {
    return `${input.operationLabel} require a loopback Host header`;
  }
  if (input.originHeader) {
    try {
      if (new URL(input.originHeader).host !== input.hostHeader) {
        return `Cross-origin ${input.operationLabel.toLowerCase()} are not allowed`;
      }
    } catch {
      return `Cross-origin ${input.operationLabel.toLowerCase()} are not allowed`;
    }
  }
  return null;
}

export function getCrossSiteBrowserRejection(input: CrossSiteBrowserInput): string | null {
  const site = input.secFetchSite;
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    return `Cross-site ${input.operationLabel.toLowerCase()} are not allowed`;
  }
  return null;
}

export function localOnly(operationLabel: string): SecurityPolicy {
  return (ctx) => {
    const message = getLocalOnlyRejection({
      operationLabel,
      remoteAddress: ctx.req.socket.remoteAddress,
      hostHeader: firstHeader(ctx.req.headers.host),
      originHeader: firstHeader(ctx.req.headers.origin),
    });
    if (!message) return false;
    sendJsonError(ctx.res, 403, message);
    return true;
  };
}

export function rejectCrossSiteBrowser(operationLabel: string): SecurityPolicy {
  return (ctx) => {
    const message = getCrossSiteBrowserRejection({
      operationLabel,
      secFetchSite: firstHeader(ctx.req.headers['sec-fetch-site']),
    });
    if (!message) return false;
    sendJsonError(ctx.res, 403, message);
    return true;
  };
}

export function localMutation(operationLabel: string): SecurityPolicy {
  const local = localOnly(operationLabel);
  const browser = rejectCrossSiteBrowser(operationLabel);
  return async (ctx) => (await local(ctx)) || (await browser(ctx));
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
