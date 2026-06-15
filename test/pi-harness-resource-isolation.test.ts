/**
 * Tests for PiHarness resource-loader isolation.
 *
 * Verifies that `buildResourceLoaderOverrides` (exported via `piHarnessInternalsForTest`)
 * correctly implements the isolation contract:
 *  - isolated mode (default): eforge anti-recursion filter fires, then ALL resources are
 *    dropped (empty arrays returned) regardless of package origin.
 *  - ambient mode (opt-in): eforge resources are filtered, non-eforge resources preserved.
 *  - per-category counters track only the eforge-specific drops in both modes.
 *  - the tools allowlist (eforge custom tools + bridged MCP tools) is orthogonal to the
 *    resource loader — these are passed via `tools`/`customTools` on createAgentSession,
 *    not via the resource loader overrides. Regression: ensure the override result does not
 *    interfere with tool names.
 *
 * NOTE: PiHarness short-circuits discoverPiExtensions entirely under isolated mode (see
 * pi-extension-discovery.test.ts for discoverPiExtensions unit tests). This test covers
 * only the override-builder logic that runs inside DefaultResourceLoader.
 */

import { describe, it, expect } from 'vitest';
import { piHarnessInternalsForTest } from '../packages/engine/src/harnesses/pi.js';

const { buildResourceLoaderOverrides } = piHarnessInternalsForTest;

// ---------------------------------------------------------------------------
// Hand-crafted resource shapes (cast through unknown to match Pi SDK duck types)
// ---------------------------------------------------------------------------

function makeExt(resolvedPath: string, source?: string) {
  return { resolvedPath, sourceInfo: source ? { source } : undefined } as unknown;
}

function makeSkill(filePath: string, source?: string) {
  return { filePath, sourceInfo: source ? { source } : undefined } as unknown;
}

function makePrompt(filePath: string, source?: string) {
  return { filePath, sourceInfo: source ? { source } : undefined } as unknown;
}

function makeTheme(sourceInfoPath: string, source?: string) {
  return { sourceInfo: { path: sourceInfoPath, source } } as unknown;
}

// A mix of one eforge-owned resource and two non-eforge resources per category
const EFORGE_EXT = makeExt('/node_modules/@eforge-build/pi-eforge/extensions/eforge/index.js', '@eforge-build/pi-eforge');
const USER_EXT_A = makeExt('/home/user/.pi/extensions/my-ext', 'my-package');
const USER_EXT_B = makeExt('/project/.pi/extensions/acme', '@acme/pi-ext');

const EFORGE_SKILL = makeSkill('/node_modules/@eforge-build/pi-eforge/skills/eforge-build/SKILL.md', '@eforge-build/pi-eforge');
const USER_SKILL_A = makeSkill('/home/user/.pi/agent/skills/commit/SKILL.md', 'local');
const USER_SKILL_B = makeSkill('/project/.pi/skills/custom/SKILL.md', 'custom-pkg');

const EFORGE_PROMPT = makePrompt('/node_modules/@eforge-build/pi-eforge/prompts/plan.md', '@eforge-build/pi-eforge');
const USER_PROMPT_A = makePrompt('/home/user/.pi/agent/prompts/greeting.md', 'local');
const USER_PROMPT_B = makePrompt('/project/.pi/prompts/review.md', 'custom-pkg');

const EFORGE_THEME = makeTheme('/node_modules/@eforge-build/pi-eforge/themes/dark.json', '@eforge-build/pi-eforge');
const USER_THEME_A = makeTheme('/home/user/.pi/themes/my-theme.json', 'my-theme-pkg');
const USER_THEME_B = makeTheme('/project/.pi/themes/corp.json', 'corp-pkg');

// ---------------------------------------------------------------------------
// isolated mode
// ---------------------------------------------------------------------------

