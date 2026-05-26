/**
 * Unit tests for sharded builder functionality:
 * - formatShardScopeNotice: prompt rendering for shard scope
 * - enforceShardScope: staged-file scope validation
 * - buildShardedBuilderContinuationInput: stash-based retry checkpointing
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { formatShardScopeNotice } from '@eforge-build/engine/agents/builder';
import { enforceShardScope } from '@eforge-build/engine/pipeline/stages/build-stages';
import {
  withRetry,
  buildShardedBuilderContinuationInput,
  buildShardPolicy,
  type BuilderShardContinuationInput,
  type RetryAttemptInfo,
} from '@eforge-build/engine/retry';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { ShardScope } from '@eforge-build/engine/schemas';

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// formatShardScopeNotice
// ---------------------------------------------------------------------------

describe('formatShardScopeNotice', () => {
  it('renders roots-only scope', () => {
    const shard: ShardScope = { id: 'shard-src', roots: ['packages/engine/src'] };
    const notice = formatShardScopeNotice(shard);

    expect(notice).toContain('shard-src');
    expect(notice).toContain('packages/engine/src');
    expect(notice).toContain('Directory roots');
    expect(notice).not.toContain('Explicit files');
  });

  it('renders files-only scope', () => {
    const shard: ShardScope = { id: 'shard-config', files: ['eforge/config.yaml', 'packages/engine/src/config.ts'] };
    const notice = formatShardScopeNotice(shard);

    expect(notice).toContain('shard-config');
    expect(notice).toContain('eforge/config.yaml');
    expect(notice).toContain('packages/engine/src/config.ts');
    expect(notice).toContain('Explicit files');
    expect(notice).not.toContain('Directory roots');
  });

  it('renders roots+files scope', () => {
    const shard: ShardScope = {
      id: 'shard-mixed',
      roots: ['packages/engine/src/agents'],
      files: ['test/sharded-builder.test.ts'],
    };
    const notice = formatShardScopeNotice(shard);

    expect(notice).toContain('shard-mixed');
    expect(notice).toContain('packages/engine/src/agents');
    expect(notice).toContain('test/sharded-builder.test.ts');
    expect(notice).toContain('Directory roots');
    expect(notice).toContain('Explicit files');
  });

  it('includes lane-discipline instructions', () => {
    const shard: ShardScope = { id: 'shard-a', roots: ['src/'] };
    const notice = formatShardScopeNotice(shard);

    expect(notice).toContain('git add <file>');
    expect(notice).toContain('Do not commit');
    expect(notice).toContain('Do not run verification');
    expect(notice).toContain('Do not touch files outside your scope');
  });

  it('does not reference harness-specific tool names', () => {
    const shard: ShardScope = { id: 'shard-a', roots: ['src/'] };
    const notice = formatShardScopeNotice(shard);

    // Must not mention harness-specific tool names
    expect(notice).not.toContain('Task');
    expect(notice).not.toContain('Bash');
    expect(notice).not.toContain('Write');
    expect(notice).not.toContain('Read');
    expect(notice).not.toContain('Edit');
  });
});

// ---------------------------------------------------------------------------
// enforceShardScope
// ---------------------------------------------------------------------------

describe('enforceShardScope', () => {
  it('returns ok:true when all files are claimed by exactly one shard', () => {
    const shards: ShardScope[] = [
      { id: 'shard-a', roots: ['packages/engine/src'] },
      { id: 'shard-b', roots: ['test/'] },
    ];
    const result = enforceShardScope(
      ['packages/engine/src/config.ts', 'packages/engine/src/retry.ts', 'test/foo.test.ts'],
      shards,
    );
    expect(result.ok).toBe(true);
  });

  it('returns ok:true for empty staged files', () => {
    const shards: ShardScope[] = [{ id: 'shard-a', roots: ['src/'] }];
    const result = enforceShardScope([], shards);
    expect(result.ok).toBe(true);
  });

  it('returns unclaimed when a file is not matched by any shard', () => {
    const shards: ShardScope[] = [{ id: 'shard-a', roots: ['packages/'] }];
    const result = enforceShardScope(['packages/engine/src/foo.ts', 'README.md'], shards);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unclaimed');
      expect(result.files).toContain('README.md');
      expect(result.files).not.toContain('packages/engine/src/foo.ts');
    }
  });

  it('returns overlap when a file is matched by multiple shards', () => {
    const shards: ShardScope[] = [
      { id: 'shard-a', roots: ['packages/'] },
      { id: 'shard-b', roots: ['packages/engine/'] },
    ];
    const result = enforceShardScope(['packages/engine/src/config.ts'], shards);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('overlap');
      expect(result.files).toContain('packages/engine/src/config.ts');
      expect(result.shardIds?.[0]).toContain('shard-a');
      expect(result.shardIds?.[0]).toContain('shard-b');
    }
  });

  it('matches explicit files', () => {
    const shards: ShardScope[] = [
      { id: 'shard-a', files: ['eforge/config.yaml'] },
      { id: 'shard-b', roots: ['packages/'] },
    ];
    const result = enforceShardScope(['eforge/config.yaml', 'packages/engine/src/foo.ts'], shards);
    expect(result.ok).toBe(true);
  });

  it('matches root with trailing slash', () => {
    const shards: ShardScope[] = [{ id: 'shard-a', roots: ['src/'] }];
    const result = enforceShardScope(['src/foo.ts', 'src/bar/baz.ts'], shards);
    expect(result.ok).toBe(true);
  });

  it('does not match sibling directories with same prefix', () => {
    const shards: ShardScope[] = [{ id: 'shard-a', roots: ['packages/engine'] }];
    // packages/engine-other should NOT be claimed by the shard
    const result = enforceShardScope(['packages/engine-other/foo.ts'], shards);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unclaimed');
      expect(result.files).toContain('packages/engine-other/foo.ts');
    }
  });

  it('root exact match is claimed', () => {
    const shards: ShardScope[] = [{ id: 'shard-a', roots: ['some-file.ts'] }];
    const result = enforceShardScope(['some-file.ts'], shards);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildShardedBuilderContinuationInput
// ---------------------------------------------------------------------------

describe('buildShardedBuilderContinuationInput', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'eforge-shard-test-'));
    // Initialize a real git repo
    await exec('git', ['init'], { cwd: tmpDir });
    await exec('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir });
    await exec('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
    // Create initial commit so HEAD is valid
    await writeFile(join(tmpDir, 'README.md'), '# Test repo\n');
    await exec('git', ['add', 'README.md'], { cwd: tmpDir });
    await exec('git', ['commit', '-m', 'initial commit'], { cwd: tmpDir });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeInfo(
    attempt: number,
    shardScope: ShardScope,
    overrides?: Partial<BuilderShardContinuationInput>,
    events: EforgeEvent[] = [],
  ): RetryAttemptInfo<BuilderShardContinuationInput> {
    const input: BuilderShardContinuationInput = {
      worktreePath: tmpDir,
      baseBranch: 'main',
      planId: 'plan-01-test',
      shardId: shardScope.id,
      shardScope,
      builderOptions: {},
      ...overrides,
    };
    return {
      attempt,
      maxAttempts: 4,
      subtype: 'error_max_turns',
      events,
      prevInput: input,
      error: undefined,
    };
  }

  it('creates a stash with the expected message format', async () => {
    const shard: ShardScope = { id: 'shard-src', roots: ['src/'] };

    // Create a working-tree change in the shard's scope
    await exec('git', ['checkout', '-b', 'feature'], { cwd: tmpDir });
    await writeFile(join(tmpDir, 'src', 'foo.ts'), 'export const foo = 1;\n').catch(async () => {
      // Create directory first
      await exec('git', ['checkout', '-b', 'feature2'], { cwd: tmpDir }).catch(() => {});
    });

    // Use mkdir to create src/ directory
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'foo.ts'), 'export const foo = 1;\n');

    const info = makeInfo(1, shard);
    const result = await buildShardedBuilderContinuationInput(info);

    expect(result.kind).toBe('retry');
    if (result.kind === 'retry') {
      expect(result.input.builderOptions.continuationContext).toBeDefined();
      expect(result.input.builderOptions.continuationContext?.attempt).toBe(1);
    }

    // Verify stash was created with the correct message
    const { stdout: stashList } = await exec('git', ['stash', 'list'], { cwd: tmpDir });
    expect(stashList).toContain('eforge-shard-shard-src-attempt-1');
  });

  it('captures the stash diff in continuationContext', async () => {
    const shard: ShardScope = { id: 'shard-test', roots: ['test/'] };

    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(tmpDir, 'test'), { recursive: true });
    await writeFile(join(tmpDir, 'test', 'my.test.ts'), 'describe("foo", () => {});\n');

    const info = makeInfo(2, shard);
    const result = await buildShardedBuilderContinuationInput(info);

    expect(result.kind).toBe('retry');
    if (result.kind === 'retry') {
      const ctx = result.input.builderOptions.continuationContext;
      expect(ctx).toBeDefined();
      expect(ctx?.handoffMode).toBe('checkpointed-diff');
      if (ctx?.handoffMode === 'checkpointed-diff') {
        expect(ctx.completedDiff).not.toBe('[Unable to generate stash diff]');
        expect(ctx.completedDiff).toContain('test/my.test.ts');
        expect(ctx.completedDiff).toContain('describe("foo", () => {});');
      }
    }
  });

  it('handles staged-only changes: checkpointed-diff without creating a stash', async () => {
    const shard: ShardScope = { id: 'shard-staged-only', roots: ['src/'] };

    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await writeFile(join(tmpDir, 'src', 'staged-only.ts'), 'export const staged = 42;\n');
    // Stage the file but leave no unstaged changes
    await exec('git', ['add', 'src/staged-only.ts'], { cwd: tmpDir });

    const info = makeInfo(1, shard);
    const result = await buildShardedBuilderContinuationInput(info);

    expect(result.kind).toBe('retry');
    if (result.kind === 'retry') {
      const ctx = result.input.builderOptions.continuationContext;
      expect(ctx).toBeDefined();
      expect(ctx?.handoffMode).toBe('checkpointed-diff');
      if (ctx?.handoffMode === 'checkpointed-diff') {
        expect(ctx.completedDiff).toContain('src/staged-only.ts');
        expect(ctx.completedDiff).toContain('staged = 42');
      }
    }

    // No stash should have been created (staged-only path skips stash)
    const { stdout: stashList } = await exec('git', ['stash', 'list'], { cwd: tmpDir });
    expect(stashList).not.toContain('eforge-shard-shard-staged-only-attempt-1');

    // File should still be staged
    const { stdout: staged } = await exec('git', ['diff', '--cached', '--name-only'], { cwd: tmpDir });
    expect(staged).toContain('src/staged-only.ts');
  });

  it('returns discovery-only retry when the shard scope has no working-tree changes', async () => {
    const shard: ShardScope = { id: 'shard-empty', roots: ['nonexistent-dir/'] };

    // Supply builder discovery events that should appear in the handoff
    const events: EforgeEvent[] = [
      {
        timestamp: new Date().toISOString(), type: 'agent:tool_use', agentId: 'b1', agent: 'builder',
        tool: 'Read', toolUseId: 'tu-1', input: { file_path: 'src/engine.ts' },
      },
      {
        timestamp: new Date().toISOString(), type: 'agent:tool_result', agentId: 'b1', agent: 'builder',
        tool: 'Read', toolUseId: 'tu-1', output: 'export const ENGINE = 1;',
      },
    ];

    // No files created in the scope
    const info = makeInfo(1, shard, {}, events);
    const result = await buildShardedBuilderContinuationInput(info);

    expect(result.kind).toBe('retry');
    if (result.kind === 'retry') {
      const ctx = result.input.builderOptions.continuationContext;
      expect(ctx?.handoffMode).toBe('discovery-only');
      if (ctx?.handoffMode === 'discovery-only') {
        expect(ctx.filesInspected).toContain('src/engine.ts');
        expect(ctx.toolResultSnippets.some((s) => s.includes('ENGINE'))).toBe(true);
      }
    }
  });

  it('keeps staged changes staged after stashing (--keep-index)', async () => {
    const shard: ShardScope = { id: 'shard-staged', roots: ['lib/'] };

    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(tmpDir, 'lib'), { recursive: true });

    // Stage one file
    await writeFile(join(tmpDir, 'lib', 'staged.ts'), 'export const staged = true;\n');
    await exec('git', ['add', 'lib/staged.ts'], { cwd: tmpDir });

    // Leave another file unstaged
    await writeFile(join(tmpDir, 'lib', 'unstaged.ts'), 'export const unstaged = true;\n');

    const info = makeInfo(1, shard);
    await buildShardedBuilderContinuationInput(info);

    // After stash --keep-index, staged.ts should still be staged
    const { stdout: staged } = await exec('git', ['diff', '--cached', '--name-only'], { cwd: tmpDir });
    expect(staged).toContain('lib/staged.ts');

    // unstaged.ts should be in the stash
    const { stdout: stashShow } = await exec('git', ['stash', 'show', '--name-only', 'stash@{0}'], { cwd: tmpDir });
    expect(stashShow).toContain('lib/unstaged.ts');
  });

  it('uses attempt number in stash message', async () => {
    const shard: ShardScope = { id: 'shard-retry', files: ['some-file.ts'] };

    await writeFile(join(tmpDir, 'some-file.ts'), 'const x = 1;\n');

    const info = makeInfo(3, shard);
    await buildShardedBuilderContinuationInput(info);

    const { stdout: stashList } = await exec('git', ['stash', 'list'], { cwd: tmpDir });
    expect(stashList).toContain('eforge-shard-shard-retry-attempt-3');
  });

  it('withRetry + shard policy: no-diff shard emits agent:retry and plan:build:implement:continuation', async () => {
    const shard: ShardScope = { id: 'shard-nodiff', roots: ['lib/'] };
    const policy = buildShardPolicy(shard.id, 2);

    // Shard tool events that should surface in discovery context
    const toolEvents: EforgeEvent[] = [
      {
        timestamp: new Date().toISOString(), type: 'agent:tool_use', agentId: 'b1', agent: 'builder',
        tool: 'Read', toolUseId: 'tu-shard-1', input: { file_path: 'lib/api.ts' },
      },
      {
        timestamp: new Date().toISOString(), type: 'agent:tool_result', agentId: 'b1', agent: 'builder',
        tool: 'Read', toolUseId: 'tu-shard-1', output: 'export const api = {};',
      },
    ];

    let secondInput: BuilderShardContinuationInput | undefined;
    const attempts = [
      async function* (_input: BuilderShardContinuationInput): AsyncGenerator<EforgeEvent, undefined> {
        for (const ev of toolEvents) yield ev;
        yield {
          timestamp: new Date().toISOString(), type: 'plan:build:failed', planId: 'plan-01-test',
          error: 'Reached maximum number of turns', terminalSubtype: 'error_max_turns',
        };
      },
      async function* (input: BuilderShardContinuationInput): AsyncGenerator<EforgeEvent, undefined> {
        secondInput = input;
        yield { timestamp: new Date().toISOString(), type: 'plan:build:implement:complete', planId: 'plan-01-test' };
      },
    ];
    let idx = 0;
    const runShard = (input: BuilderShardContinuationInput) => attempts[idx++](input);

    const initial: BuilderShardContinuationInput = {
      worktreePath: tmpDir,
      baseBranch: 'main',
      planId: 'plan-01-test',
      shardId: shard.id,
      shardScope: shard,
      builderOptions: {},
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(runShard, policy, initial)) {
      out.push(ev);
    }

    // agent:retry emitted between attempts
    const retries = out.filter((e) => e.type === 'agent:retry') as Array<Extract<EforgeEvent, { type: 'agent:retry' }>>;
    expect(retries).toHaveLength(1);
    expect(retries[0].agent).toBe('builder');
    expect(retries[0].subtype).toBe('error_max_turns');

    // plan:build:implement:continuation emitted
    const continuations = out.filter((e) => e.type === 'plan:build:implement:continuation') as Array<Extract<EforgeEvent, { type: 'plan:build:implement:continuation' }>>;
    expect(continuations).toHaveLength(1);
    expect(continuations[0].planId).toBe('plan-01-test');

    // Second input has discovery-only context with builder events from first attempt
    expect(secondInput).toBeDefined();
    const ctx = secondInput?.builderOptions.continuationContext;
    expect(ctx?.handoffMode).toBe('discovery-only');
    if (ctx?.handoffMode === 'discovery-only') {
      expect(ctx.filesInspected).toContain('lib/api.ts');
      expect(ctx.toolResultSnippets.some((s) => s.includes('api'))).toBe(true);
    }
  });
});
