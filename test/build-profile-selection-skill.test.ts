import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function readRepoFile(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), 'utf-8');
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

describe('Claude Code /eforge:build profile selection guidance', () => {
  const skill = readRepoFile('eforge-plugin/skills/build/build.md');

  it('asks the user to choose a profile when no --profile override was supplied', () => {
    expect(skill).toContain('### Step 3.5: Select Profile');
    expect(skill).toContain('mcp__eforge__eforge_profile');
    expect(skill).toContain('{ action: "list", scope: "all" }');
    expect(skill).toContain('Use active profile (no override)');
    expect(skill).toContain('Ask the user which profile to use');
  });

  it('keeps explicit --profile overrides and forwards conversational selections to eforge_build', () => {
    expect(skill).toContain('If `$ARGUMENTS` already contains `--profile <name>`');
    expect(skill).toContain('include `profile: "<name>"`');
    expect(skill).toContain('mcp__eforge__eforge_build');
  });

  it('places profile selection before source confirmation and enqueue', () => {
    const profileStep = skill.indexOf('### Step 3.5: Select Profile');
    const confirmStep = skill.indexOf('### Step 4: Confirm Source Preview');
    const enqueueStep = skill.indexOf('### Step 5: Enqueue & Report');

    expect(profileStep).toBeGreaterThan(-1);
    expect(confirmStep).toBeGreaterThan(profileStep);
    expect(enqueueStep).toBeGreaterThan(confirmStep);
  });

  it('bumps the Claude Code plugin manifest version for the user-facing skill change', () => {
    const manifest = JSON.parse(readRepoFile('eforge-plugin/.claude-plugin/plugin.json')) as { version: string };
    expect(compareSemver(manifest.version, '0.25.31')).toBeGreaterThan(0);
  });
});
