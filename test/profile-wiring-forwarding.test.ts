/**
 * Wiring tests split by consumer surface and source assertion responsibility.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_ROUTES } from '@eforge-build/client';
import { REPO_ROOT, parseFrontmatter, readRepoFile } from './profile-wiring-helpers';

describe('/eforge:init redesign (plan-02-consumers)', () => {
  const mcpSource = readRepoFile('packages/eforge/src/cli/mcp-proxy.ts');
  const piSource = readRepoFile('packages/pi-eforge/extensions/eforge/index.ts');

  // Locate the eforge_init tool block in the MCP proxy
  function getMcpInitBlock(): string {
    const start = mcpSource.indexOf("name: 'eforge_init',");
    expect(start).toBeGreaterThan(-1);
    const nextTool = mcpSource.indexOf('createDaemonTool(', start + 1);
    return nextTool > start ? mcpSource.slice(start, nextTool) : mcpSource.slice(start);
  }

  // Locate the eforge_init tool block in the Pi extension
  function getPiInitBlock(): string {
    const start = piSource.indexOf('name: "eforge_init"');
    expect(start).toBeGreaterThan(-1);
    // Slice from a bit before the name to include the full registerTool call
    const blockStart = piSource.lastIndexOf('pi.registerTool(', start);
    const nextTool = piSource.indexOf('pi.registerTool(', start + 1);
    return nextTool > blockStart ? piSource.slice(blockStart, nextTool) : piSource.slice(blockStart);
  }

  it('MCP proxy eforge_init no longer calls elicitInput', () => {
    const block = getMcpInitBlock();
    expect(block).not.toContain('elicitInput');
  });

  it('MCP proxy eforge_init declares the profile schema parameter', () => {
    const block = getMcpInitBlock();
    expect(block).toContain('profile:');
    expect(block).toContain('tiers');
    // agentRuntimes, defaultAgentRuntime, models removed in tier-recipe schema
    expect(block).not.toContain('agentRuntimes');
    expect(block).not.toContain('defaultAgentRuntime');
  });

  it('MCP proxy eforge_init does not call modelProviders or modelList from the fresh-init path', () => {
    const block = getMcpInitBlock();
    // These should only appear in the eforge_models tool, not in eforge_init
    // The migrate path doesn't use them either - only eforge_models does
    // Verify the init block doesn't hit these endpoints directly
    const freshInitStart = block.indexOf('Fresh init mode');
    expect(freshInitStart).toBeGreaterThan(-1);
    const freshInitBlock = block.slice(freshInitStart);
    expect(freshInitBlock).not.toContain('API_ROUTES.modelProviders');
    expect(freshInitBlock).not.toContain('API_ROUTES.modelList');
  });

  it('Pi extension eforge_init declares the profile schema parameter', () => {
    const block = getPiInitBlock();
    expect(block).toContain('profile');
    expect(block).toContain('agentRuntimes');
    expect(block).toContain('defaultAgentRuntime');
  });

  it('Pi extension eforge_init does not declare top-level provider or maxModel parameters', () => {
    const block = getPiInitBlock();
    // provider and maxModel should no longer be top-level parameters in the schema
    // They were the old single-model scalars; check the Type.Object schema block
    const schemaStart = block.indexOf('parameters: Type.Object(');
    expect(schemaStart).toBeGreaterThan(-1);
    // Find the matching closing paren for the parameters object
    const schemaBlock = block.slice(schemaStart, schemaStart + 3000);
    // The old top-level 'provider' and 'maxModel' params should be gone
    expect(schemaBlock).not.toMatch(/^\s+provider:/m);
    expect(schemaBlock).not.toMatch(/^\s+maxModel:/m);
  });

  it('plugin /eforge:init skill describes the two-track flow', () => {
    const raw = readRepoFile('eforge-plugin/skills/init/init.md');
    expect(raw).toMatch(/Quick setup/i);
    expect(raw).toMatch(/mix-and-match/i);
    expect(raw).toContain('Step 3a');
    expect(raw).toContain('Step 3b');
    // Plan-02 replaced defaultAgentRuntime with tier-recipe vocabulary
    expect(raw).not.toContain('defaultAgentRuntime');
    expect(raw).toContain('agents.tiers');
  });

  it('plugin /eforge:init skill contains Step 1.5 (existing local- and user-scope profiles)', () => {
    const raw = readRepoFile('eforge-plugin/skills/init/init.md');
    expect(raw).toContain('Step 1.5');
    expect(raw).toContain('existingProfile');
    expect(raw).toContain('"scope": "<local|user>"');
  });

  it('plugin /eforge:init skill tool call passes profile parameter', () => {
    const raw = readRepoFile('eforge-plugin/skills/init/init.md');
    expect(raw).toContain('profile:');
  });

  it('Pi eforge-init skill describes the two-track flow', () => {
    const raw = readRepoFile('packages/pi-eforge/skills/eforge-init/SKILL.md');
    expect(raw).toMatch(/Quick setup/i);
    expect(raw).toMatch(/mix-and-match/i);
    expect(raw).toContain('Step 3a');
    expect(raw).toContain('Step 3b');
    // Plan-02 replaced defaultAgentRuntime with tier-recipe vocabulary
    expect(raw).not.toContain('defaultAgentRuntime');
    expect(raw).toContain('agents.tiers');
  });

  it('Pi eforge-init skill pins harness to pi (no claude-sdk choice)', () => {
    const raw = readRepoFile('packages/pi-eforge/skills/eforge-init/SKILL.md');
    // The Pi skill should not present claude-sdk as a harness choice in the workflow
    // It should state the harness is always pi
    expect(raw).toContain("harness is always `pi`");
  });

  it('Pi eforge-init skill tool call passes profile parameter', () => {
    const raw = readRepoFile('packages/pi-eforge/skills/eforge-init/SKILL.md');
    expect(raw).toContain('profile:');
  });

  it('plugin version bumped to at least 0.16.0', () => {
    // The redesign-eforge-init-around-multi-runtime-profiles PRD required a plugin bump.
    // Floor at 0.16.0; subsequent bumps (mandated by AGENTS.md on every plugin change)
    // must keep moving forward, not stay pinned to a single version.
    const manifest = JSON.parse(readRepoFile('eforge-plugin/.claude-plugin/plugin.json')) as { version: string };
    const [major, minor] = manifest.version.split('.').map(Number);
    const isAtLeast = major > 0 || (major === 0 && minor >= 16);
    expect(isAtLeast).toBe(true);
  });

  it('MCP proxy eforge_init writes config file before calling profileCreate in the fresh-init branch', () => {
    const block = getMcpInitBlock();
    const freshInitStart = block.indexOf('Fresh init mode');
    expect(freshInitStart).toBeGreaterThan(-1);
    const slice = block.slice(freshInitStart);
    const writeFileIdx = slice.indexOf('writeFile(configPath');
    const profileCreateIdx = slice.indexOf('API_ROUTES.profileCreate');
    expect(writeFileIdx).toBeGreaterThan(-1);
    expect(profileCreateIdx).toBeGreaterThan(-1);
    expect(writeFileIdx).toBeLessThan(profileCreateIdx);
  });

  it('Pi extension eforge_init writes config file before calling profileCreate in the fresh-init branch', () => {
    const block = getPiInitBlock();
    const freshInitStart = block.indexOf('Fresh init mode');
    expect(freshInitStart).toBeGreaterThan(-1);
    const slice = block.slice(freshInitStart);
    const writeFileIdx = slice.indexOf('writeFileSync(configPath');
    const profileCreateIdx = slice.indexOf('API_ROUTES.profileCreate');
    expect(writeFileIdx).toBeGreaterThan(-1);
    expect(profileCreateIdx).toBeGreaterThan(-1);
    expect(writeFileIdx).toBeLessThan(profileCreateIdx);
  });

  it('MCP proxy eforge_init writes a sentinel before profileUse in the existing-profile branch', () => {
    const block = getMcpInitBlock();
    const existingProfileStart = block.indexOf('Existing profile mode');
    expect(existingProfileStart).toBeGreaterThan(-1);
    const slice = block.slice(existingProfileStart, block.indexOf('Fresh init mode'));
    const writeFileIdx = slice.indexOf("writeFile(configPath, '', 'utf-8')");
    const profileUseIdx = slice.indexOf('API_ROUTES.profileUse');
    expect(writeFileIdx).toBeGreaterThan(-1);
    expect(profileUseIdx).toBeGreaterThan(-1);
    expect(writeFileIdx).toBeLessThan(profileUseIdx);
    expect(block).toContain("z.enum(['local', 'user'])");
  });

  it('Pi extension eforge_init writes a sentinel before profileUse in the existing-profile branch', () => {
    const block = getPiInitBlock();
    const existingProfileStart = block.indexOf('Existing profile mode');
    expect(existingProfileStart).toBeGreaterThan(-1);
    const slice = block.slice(existingProfileStart, block.indexOf('Fresh init mode'));
    const writeFileIdx = slice.indexOf('writeFileSync(configPath, "", "utf-8")');
    const profileUseIdx = slice.indexOf('API_ROUTES.profileUse');
    expect(writeFileIdx).toBeGreaterThan(-1);
    expect(profileUseIdx).toBeGreaterThan(-1);
    expect(writeFileIdx).toBeLessThan(profileUseIdx);
    expect(block).toContain("StringEnum(['local', 'user'])");
  });
});

// ---------------------------------------------------------------------------
// eforge_build afterQueueId wiring (plan-03-consumer-surfaces-docs)
// ---------------------------------------------------------------------------

describe('eforge_build afterQueueId schema and forwarding parity (plan-03-consumer-surfaces-docs)', () => {
  const mcpSource = readRepoFile('packages/eforge/src/cli/mcp-proxy.ts');
  const piSource = readRepoFile('packages/pi-eforge/extensions/eforge/index.ts');

  function getMcpBuildBlock(): string {
    const start = mcpSource.indexOf("name: 'eforge_build',");
    expect(start).toBeGreaterThan(-1);
    const next = mcpSource.indexOf('createDaemonTool(', start + 1);
    return next > start ? mcpSource.slice(start, next) : mcpSource.slice(start);
  }

  function getPiBuildBlock(): string {
    const start = piSource.indexOf('name: "eforge_build"');
    expect(start).toBeGreaterThan(-1);
    const next = piSource.indexOf('pi.registerTool(', start + 1);
    const blockStart = piSource.lastIndexOf('pi.registerTool(', start);
    return next > blockStart ? piSource.slice(blockStart, next) : piSource.slice(blockStart);
  }

  it('MCP proxy eforge_build schema declares optional afterQueueId field', () => {
    const block = getMcpBuildBlock();
    expect(block).toContain('afterQueueId');
    expect(block).toMatch(/afterQueueId:\s*z[\s\S]*?\.string\(\)[\s\S]*?\.optional\(\)/);
  });

  it('Pi extension eforge_build schema declares optional afterQueueId field', () => {
    const block = getPiBuildBlock();
    expect(block).toContain('afterQueueId');
    expect(block).toMatch(/afterQueueId:\s*Type\.Optional\(Type\.String/);
  });

  it('MCP proxy eforge_build handler forwards afterQueueId to the enqueue body', () => {
    const block = getMcpBuildBlock();
    expect(block).toMatch(/body\.afterQueueId\s*=\s*afterQueueId/);
  });

  it('Pi extension eforge_build handler forwards afterQueueId to the enqueue body', () => {
    const block = getPiBuildBlock();
    expect(block).toMatch(/body\.afterQueueId\s*=\s*params\.afterQueueId/);
  });

  it('MCP proxy eforge_build only sets afterQueueId in body when defined', () => {
    const block = getMcpBuildBlock();
    // Must be guarded by a defined check (not unconditionally assigned)
    expect(block).toMatch(/afterQueueId\s*!==\s*undefined/);
  });

  it('Pi extension eforge_build only sets afterQueueId in body when defined', () => {
    const block = getPiBuildBlock();
    expect(block).toMatch(/params\.afterQueueId\s*!==\s*undefined/);
  });
});
