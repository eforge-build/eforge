import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  API_ROUTES,
  CONSOLE_WORKSTATION_BROWSER_SDK_VERSION,
  EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
  buildPath,
  type ExtensionContributionManifestResponse,
} from '@eforge-build/client';
import type { NativeExtensionRegistry } from '@eforge-build/engine/extensions/index';
import { startContentRouteHarness } from './route-test-harness.js';
import { createExtensionWorkstationRoutes, renderBridgeScript } from '../routes/extensions/workstations.js';

const contributionMock = vi.hoisted(() => ({
  manifest: undefined as ExtensionContributionManifestResponse | undefined,
  loadContributionRuntime: vi.fn(),
}));

vi.mock('../routes/extensions/contribution-service.js', () => ({
  loadContributionRuntime: contributionMock.loadContributionRuntime,
}));

describe('extension workstation routes', () => {
  it('rejects malformed asset ids before loading extension runtime', async () => {
    contributionMock.loadContributionRuntime.mockClear();
    const harness = await startContentRouteHarness({ routes: createExtensionWorkstationRoutes });
    try {
      const res = await harness.get(buildPath(API_ROUTES.extensionWorkstationAsset, { workstationId: 'bundle:board', assetId: 'asset.js' }));
      expect(res.status).toBe(400);
      expect(await res.text()).toBe('Bad Request');
      expect(contributionMock.loadContributionRuntime).not.toHaveBeenCalled();
    } finally { await harness.close(); }
  });

  it('returns a route-specific 503 when the working directory is unavailable', async () => {
    contributionMock.loadContributionRuntime.mockReset();
    const harness = await startContentRouteHarness({ routes: createExtensionWorkstationRoutes });
    try {
      harness.context.cwd = undefined;
      const res = await harness.get(buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: 'bundle:board' }));
      expect(res.status).toBe(503);
      expect(await res.text()).toBe('Working directory not configured');
      expect(contributionMock.loadContributionRuntime).not.toHaveBeenCalled();
    } finally { await harness.close(); }
  });

  it('returns a route-specific 500 when extension workstation runtime loading fails', async () => {
    contributionMock.loadContributionRuntime.mockReset().mockRejectedValue(new Error('manifest unavailable'));
    const harness = await startContentRouteHarness({ routes: createExtensionWorkstationRoutes });
    try {
      const res = await harness.get(buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: 'bundle:board' }));
      expect(res.status).toBe(500);
      expect(await res.text()).toBe('Extension workstation runtime unavailable');
    } finally { await harness.close(); }
  });

  it('rejects asset ids that are absent from the loaded registry', async () => {
    const harness = await startContentRouteHarness({ routes: createExtensionWorkstationRoutes });
    try {
      const body = 'console.log("ok");\n';
      const sha256 = sha256Hex(body);
      const asset = assetRef('workstation-assets/index.js', `${'a'.repeat(64)}`, sha256);
      contributionMock.manifest = manifestFor(asset);
      contributionMock.loadContributionRuntime.mockReset().mockResolvedValue({ manifest: contributionMock.manifest, registry: registryFor(harness.cwd) });
      await seedAsset(harness.cwd, 'workstation-assets/index.js', body);

      const res = await harness.get(asset.url);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('Not Found');
    } finally { await harness.close(); }
  });

  it('posts the raw bridge token from Console-generated frame URL fragments', async () => {
    const modulePath = '../../../console-ui/src/views/workstations/workstation-frame-url.js';
    const { buildWorkstationFrameUrl } = await import(modulePath) as { buildWorkstationFrameUrl(frameUrl: string, bridgeToken: string): string };
    const token = 'token one=value&two';
    const frameUrl = buildWorkstationFrameUrl('/frame', token);
    const posted: unknown[] = [];
    const frameWindow = {
      location: { hash: new URL(frameUrl, 'http://localhost').hash },
      crypto: { randomUUID: () => 'request-1' },
      parent: { postMessage: (message: unknown) => posted.push(message) },
      addEventListener: () => undefined,
      eforge: undefined,
    };

    Function('window', 'URLSearchParams', renderBridgeScript())(frameWindow, URLSearchParams);
    expect((frameWindow.eforge as unknown as { version: number }).version).toBe(CONSOLE_WORKSTATION_BROWSER_SDK_VERSION);
    void (frameWindow.eforge as unknown as { invokeAction(actionId: string, input: Record<string, unknown>): Promise<unknown> }).invokeAction('bundle:hello', { ok: true });

    expect(posted[0]).toMatchObject({ bridgeToken: token });
  });

  it('serves frames and assets with response-level protections', async () => {
    const harness = await startContentRouteHarness({ routes: createExtensionWorkstationRoutes });
    try {
      const body = 'console.log("ok");\n';
      const sha256 = sha256Hex(body);
      const asset = assetRef('workstation-assets/index.js', sha256, sha256, 'index.js');
      contributionMock.manifest = manifestFor(asset);
      contributionMock.loadContributionRuntime.mockReset().mockResolvedValue({ manifest: contributionMock.manifest, registry: registryFor(harness.cwd) });
      await seedAsset(harness.cwd, asset.relativePath, body);

      const frame = await harness.get(buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: 'bundle:board' }));
      expect(frame.status).toBe(200);
      expect(frame.headers.get('content-security-policy')).toContain("script-src 'self' 'nonce-");

      const res = await harness.get(asset.url);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    } finally { await harness.close(); }
  });
});

