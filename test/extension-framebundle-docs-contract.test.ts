import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function json<T>(path: string): T {
  return JSON.parse(read(path)) as T;
}

const extensionGuidePaths = [
  'docs/extensions.md',
  'web/content/docs/extensions.md',
] as const;

const extensionApiPaths = [
  'docs/extensions-api.md',
  'web/content/docs/extensions-api.md',
] as const;

const generatedMirrorPairs = [
  ['web/content/docs/extensions.md', 'web/public/docs/extensions.md'],
  ['web/content/docs/extensions-api.md', 'web/public/docs/extensions-api.md'],
] as const;

describe('frameBundle workstation documentation contract', () => {
  it('documents source-compatible srcDoc workstations beside iframe-scoped frameBundle assets', () => {
    for (const path of extensionGuidePaths) {
      const source = read(path);

      for (const snippet of [
        'srcDoc',
        'frameBundle',
        'workstation-assets',
        '@eforge-build/extension-sdk/browser',
        'window.eforge.invokeAction',
        'allowedActions',
      ]) {
        expect(source, `${path} should document ${snippet}`).toContain(snippet);
      }

      expect(source, `${path} should describe frameBundle fields`).toMatch(/root[\s\S]*entrypoint[\s\S]*styles[\s\S]*assets[\s\S]*browserSdkVersion/i);
      expect(source, `${path} should constrain bundle roots to workstation-assets`).toMatch(/Bundle roots? must be `?workstation-assets`? or a child directory under `?workstation-assets\//i);
      expect(source, `${path} should document omitted browserSdkVersion semantics`).toMatch(/omitted means browser SDK v1/i);
      expect(source, `${path} should say bundle code stays in the iframe`).toMatch(/(?:bundle|code)[^.\n]*(?:executes|runs)[^.\n]*inside[^.\n]*(?:iframe|workstation iframe)[^.\n]*not in the parent Console realm/i);
      expect(source, `${path} should allow React or another framework inside the iframe`).toMatch(/bundle React or another browser framework inside (?:a `frameBundle` )?iframe/i);
    }
  });

  it('documents daemon-owned frame and asset serving boundaries for bundle workstations', () => {
    for (const path of [...extensionGuidePaths, ...extensionApiPaths, 'packages/extension-sdk/README.md']) {
      const source = read(path);

      expect(source, `${path} should mention a Content-Security-Policy header`).toContain('Content-Security-Policy');
      expect(source, `${path} should document no-cache frame shell semantics`).toMatch(/frame shell[^.\n]*no-cache|no-cache[^.\n]*frame shell|frame routes?[^.\n]*no-cache/i);
      expect(source, `${path} should document immutable declared asset URLs`).toMatch(/immutable[^.\n]*(?:asset URLs|content-addressed asset URLs|declared asset)|(?:asset URLs|declared bundle files)[^.\n]*immutable/i);
      expect(source, `${path} should document fragment-carried bridge tokens`).toMatch(/bridge token[^.\n]*(?:URL fragment|iframe URL fragment)[^.\n]*not[^.\n]*(?:query string|route query)|(?:URL fragment|iframe URL fragment)[^.\n]*bridge token[^.\n]*not[^.\n]*(?:query string|route query)/i);
      expect(source, `${path} should reject filesystem-relative browser asset paths`).toMatch(/browser[^.\n]*never[^.\n]*(?:filesystem-relative asset paths|provide filesystem-relative asset paths)/i);
    }
  });

  it('keeps parent-Console plugin and private import boundaries unsupported while allowing iframe bundles', () => {
    for (const path of [...extensionGuidePaths, ...extensionApiPaths, 'packages/extension-sdk/README.md', 'packages/console-ui/README.md']) {
      const source = read(path);

      const commonBoundaries = [
        /direct React component loading(?: into the parent Console)?[^.\n]*(?:unsupported|deferred)|(?:unsupported|deferred)[^.\n]*direct React component loading(?: into the parent Console)?/i,
        /private Console (?:React\/components\/CSS imports|imports|modules)[^.\n]*(?:unsupported|must not|deferred)|(?:unsupported|must not|deferred)[^.\n]*private Console (?:React\/components\/CSS imports|imports|modules)/i,
        /parent Console context(?: imports?)?[^.\n]*(?:unsupported|must not|deferred)|(?:unsupported|must not|deferred)[^.\n]*parent Console context(?: imports?)?/i,
        /parent-Console plugins?[^.\n]*(?:unsupported|must not|deferred)|(?:unsupported|must not|deferred)[^.\n]*parent-Console plugins?/i,
        /(?:raw )?extension-owned HTTP routes?[^.\n]*(?:unsupported|deferred)|(?:unsupported|deferred)[^.\n]*(?:raw )?extension-owned HTTP routes?/i,
      ];
      const expectedBoundaries = path === 'packages/console-ui/README.md'
        ? commonBoundaries
        : [...commonBoundaries, /extension-owned AI planning\/chat APIs[^.\n]*(?:unsupported|deferred)|(?:unsupported|deferred)[^.\n]*extension-owned AI planning\/chat APIs/i];
      for (const expected of expectedBoundaries) {
        expect(source, `${path} should match ${expected}`).toMatch(expected);
      }
    }
  });

  it('documents trust hashing for workstation-assets without broad dist hashing', () => {
    for (const path of extensionGuidePaths) {
      const source = read(path);
      expect(source, `${path} should say workstation-assets files are hash-covered`).toMatch(/content hash[^.\n]*workstation-assets|workstation-assets[^.\n]*(?:content hash|hash)/i);
      expect(source, `${path} should keep top-level dist excluded`).toMatch(/excluding top-level `?node_modules\/`?, `?dist\/`?, and `?\.git\/`?|top-level `?dist\/`?[^.\n]*(?:excluded|skipped)/i);
    }
  });

  it('keeps generated public docs and route references synchronized with source docs', () => {
    for (const [sourcePath, mirrorPath] of generatedMirrorPairs) {
      expect(read(mirrorPath), `${mirrorPath} should match ${sourcePath}`).toBe(read(sourcePath));
    }

    for (const path of ['web/content/reference/api.md', 'web/public/reference/api.md']) {
      const reference = read(path);
      expect(reference).toContain('extensionWorkstationFrame');
      expect(reference).toContain('extensionWorkstationAsset');
    }

    expect(read('web/public/llms.txt')).toContain('frameBundle');
    expect(read('web/public/llms-full.txt')).toContain('@eforge-build/extension-sdk/browser');
  });

  it('keeps example and dogfood prose scoped to docs snippets instead of a runnable bundle example', () => {
    const exampleReadme = read('examples/extensions/README.md');
    expect(exampleReadme).toMatch(/Bundle workstation examples intentionally live in the docs and SDK README snippets/i);
    expect(exampleReadme).toContain('does not build browser source');

    for (const entry of readdirSync('examples/extensions').filter((name) => name.endsWith('.ts'))) {
      const source = read(`examples/extensions/${entry}`);
      expect(source, `${entry} should not become a runnable frameBundle browser example`).not.toContain('frameBundle');
      expect(source, `${entry} should not import the browser SDK`).not.toContain('@eforge-build/extension-sdk/browser');
    }

    const dogfoodReadme = read('eforge/extensions/eforge-plan/README.md');
    expect(dogfoodReadme).toMatch(/planning workstation appears under `\/console\/workstations` as an extension-owned `frameBundle`/i);
    expect(dogfoodReadme).toMatch(/All reads and mutations go through `window\.eforge\.invokeAction`/i);
  });

  it('keeps Claude and Pi extension authoring guidance in sync', () => {
    const pluginSkill = read('eforge-plugin/skills/extend/extend.md');
    const piSkill = read('packages/pi-eforge/skills/eforge-extend/SKILL.md');

    for (const source of [pluginSkill, piSkill]) {
      for (const snippet of [
        'registerConsoleWorkstation',
        'srcDoc',
        'frameBundle',
        'workstation-assets/',
        '@eforge-build/extension-sdk/browser',
        'parent Console',
      ]) {
        expect(source).toContain(snippet);
      }
    }
  });
});
