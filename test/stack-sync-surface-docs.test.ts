/**
 * Static surface-docs tests for plan-03-plugin-docs-and-generated-reference.
 *
 * Verifies:
 *   - Plugin version bump
 *   - Claude plugin stack skill mentions eforge_stack_sync
 *   - Claude plugin workflow skill covers all four wizard dimensions
 *   - docs/stacking.md contains required content
 *   - docs/config.md lists all five workflow presets with config keys
 *   - docs/roadmap.md no longer contains the removed roadmap item
 *   - Plugin/Pi skill parity for stack and workflow
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function readRepoFile(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), 'utf-8');
}

// ---------------------------------------------------------------------------
// Plugin version bump
// ---------------------------------------------------------------------------

describe('eforge-plugin/.claude-plugin/plugin.json — version bump', () => {
  const raw = readRepoFile('eforge-plugin/.claude-plugin/plugin.json');
  const parsed = JSON.parse(raw);

  it('version is greater than 0.25.30 (pre-plan baseline)', () => {
    const [major, minor, patch] = (parsed.version as string).split('.').map(Number);
    const pre = [0, 25, 30];
    const gt =
      major > pre[0] ||
      (major === pre[0] && minor > pre[1]) ||
      (major === pre[0] && minor === pre[1] && patch > pre[2]);
    expect(gt).toBe(true);
  });

  it('includes ./skills/stack/stack.md in commands', () => {
    expect(parsed.commands).toContain('./skills/stack/stack.md');
  });

  it('includes ./skills/workflow/workflow.md in commands', () => {
    expect(parsed.commands).toContain('./skills/workflow/workflow.md');
  });
});

// ---------------------------------------------------------------------------
// Claude plugin stack skill — eforge_stack_sync coverage
// ---------------------------------------------------------------------------

describe('eforge-plugin/skills/stack/stack.md — eforge_stack_sync coverage', () => {
  const raw = readRepoFile('eforge-plugin/skills/stack/stack.md');

  it('mentions eforge_stack_sync MCP tool', () => {
    expect(raw).toContain('eforge_stack_sync');
  });

  it('documents dry-run flag', () => {
    expect(raw).toMatch(/dry.?run/i);
  });

  it('documents conflict recovery steps', () => {
    expect(raw).toMatch(/conflict.*recov|recov.*conflict/is);
  });

  it('documents active-build skip behavior', () => {
    expect(raw).toMatch(/active.?build.?skip|activeBuildSkip/i);
  });

  it('documents skipped outcome with stacking disabled', () => {
    expect(raw).toContain('skipped');
  });

  it('documents fast-forward trunk policy', () => {
    expect(raw).toMatch(/fast.?forward/i);
  });
});

// ---------------------------------------------------------------------------
// Claude plugin workflow skill — four wizard dimensions
// ---------------------------------------------------------------------------

describe('eforge-plugin/skills/workflow/workflow.md — four wizard dimensions', () => {
  const raw = readRepoFile('eforge-plugin/skills/workflow/workflow.md');

  it('covers solo vs team dimension', () => {
    expect(raw).toMatch(/solo/i);
    expect(raw).toMatch(/team/i);
  });

  it('covers direct merge vs PR dimension', () => {
    expect(raw).toMatch(/direct merge|merge.*pr|merge.*pull request/i);
    expect(raw).toMatch(/pull request|`pr`/i);
  });

  it('covers stacked PRs dimension', () => {
    expect(raw).toMatch(/stacked? PR|git.?spice/i);
  });

  it('covers automatic stack sync dimension', () => {
    expect(raw).toMatch(/auto.*sync|autoSync/i);
    expect(raw).toContain('eforge stack sync');
  });

  it('documents all five preset names', () => {
    expect(raw).toContain('solo-merge');
    expect(raw).toContain('solo-pr');
    expect(raw).toContain('team-pr');
    expect(raw).toContain('stacked-pr');
    expect(raw).toContain('stacked-pr-autosync');
  });

  it('documents config keys for each preset', () => {
    expect(raw).toContain('landing.action');
    expect(raw).toContain('landing.pr.autoMerge');
    expect(raw).toContain('build.allowLocalMergeToTrunk');
    expect(raw).toContain('stacking.enabled');
    expect(raw).toContain('build.postMergeCommands');
  });

  it('notes Claude Code lacks native select overlays (technical limitation vs Pi)', () => {
    expect(raw).toMatch(/Claude Code.*select overlay|native select overlay|conversational/i);
  });
});

// ---------------------------------------------------------------------------
// docs/stacking.md — required content
// ---------------------------------------------------------------------------

describe('docs/stacking.md — stack sync documentation', () => {
  const raw = readRepoFile('docs/stacking.md');

  it('documents eforge stack sync --dry-run', () => {
    expect(raw).toContain('eforge stack sync --dry-run');
  });

  it('documents stacking.sync.enabled or stacking.enabled opt-in', () => {
    expect(raw).toMatch(/stacking\.(sync\.enabled|enabled)/);
  });

  it('documents active-build skip behavior', () => {
    expect(raw).toMatch(/active.?build|skip.*active|active.*skip/i);
  });

  it('documents pre-landing reconciliation', () => {
    expect(raw).toMatch(/pre.?landing|reconcili/i);
  });

  it('documents conflict recovery', () => {
    expect(raw).toMatch(/conflict.*recov|recov.*conflict/is);
  });

  it('documents fast-forward-only trunk policy', () => {
    expect(raw).toMatch(/fast.?forward/i);
  });
});

// ---------------------------------------------------------------------------
// docs/config.md — five workflow presets
// ---------------------------------------------------------------------------

describe('docs/config.md — workflow presets section', () => {
  const raw = readRepoFile('docs/config.md');

  it('documents all five workflow preset names', () => {
    expect(raw).toContain('solo-merge');
    expect(raw).toContain('solo-pr');
    expect(raw).toContain('team-pr');
    expect(raw).toContain('stacked-pr');
    expect(raw).toContain('stacked-pr-autosync');
  });

  it('documents landing.action config key for presets', () => {
    expect(raw).toContain('landing.action');
  });

  it('documents landing.pr.autoMerge config key for presets', () => {
    expect(raw).toContain('landing.pr.autoMerge');
  });

  it('documents build.allowLocalMergeToTrunk config key for presets', () => {
    expect(raw).toContain('build.allowLocalMergeToTrunk');
  });

  it('documents stacking.enabled config key for presets', () => {
    expect(raw).toContain('stacking.enabled');
  });
});

// ---------------------------------------------------------------------------
// docs/roadmap.md — removed item
// ---------------------------------------------------------------------------

describe('docs/roadmap.md — removed automated restack item', () => {
  const raw = readRepoFile('docs/roadmap.md');

  it('does not contain "Automated post-merge restack/sync"', () => {
    expect(raw).not.toContain('Automated post-merge restack/sync');
  });
});

// ---------------------------------------------------------------------------
// Plugin / Pi skill parity for stack and workflow
// ---------------------------------------------------------------------------

describe('plugin <-> Pi skill parity for stack and workflow', () => {
  const pluginStack = readRepoFile('eforge-plugin/skills/stack/stack.md');
  const piStack = readRepoFile('packages/pi-eforge/skills/eforge-stack/SKILL.md');
  const pluginWorkflow = readRepoFile('eforge-plugin/skills/workflow/workflow.md');
  const piWorkflow = readRepoFile('packages/pi-eforge/skills/eforge-workflow/SKILL.md');

  it('both stack skills mention the eforge_stack_sync tool', () => {
    expect(pluginStack).toContain('eforge_stack_sync');
    expect(piStack).toContain('eforge_stack_sync');
  });

  it('both stack skills document dry-run', () => {
    expect(pluginStack).toMatch(/dry.?run/i);
    expect(piStack).toMatch(/dry.?run/i);
  });

  it('both stack skills document conflict recovery', () => {
    expect(pluginStack).toMatch(/conflict.*recov|recov.*conflict/is);
    expect(piStack).toMatch(/conflict.*recov|recov.*conflict/is);
  });

  it('both workflow skills document all five presets', () => {
    for (const raw of [pluginWorkflow, piWorkflow]) {
      expect(raw).toContain('solo-merge');
      expect(raw).toContain('solo-pr');
      expect(raw).toContain('team-pr');
      expect(raw).toContain('stacked-pr');
      expect(raw).toContain('stacked-pr-autosync');
    }
  });

  it('both workflow skills document the four wizard dimensions', () => {
    for (const raw of [pluginWorkflow, piWorkflow]) {
      expect(raw).toMatch(/solo/i);
      expect(raw).toMatch(/team/i);
      expect(raw).toMatch(/stacked? PR|git.?spice/i);
      expect(raw).toMatch(/auto.*sync|autoSync/i);
    }
  });

  it('Pi workflow skill does not use mcp__eforge__ prefix (Pi convention)', () => {
    expect(piWorkflow).not.toContain('mcp__eforge__');
  });

  it('Pi stack skill does not use mcp__eforge__ prefix (Pi convention)', () => {
    expect(piStack).not.toContain('mcp__eforge__');
  });
});
