import { createServer, request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { getCrossSiteBrowserRejection, getLocalOnlyRejection, isLoopbackHostHeader, isLoopbackRemoteAddress, localMutation, localOnly, rejectCrossSiteBrowser } from '../http/security.js';
import type { RequestContext } from '../http/router.js';

let closeServer: (() => Promise<void>) | undefined;

afterEach(async () => {
  await closeServer?.();
  closeServer = undefined;
});

describe('security classifiers', () => {
  it('accepts loopback remote addresses', () => {
    for (const value of [undefined, '::1', '::ffff:127.0.0.1', '127.0.0.1']) {
      expect(isLoopbackRemoteAddress(value)).toBe(true);
    }
  });

  it('classifies loopback host headers', () => {
    for (const value of ['localhost', 'localhost.', '[::1]', '::1', '127.0.0.1:4567']) {
      expect(isLoopbackHostHeader(value)).toBe(true);
    }
    for (const value of ['127.0.0.1.evil.example', '192.0.2.1', '', 'bad host']) {
      expect(isLoopbackHostHeader(value)).toBe(false);
    }
  });

  it('returns local-only rejection messages', () => {
    expect(getLocalOnlyRejection({ operationLabel: 'Extension management mutations', remoteAddress: '192.0.2.1', hostHeader: 'localhost' }))
      .toBe('Extension management mutations must originate from the local machine');
    expect(getLocalOnlyRejection({ operationLabel: 'Extension management mutations', remoteAddress: '127.0.0.1', hostHeader: '192.0.2.1' }))
      .toBe('Extension management mutations require a loopback Host header');
    expect(getLocalOnlyRejection({ operationLabel: 'Extension management mutations', remoteAddress: '127.0.0.1', hostHeader: 'localhost:1', originHeader: 'http://evil.example' }))
      .toBe('Cross-origin extension management mutations are not allowed');
  });

  it('classifies Fetch Metadata', () => {
    expect(getCrossSiteBrowserRejection({ operationLabel: 'Extension management mutations', secFetchSite: 'cross-site' }))
      .toBe('Cross-site extension management mutations are not allowed');
    expect(getCrossSiteBrowserRejection({ operationLabel: 'Extension management mutations', secFetchSite: 'same-site' }))
      .toBe('Cross-site extension management mutations are not allowed');
    for (const site of ['same-origin', 'none', undefined]) {
      expect(getCrossSiteBrowserRejection({ operationLabel: 'Extension management mutations', secFetchSite: site })).toBeNull();
    }
  });
});

describe('security policies', () => {
  async function policyResponse(headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
    const policy = localMutation('Extension management mutations');
    const server = createServer(async (req, res) => {
      const blocked = await policy({ req, res } as RequestContext);
      if (!blocked && !res.headersSent) {
        res.writeHead(204);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closeServer = () => new Promise((resolve) => server.close(() => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    return new Promise((resolve, reject) => {
      const clientReq = request({ host: '127.0.0.1', port: addr.port, headers }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: body ? JSON.parse(body) : null }));
      });
      clientReq.on('error', reject);
      clientReq.end();
    });
  }

  it('writes 403 JSON for non-loopback Host', async () => {
    const res = await policyResponse({ Host: '192.0.2.1' });
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  it('writes 403 JSON for cross-origin Origin', async () => {
    const res = await policyResponse({ Host: '127.0.0.1', Origin: 'http://evil.example' });
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  it('writes 403 JSON for cross-site Fetch Metadata', async () => {
    const res = await policyResponse({ Host: '127.0.0.1', 'Sec-Fetch-Site': 'cross-site' });
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  it('exports individual policy factories', () => {
    expect(typeof localOnly('x')).toBe('function');
    expect(typeof rejectCrossSiteBrowser('x')).toBe('function');
  });
});
