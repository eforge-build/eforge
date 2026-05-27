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

  it('documents deferred outcome for active-build conflicts', () => {
    expect(raw).toContain('deferred');
  });

  it('documents retryDeferred field for automatic retry', () => {
    expect(raw).toMatch(/retry.?[Dd]eferred|retryDeferred/i);
  });

  it('documents daemon-owned execution from project root', () => {
    expect(raw).toMatch(/daemon.?owned|daemon.*project root|project root.*daemon/i);
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
    expect(raw).toContain('stacking.sync.afterBuild');
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
    expect(raw).toContain('stacking.sync.afterBuild');
  });

  it('maps stacked-pr-autosync to stacking.sync.afterBuild, not build.postMergeCommands', () => {
    // Automatic stack sync is now daemon-owned via stacking.sync.afterBuild;
    // the old guidance that added eforge stack sync to build.postMergeCommands is removed
    expect(raw).toContain('stacking.sync.afterBuild');
    expect(raw).not.toMatch(/stacked-pr-autosync[\s\S]{0,300}build\.postMergeCommands/);
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

  it('documents activeBuildSkips response field', () => {
    expect(raw).toContain('activeBuildSkips');
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

  it('documents deferred outcome for active-build conflicts', () => {
    expect(raw).toContain('deferred');
  });

  it('documents retry behavior for deferred syncs', () => {
    expect(raw).toMatch(/retry.?deferred|retryDeferred|retry.*deferred/i);
  });

  it('documents stacking.sync.afterBuild for daemon-owned after-build sync', () => {
    expect(raw).toContain('stacking.sync.afterBuild');
  });

  it('does not promote build.postMergeCommands as the recommended auto-sync mechanism', () => {
    // The old guidance promoted: "add `eforge stack sync` to `build.postMergeCommands`"
    // The new guidance uses stacking.sync.afterBuild: true for daemon-owned after-build sync
    // Note: the new docs may warn *against* using postMergeCommands — that is fine.
    // Using single-line matching so we only flag the recommendation pattern, not warning prose.
    expect(raw).not.toMatch(/add.*eforge stack sync.*postMergeCommands|To enable.*postMergeCommands.*eforge stack sync/i);
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

  it('documents stacking.sync.afterBuild config field', () => {
    expect(raw).toContain('stacking.sync.afterBuild');
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

  it('both stack skills document deferred outcome', () => {
    expect(pluginStack).toContain('deferred');
    expect(piStack).toContain('deferred');
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

  it('both workflow skills map stacked-pr-autosync to stacking.sync.afterBuild', () => {
    expect(pluginWorkflow).toContain('stacking.sync.afterBuild');
    expect(piWorkflow).toContain('stacking.sync.afterBuild');
  });

  it('Pi workflow skill does not use mcp__eforge__ prefix (Pi convention)', () => {
    expect(piWorkflow).not.toContain('mcp__eforge__');
  });

  it('Pi stack skill does not use mcp__eforge__ prefix (Pi convention)', () => {
    expect(piStack).not.toContain('mcp__eforge__');
  });
});
