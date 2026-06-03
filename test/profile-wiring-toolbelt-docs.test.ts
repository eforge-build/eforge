/**
 * Wiring tests split by consumer surface and source assertion responsibility.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_ROUTES } from '@eforge-build/client';
import { REPO_ROOT, parseFrontmatter, readRepoFile } from './profile-wiring-helpers';

describe('toolbelt-presets.ts source assertions (plan-01-pi-toolbelt-preset-ux)', () => {
  const source = readRepoFile('packages/pi-eforge/extensions/eforge/toolbelt-presets.ts');

  it('exports TOOLBELT_PRESETS', () => {
    expect(source).toMatch(/export\s+const\s+TOOLBELT_PRESETS/);
  });

  it('exports findMissingServers', () => {
    expect(source).toMatch(/export\s+function\s+findMissingServers/);
  });

  it('exports applyToolbeltPresetToTiers', () => {
    expect(source).toMatch(/export\s+function\s+applyToolbeltPresetToTiers/);
  });

  it('exports applyNoMcpAccessToTiers', () => {
    expect(source).toMatch(/export\s+function\s+applyNoMcpAccessToTiers/);
  });

  it('exports getPresetById', () => {
    expect(source).toMatch(/export\s+function\s+getPresetById/);
  });

  it('exports getPresetRegistryData', () => {
    expect(source).toMatch(/export\s+function\s+getPresetRegistryData/);
  });

  it('contains all 8 preset ids', () => {
    for (const id of [
      'browser-ui',
      'docs-research',
      'issue-triage',
      'repo-review',
      'observability',
      'database-readonly',
      'api-testing',
      'design-ui',
    ]) {
      expect(source).toContain(`id: '${id}'`);
    }
  });
});

describe('toolbelt-config-files.ts source assertions (plan-01-pi-toolbelt-preset-ux)', () => {
  const source = readRepoFile('packages/pi-eforge/extensions/eforge/toolbelt-config-files.ts');

  it('exports readMcpServers', () => {
    expect(source).toMatch(/export\s+function\s+readMcpServers/);
  });

  it('exports addPlaywrightServer', () => {
    expect(source).toMatch(/export\s+function\s+addPlaywrightServer/);
  });

  it('exports readEforgeConfig', () => {
    expect(source).toMatch(/export\s+function\s+readEforgeConfig/);
  });

  it('exports upsertToolbeltInConfig', () => {
    expect(source).toMatch(/export\s+function\s+upsertToolbeltInConfig/);
  });

  it('exports captureFileContents', () => {
    expect(source).toMatch(/export\s+function\s+captureFileContents/);
  });

  it('exports restoreFileContents', () => {
    expect(source).toMatch(/export\s+function\s+restoreFileContents/);
  });

  it('uses atomic temp-file replacement in writeFileAtomic', () => {
    expect(source).toContain('renameSync');
    expect(source).toContain('.tmp-');
  });
});

describe('profile-commands.ts imports toolbelt modules (plan-01-pi-toolbelt-preset-ux)', () => {
  const source = readRepoFile('packages/pi-eforge/extensions/eforge/profile-commands.ts');

  it('imports from toolbelt-presets', () => {
    expect(source).toMatch(/from\s+['"]\.\/toolbelt-presets['"]/);
  });

  it('imports from toolbelt-config-files', () => {
    expect(source).toMatch(/from\s+['"]\.\/toolbelt-config-files['"]/);
  });

  it('uses TOOLBELT_PRESETS for preset selection', () => {
    expect(source).toContain('TOOLBELT_PRESETS');
  });

  it('applies preset tier assignments via applyToolbeltPresetToTiers', () => {
    expect(source).toContain('applyToolbeltPresetToTiers');
  });

  it('applies no-access option via applyNoMcpAccessToTiers', () => {
    expect(source).toContain('applyNoMcpAccessToTiers');
  });

  it('offers "No project MCP access" choice', () => {
    expect(source).toContain('No project MCP access');
  });

  it('offers "Skip (configure manually)" choice', () => {
    expect(source).toContain('Skip (configure manually)');
  });

  it('calls upsertToolbeltInConfig after applying a preset', () => {
    expect(source).toContain('upsertToolbeltInConfig');
  });

  it('calls configValidate after preset mutations and before profileCreate', () => {
    const handlerStart = source.indexOf('export async function handleProfileNewCommand');
    expect(handlerStart).toBeGreaterThan(-1);
    const handlerEnd = source.indexOf('\n}\n', source.indexOf('Profile Created', handlerStart));
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handlerBody = source.slice(handlerStart, handlerEnd);

    const applyIdx = handlerBody.indexOf('applyToolbeltPresetToTiers(selectedPreset, tiers)');
    const upsertIdx = handlerBody.indexOf('upsertToolbeltInConfig(ctx.cwd, selectedPreset)');
    const configValidateRequestIdx = handlerBody.indexOf(
      "piDaemonRequest<{ valid: boolean; errors?: string[] }>(ctx.cwd, 'GET', API_ROUTES.configValidate)",
    );
    const profileCreateRequestIdx = handlerBody.indexOf(
      'piDaemonRequest(ctx.cwd, "POST", API_ROUTES.profileCreate',
    );

    expect(applyIdx).toBeGreaterThan(-1);
    expect(upsertIdx).toBeGreaterThan(applyIdx);
    expect(configValidateRequestIdx).toBeGreaterThan(upsertIdx);
    expect(profileCreateRequestIdx).toBeGreaterThan(configValidateRequestIdx);
  });
});

describe('config-command.ts imports getPresetRegistryData (plan-01-pi-toolbelt-preset-ux)', () => {
  const source = readRepoFile('packages/pi-eforge/extensions/eforge/config-command.ts');

  it('imports from toolbelt-presets', () => {
    expect(source).toMatch(/from\s+['"]\.\/toolbelt-presets['"]/);
  });

  it('calls getPresetRegistryData', () => {
    expect(source).toContain('getPresetRegistryData');
  });

  it('renders a Toolbelts section', () => {
    expect(source).toContain('## Toolbelts');
  });

  it('mentions available presets with link to profile:new command', () => {
    expect(source).toContain('/eforge:profile:new');
  });
});

describe('profile-payload.ts exports TierName (plan-01-pi-toolbelt-preset-ux)', () => {
  const source = readRepoFile('packages/pi-eforge/extensions/eforge/profile-payload.ts');

  it('exports TierName type', () => {
    expect(source).toMatch(/export\s+type\s+TierName/);
  });

  it('TierSelection has optional toolbelt field', () => {
    // The TierSelection interface should include toolbelt
    const idx = source.indexOf('export interface TierSelection');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, source.indexOf('\n}', idx) + 2);
    expect(block).toContain('toolbelt?');
  });

  it('TierRecipeEntry has optional toolbelt field', () => {
    const idx = source.indexOf('export interface TierRecipeEntry');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, source.indexOf('\n}', idx) + 2);
    expect(block).toContain('toolbelt?');
  });
});

describe('docs/architecture.md - native command mentions (plan-02-native-pi-ux)', () => {
  const raw = readRepoFile('docs/architecture.md');

  it('Pi Package section mentions "native" in the context of commands', () => {
    // Find the Pi Package section
    const piStart = raw.indexOf('### Pi Package');
    expect(piStart).toBeGreaterThan(-1);
    const nextSection = raw.indexOf('\n## ', piStart);
    const piSection = raw.slice(piStart, nextSection > -1 ? nextSection : undefined);
    expect(piSection.toLowerCase()).toContain('native');
  });

  it('Pi Package section mentions native commands for profile management', () => {
    const piStart = raw.indexOf('### Pi Package');
    const nextSection = raw.indexOf('\n## ', piStart);
    const piSection = raw.slice(piStart, nextSection > -1 ? nextSection : undefined);
    expect(piSection).toContain('/eforge:profile');
    expect(piSection).toContain('/eforge:profile:new');
  });

  it('Pi Package section mentions native commands for config', () => {
    const piStart = raw.indexOf('### Pi Package');
    const nextSection = raw.indexOf('\n## ', piStart);
    const piSection = raw.slice(piStart, nextSection > -1 ? nextSection : undefined);
    expect(piSection).toContain('/eforge:config');
  });

  it('Pi Package section is not described as purely "skill-based"', () => {
    const piStart = raw.indexOf('### Pi Package');
    const nextSection = raw.indexOf('\n## ', piStart);
    const piSection = raw.slice(piStart, nextSection > -1 ? nextSection : undefined);
    // The section should not say ALL commands are skill-based
    expect(piSection).not.toMatch(/Skill-based slash commands.*\/eforge:config/);
    expect(piSection).not.toMatch(/Skill-based slash commands.*\/eforge:profile/);
  });
});

describe('packages/pi-eforge/README.md - native command UX (plan-02-native-pi-ux)', () => {
  const raw = readRepoFile('packages/pi-eforge/README.md');

  it('mentions native commands for agent runtime profile management', () => {
    expect(raw).toContain('/eforge:profile');
    expect(raw).toContain('/eforge:profile:new');
  });

  it('mentions native config, status, and restart commands', () => {
    expect(raw).toContain('/eforge:config');
    expect(raw).toContain('/eforge:status');
    expect(raw).toContain('/eforge:restart');
  });

  it('describes interactive TUI panel and selector UX', () => {
    expect(raw.toLowerCase()).toContain('tui panels and selectors');
    expect(raw.toLowerCase()).not.toContain('overlay ux');
  });

  it('mentions ambient status display', () => {
    expect(raw.toLowerCase()).toContain('ambient status');
  });

  it('distinguishes native commands from skill-based slash commands', () => {
    // Should have separate mentions of native commands vs slash commands
    expect(raw).toMatch(/Native Pi commands/i);
    expect(raw).toMatch(/Slash commands for/i);
  });
});

// ---------------------------------------------------------------------------
// /eforge:init redesign (plan-02-consumers)
// ---------------------------------------------------------------------------
