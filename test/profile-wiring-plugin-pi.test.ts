/**
 * Wiring tests split by consumer surface and source assertion responsibility.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_ROUTES } from '@eforge-build/client';
import { REPO_ROOT, parseFrontmatter, readRepoFile } from './profile-wiring-helpers';

describe('eforge-plugin/.claude-plugin/plugin.json', () => {
  const manifest = JSON.parse(readRepoFile('eforge-plugin/.claude-plugin/plugin.json')) as {
    name: string;
    version: string;
    commands: string[];
  };

  it('registers the /eforge:profile skill in commands', () => {
    expect(manifest.commands).toContain('./skills/profile/profile.md');
  });

  it('registers the /eforge:profile:new skill in commands', () => {
    expect(manifest.commands).toContain('./skills/profile-new/profile-new.md');
  });

  it('preserves the pre-existing skill entries', () => {
    // plan-02 says existing entries are left intact; we guard the core ones.
    for (const preexisting of [
      './skills/build/build.md',
      './skills/status/status.md',
      './skills/config/config.md',
      './skills/update/update.md',
      './skills/restart/restart.md',
      './skills/init/init.md',
    ]) {
      expect(manifest.commands).toContain(preexisting);
    }
  });

  it('only references skill files that actually exist on disk', () => {
    for (const cmd of manifest.commands) {
      const abs = resolve(REPO_ROOT, 'eforge-plugin', cmd);
      expect(existsSync(abs), `${cmd} must exist on disk`).toBe(true);
      expect(statSync(abs).isFile()).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Repo-root .gitignore (scratch marker should never leak)
// ---------------------------------------------------------------------------

describe('repo-root .gitignore', () => {
  it('contains an `eforge/.active-profile` entry', () => {
    const contents = readRepoFile('.gitignore');
    const lines = contents.split('\n').map((l) => l.trim());
    expect(lines).toContain('eforge/.active-profile');
  });
});

// ---------------------------------------------------------------------------
// Claude Code plugin skills (eforge-plugin/skills/profile, profile-new)
// ---------------------------------------------------------------------------

describe('eforge-plugin/skills/profile/profile.md', () => {
  const path = 'eforge-plugin/skills/profile/profile.md';
  const raw = readRepoFile(path);
  const fm = parseFrontmatter(raw);

  it('has the expected description frontmatter', () => {
    expect(fm.description).toBe('List, inspect, and switch agent runtime profiles');
  });

  it('has the expected argument-hint frontmatter', () => {
    expect(fm['argument-hint']).toBe('[name]');
  });

  it('references the MCP-namespaced eforge_profile tool', () => {
    expect(raw).toContain('mcp__eforge__eforge_profile');
  });

  it('documents both inspect (show) and switch (use) flows', () => {
    expect(raw).toMatch(/action:\s*["']show["']/);
    expect(raw).toMatch(/action:\s*["']use["']/);
  });

  it('includes a Related Skills table that mentions /eforge:profile-new', () => {
    expect(raw).toMatch(/##\s+Related Skills/);
    expect(raw).toContain('/eforge:profile-new');
  });
});

describe('eforge-plugin/skills/profile-new/profile-new.md', () => {
  const path = 'eforge-plugin/skills/profile-new/profile-new.md';
  const raw = readRepoFile(path);
  const fm = parseFrontmatter(raw);

  it('has the expected description frontmatter', () => {
    expect(fm.description).toBe('Create a new agent runtime profile in eforge/profiles/');
  });

  it('has the expected argument-hint frontmatter', () => {
    expect(fm['argument-hint']).toBe('[name]');
  });

  it('chains eforge_models (providers + list) -> eforge_profile create', () => {
    // Must reference both tools with MCP namespacing.
    expect(raw).toContain('mcp__eforge__eforge_models');
    expect(raw).toContain('mcp__eforge__eforge_profile');
    // Must mention both model actions and the create action.
    expect(raw).toMatch(/action:\s*["']providers["']/);
    expect(raw).toMatch(/action:\s*["']list["']/);
    expect(raw).toMatch(/action:\s*["']create["']/);
  });

  it('covers the activation step (eforge_profile action=use)', () => {
    expect(raw).toMatch(/action:\s*["']use["']/);
  });
});

// ---------------------------------------------------------------------------
// Pi extension skills (packages/pi-eforge/skills/eforge-profile, eforge-profile-new)
// ---------------------------------------------------------------------------

describe('packages/pi-eforge/skills/eforge-profile/SKILL.md', () => {
  const raw = readRepoFile('packages/pi-eforge/skills/eforge-profile/SKILL.md');
  const fm = parseFrontmatter(raw);

  it('has name: eforge-profile', () => {
    expect(fm.name).toBe('eforge-profile');
  });

  it('has disable-model-invocation: true (Pi convention)', () => {
    expect(fm['disable-model-invocation']).toBe(true);
  });

  it('uses bare tool names (no mcp__eforge__ prefix)', () => {
    expect(raw).not.toContain('mcp__eforge__');
    expect(raw).toMatch(/`eforge_profile`/);
  });
});

describe('packages/pi-eforge/skills/eforge-profile-new/SKILL.md', () => {
  const raw = readRepoFile('packages/pi-eforge/skills/eforge-profile-new/SKILL.md');
  const fm = parseFrontmatter(raw);

  it('has name: eforge-profile-new', () => {
    expect(fm.name).toBe('eforge-profile-new');
  });

  it('has disable-model-invocation: true (Pi convention)', () => {
    expect(fm['disable-model-invocation']).toBe(true);
  });

  it('uses bare tool names (no mcp__eforge__ prefix)', () => {
    expect(raw).not.toContain('mcp__eforge__');
    expect(raw).toMatch(/`eforge_profile`/);
    expect(raw).toMatch(/`eforge_models`/);
  });
});

// ---------------------------------------------------------------------------
// Init-skill updates in both integrations
// ---------------------------------------------------------------------------

describe('init skill updates (plugin + Pi parity)', () => {
  it('plugin /eforge:init mentions `eforge/.active-profile` and suggests /eforge:profile-new', () => {
    const raw = readRepoFile('eforge-plugin/skills/init/init.md');
    expect(raw).toContain('eforge/.active-profile');
    expect(raw).toContain('/eforge:profile-new');
  });

  it('Pi eforge-init skill mentions `eforge/.active-profile` and suggests /eforge:profile-new', () => {
    const raw = readRepoFile('packages/pi-eforge/skills/eforge-init/SKILL.md');
    expect(raw).toContain('eforge/.active-profile');
    expect(raw).toContain('/eforge:profile-new');
  });
});

// ---------------------------------------------------------------------------
// MCP proxy source (packages/eforge/src/cli/mcp-proxy.ts)
// ---------------------------------------------------------------------------

describe('eforge_profile scope field parity', () => {
  const mcpSource = readRepoFile('packages/eforge/src/cli/mcp-proxy.ts');
  const piSource = readRepoFile('packages/pi-eforge/extensions/eforge/index.ts');

  it('MCP proxy eforge_profile schema includes a scope field accepting local, project, user, all', () => {
    // Find the eforge_profile registration block (now registered via createDaemonTool)
    const idx = mcpSource.indexOf("name: 'eforge_profile',");
    expect(idx).toBeGreaterThan(-1);
    const block = mcpSource.slice(idx, idx + 3000);
    // Verify scope enum includes all four values
    expect(block).toMatch(/scope:\s*z\.enum\(\[.*'local'.*'project'.*'user'.*'all'.*\]\)/s);
  });

  it('Pi extension eforge_profile schema includes a scope field accepting local, project, user, all', () => {
    // Find the eforge_profile registration block
    const idx = piSource.indexOf('name: "eforge_profile"');
    expect(idx).toBeGreaterThan(-1);
    const block = piSource.slice(idx - 200, idx + 3000);
    // Verify scope with Type.Union containing all four literals
    expect(block).toContain('Type.Literal("local")');
    expect(block).toContain('Type.Literal("project")');
    expect(block).toContain('Type.Literal("user")');
    expect(block).toContain('Type.Literal("all")');
  });

  it('MCP proxy threads scope as query param for list action', () => {
    // The list action should pass scope via URLSearchParams
    expect(mcpSource).toMatch(/params\.set\(['"]scope['"],\s*scope\)/);
  });

  it('MCP proxy threads scope in request body for use, create, delete actions', () => {
    // Extract the full eforge_profile tool block (now registered via createDaemonTool)
    const idx = mcpSource.indexOf("name: 'eforge_profile',");
    expect(idx).toBeGreaterThan(-1);
    const nextTool = mcpSource.indexOf("name: 'eforge_models',", idx + 1);
    const block = nextTool > idx ? mcpSource.slice(idx, nextTool) : mcpSource.slice(idx);
    // use action: useBody.scope = scope
    expect(block).toMatch(/useBody\.scope\s*=\s*scope/);
    // create and delete actions: body.scope = scope
    const scopeAssignments = block.match(/body\.scope\s*=\s*scope/g);
    expect(scopeAssignments).not.toBeNull();
    expect(scopeAssignments!.length).toBeGreaterThanOrEqual(2);
  });

  it('Pi extension threads scope as query param for list action', () => {
    // The list action should pass scope via URLSearchParams
    expect(piSource).toMatch(/params\.set\(["']scope["'],\s*scope\)/);
  });

  it('Pi extension threads scope in request body for use, create, delete actions', () => {
    // Extract the full eforge_profile tool block (from tool name to the next pi.registerTool call)
    const idx = piSource.indexOf('name: "eforge_profile"');
    expect(idx).toBeGreaterThan(-1);
    const nextTool = piSource.indexOf('pi.registerTool(', idx + 1);
    const block = nextTool > idx ? piSource.slice(idx - 200, nextTool) : piSource.slice(idx - 200);
    // use action: useBody.scope = scope
    expect(block).toMatch(/useBody\.scope\s*=\s*scope/);
    // create and delete actions: body.scope = scope
    const scopeAssignments = block.match(/body\.scope\s*=\s*scope/g);
    expect(scopeAssignments).not.toBeNull();
    expect(scopeAssignments!.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Pi extension native command modules (plan-02-native-pi-ux)
// ---------------------------------------------------------------------------

describe('eforge_profile metadata field parity', () => {
  const mcpSource = readRepoFile('packages/eforge/src/cli/mcp-proxy.ts');
  const piSource = readRepoFile('packages/pi-eforge/extensions/eforge/index.ts');

  it('MCP proxy eforge_profile schema declares optional metadata zod object with description, whenToUse, tags', () => {
    const idx = mcpSource.indexOf("name: 'eforge_profile',");
    expect(idx).toBeGreaterThan(-1);
    const block = mcpSource.slice(idx, idx + 4000);
    expect(block).toMatch(/metadata:\s*z\.object\(\{/);
    expect(block).toContain('description: z.string().optional()');
    expect(block).toContain('whenToUse: z.array(z.string()).optional()');
    expect(block).toContain('tags: z.array(z.string()).optional()');
    expect(block).toMatch(/\}\)\.optional\(\)/);
  });

  it('Pi extension eforge_profile schema declares optional metadata Type.Object with description, whenToUse, tags', () => {
    const idx = piSource.indexOf('name: "eforge_profile"');
    expect(idx).toBeGreaterThan(-1);
    const block = piSource.slice(idx - 200, idx + 4000);
    expect(block).toContain('metadata:');
    expect(block).toMatch(/Type\.Optional\s*\(\s*Type\.Object\s*\(\s*\{/s);
    expect(block).toMatch(/metadata:[\s\S]*?description:\s*Type\.Optional\(Type\.String/);
    expect(block).toMatch(/metadata:[\s\S]*?whenToUse:\s*Type\.Optional\(Type\.Array\(Type\.String/);
    expect(block).toMatch(/metadata:[\s\S]*?tags:\s*Type\.Optional\(Type\.Array\(Type\.String/);
  });

  it('MCP proxy forwards metadata to the daemon create body', () => {
    const idx = mcpSource.indexOf("name: 'eforge_profile',");
    expect(idx).toBeGreaterThan(-1);
    const nextTool = mcpSource.indexOf("name: 'eforge_models',", idx + 1);
    const block = nextTool > idx ? mcpSource.slice(idx, nextTool) : mcpSource.slice(idx);
    expect(block).toMatch(/body\.metadata\s*=\s*metadata/);
  });

  it('Pi extension forwards metadata to the daemon create body', () => {
    const idx = piSource.indexOf('name: "eforge_profile"');
    expect(idx).toBeGreaterThan(-1);
    const nextTool = piSource.indexOf('pi.registerTool(', idx + 1);
    const block = nextTool > idx ? piSource.slice(idx - 200, nextTool) : piSource.slice(idx - 200);
    expect(block).toMatch(/body\.metadata\s*=\s*metadata/);
  });

  it('Claude profile skill doc references description, whenToUse (or use when), and tags', () => {
    const raw = readRepoFile('eforge-plugin/skills/profile/profile.md');
    expect(raw.toLowerCase()).toContain('description');
    expect(raw).toMatch(/whenToUse|use when/i);
    expect(raw.toLowerCase()).toContain('tags');
  });

  it('Claude profile-new skill doc includes metadata in the create payload example', () => {
    const raw = readRepoFile('eforge-plugin/skills/profile-new/profile-new.md');
    expect(raw).toContain('metadata');
    expect(raw.toLowerCase()).toContain('description');
    expect(raw).toMatch(/whenToUse|use when/i);
    expect(raw.toLowerCase()).toContain('tags');
  });

  it('Pi eforge-profile skill doc references description, whenToUse (or use when), and tags', () => {
    const raw = readRepoFile('packages/pi-eforge/skills/eforge-profile/SKILL.md');
    expect(raw.toLowerCase()).toContain('description');
    expect(raw).toMatch(/whenToUse|use when/i);
    expect(raw.toLowerCase()).toContain('tags');
  });

  it('Pi eforge-profile-new skill doc includes metadata in the create payload example', () => {
    const raw = readRepoFile('packages/pi-eforge/skills/eforge-profile-new/SKILL.md');
    expect(raw).toContain('metadata');
    expect(raw.toLowerCase()).toContain('description');
    expect(raw).toMatch(/whenToUse|use when/i);
    expect(raw.toLowerCase()).toContain('tags');
  });

  it('plugin manifest version is greater than 0.23.5', () => {
    const manifest = JSON.parse(readRepoFile('eforge-plugin/.claude-plugin/plugin.json')) as { version: string };
    const [major, minor, patch] = manifest.version.split('.').map(Number);
    const isGreater = major > 0 || minor > 23 || (minor === 23 && patch > 5);
    expect(isGreater).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Toolbelt preset UX wiring (plan-01-pi-toolbelt-preset-ux)
// ---------------------------------------------------------------------------
