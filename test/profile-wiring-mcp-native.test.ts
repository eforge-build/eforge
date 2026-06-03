/**
 * Wiring tests split by consumer surface and source assertion responsibility.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_ROUTES } from '@eforge-build/client';
import { REPO_ROOT, parseFrontmatter, readRepoFile } from './profile-wiring-helpers';

describe('MCP proxy registrations (packages/eforge/src/cli/mcp-proxy.ts)', () => {
  const source = readRepoFile('packages/eforge/src/cli/mcp-proxy.ts');

  it("registers the 'eforge_profile' tool via createDaemonTool(...)", () => {
    // Tools are now registered via the factory; verify name appears in a createDaemonTool call.
    expect(source).toMatch(/createDaemonTool\(server,\s*cwd,\s*\{[\s\S]*?name:\s*'eforge_profile'/);
  });

  it("registers the 'eforge_models' tool via createDaemonTool(...)", () => {
    expect(source).toMatch(/createDaemonTool\(server,\s*cwd,\s*\{[\s\S]*?name:\s*'eforge_models'/);
  });

  it('declares the full action enum for eforge_profile (list|show|use|create|delete)', () => {
    // Find the eforge_profile registration block and verify each action literal appears.
    const idx = source.indexOf("name: 'eforge_profile',");
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 3000);
    for (const action of ['list', 'show', 'use', 'create', 'delete']) {
      expect(block).toContain(`'${action}'`);
    }
  });

  it('declares the action enum for eforge_models (providers|list)', () => {
    const idx = source.indexOf("name: 'eforge_models',");
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 2000);
    for (const action of ['providers', 'list']) {
      expect(block).toContain(`'${action}'`);
    }
    // And both backend kinds are acceptable inputs.
    expect(block).toContain("'claude-sdk'");
    expect(block).toContain("'pi'");
  });

  it('dispatches eforge_profile actions to the expected daemon endpoints', () => {
    // After the HTTP route rename (plan-05), the source uses the renamed API_ROUTES.*
    // constants (profile* instead of backend*). Verify the constants are referenced.
    expect(source).toContain('API_ROUTES.profileList');
    expect(source).toContain('API_ROUTES.profileShow');
    expect(source).toContain('API_ROUTES.profileUse');
    expect(source).toContain('API_ROUTES.profileCreate');
    expect(source).toContain('API_ROUTES.profileDelete');
    // Verify the routes resolve to the correct paths via the shared constant.
    expect(API_ROUTES.profileList).toBe('/api/profile/list');
    expect(API_ROUTES.profileShow).toBe('/api/profile/show');
    expect(API_ROUTES.profileUse).toBe('/api/profile/use');
    expect(API_ROUTES.profileCreate).toBe('/api/profile/create');
    expect(API_ROUTES.profileDelete).toBe('/api/profile/:name');
  });

  it('dispatches eforge_models actions to the expected daemon endpoints', () => {
    // After the API_ROUTES migration, verify the source uses API_ROUTES constants.
    expect(source).toContain('API_ROUTES.modelProviders');
    expect(source).toContain('API_ROUTES.modelList');
    expect(API_ROUTES.modelProviders).toBe('/api/models/providers');
    expect(API_ROUTES.modelList).toBe('/api/models/list');
  });

  it("adds 'eforge/.active-profile' to the init tool's managed gitignore block", () => {
    // ensureGitignoreEntries(cwd, [..., 'eforge/.active-profile']) inside eforge_init.
    expect(source).toMatch(
      /ensureGitignoreEntries\([^)]*['"]eforge\/\.active-profile['"]/,
    );
  });
});

// ---------------------------------------------------------------------------
// Pi extension source (packages/pi-eforge/extensions/eforge/index.ts)
// ---------------------------------------------------------------------------

describe('Pi extension registrations (packages/pi-eforge/extensions/eforge/index.ts)', () => {
  const source = readRepoFile('packages/pi-eforge/extensions/eforge/index.ts');

  it("registers the 'eforge_profile' tool via pi.registerTool", () => {
    expect(source).toMatch(/name:\s*["']eforge_profile["']/);
  });

  it("registers the 'eforge_models' tool via pi.registerTool", () => {
    expect(source).toMatch(/name:\s*["']eforge_models["']/);
  });

  it('registers the /eforge:profile command natively (not as skill alias)', () => {
    expect(source).toContain('"eforge:profile"');
    expect(source).toMatch(/from\s+['"]\.\/profile-commands['"]/);
  });

  it('registers the /eforge:profile:new command natively (not as skill alias)', () => {
    expect(source).toContain('"eforge:profile:new"');
    expect(source).toMatch(/from\s+['"]\.\/profile-commands['"]/);
  });

  it('dispatches eforge_profile to the daemon via daemonRequest', () => {
    // After the HTTP route rename (plan-05), the source uses the renamed API_ROUTES.*
    // constants (profile* instead of backend*).
    expect(source).toContain('API_ROUTES.profileList');
    expect(source).toContain('API_ROUTES.profileShow');
    expect(source).toContain('API_ROUTES.profileUse');
    expect(source).toContain('API_ROUTES.profileCreate');
    expect(source).toContain('API_ROUTES.profileDelete');
  });

  it('dispatches eforge_models to the daemon via daemonRequest', () => {
    expect(source).toContain('API_ROUTES.modelProviders');
    expect(source).toContain('API_ROUTES.modelList');
  });
});

// ---------------------------------------------------------------------------
// Scope field parity (MCP proxy + Pi extension)
// ---------------------------------------------------------------------------

describe('Pi extension native command modules (plan-02-native-pi-ux)', () => {
  it('profile-commands.ts exists', () => {
    const path = resolve(REPO_ROOT, 'packages/pi-eforge/extensions/eforge/profile-commands.ts');
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).isFile()).toBe(true);
  });

  it('config-command.ts exists', () => {
    const path = resolve(REPO_ROOT, 'packages/pi-eforge/extensions/eforge/config-command.ts');
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).isFile()).toBe(true);
  });

  it('ui-helpers.ts exists', () => {
    const path = resolve(REPO_ROOT, 'packages/pi-eforge/extensions/eforge/ui-helpers.ts');
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).isFile()).toBe(true);
  });

  it('index.ts imports from ./profile-commands and ./config-command', () => {
    const source = readRepoFile('packages/pi-eforge/extensions/eforge/index.ts');
    expect(source).toMatch(/from\s+['"]\.\/profile-commands['"]/);
    expect(source).toMatch(/from\s+['"]\.\/config-command['"]/);
  });

  it('index.ts imports from ./ui-helpers (UIContext type)', () => {
    const source = readRepoFile('packages/pi-eforge/extensions/eforge/index.ts');
    expect(source).toMatch(/from\s+['"]\.\/ui-helpers['"]/);
  });

  it('Pi skill files contain fallback notes for native commands', () => {
    const backendSkill = readRepoFile('packages/pi-eforge/skills/eforge-profile/SKILL.md');
    expect(backendSkill.toLowerCase()).toContain('fallback');
    expect(backendSkill).toContain('/eforge:profile');

    const backendNewSkill = readRepoFile('packages/pi-eforge/skills/eforge-profile-new/SKILL.md');
    expect(backendNewSkill.toLowerCase()).toContain('fallback');
    expect(backendNewSkill).toContain('/eforge:profile:new');

    const configSkill = readRepoFile('packages/pi-eforge/skills/eforge-config/SKILL.md');
    expect(configSkill.toLowerCase()).toContain('fallback');
    expect(configSkill).toContain('/eforge:config');
  });
});

// ---------------------------------------------------------------------------
// Module exports verification (plan-02-native-pi-ux)
// ---------------------------------------------------------------------------

describe('Native command module exports (plan-02-native-pi-ux)', () => {
  it('ui-helpers.ts exports preferred panel helpers', () => {
    const source = readRepoFile('packages/pi-eforge/extensions/eforge/ui-helpers.ts');
    expect(source).toMatch(/export\s+(async\s+)?function\s+showSelectPanel/);
    expect(source).toMatch(/export\s+(async\s+)?function\s+showSearchableSelectPanel/);
    expect(source).toMatch(/export\s+(async\s+)?function\s+showInfoPanel/);
  });

  it('ui-helpers.ts keeps compatibility overlay helper exports', () => {
    const source = readRepoFile('packages/pi-eforge/extensions/eforge/ui-helpers.ts');
    expect(source).toMatch(/export\s+(async\s+)?function\s+showSelectOverlay/);
    expect(source).toMatch(/export\s+(async\s+)?function\s+showSearchableSelectOverlay/);
    expect(source).toMatch(/export\s+(async\s+)?function\s+showInfoOverlay/);
    expect(source).toContain('return showSelectPanel(ctx, title, items);');
    expect(source).toContain('return showSearchableSelectPanel(ctx, title, items);');
    expect(source).toContain('return showInfoPanel(ctx, title, content);');
  });

  it('ui-helpers.ts exports withLoader', () => {
    const source = readRepoFile('packages/pi-eforge/extensions/eforge/ui-helpers.ts');
    expect(source).toMatch(/export\s+(async\s+)?function\s+withLoader/);
  });

  it('ui-helpers.ts exports UIContext type', () => {
    const source = readRepoFile('packages/pi-eforge/extensions/eforge/ui-helpers.ts');
    expect(source).toMatch(/export\s+interface\s+UIContext/);
  });

  it('profile-commands.ts exports handleProfileCommand', () => {
    const source = readRepoFile('packages/pi-eforge/extensions/eforge/profile-commands.ts');
    expect(source).toMatch(/export\s+async\s+function\s+handleProfileCommand/);
  });

  it('profile-commands.ts exports handleProfileNewCommand', () => {
    const source = readRepoFile('packages/pi-eforge/extensions/eforge/profile-commands.ts');
    expect(source).toMatch(/export\s+async\s+function\s+handleProfileNewCommand/);
  });

  it('config-command.ts exports handleConfigCommand', () => {
    const source = readRepoFile('packages/pi-eforge/extensions/eforge/config-command.ts');
    expect(source).toMatch(/export\s+async\s+function\s+handleConfigCommand/);
  });
});

// ---------------------------------------------------------------------------
// Skill-forwarding removal for native commands (plan-02-native-pi-ux)
// ---------------------------------------------------------------------------

describe('Skill-forwarding removed for native commands (plan-02-native-pi-ux)', () => {
  const source = readRepoFile('packages/pi-eforge/extensions/eforge/index.ts');

  it('eforge:profile is NOT in the skillCommands array', () => {
    // The skillCommands array should not contain eforge:profile
    const skillCommandsStart = source.indexOf('const skillCommands');
    expect(skillCommandsStart).toBeGreaterThan(-1);
    const skillCommandsEnd = source.indexOf('];', skillCommandsStart);
    const skillCommandsBlock = source.slice(skillCommandsStart, skillCommandsEnd);
    expect(skillCommandsBlock).not.toContain('"eforge:profile"');
    expect(skillCommandsBlock).not.toContain("'eforge:profile'");
  });

  it('eforge:profile:new is NOT in the skillCommands array', () => {
    const skillCommandsStart = source.indexOf('const skillCommands');
    const skillCommandsEnd = source.indexOf('];', skillCommandsStart);
    const skillCommandsBlock = source.slice(skillCommandsStart, skillCommandsEnd);
    expect(skillCommandsBlock).not.toContain('"eforge:profile:new"');
    expect(skillCommandsBlock).not.toContain("'eforge:profile:new'");
  });

  it('eforge:config is NOT in the skillCommands array', () => {
    const skillCommandsStart = source.indexOf('const skillCommands');
    const skillCommandsEnd = source.indexOf('];', skillCommandsStart);
    const skillCommandsBlock = source.slice(skillCommandsStart, skillCommandsEnd);
    expect(skillCommandsBlock).not.toContain('"eforge:config"');
    expect(skillCommandsBlock).not.toContain("'eforge:config'");
  });

  it('eforge:status is NOT in the skillCommands array', () => {
    const skillCommandsStart = source.indexOf('const skillCommands');
    const skillCommandsEnd = source.indexOf('];', skillCommandsStart);
    const skillCommandsBlock = source.slice(skillCommandsStart, skillCommandsEnd);
    expect(skillCommandsBlock).not.toContain('"eforge:status"');
    expect(skillCommandsBlock).not.toContain("'eforge:status'");
  });

  it('eforge:profile is registered natively via pi.registerCommand', () => {
    // Should appear as a native command registration, not in skillCommands
    expect(source).toMatch(/pi\.registerCommand\(\s*["']eforge:profile["']/);
  });

  it('eforge:profile:new is registered natively via pi.registerCommand', () => {
    expect(source).toMatch(/pi\.registerCommand\(\s*["']eforge:profile:new["']/);
  });

  it('eforge:config is registered natively via pi.registerCommand', () => {
    expect(source).toMatch(/pi\.registerCommand\(\s*["']eforge:config["']/);
  });

  it('eforge:status is registered natively via pi.registerCommand', () => {
    expect(source).toMatch(/pi\.registerCommand\(\s*["']eforge:status["']/);
  });

  it('native eforge:profile handler calls handleProfileCommand (not skill forwarding)', () => {
    // Find the native eforge:profile registration block
    const idx = source.indexOf('pi.registerCommand("eforge:profile"');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 300);
    expect(block).toContain('handleProfileCommand');
    expect(block).not.toContain('sendUserMessage');
  });

  it('native eforge:profile:new handler calls handleProfileNewCommand (not skill forwarding)', () => {
    const idx = source.indexOf('pi.registerCommand("eforge:profile:new"');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 300);
    expect(block).toContain('handleProfileNewCommand');
    expect(block).not.toContain('sendUserMessage');
  });

  it('native eforge:config handler calls handleConfigCommand (not skill forwarding)', () => {
    const idx = source.indexOf('pi.registerCommand("eforge:config"');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 300);
    expect(block).toContain('handleConfigCommand');
    expect(block).not.toContain('sendUserMessage');
  });

  it('native eforge:status handler calls handleStatusCommand (not skill forwarding)', () => {
    const idx = source.indexOf('pi.registerCommand("eforge:status"');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 300);
    expect(block).toContain('handleStatusCommand');
    expect(block).not.toContain('sendUserMessage');
  });

  it('native eforge:restart handler calls handleRestartCommand (not skill forwarding)', () => {
    const idx = source.indexOf('pi.registerCommand("eforge:restart"');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 400);
    expect(block).toContain('handleRestartCommand');
    expect(block).not.toContain('sendUserMessage');
  });

  it('native eforge:build handler calls handleBuildCommand (not skill forwarding)', () => {
    const idx = source.indexOf('pi.registerCommand("eforge:build"');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 400);
    expect(block).toContain('handleBuildCommand');
    expect(block).not.toContain('sendUserMessage');
  });

  it('native eforge:plan handler calls handlePlanCommand (not skill forwarding)', () => {
    const idx = source.indexOf('pi.registerCommand("eforge:plan"');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 400);
    expect(block).toContain('handlePlanCommand');
    expect(block).not.toContain('sendUserMessage');
  });
});

// ---------------------------------------------------------------------------
// Remaining commands still use skill forwarding (plan-02-native-pi-ux)
// ---------------------------------------------------------------------------

describe('Remaining commands still forward to skills (plan-02-native-pi-ux)', () => {
  const source = readRepoFile('packages/pi-eforge/extensions/eforge/index.ts');
  const skillCommandsStart = source.indexOf('const skillCommands');
  const skillCommandsEnd = source.indexOf('];', skillCommandsStart);
  const skillCommandsBlock = source.slice(skillCommandsStart, skillCommandsEnd);

  // eforge:build is now a dedicated native command (plan-01-per-build-profile-override),
  // eforge:status now has a native panel handler, eforge:restart has a
  // native safe-restart selector/panel flow, and eforge:plan has native selectors,
  // so none of those commands is in the skillCommands array.
  for (const cmd of ['eforge:init', 'eforge:update']) {
    it(`${cmd} remains in the skillCommands array`, () => {
      expect(skillCommandsBlock).toContain(`"${cmd}"`);
    });
  }

  it('skillCommands loop uses sendUserMessage for skill forwarding', () => {
    // After the skillCommands array, the for loop should use sendUserMessage
    const loopStart = source.indexOf('for (const cmd of skillCommands)');
    expect(loopStart).toBeGreaterThan(-1);
    const loopBlock = source.slice(loopStart, loopStart + 300);
    expect(loopBlock).toContain('sendUserMessage');
    expect(loopBlock).toContain('/skill:');
  });
});

// ---------------------------------------------------------------------------
// Architecture docs and README updates (plan-02-native-pi-ux)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Metadata field parity (plan-02-consumers-and-docs)
// ---------------------------------------------------------------------------
