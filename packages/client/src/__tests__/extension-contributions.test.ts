import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import {
  EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
  CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN,
  CONSOLE_WORKSTATION_BUNDLE_ASSET_URL_PATTERN,
  CONSOLE_WORKSTATION_BUNDLE_SHA256_PATTERN,
  CONSOLE_WORKSTATION_FRAME_URL_PATTERN,
  ConsoleContributionBlockSchema,
  ConsoleWorkstationFrameBundleAssetRefSchema,
  ExtensionActionInvokeErrorCodeSchema,
  ExtensionActionInvokeRequestSchema,
  ExtensionActionInvokeResponseSchema,
  safeParseExtensionContributionManifest,
  safeParseExtensionActionInvokeRequest,
  safeParseExtensionActionInvokeResponse,
} from '../extension-contributions.js';
import {
  CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN as BROWSER_CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN,
  CONSOLE_WORKSTATION_BUNDLE_ASSET_URL_PATTERN as BROWSER_CONSOLE_WORKSTATION_BUNDLE_ASSET_URL_PATTERN,
  CONSOLE_WORKSTATION_BUNDLE_SHA256_PATTERN as BROWSER_CONSOLE_WORKSTATION_BUNDLE_SHA256_PATTERN,
  CONSOLE_WORKSTATION_FRAME_URL_PATTERN as BROWSER_CONSOLE_WORKSTATION_FRAME_URL_PATTERN,
  ConsoleWorkstationFrameBundleManifestSchema as BrowserConsoleWorkstationFrameBundleManifestSchema,
} from '../browser.js';
import { Value } from '@sinclair/typebox/value';
import { API_ROUTES, buildPath } from '../routes.js';

const base = {
  id: 'example.item',
  localId: 'item',
  extensionName: 'example',
  extensionPath: '/repo/.eforge/extensions/example',
};

function bundleAssetRef(relativePath: string) {
  const id = 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-path-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  return {
    id,
    url: buildPath(API_ROUTES.extensionWorkstationAsset, { workstationId: 'example.workstation', assetId: id }),
    relativePath,
    sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  };
}

function manifest() {
  return {
    schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
    generatedAt: '2026-06-03T00:00:00.000Z',
    actions: [{
      ...base,
      id: 'example.say-hi',
      localId: 'say-hi',
      title: 'Say hi',
      inputSchema: Type.Object({ name: Type.String() }),
      sideEffects: ['none'],
    }],
    consoleContributions: [{
      ...base,
      id: 'example.panel',
      localId: 'panel',
      title: 'Panel',
      schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
      blocks: [{ rendererId: 'text', content: 'Hello' }],
    }],
    consoleWorkstations: [{
      ...base,
      id: 'example.workstation',
      localId: 'workstation',
      title: 'Workstation',
      schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
      srcDoc: '<h1>Hello</h1>',
      allowedActions: ['example.say-hi'],
    }],
    integrationCommands: [{
      ...base,
      id: 'example.command',
      localId: 'command',
      label: 'Run command',
      action: { actionId: 'example.say-hi', inputDefaults: { name: 'world' } },
    }],
    deepLinks: [{
      ...base,
      id: 'example.link',
      localId: 'link',
      label: 'Open link',
      urlTemplate: 'https://example.test/{id}',
    }],
    diagnostics: [{
      extensionName: 'example',
      extensionPath: '/repo/.eforge/extensions/example',
      severity: 'warning',
      message: 'Heads up',
      code: 'extension:invalid-registration',
      name: 'example',
    }],
  };
}

