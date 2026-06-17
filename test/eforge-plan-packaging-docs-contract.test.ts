import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const centralExtensionDocs = [
  'docs/extensions.md',
  'web/content/docs/extensions.md',
  'web/public/docs/extensions.md',
];

async function read(path: string): Promise<string> {
  return readFile(path, 'utf-8');
}

describe('eforge-plan packaging documentation contract', () => {
  it('documents first-party installable package workflows in every extension docs mirror', async () => {
    for (const path of centralExtensionDocs) {
      const text = await read(path);
      expect(text, `${path} should name the first-party package`).toContain('@eforge-build/eforge-plan');
      expect(text, `${path} should document local install`).toContain('eforge extension install @eforge-build/eforge-plan');
      expect(text, `${path} should document project-team trust install`).toContain('eforge extension install @eforge-build/eforge-plan --scope project --trust');
      expect(text, `${path} should document validation`).toContain('eforge extension validate eforge-plan');
      expect(text, `${path} should document trust`).toContain('eforge extension trust eforge-plan');
      expect(text, `${path} should document reload`).toContain('eforge extension reload');
      expect(text, `${path} should document update`).toContain('eforge extension update eforge-plan');
      expect(text, `${path} should document version-pinned update`).toContain('eforge extension update eforge-plan --version latest');
      expect(text, `${path} should document removal`).toContain('eforge extension remove eforge-plan');
      expect(text, `${path} should describe packaged runtime files`).toMatch(/dist\/[\s\S]{0,240}workstation-assets\/plans\//);
      expect(text, `${path} should distinguish local and project/team trust`).toMatch(/local installs[\s\S]{0,400}project\/team installs[\s\S]{0,400}(trust|trusted)/i);
      expect(text, `${path} should warn about unsandboxed extension code`).toMatch(/unsandboxed|arbitrary code|not sandboxed/i);
      expect(text, `${path} should explain npm-only version forwarding`).toMatch(/--version <specifier>[\s\S]{0,300}npm-installed extensions/i);
      expect(text, `${path} should explain local and tarball update source semantics`).toMatch(/Local package directory and tarball installs update from their recorded sidecar source/);
    }
  });

  it('keeps roadmap wording non-canonical in user-facing package docs', async () => {
    for (const path of ['eforge/extensions/eforge-plan/README.md', ...centralExtensionDocs]) {
      const text = await read(path);
      expect(text, `${path} should not use legacy roadmap evidence wording`).not.toMatch(/roadmap evidence/i);
      expect(text, `${path} should not call docs\/roadmap.md canonical`).not.toMatch(/canonical docs\/roadmap/i);
    }

    const readme = await read('eforge/extensions/eforge-plan/README.md');
    expect(readme).toContain('.eforge/storage/extensions/eforge-plan/roadmaps/local-focus.md');
    expect(readme).toContain('.eforge/storage/extensions/eforge-plan/roadmaps/config.json');
    expect(readme).toMatch(/docs\/roadmap\.md[\s\S]{0,180}non-canonical/i);
    expect(readme).toMatch(/does not silently rewrite shared roadmap files/i);
  });

  it('includes eforge-plan in release documentation and package docs', async () => {
    const releasing = await read('docs/releasing.md');
    expect(releasing).toMatch(/@eforge-build\/eforge-plan[\s\S]{0,240}lockstep public npm release/i);
    expect(releasing).toMatch(/package install smoke checks/i);

    const readme = await read('eforge/extensions/eforge-plan/README.md');
    expect(readme).toContain('eforge extension install ./eforge/extensions/eforge-plan');
    expect(readme).toContain('eforge extension install ./eforge/extensions/eforge-plan/eforge-build-eforge-plan-<version>.tgz');
    expect(readme).toMatch(/Private planning state is stored under `.eforge\/storage\/extensions\/eforge-plan\/`/);
  });
});
