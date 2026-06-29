import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('recovery skill decomposition evidence guidance', () => {
  it('keeps Claude Code and Pi recovery skills aligned on read-only decomposition evidence', () => {
    const claude = readFileSync('eforge-plugin/skills/recover/recover.md', 'utf8');
    const pi = readFileSync('packages/pi-eforge/skills/eforge-recover/SKILL.md', 'utf8');

    for (const doc of [claude, pi]) {
      expect(doc).toContain('decompositionEvidence');
      expect(doc).toMatch(/read-only/i);
      expect(doc).toMatch(/does not auto-author/i);
      expect(doc).toMatch(/does not auto-author or auto-enqueue|does not auto-enqueue/i);
      expect(doc).toMatch(/do not author replacement PRD content/i);
    }

    expect(claude).toContain('eforge_apply_recovery');
    expect(claude).toContain('eforge_continue_repair');
    expect(pi).toContain('apply-recovery');
    expect(pi).toContain('continue-repair');
  });

  it('bumps only the Claude Code plugin patch version for skill guidance changes', () => {
    const plugin = JSON.parse(readFileSync('eforge-plugin/.claude-plugin/plugin.json', 'utf8')) as { version: string };
    const piPackage = JSON.parse(readFileSync('packages/pi-eforge/package.json', 'utf8')) as { version: string };
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(plugin.version).not.toBe('0.0.0');
    expect(piPackage.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
