import { createHash } from 'node:crypto';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  API_ROUTES,
  buildPath,
  type ConsoleWorkstationFrameBundleManifestEntry,
  type ExtensionContributionManifestResponse,
} from '@eforge-build/client';
import { sendContainedStaticFile } from '../http/contained-static-file.js';
import { startContentRouteHarness, type RouteHarness } from './route-test-harness.js';

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

describe('extension workstation frame and asset routes', () => {
  it('serves generated bundle frame shells and declared assets with secure headers', async () => {
    const harness = await startContentRouteHarness();
    try {
      await seedBundleExtension(harness);
      const manifest = await contributionManifest(harness);
      const workstation = bundleWorkstation(manifest);

      const frame = await harness.get(`${workstation.frameBundle.frameUrl}#bridgeToken=secret-token`);
      const html = await frame.text();
      expect(frame.status).toBe(200);
      expect(frame.headers.get('content-type')).toContain('text/html');
      expect(frame.headers.get('cache-control')).toBe('no-cache');
      expect(frame.headers.get('x-content-type-options')).toBe('nosniff');
      expect(frame.headers.get('referrer-policy')).toBe('no-referrer');
      expect(frame.headers.get('content-security-policy')).toEqual(expect.stringContaining("default-src 'none'"));
      expect(frame.headers.get('content-security-policy')).toEqual(expect.stringContaining("script-src 'self' 'nonce-"));
      expect(frame.headers.get('content-security-policy')).toEqual(expect.stringContaining("style-src 'self'"));
      expect(frame.headers.get('content-security-policy')).toEqual(expect.stringContaining("frame-ancestors 'self'"));
      expect(html).toContain('location.hash');
      expect(html).toContain('bridgeToken');
      expect(html).toContain('window.eforge');
      expect(html).toContain('version: 1');
      expect(html).toContain('eforge:workstation:invoke-action');
      expect(html).toContain(`href="${workstation.frameBundle.styles[0]?.url}"`);
      expect(html).toContain(`<script type="module" src="${workstation.frameBundle.entrypoint.url}"></script>`);
      expect(html).not.toContain('secret-token');

      const js = await harness.get(workstation.frameBundle.entrypoint.url);
      expect(js.status).toBe(200);
      expect(await js.text()).toBe('console.log("board");\n');
      expect(js.headers.get('content-type')).toContain('application/javascript');
      expect(js.headers.get('cache-control')).toBe(IMMUTABLE_CACHE);
      expect(js.headers.get('x-content-type-options')).toBe('nosniff');
      expect(js.headers.get('access-control-allow-origin')).toBe('null');

      const sandboxJs = await harness.get(workstation.frameBundle.entrypoint.url, { headers: { Origin: 'null' } });
      expect(sandboxJs.status).toBe(200);
      expect(sandboxJs.headers.get('access-control-allow-origin')).toBe('null');

      const css = await harness.get(workstation.frameBundle.styles[0]?.url ?? '');
      expect(css.status).toBe(200);
      expect(await css.text()).toBe('body { color: red; }\n');
      expect(css.headers.get('content-type')).toContain('text/css');
      expect(css.headers.get('cache-control')).toBe(IMMUTABLE_CACHE);

      const svg = await harness.get(workstation.frameBundle.assets[0]?.url ?? '');
      expect(svg.status).toBe(200);
      expect(svg.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'; script-src 'none'; frame-ancestors 'none'");
    } finally { await harness.close(); }
  });

  it('returns 404 for legacy srcDoc and missing workstation frame ids', async () => {
    const harness = await startContentRouteHarness();
    try {
      await seedBundleExtension(harness);
      expect((await harness.get(buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: 'bundle:legacy' }))).status).toBe(404);
      expect((await harness.get(buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: 'bundle:missing' }))).status).toBe(404);
    } finally { await harness.close(); }
  });

  it('rejects malformed, traversal-shaped, and undeclared asset ids', async () => {
    const harness = await startContentRouteHarness();
    try {
      await seedBundleExtension(harness);
      const workstation = bundleWorkstation(await contributionManifest(harness));
      const malformed = await harness.get(buildPath(API_ROUTES.extensionWorkstationAsset, { workstationId: workstation.id, assetId: 'asset.js' }));
      expect(malformed.status).toBe(400);
      expect(await malformed.text()).not.toContain(harness.cwd);

      expect((await harness.rawGet(`/api/extensions/workstations/${encodeURIComponent(workstation.id)}/assets/%E0%A4%A`)).status).toBe(400);

      const traversal = await harness.get(buildPath(API_ROUTES.extensionWorkstationAsset, { workstationId: workstation.id, assetId: '..%2Fsecret' }));
      expect(traversal.status).toBe(400);

      const unknownId = `sha256-${'a'.repeat(64)}-path-${'b'.repeat(64)}`;
      const unknown = await harness.get(buildPath(API_ROUTES.extensionWorkstationAsset, { workstationId: workstation.id, assetId: unknownId }));
      expect(unknown.status).toBe(404);
      expect(await unknown.text()).not.toContain(harness.cwd);
    } finally { await harness.close(); }
  });

  it('rejects missing files, symlinks, realpath escapes, and changed content for immutable asset ids', async () => {
    const harness = await startContentRouteHarness();
    try {
      await seedBundleExtension(harness);
      const workstation = bundleWorkstation(await contributionManifest(harness));
      await rm(join(extensionDir(harness), 'workstation-assets', 'board', 'index.js'));
      expect((await harness.get(workstation.frameBundle.entrypoint.url)).status).toBe(404);

      await seedBundleExtension(harness);
      const symlinkWorkstation = bundleWorkstation(await contributionManifest(harness));
      await rm(join(extensionDir(harness), 'workstation-assets', 'board', 'style.css'));
      await symlink(join(extensionDir(harness), 'workstation-assets', 'board', 'logo.svg'), join(extensionDir(harness), 'workstation-assets', 'board', 'style.css'));
      expect((await harness.get(symlinkWorkstation.frameBundle.styles[0]?.url ?? '')).status).toBe(404);

      await seedBundleExtension(harness);
      const escapeWorkstation = bundleWorkstation(await contributionManifest(harness));
      const outside = join(harness.cwd, 'outside-bundle');
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, 'index.js'), 'console.log("escape");\n');
      await writeFile(join(outside, 'style.css'), 'body{}\n');
      await rm(join(extensionDir(harness), 'workstation-assets', 'board'), { recursive: true, force: true });
      await symlink(outside, join(extensionDir(harness), 'workstation-assets', 'board'));
      expect((await harness.get(escapeWorkstation.frameBundle.entrypoint.url)).status).toBe(404);

      await expectHashMismatch(harness);
      await seedBundleExtension(harness);
      await expectHtmlAssetRejected(harness);
    } finally { await harness.close(); }
  });

  it('keeps frame route stricter than opaque-origin asset reads', async () => {
    const harness = await startContentRouteHarness();
    try {
      await seedBundleExtension(harness);
      const workstation = bundleWorkstation(await contributionManifest(harness));
      expect((await harness.get(workstation.frameBundle.frameUrl, { headers: { Origin: 'null' } })).status).toBe(403);
      expect((await harness.get(workstation.frameBundle.entrypoint.url, { headers: { Origin: 'null' } })).status).toBe(200);
    } finally { await harness.close(); }
  });

  it('protects frame and asset routes from non-loopback Host headers', async () => {
    const harness = await startContentRouteHarness();
    try {
      await seedBundleExtension(harness);
      const workstation = bundleWorkstation(await contributionManifest(harness));
      expect((await harness.rawGet(workstation.frameBundle.frameUrl, { Host: 'example.com' })).status).toBe(403);
      expect((await harness.rawGet(workstation.frameBundle.entrypoint.url, { Host: 'example.com' })).status).toBe(403);
    } finally { await harness.close(); }
  });
});