describe('buildResourceLoaderOverrides — isolated mode (default)', () => {
  it('extensions: returns empty array regardless of package origin', () => {
    const result = buildResourceLoaderOverrides('isolated');
    const out = result.extensionsOverride({ extensions: [EFORGE_EXT, USER_EXT_A, USER_EXT_B] });
    expect(out.extensions).toHaveLength(0);
  });

  it('skills: returns empty array regardless of package origin', () => {
    const result = buildResourceLoaderOverrides('isolated');
    const out = result.skillsOverride({ skills: [EFORGE_SKILL, USER_SKILL_A, USER_SKILL_B] });
    expect(out.skills).toHaveLength(0);
  });

  it('prompts: returns empty array regardless of package origin', () => {
    const result = buildResourceLoaderOverrides('isolated');
    const out = result.promptsOverride({ prompts: [EFORGE_PROMPT, USER_PROMPT_A, USER_PROMPT_B] });
    expect(out.prompts).toHaveLength(0);
  });

  it('themes: returns empty array regardless of package origin', () => {
    const result = buildResourceLoaderOverrides('isolated');
    const out = result.themesOverride({ themes: [EFORGE_THEME, USER_THEME_A, USER_THEME_B] });
    expect(out.themes).toHaveLength(0);
  });

  it('eforge-specific counter increments for the eforge entry, not user entries', () => {
    const result = buildResourceLoaderOverrides('isolated');
    result.extensionsOverride({ extensions: [EFORGE_EXT, USER_EXT_A, USER_EXT_B] });
    result.skillsOverride({ skills: [EFORGE_SKILL, USER_SKILL_A] });
    result.promptsOverride({ prompts: [EFORGE_PROMPT] });
    result.themesOverride({ themes: [EFORGE_THEME, USER_THEME_A] });

    const counters = result.getCounters();
    expect(counters.eforgeExtensionsFiltered).toBe(1);
    expect(counters.eforgeSkillsFiltered).toBe(1);
    expect(counters.eforgePromptsFiltered).toBe(1);
    expect(counters.eforgeThemesFiltered).toBe(1);
  });

  it('empty inputs produce empty outputs and zero counters', () => {
    const result = buildResourceLoaderOverrides('isolated');
    expect(result.extensionsOverride({ extensions: [] }).extensions).toHaveLength(0);
    expect(result.skillsOverride({ skills: [] }).skills).toHaveLength(0);
    expect(result.promptsOverride({ prompts: [] }).prompts).toHaveLength(0);
    expect(result.themesOverride({ themes: [] }).themes).toHaveLength(0);

    const counters = result.getCounters();
    expect(counters.eforgeExtensionsFiltered).toBe(0);
    expect(counters.eforgeSkillsFiltered).toBe(0);
    expect(counters.eforgePromptsFiltered).toBe(0);
    expect(counters.eforgeThemesFiltered).toBe(0);
  });

  it('preserves extra base fields on the returned object (spread)', () => {
    const result = buildResourceLoaderOverrides('isolated');
    const base = { extensions: [USER_EXT_A], someExtraField: 'preserved' };
    const out = result.extensionsOverride(base);
    expect(out.someExtraField).toBe('preserved');
    expect(out.extensions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ambient mode (opt-in)
// ---------------------------------------------------------------------------

describe('buildResourceLoaderOverrides — ambient mode (opt-in)', () => {
  it('extensions: preserves non-eforge entries, drops eforge', () => {
    const result = buildResourceLoaderOverrides('ambient');
    const out = result.extensionsOverride({ extensions: [EFORGE_EXT, USER_EXT_A, USER_EXT_B] });
    expect(out.extensions).toHaveLength(2);
    const paths = (out.extensions as Array<{ resolvedPath: string }>).map(e => e.resolvedPath);
    expect(paths).toContain('/home/user/.pi/extensions/my-ext');
    expect(paths).toContain('/project/.pi/extensions/acme');
  });

  it('skills: preserves non-eforge entries, drops eforge', () => {
    const result = buildResourceLoaderOverrides('ambient');
    const out = result.skillsOverride({ skills: [EFORGE_SKILL, USER_SKILL_A, USER_SKILL_B] });
    expect(out.skills).toHaveLength(2);
  });

  it('prompts: preserves non-eforge entries, drops eforge', () => {
    const result = buildResourceLoaderOverrides('ambient');
    const out = result.promptsOverride({ prompts: [EFORGE_PROMPT, USER_PROMPT_A, USER_PROMPT_B] });
    expect(out.prompts).toHaveLength(2);
  });

  it('themes: preserves non-eforge entries, drops eforge', () => {
    const result = buildResourceLoaderOverrides('ambient');
    const out = result.themesOverride({ themes: [EFORGE_THEME, USER_THEME_A, USER_THEME_B] });
    expect(out.themes).toHaveLength(2);
  });

  it('eforge counter increments for eforge entry only', () => {
    const result = buildResourceLoaderOverrides('ambient');
    result.extensionsOverride({ extensions: [EFORGE_EXT, USER_EXT_A, USER_EXT_B] });
    result.skillsOverride({ skills: [EFORGE_SKILL, USER_SKILL_A, USER_SKILL_B] });
    result.promptsOverride({ prompts: [EFORGE_PROMPT, USER_PROMPT_A] });
    result.themesOverride({ themes: [EFORGE_THEME, USER_THEME_B] });

    const counters = result.getCounters();
    expect(counters.eforgeExtensionsFiltered).toBe(1);
    expect(counters.eforgeSkillsFiltered).toBe(1);
    expect(counters.eforgePromptsFiltered).toBe(1);
    expect(counters.eforgeThemesFiltered).toBe(1);
  });

  it('local-path pi-eforge install is also filtered in ambient mode', () => {
    const localExt = makeExt('/Users/me/projects/eforge/packages/pi-eforge/extensions/eforge/index.ts', '/Users/me/projects/eforge/packages/pi-eforge');
    const result = buildResourceLoaderOverrides('ambient');
    const out = result.extensionsOverride({ extensions: [localExt, USER_EXT_A] });
    expect(out.extensions).toHaveLength(1);
    expect((out.extensions as Array<{ resolvedPath: string }>)[0].resolvedPath).toBe('/home/user/.pi/extensions/my-ext');
    expect(result.getCounters().eforgeExtensionsFiltered).toBe(1);
  });

  it('non-eforge resources are returned when there are no eforge entries', () => {
    const result = buildResourceLoaderOverrides('ambient');
    const out = result.extensionsOverride({ extensions: [USER_EXT_A, USER_EXT_B] });
    expect(out.extensions).toHaveLength(2);
    expect(result.getCounters().eforgeExtensionsFiltered).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tool allowlist regression: resource overrides must not affect tool names
// ---------------------------------------------------------------------------

describe('buildResourceLoaderOverrides — tool allowlist not affected', () => {
  it('isolated mode override result does not contain tool names (tools are separate)', () => {
    // The resource loader overrides handle extensions/skills/prompts/themes only.
    // eforge custom tools (submit_plan_set) and bridged MCP tools are passed via
    // createAgentSession's `tools` allowlist and `customTools` array — not through
    // the resource loader. This test asserts that the override result has no
    // `tools` property (regression guard for accidental coupling).
    const result = buildResourceLoaderOverrides('isolated');
    expect('tools' in result).toBe(false);
    expect('customTools' in result).toBe(false);
  });

  it('ambient mode override result does not contain tool names', () => {
    const result = buildResourceLoaderOverrides('ambient');
    expect('tools' in result).toBe(false);
    expect('customTools' in result).toBe(false);
  });
});
