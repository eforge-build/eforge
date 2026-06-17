import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const README = 'eforge/extensions/eforge-plan/README.md';

async function readme(): Promise<string> {
  return readFile(README, 'utf-8');
}

describe('eforge-plan README mature package and workflow contract', () => {
  it('documents install, update, trust, reload, scope, validation, and removal commands', async () => {
    const text = await readme();
    for (const required of [
      'eforge extension install @eforge-build/eforge-plan',
      'eforge extension install ./eforge/extensions/eforge-plan',
      'eforge extension install ./eforge/extensions/eforge-plan/eforge-build-eforge-plan-<version>.tgz',
      'eforge extension validate eforge-plan',
      'eforge extension trust eforge-plan',
      'eforge extension reload',
      'eforge extension update eforge-plan',
      'eforge extension update eforge-plan --version latest',
      'eforge extension remove eforge-plan',
      '--scope project --trust',
      'user',
      'local',
    ]) {
      expect(text).toContain(required);
    }
    expect(text).toMatch(/--version <specifier>[\s\S]*npm-installed extensions/);
    expect(text).toMatch(/Local directory and tarball installs update from their recorded sidecar source/);
  });

  it('documents package artifact contents and trust/privacy boundaries', async () => {
    const text = await readme();
    expect(text).toContain('@eforge-build/eforge-plan');
    expect(text).toContain('dist/');
    expect(text).toContain('workstation-assets/plans/');
    expect(text).toContain('README.md');
    expect(text).toContain('LICENSE');
    expect(text).toMatch(/not a sandbox boundary|unsandboxed/i);
    expect(text).toMatch(/workstation.*assets.*trust hash|trust hash.*workstation.*assets/is);
    expect(text).toContain('.eforge/storage/extensions/eforge-plan/');
    expect(text).toMatch(/private.*storage|storage.*private/is);
  });

  it('documents annotation revision capture, snapshots, unresolved management, and apply semantics', async () => {
    const text = await readme();
    for (const action of [
      'create-plan-revision-annotation',
      'update-plan-revision-annotation',
      'delete-plan-revision-annotation',
      'resolve-plan-revision-annotation',
      'dismiss-plan-revision-annotation',
    ]) {
      expect(text).toContain(action);
    }
    expect(text).toMatch(/capture annotations from selected text|selected text/);
    expect(text).toMatch(/fallback controls/);
    expect(text).toMatch(/Unresolved annotations remain visible/);
    expect(text).toMatch(/Annotation-driven revision turns snapshot/);
    expect(text).toMatch(/resolves only the referenced open annotations/);
    expect(text).toMatch(/invalid-patch turns do not write plan sections and do not auto-resolve annotations/);
  });

  it('documents local-first roadmap steering, shared context, freshness, and non-canonical discovery', async () => {
    const text = await readme();
    expect(text).toContain('.eforge/storage/extensions/eforge-plan/roadmaps/local-focus.md');
    expect(text).toContain('.eforge/storage/extensions/eforge-plan/roadmaps/config.json');
    expect(text).toMatch(/configured shared (roadmap )?sources/i);
    expect(text).toMatch(/docs\/roadmap\.md/);
    expect(text).toMatch(/non-canonical shared context|non-canonical context/);
    expect(text).toMatch(/does not silently rewrite shared roadmap files/);
    expect(text).toMatch(/Changing local focus or configured roadmap context can make recommendations stale/);
    expect(text).not.toMatch(/roadmap evidence|canonical docs\/roadmap/);
  });
});