async function contributionManifest(harness: RouteHarness): Promise<ExtensionContributionManifestResponse> {
  const res = await harness.get(API_ROUTES.extensionContributionManifest);
  expect(res.status).toBe(200);
  return await res.json() as ExtensionContributionManifestResponse;
}

function bundleWorkstation(manifest: ExtensionContributionManifestResponse): ConsoleWorkstationFrameBundleManifestEntry {
  const workstation = manifest.consoleWorkstations.find((entry) => entry.id === 'bundle:board');
  if (!workstation || !('frameBundle' in workstation)) throw new Error('bundle workstation missing');
  return workstation;
}

async function seedBundleExtension(harness: RouteHarness): Promise<void> {
  await rm(extensionDir(harness), { recursive: true, force: true });
  await mkdir(join(extensionDir(harness), 'workstation-assets', 'board'), { recursive: true });
  await mkdir(join(harness.cwd, '.eforge'), { recursive: true });
  await writeFile(join(harness.cwd, '.eforge', 'config.yaml'), [
    'extensions:',
    '  enabled: true',
    '  trustProjectExtensions: true',
    '',
  ].join('\n'));
  await writeFile(join(extensionDir(harness), 'index.mjs'), extensionSource());
  await writeFile(join(extensionDir(harness), 'workstation-assets', 'board', 'index.js'), 'console.log("board");\n');
  await writeFile(join(extensionDir(harness), 'workstation-assets', 'board', 'style.css'), 'body { color: red; }\n');
  await writeFile(join(extensionDir(harness), 'workstation-assets', 'board', 'logo.svg'), '<svg></svg>\n');
}