describe('extension contribution schemas', () => {
  it('owns the contribution manifest, workstation frame/asset, and action invocation route constants', () => {
    expect(API_ROUTES.extensionContributionManifest).toBe('/api/extensions/contributions');
    expect(API_ROUTES.extensionWorkstationFrame).toBe('/api/extensions/workstations/:workstationId/frame');
    expect(API_ROUTES.extensionWorkstationAsset).toBe('/api/extensions/workstations/:workstationId/assets/:assetId');
    expect(API_ROUTES.extensionActionInvoke).toBe('/api/extensions/actions/invoke');
    expect(buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: 'demo:board' })).toBe('/api/extensions/workstations/demo%3Aboard/frame');
    expect(buildPath(API_ROUTES.extensionWorkstationAsset, { workstationId: 'demo:board', assetId: 'asset:one' })).toBe('/api/extensions/workstations/demo%3Aboard/assets/asset%3Aone');
  });

  it('exports bundle workstation schemas and constants from the browser entrypoint', () => {
    expect(BROWSER_CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN).toBe(CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN);
    expect(BROWSER_CONSOLE_WORKSTATION_BUNDLE_ASSET_URL_PATTERN).toBe(CONSOLE_WORKSTATION_BUNDLE_ASSET_URL_PATTERN);
    expect(BROWSER_CONSOLE_WORKSTATION_BUNDLE_SHA256_PATTERN).toBe(CONSOLE_WORKSTATION_BUNDLE_SHA256_PATTERN);
    expect(BROWSER_CONSOLE_WORKSTATION_FRAME_URL_PATTERN).toBe(CONSOLE_WORKSTATION_FRAME_URL_PATTERN);
    expect(BrowserConsoleWorkstationFrameBundleManifestSchema.type).toBe('object');
  });

  it('keeps the browser extension contribution exports free of forbidden Node-only sources', () => {
    const browserSource = readFileSync(new URL('../browser.ts', import.meta.url), 'utf8');
    const importExportLines = browserSource
      .split('\n')
      .filter((line) => /^\s*(import|export)\b.*\bfrom\b/.test(line));

    for (const forbidden of ['daemon-client', 'lockfile', './api-version.js', 'node:', 'packages/console-ui', '@eforge-build/console-ui']) {
      expect(importExportLines, `browser.ts must not export from ${forbidden}`).not.toEqual(
        expect.arrayContaining([expect.stringContaining(forbidden)]),
      );
    }
  });

  it('accepts a manifest with actions, Console contributions, srcDoc workstations, commands, deep links, and diagnostics', () => {
    expect(safeParseExtensionContributionManifest(manifest()).success).toBe(true);
  });

  it('accepts a manifest with a bundle-backed Console workstation', () => {
    const value = manifest();
    value.consoleWorkstations[0] = {
      ...base,
      id: 'example.workstation',
      localId: 'workstation',
      title: 'Workstation',
      schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
      frameBundle: {
        browserSdkVersion: 1,
        frameUrl: buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: 'example.workstation' }),
        entrypoint: bundleAssetRef('dist/index.js'),
        styles: [bundleAssetRef('dist/index.css')],
        assets: [bundleAssetRef('dist/logo.svg')],
      },
      allowedActions: ['example.say-hi'],
    } as never;
    expect(safeParseExtensionContributionManifest(value).success).toBe(true);
  });

  it('rejects handler-like unsafe action manifest fields', () => {
    for (const key of ['handler', 'module', 'source']) {
      const value = manifest();
      (value.actions[0] as Record<string, unknown>)[key] = 'unsafe';
      expect(safeParseExtensionContributionManifest(value).success).toBe(false);
    }
  });

  it('rejects invalid console blocks, missing Console titles, and non-JSON-safe schema documents', () => {
    const missingTitle = manifest();
    delete (missingTitle.consoleContributions[0] as Partial<(typeof missingTitle.consoleContributions)[number]>).title;
    expect(safeParseExtensionContributionManifest(missingTitle).success).toBe(false);

    const missingHref = manifest();
    missingHref.consoleContributions[0].blocks = [{ rendererId: 'link', content: 'x' } as never];
    expect(safeParseExtensionContributionManifest(missingHref).success).toBe(false);

    const unsafeSchema = manifest();
    (unsafeSchema.actions[0].inputSchema as Record<string, unknown>).properties = { value: () => 'nope' };
    expect(safeParseExtensionContributionManifest(unsafeSchema).success).toBe(false);

    const nonObjectInputSchema = manifest();
    nonObjectInputSchema.actions[0].inputSchema = Type.String() as never;
    expect(safeParseExtensionContributionManifest(nonObjectInputSchema).success).toBe(false);
  });

  it('rejects invalid Console workstation entries', () => {
    const missingAllowedActions = manifest();
    delete (missingAllowedActions.consoleWorkstations[0] as Partial<(typeof missingAllowedActions.consoleWorkstations)[number]>).allowedActions;
    expect(safeParseExtensionContributionManifest(missingAllowedActions).success).toBe(false);

    const extraSrcDocField = manifest();
    (extraSrcDocField.consoleWorkstations[0] as Record<string, unknown>).extra = true;
    expect(safeParseExtensionContributionManifest(extraSrcDocField).success).toBe(false);

    const neitherSource = manifest();
    delete (neitherSource.consoleWorkstations[0] as Partial<(typeof neitherSource.consoleWorkstations)[number]>).srcDoc;
    expect(safeParseExtensionContributionManifest(neitherSource).success).toBe(false);

    const bothSources = manifest();
    (bothSources.consoleWorkstations[0] as Record<string, unknown>).frameBundle = {
      browserSdkVersion: 1,
      frameUrl: buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: 'example.workstation' }),
      entrypoint: bundleAssetRef('dist/index.js'),
      styles: [],
      assets: [],
    };
    expect(safeParseExtensionContributionManifest(bothSources).success).toBe(false);

    const invalidVersion = manifest();
    invalidVersion.consoleWorkstations[0].schemaVersion = 2 as never;
    expect(safeParseExtensionContributionManifest(invalidVersion).success).toBe(false);

    const nonStringAllowedActions = manifest();
    nonStringAllowedActions.consoleWorkstations[0].allowedActions = [123] as never;
    expect(safeParseExtensionContributionManifest(nonStringAllowedActions).success).toBe(false);
  });

  it('validates bundle asset refs with the shared asset id and content hash patterns', () => {
    expect(CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN).toBe('^sha256-[a-f0-9]{64}-path-[a-f0-9]{64}$');
    expect(CONSOLE_WORKSTATION_BUNDLE_ASSET_URL_PATTERN).toBe('^/api/extensions/workstations/[^/?#]+/assets/sha256-[a-f0-9]{64}-path-[a-f0-9]{64}$');
    expect(CONSOLE_WORKSTATION_BUNDLE_SHA256_PATTERN).toBe('^[a-f0-9]{64}$');
    expect(CONSOLE_WORKSTATION_FRAME_URL_PATTERN).toBe('^/api/extensions/workstations/[^/?#]+/frame(?:\\?[^#]*)?$');
    expect(Value.Check(ConsoleWorkstationFrameBundleAssetRefSchema, bundleAssetRef('dist/index.js'))).toBe(true);
    expect(Value.Check(ConsoleWorkstationFrameBundleAssetRefSchema, {
      ...bundleAssetRef('dist/index.js'),
      id: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-path-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })).toBe(false);
    expect(Value.Check(ConsoleWorkstationFrameBundleAssetRefSchema, {
      ...bundleAssetRef('dist/index.js'),
      sha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    })).toBe(false);
  });

  it('accepts bundle frame URLs with query strings', () => {
    const value = manifest();
    value.consoleWorkstations[0] = {
      ...base,
      id: 'example.workstation',
      localId: 'workstation',
      title: 'Workstation',
      schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
      frameBundle: {
        browserSdkVersion: 1,
        frameUrl: `${buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: 'example.workstation' })}?view=main`,
        entrypoint: bundleAssetRef('dist/index.js'),
        styles: [bundleAssetRef('dist/index.css')],
        assets: [bundleAssetRef('dist/logo.svg')],
      },
      allowedActions: ['example.say-hi'],
    } as never;
    expect(safeParseExtensionContributionManifest(value).success).toBe(true);
  });

  it('rejects invalid bundle-backed Console workstation metadata', () => {
    function bundleManifest() {
      const value = manifest();
      value.consoleWorkstations[0] = {
        ...base,
        id: 'example.workstation',
        localId: 'workstation',
        title: 'Workstation',
        schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
        frameBundle: {
          browserSdkVersion: 1,
          frameUrl: buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: 'example.workstation' }),
          entrypoint: bundleAssetRef('dist/index.js'),
          styles: [bundleAssetRef('dist/index.css')],
          assets: [bundleAssetRef('dist/logo.svg')],
        },
        allowedActions: ['example.say-hi'],
      } as never;
      return value;
    }

    const missingBrowserSdkVersion = bundleManifest();
    delete ((missingBrowserSdkVersion.consoleWorkstations[0] as never as { frameBundle: Record<string, unknown> }).frameBundle.browserSdkVersion);
    expect(safeParseExtensionContributionManifest(missingBrowserSdkVersion).success).toBe(false);

    const unsupportedBrowserSdkVersion = bundleManifest();
    (unsupportedBrowserSdkVersion.consoleWorkstations[0] as never as { frameBundle: { browserSdkVersion: number } }).frameBundle.browserSdkVersion = 2;
    expect(safeParseExtensionContributionManifest(unsupportedBrowserSdkVersion).success).toBe(false);

    const malformedAssetId = bundleManifest();
    (malformedAssetId.consoleWorkstations[0] as never as { frameBundle: { entrypoint: { id: string } } }).frameBundle.entrypoint.id = 'asset.js';
    expect(safeParseExtensionContributionManifest(malformedAssetId).success).toBe(false);

    const malformedSha256 = bundleManifest();
    (malformedSha256.consoleWorkstations[0] as never as { frameBundle: { entrypoint: { sha256: string } } }).frameBundle.entrypoint.sha256 = 'not-a-hash';
    expect(safeParseExtensionContributionManifest(malformedSha256).success).toBe(false);

    const mismatchedAssetIdHash = bundleManifest();
    (mismatchedAssetIdHash.consoleWorkstations[0] as never as { frameBundle: { entrypoint: { sha256: string } } }).frameBundle.entrypoint.sha256 = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    expect(safeParseExtensionContributionManifest(mismatchedAssetIdHash).success).toBe(false);

    for (const frameUrl of ['https://example.test/frame', 'data:text/html,nope', 'javascript:alert(1)', '/api/extensions/workstations/example.workstation/assets/not-frame']) {
      const invalidFrameUrl = bundleManifest();
      (invalidFrameUrl.consoleWorkstations[0] as never as { frameBundle: { frameUrl: string } }).frameBundle.frameUrl = frameUrl;
      expect(safeParseExtensionContributionManifest(invalidFrameUrl).success).toBe(false);
    }

    for (const url of ['https://example.test/asset.js', 'data:text/javascript,nope', 'javascript:alert(1)', '/api/extensions/workstations/example.workstation/assets/dist%2Findex.js']) {
      const invalidAssetUrl = bundleManifest();
      (invalidAssetUrl.consoleWorkstations[0] as never as { frameBundle: { entrypoint: { url: string } } }).frameBundle.entrypoint.url = url;
      expect(safeParseExtensionContributionManifest(invalidAssetUrl).success).toBe(false);
    }

    const mismatchedFrameWorkstationId = bundleManifest();
    (mismatchedFrameWorkstationId.consoleWorkstations[0] as never as { frameBundle: { frameUrl: string } }).frameBundle.frameUrl = buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: 'other.workstation' });
    expect(safeParseExtensionContributionManifest(mismatchedFrameWorkstationId).success).toBe(false);

    const mismatchedAssetWorkstationId = bundleManifest();
    (mismatchedAssetWorkstationId.consoleWorkstations[0] as never as { frameBundle: { entrypoint: { url: string } } }).frameBundle.entrypoint.url = buildPath(API_ROUTES.extensionWorkstationAsset, { workstationId: 'other.workstation', assetId: bundleAssetRef('dist/index.js').id });
    expect(safeParseExtensionContributionManifest(mismatchedAssetWorkstationId).success).toBe(false);

    const mismatchedAssetUrlId = bundleManifest();
    (mismatchedAssetUrlId.consoleWorkstations[0] as never as { frameBundle: { entrypoint: { url: string } } }).frameBundle.entrypoint.url = '/api/extensions/workstations/example.workstation/assets/sha256-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc-path-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    expect(safeParseExtensionContributionManifest(mismatchedAssetUrlId).success).toBe(false);

    const missingEntrypoint = bundleManifest();
    delete ((missingEntrypoint.consoleWorkstations[0] as never as { frameBundle: Record<string, unknown> }).frameBundle.entrypoint);
    expect(safeParseExtensionContributionManifest(missingEntrypoint).success).toBe(false);

    const nonArrayStyles = bundleManifest();
    (nonArrayStyles.consoleWorkstations[0] as never as { frameBundle: { styles: unknown } }).frameBundle.styles = bundleAssetRef('dist/index.css');
    expect(safeParseExtensionContributionManifest(nonArrayStyles).success).toBe(false);

    const nonArrayAssets = bundleManifest();
    (nonArrayAssets.consoleWorkstations[0] as never as { frameBundle: { assets: unknown } }).frameBundle.assets = bundleAssetRef('dist/logo.svg');
    expect(safeParseExtensionContributionManifest(nonArrayAssets).success).toBe(false);

    const extraFrameBundleField = bundleManifest();
    (extraFrameBundleField.consoleWorkstations[0] as never as { frameBundle: Record<string, unknown> }).frameBundle.extra = true;
    expect(safeParseExtensionContributionManifest(extraFrameBundleField).success).toBe(false);

    const extraAssetRefField = bundleManifest();
    (extraAssetRefField.consoleWorkstations[0] as never as { frameBundle: { entrypoint: Record<string, unknown> } }).frameBundle.entrypoint.extra = true;
    expect(safeParseExtensionContributionManifest(extraAssetRefField).success).toBe(false);
  });

  it('validates requestedBy host values and non-blank action ids', () => {
    for (const host of ['console', 'pi', 'claude', 'mcp', 'cli']) {
      expect(safeParseExtensionActionInvokeRequest({ actionId: 'a', input: {}, requestedBy: { host } }).success).toBe(true);
    }
    expect(safeParseExtensionActionInvokeRequest({ actionId: '', input: {}, requestedBy: { host: 'cli' } }).success).toBe(false);
    expect(safeParseExtensionActionInvokeRequest({ actionId: '   ', input: {}, requestedBy: { host: 'cli' } }).success).toBe(false);
    expect(safeParseExtensionActionInvokeRequest({ actionId: 'a', input: {}, requestedBy: { host: 'web' } }).success).toBe(false);
  });

  it('rejects non-object invocation inputs', () => {
    for (const input of [[], 'x', 1, true, null]) {
      expect(Value.Check(ExtensionActionInvokeRequestSchema, { actionId: 'a', input, requestedBy: { host: 'cli' } })).toBe(false);
    }
  });

  it('accepts invocation success and every failure code', () => {
    expect(safeParseExtensionActionInvokeResponse({ ok: true, invocationId: 'invoke-1', output: { value: 1 } }).success).toBe(true);
    expect(safeParseExtensionActionInvokeResponse({ ok: true }).success).toBe(false);
    const codes = ExtensionActionInvokeErrorCodeSchema.anyOf.map((schema) => schema.const);
    for (const code of codes) {
      expect(Value.Check(ExtensionActionInvokeResponseSchema, { ok: false, invocationId: 'invoke-1', error: { code, message: 'nope' } })).toBe(true);
    }
  });

  it('accepts each Console renderer ID and rejects an unknown renderer', () => {
    expect(Value.Check(ConsoleContributionBlockSchema, { rendererId: 'text', content: 'x' })).toBe(true);
    expect(Value.Check(ConsoleContributionBlockSchema, { rendererId: 'markdown', content: 'x' })).toBe(true);
    expect(Value.Check(ConsoleContributionBlockSchema, { rendererId: 'status-badge', content: 'x', status: 'ok' })).toBe(true);
    expect(Value.Check(ConsoleContributionBlockSchema, { rendererId: 'link', content: 'x', href: 'https://example.com' })).toBe(true);
    expect(Value.Check(ConsoleContributionBlockSchema, { rendererId: 'action-button', content: 'x', action: { actionId: 'a' } })).toBe(true);
    expect(Value.Check(ConsoleContributionBlockSchema, { rendererId: 'action-form', content: 'x', action: { actionId: 'a' } })).toBe(true);
    expect(Value.Check(ConsoleContributionBlockSchema, { rendererId: 'iframe', content: 'x' })).toBe(false);
  });
});