function manifestFor(entrypoint: ReturnType<typeof assetRef>): ExtensionContributionManifestResponse {
  return {
    schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
    generatedAt: new Date(0).toISOString(),
    actions: [],
    consoleContributions: [],
    consoleWorkstations: [{
      id: 'bundle:board',
      localId: 'board',
      extensionName: 'bundle',
      extensionPath: '.eforge/extensions/bundle.mjs',
      title: 'Board',
      schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
      frameBundle: {
        browserSdkVersion: CONSOLE_WORKSTATION_BROWSER_SDK_VERSION,
        frameUrl: buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: 'bundle:board' }),
        entrypoint,
        styles: [],
        assets: [],
      },
      allowedActions: [],
    }],
    integrationCommands: [],
    deepLinks: [],
  };
}

function assetRef(relativePath: string, idSha256: string, sha256: string, bundleRelativePath = relativePath) {
  const id = `sha256-${idSha256}-path-${sha256Hex(bundleRelativePath)}`;
  return {
    id,
    url: buildPath(API_ROUTES.extensionWorkstationAsset, { workstationId: 'bundle:board', assetId: id }),
    relativePath,
    sha256,
  };
}

function registryFor(cwd: string): NativeExtensionRegistry {
  return {
    extensions: [],
    candidates: [],
    diagnostics: [],
    eventHooks: [],
    agentRunHooks: [],
    policyGates: [],
    profileRouters: [],
    inputSources: [],
    reviewerPerspectives: [],
    validationProviders: [],
    tools: [],
    prdEnrichers: [],
    actions: [],
    consoleContributions: [],
    consoleWorkstations: [{
      kind: 'consoleWorkstation',
      extensionName: 'bundle',
      extensionPath: join(cwd, '.eforge', 'extensions', 'bundle.mjs'),
      localId: 'board',
      id: 'bundle:board',
      value: {
        id: 'board',
        title: 'Board',
        frameBundle: {
          root: 'workstation-assets',
          entrypoint: 'index.js',
        },
      },
    }],
    integrationCommands: [],
    deepLinks: [],
  };
}

async function seedAsset(cwd: string, relativePath: string, body: string): Promise<void> {
  const extensionDir = join(cwd, '.eforge', 'extensions');
  await mkdir(join(extensionDir, 'dist'), { recursive: true });
  await mkdir(join(extensionDir, 'workstation-assets'), { recursive: true });
  await writeFile(join(extensionDir, 'bundle.mjs'), 'export default function extension() {}\n');
  await writeFile(join(extensionDir, relativePath), body);
}

function sha256Hex(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}