function extensionDir(harness: RouteHarness): string {
  return join(harness.cwd, '.eforge', 'extensions', 'bundle');
}

function extensionSource(): string {
  return `
import { Type } from '@eforge-build/extension-sdk';
export default function extension(eforge) {
  eforge.registerAction({ id: 'echo', title: 'Echo', inputSchema: Type.Object({}, { additionalProperties: true }), handler(input) { return input; } });
  eforge.registerConsoleWorkstation({ id: 'board', title: 'Board', allowedActions: ['echo'], frameBundle: { root: 'workstation-assets/board', entrypoint: 'index.js', styles: ['style.css'], assets: ['logo.svg'], browserSdkVersion: 1 } });
  eforge.registerConsoleWorkstation({ id: 'legacy', title: 'Legacy', srcDoc: '<h1>Legacy</h1>' });
}
`;
}

async function expectHtmlAssetRejected(harness: RouteHarness): Promise<void> {
  const res = new CapturingResponse();
  const htmlPath = join(extensionDir(harness), 'workstation-assets', 'board', 'active.html');
  await writeFile(htmlPath, '<script>throw new Error("nope")</script>');
  await sendContainedStaticFile({
    res: res as never,
    rootDir: extensionDir(harness),
    filePath: htmlPath,
    cacheControl: IMMUTABLE_CACHE,
  });
  expect(res.statusCode).toBe(404);
}

async function expectHashMismatch(harness: RouteHarness): Promise<void> {
  const body = Buffer.from('changed bytes');
  const res = new CapturingResponse();
  await sendContainedStaticFile({
    res: res as never,
    rootDir: extensionDir(harness),
    filePath: join(extensionDir(harness), 'index.mjs'),
    cacheControl: IMMUTABLE_CACHE,
    expectedSha256: createHash('sha256').update(body).digest('hex'),
  });
  expect(res.statusCode).toBe(404);
}

class CapturingResponse {
  headersSent = false;
  statusCode = 0;
  writeHead(status: number): void {
    this.statusCode = status;
    this.headersSent = true;
  }
  end(): void {}
}
