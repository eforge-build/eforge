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
import { startContentRouteHarness } from './route-test-harness.js';
import { createExtensionWorkstationRoutes } from '../routes/extensions/workstations.js';

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
      expect(await res.json()).toMatchObject({ error: 'Malformed extension workstation asset id' });
      expect(contributionMock.loadContributionRuntime).not.toHaveBeenCalled();
    } finally { await harness.close(); }
  });

  it('rejects asset manifests whose id hash does not match sha256', async () => {
    const harness = await startContentRouteHarness({ routes: createExtensionWorkstationRoutes });
    try {
      const body = 'console.log("ok");\n';
      const sha256 = sha256Hex(body);
      const asset = assetRef('dist/index.js', `${'a'.repeat(64)}`, sha256);
      contributionMock.manifest = manifestFor(asset);
      contributionMock.loadContributionRuntime.mockReset().mockResolvedValue({ manifest: contributionMock.manifest });
      await seedAsset(harness.cwd, asset.relativePath, body);

      const res = await harness.get(asset.url);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: 'Extension workstation asset hash mismatch' });
    } finally { await harness.close(); }
  });

  it('serves frames and assets with response-level CSP protections', async () => {
    const harness = await startContentRouteHarness({ routes: createExtensionWorkstationRoutes });
    try {
      const body = 'console.log("ok");\n';
      const sha256 = sha256Hex(body);
      const asset = assetRef('dist/index.js', sha256, sha256);
      contributionMock.manifest = manifestFor(asset);
      contributionMock.loadContributionRuntime.mockReset().mockResolvedValue({ manifest: contributionMock.manifest });
      await seedAsset(harness.cwd, asset.relativePath, body);

      const frame = await harness.get(buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: 'bundle:board' }));
      expect(frame.status).toBe(200);
      expect(frame.headers.get('content-security-policy')).toContain('sandbox allow-scripts');

      const res = await harness.get(asset.url);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-security-policy')).toContain("script-src 'none'");
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

function assetRef(relativePath: string, idSha256: string, sha256: string) {
  const id = `sha256-${idSha256}-path-${'b'.repeat(64)}`;
  return {
    id,
    url: buildPath(API_ROUTES.extensionWorkstationAsset, { workstationId: 'bundle:board', assetId: id }),
    relativePath,
    sha256,
  };
}

async function seedAsset(cwd: string, relativePath: string, body: string): Promise<void> {
  const extensionDir = join(cwd, '.eforge', 'extensions');
  await mkdir(join(extensionDir, 'dist'), { recursive: true });
  await writeFile(join(extensionDir, 'bundle.mjs'), 'export default function extension() {}\n');
  await writeFile(join(extensionDir, relativePath), body);
}

function sha256Hex(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}
