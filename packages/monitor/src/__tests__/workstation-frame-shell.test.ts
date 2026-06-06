import { describe, expect, it } from 'vitest';
import type { ConsoleWorkstationFrameBundleManifestEntry } from '@eforge-build/client';
import {
  buildWorkstationFrameCsp,
  buildWorkstationFrameShell,
} from '../routes/extensions/workstation-frame-shell.js';

const assetId = 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-path-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function bundleWorkstation(overrides: Partial<ConsoleWorkstationFrameBundleManifestEntry> = {}): ConsoleWorkstationFrameBundleManifestEntry {
  return {
    id: 'bundle:board',
    localId: 'board',
    extensionName: 'bundle',
    extensionPath: '/repo/eforge/extensions/bundle',
    title: 'Board',
    schemaVersion: 1,
    frameBundle: {
      browserSdkVersion: 1,
      frameUrl: '/api/extensions/workstations/bundle%3Aboard/frame',
      entrypoint: {
        id: assetId,
        url: `/api/extensions/workstations/bundle%3Aboard/assets/${assetId}`,
        relativePath: 'workstation-assets/board/index.js',
        sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      styles: [],
      assets: [],
    },
    allowedActions: ['bundle:render'],
    ...overrides,
  };
}

describe('workstation frame shell generation', () => {
  it('emits a nonce-bearing bridge bootstrap and matching restrictive CSP', () => {
    const nonce = 'nonce+value/with=symbols';
    const shell = buildWorkstationFrameShell(bundleWorkstation(), nonce);
    const csp = buildWorkstationFrameCsp(nonce);

    expect(shell).toContain(`<script nonce="${nonce}">`);
    expect(shell).toContain('window.eforge = Object.freeze({ version: 1, invokeAction: invokeAction });');
    expect(shell).toContain('new URLSearchParams(window.location.hash.slice(1))');
    expect(shell).toContain('eforge:workstation:invoke-action');
    expect(shell).toContain('eforge:workstation:action-result');
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}'`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("connect-src 'none'");
  });

  it('escapes workstation titles and declared asset URLs in HTML contexts', () => {
    const shell = buildWorkstationFrameShell(bundleWorkstation({
      title: 'Board <script>alert("x")</script> & friends',
      frameBundle: {
        ...bundleWorkstation().frameBundle,
        entrypoint: {
          ...bundleWorkstation().frameBundle.entrypoint,
          url: '/assets/app.js?name="onload"&tag=<script>',
        },
        styles: [{
          ...bundleWorkstation().frameBundle.entrypoint,
          url: '/assets/style.css?theme="dark"&x=<tag>',
          relativePath: 'workstation-assets/board/style.css',
        }],
      },
    }), 'nonce');

    expect(shell).toContain('<title>Board &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; friends</title>');
    expect(shell).toContain('href="/assets/style.css?theme=&quot;dark&quot;&amp;x=&lt;tag&gt;"');
    expect(shell).toContain('src="/assets/app.js?name=&quot;onload&quot;&amp;tag=&lt;script&gt;"');
    expect(shell).not.toContain('<script>alert("x")</script>');
  });

  it('loads stylesheet assets in manifest order before the module entrypoint', () => {
    const firstStyle = { ...bundleWorkstation().frameBundle.entrypoint, url: '/assets/first.css', relativePath: 'first.css' };
    const secondStyle = { ...bundleWorkstation().frameBundle.entrypoint, url: '/assets/second.css', relativePath: 'second.css' };
    const workstation = bundleWorkstation({
      frameBundle: {
        ...bundleWorkstation().frameBundle,
        entrypoint: { ...bundleWorkstation().frameBundle.entrypoint, url: '/assets/index.js' },
        styles: [firstStyle, secondStyle],
      },
    });

    const shell = buildWorkstationFrameShell(workstation, 'nonce');

    expect(shell.indexOf('href="/assets/first.css"')).toBeLessThan(shell.indexOf('href="/assets/second.css"'));
    expect(shell.indexOf('href="/assets/second.css"')).toBeLessThan(shell.indexOf('src="/assets/index.js"'));
    expect(shell).toContain('<script type="module" src="/assets/index.js"></script>');
  });

  it('rejects invalid action ids and non-record action input before posting to the parent frame', () => {
    const shell = buildWorkstationFrameShell(bundleWorkstation(), 'nonce');

    expect(shell).toContain("actionId !== 'string' || actionId.length === 0");
    expect(shell).toContain("reject(new Error('actionId must be a non-empty string'))");
    expect(shell).toContain('var safeInput = input === undefined ? {} : input;');
    expect(shell).toContain('value !== null && typeof value === \'object\' && !Array.isArray(value)');
    expect(shell).toContain("reject(new Error('input must be an object when provided'))");
    expect(shell).toContain("window.parent.postMessage({");
  });
});
