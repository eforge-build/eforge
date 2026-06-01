import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import type { EforgeEvent } from '@eforge-build/client';
import { recoverLandingConflict } from '@eforge-build/engine/stacking';
import type {
  LandingConflictRecoveryResult,
  StackProviderAdapter,
  StackProviderErrorClassification,
  StackProviderInterruptedOperation,
} from '@eforge-build/engine/stacking';
import type { StackBaseContext } from '@eforge-build/engine/stacking/base-resolver';
import type { MergeResolver } from '@eforge-build/engine/worktree-ops';
import { useTempDir } from './test-tmpdir.js';

const exec = promisify(execFile);

const classification: StackProviderErrorClassification = {
  kind: 'recoverable-conflict',
  operation: 'branch-restack',
  conflictKind: 'git-rebase',
  message: 'conflict',
  recoverable: true,
};

const stackContext: StackBaseContext = {
  prdId: 'prd-1',
  stackId: 'stack-1',
  provider: 'git-spice',
  branch: 'feature/prd-1',
  baseBranch: 'main',
};

async function collect(
  generator: AsyncGenerator<EforgeEvent, LandingConflictRecoveryResult>,
): Promise<{ events: EforgeEvent[]; result: LandingConflictRecoveryResult }> {
  const events: EforgeEvent[] = [];
  for (;;) {
    const next = await generator.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
}

function makeProvider(overrides: Partial<StackProviderAdapter> = {}): StackProviderAdapter {
  return {
    requireAvailable: async () => undefined,
    trackBranch: async () => commandResult(['branch', 'track']),
    submitBranch: async () => commandResult(['branch', 'submit']),
    submitStack: async () => commandResult(['stack', 'submit']),
    syncRepo: async () => commandResult(['repo', 'sync']),
    restackBranch: async () => commandResult(['branch', 'restack']),
    restackStack: async () => commandResult(['stack', 'restack']),
    upstackOnto: async () => commandResult(['upstack', 'onto']),
    commandPreview: (args) => ({ command: 'git-spice', args }),
    syncRepoPreview: () => ({ command: 'git-spice', args: ['repo', 'sync'] }),
    restackStackPreview: () => ({ command: 'git-spice', args: ['stack', 'restack'] }),
    parsePrUrl: () => undefined,
    isValidPrUrl: () => true,
    redactMessage: (message) => message,
    classifyError: async () => classification,
    getInterruptedOperation: async () => undefined,
    continueInterruptedOperation: async () => commandResult(['rebase', 'continue']),
    abortInterruptedOperation: async () => commandResult(['rebase', 'abort']),
    ...overrides,
  };
}

function commandResult(args: string[]) {
  return { command: 'git-spice', args, stdout: '', stderr: '', exitCode: 0 };
}

function makeOperation(files: string[]): StackProviderInterruptedOperation {
  return {
    operation: 'branch-restack',
    conflictKind: 'git-rebase',
    branch: stackContext.branch,
    conflictedFiles: files,
    conflictDiff: 'diff --cc file.txt',
  };
}

async function initRepo(dir: string): Promise<void> {
  await exec('git', ['init', '-b', 'main'], { cwd: dir });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  writeFileSync(join(dir, 'file.txt'), 'base\n');
  await exec('git', ['add', 'file.txt'], { cwd: dir });
  await exec('git', ['commit', '-m', 'base'], { cwd: dir });
}

async function createUnmergedFile(dir: string, content: string): Promise<void> {
  await initRepo(dir);
  await exec('git', ['checkout', '-b', 'ours'], { cwd: dir });
  writeFileSync(join(dir, 'file.txt'), 'ours\n');
  await exec('git', ['commit', '-am', 'ours'], { cwd: dir });
  await exec('git', ['checkout', 'main'], { cwd: dir });
  await exec('git', ['checkout', '-b', 'theirs'], { cwd: dir });
  writeFileSync(join(dir, 'file.txt'), 'theirs\n');
  await exec('git', ['commit', '-am', 'theirs'], { cwd: dir });
  await exec('git', ['checkout', 'ours'], { cwd: dir });
  await exec('git', ['merge', 'theirs'], { cwd: dir }).catch(() => undefined);
  writeFileSync(join(dir, 'file.txt'), content);
}

describe('recoverLandingConflict', () => {
  const makeTempDir = useTempDir('eforge-landing-recovery-');

  it('resolves temporary plan-ID marker-only conflicts before provider continue without resolver calls', async () => {
    const dir = makeTempDir();
    await createUnmergedFile(dir, [
      '<<<<<<< HEAD\n',
      '// --- eforge:region plan-01-rebase-provider-recovery-foundation ---\n',
      'const value = 2;\n',
      '// --- eforge:endregion plan-01-rebase-provider-recovery-foundation ---\n',
      '=======\n',
      'const value = 2;\n',
      '>>>>>>> theirs\n',
    ].join(''));

    let resolverCalls = 0;
    let continueCalls = 0;
    const provider = makeProvider({
      getInterruptedOperation: async () => makeOperation(['file.txt']),
      continueInterruptedOperation: async () => { continueCalls += 1; return commandResult(['rebase', 'continue']); },
    });
    const mergeResolver: MergeResolver = async () => { resolverCalls += 1; return true; };

    const { events, result } = await collect(recoverLandingConflict({
      cwd: dir,
      mergeWorktreePath: dir,
      stackContext,
      provider,
      classification,
      mergeResolver,
    }));

    expect(result.recovered).toBe(true);
    expect(continueCalls).toBe(1);
    expect(resolverCalls).toBe(0);
    expect(readFileSync(join(dir, 'file.txt'), 'utf8')).toBe('const value = 2;\n');
    expect(events.map((event) => event.type)).toContain('stack:landing:conflict:recovery:complete');
  });

  it('clamps post-recovery validation timeout to the configured minimum', async () => {
    const dir = makeTempDir();
    await initRepo(dir);
    const provider = makeProvider({ getInterruptedOperation: async () => makeOperation([]) });

    const { result } = await collect(recoverLandingConflict({
      cwd: dir,
      mergeWorktreePath: dir,
      stackContext,
      provider,
      classification,
      postRecoveryValidationCommands: ['node -e "setTimeout(() => {}, 20)"'],
      validationTimeoutMs: 1,
    }));

    expect(result.recovered).toBe(true);
  });

  it('does not auto-resolve non-marker empty-side conflicts', async () => {
    const dir = makeTempDir();
    await createUnmergedFile(dir, '<<<<<<< HEAD\n=======\nconst realCode = 1;\n>>>>>>> theirs\n');
    let resolverCalls = 0;
    const provider = makeProvider({ getInterruptedOperation: async () => makeOperation(['file.txt']) });
    const mergeResolver: MergeResolver = async (cwd) => {
      resolverCalls += 1;
      writeFileSync(join(cwd, 'file.txt'), 'resolved by resolver\n');
      await exec('git', ['add', 'file.txt'], { cwd });
      return true;
    };

    const { result } = await collect(recoverLandingConflict({
      cwd: dir,
      mergeWorktreePath: dir,
      stackContext,
      provider,
      classification,
      mergeResolver,
    }));

    expect(result.recovered).toBe(true);
    expect(resolverCalls).toBe(1);
    expect(readFileSync(join(dir, 'file.txt'), 'utf8')).toBe('resolved by resolver\n');
  });

  it('calls merge resolver fallback when deterministic strategies leave unmerged files', async () => {
    const dir = makeTempDir();
    await createUnmergedFile(dir, '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> theirs\n');
    let resolverCalls = 0;
    const provider = makeProvider({ getInterruptedOperation: async () => makeOperation(['file.txt']) });
    const mergeResolver: MergeResolver = async (cwd, conflict) => {
      resolverCalls += 1;
      expect(conflict.branch).toBe(stackContext.branch);
      expect(conflict.baseBranch).toBe('main');
      expect(conflict.conflictedFiles).toEqual(['file.txt']);
      expect(conflict.conflictDiff).toBe('diff --cc file.txt');
      writeFileSync(join(cwd, 'file.txt'), 'resolved\n');
      await exec('git', ['add', 'file.txt'], { cwd });
      return true;
    };

    const { result } = await collect(recoverLandingConflict({
      cwd: dir,
      mergeWorktreePath: dir,
      stackContext,
      provider,
      classification,
      mergeResolver,
    }));

    expect(result.recovered).toBe(true);
    expect(resolverCalls).toBe(1);
  });

  it('does not call provider continue while unmerged files remain', async () => {
    const dir = makeTempDir();
    await createUnmergedFile(dir, '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> theirs\n');
    let continueCalls = 0;
    const provider = makeProvider({
      getInterruptedOperation: async () => makeOperation(['file.txt']),
      continueInterruptedOperation: async () => { continueCalls += 1; return commandResult(['rebase', 'continue']); },
    });

    const { result } = await collect(recoverLandingConflict({
      cwd: dir,
      mergeWorktreePath: dir,
      stackContext,
      provider,
      classification,
    }));

    expect(result.recovered).toBe(false);
    expect(continueCalls).toBe(0);
    expect(result.reason).toContain('left unmerged file');
  });

  it('calls provider abort when recovery fails with an active interrupted operation', async () => {
    const dir = makeTempDir();
    await createUnmergedFile(dir, '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> theirs\n');
    let abortCalls = 0;
    const provider = makeProvider({
      getInterruptedOperation: async () => makeOperation(['file.txt']),
      abortInterruptedOperation: async () => { abortCalls += 1; return commandResult(['rebase', 'abort']); },
    });

    const { events, result } = await collect(recoverLandingConflict({
      cwd: dir,
      mergeWorktreePath: dir,
      stackContext,
      provider,
      classification,
    }));

    expect(result.recovered).toBe(false);
    expect(result.abortAttempted).toBe(true);
    expect(result.abortSucceeded).toBe(true);
    expect(abortCalls).toBe(1);
    expect(events.at(-1)).toMatchObject({
      type: 'stack:landing:conflict:recovery:failed',
      abortAttempted: true,
      abortSucceeded: true,
    });
  });

  it('stops continue retries at the configured max attempt count', async () => {
    const dir = makeTempDir();
    await initRepo(dir);
    let continueCalls = 0;
    let abortCalls = 0;
    const op = makeOperation([]);
    const provider = makeProvider({
      getInterruptedOperation: async () => op,
      classifyError: async () => classification,
      continueInterruptedOperation: async () => {
        continueCalls += 1;
        throw new Error('still conflicted');
      },
      abortInterruptedOperation: async () => { abortCalls += 1; return commandResult(['rebase', 'abort']); },
    });

    const { result } = await collect(recoverLandingConflict({
      cwd: dir,
      mergeWorktreePath: dir,
      stackContext,
      provider,
      classification,
      initialOperation: op,
      maxAttempts: 2,
    }));

    expect(result.recovered).toBe(false);
    expect(result.attempts).toBe(2);
    expect(continueCalls).toBe(2);
    expect(abortCalls).toBe(1);
  });

  it('aborts and emits failed when cleanup or merge resolution throws', async () => {
    const dir = makeTempDir();
    await createUnmergedFile(dir, '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> theirs\n');
    let abortCalls = 0;
    const provider = makeProvider({
      getInterruptedOperation: async () => makeOperation(['file.txt']),
      abortInterruptedOperation: async () => { abortCalls += 1; return commandResult(['rebase', 'abort']); },
    });
    const mergeResolver: MergeResolver = async () => { throw new Error('resolver exploded'); };

    const { events, result } = await collect(recoverLandingConflict({
      cwd: dir,
      mergeWorktreePath: dir,
      stackContext,
      provider,
      classification,
      mergeResolver,
    }));

    expect(result.recovered).toBe(false);
    expect(result.reason).toContain('resolver exploded');
    expect(result.abortAttempted).toBe(true);
    expect(abortCalls).toBe(1);
    expect(events.at(-1)?.type).toBe('stack:landing:conflict:recovery:failed');
  });

  it('aborts and emits failed when reclassifying an interrupted operation throws', async () => {
    const dir = makeTempDir();
    await initRepo(dir);
    let abortCalls = 0;
    const op = makeOperation([]);
    const provider = makeProvider({
      getInterruptedOperation: async () => op,
      continueInterruptedOperation: async () => { throw new Error('continue failed'); },
      classifyError: async () => { throw new Error('classify exploded'); },
      abortInterruptedOperation: async () => { abortCalls += 1; return commandResult(['rebase', 'abort']); },
    });

    const { events, result } = await collect(recoverLandingConflict({
      cwd: dir,
      mergeWorktreePath: dir,
      stackContext,
      provider,
      classification,
      initialOperation: op,
    }));

    expect(result.recovered).toBe(false);
    expect(result.reason).toContain('classify exploded');
    expect(result.abortAttempted).toBe(true);
    expect(abortCalls).toBe(1);
    expect(events.at(-1)?.type).toBe('stack:landing:conflict:recovery:failed');
  });

  it('fails non-recoverable classifications without running recovery', async () => {
    const dir = makeTempDir();
    await initRepo(dir);
    let continueCalls = 0;
    let abortCalls = 0;
    const op = makeOperation([]);
    const provider = makeProvider({
      continueInterruptedOperation: async () => { continueCalls += 1; return commandResult(['rebase', 'continue']); },
      abortInterruptedOperation: async () => { abortCalls += 1; return commandResult(['rebase', 'abort']); },
    });

    const { result } = await collect(recoverLandingConflict({
      cwd: dir,
      mergeWorktreePath: dir,
      stackContext,
      provider,
      classification: { ...classification, kind: 'provider-failure', recoverable: false, message: 'not recoverable' },
      initialOperation: op,
    }));

    expect(result.recovered).toBe(false);
    expect(result.reason).toBe('not recoverable');
    expect(result.abortAttempted).toBe(true);
    expect(abortCalls).toBe(1);
    expect(continueCalls).toBe(0);
  });

  it('returns validation failure without aborting after provider continuation finishes', async () => {
    const dir = makeTempDir();
    await initRepo(dir);
    let abortCalls = 0;
    const provider = makeProvider({
      getInterruptedOperation: async () => makeOperation([]),
      abortInterruptedOperation: async () => { abortCalls += 1; return commandResult(['rebase', 'abort']); },
    });

    const { result } = await collect(recoverLandingConflict({
      cwd: dir,
      mergeWorktreePath: dir,
      stackContext,
      provider,
      classification,
      postRecoveryValidationCommands: ['exit 7'],
    }));

    expect(result.recovered).toBe(false);
    expect(result.reason).toBe('Post-recovery validation failed');
    expect(result.abortAttempted).toBe(false);
    expect(abortCalls).toBe(0);
  });

  it('runs post-recovery validation only after continuation completes without another interrupted operation', async () => {
    const dir = makeTempDir();
    await initRepo(dir);
    let continueCalls = 0;
    const op = makeOperation([]);
    const provider = makeProvider({
      getInterruptedOperation: async () => op,
      continueInterruptedOperation: async () => {
        continueCalls += 1;
        if (continueCalls === 1) throw new Error('another conflict');
        return commandResult(['rebase', 'continue']);
      },
    });

    const marker = join(dir, 'validated.txt');
    const { events, result } = await collect(recoverLandingConflict({
      cwd: dir,
      mergeWorktreePath: dir,
      stackContext,
      provider,
      classification,
      initialOperation: op,
      maxAttempts: 3,
      postRecoveryValidationCommands: [`printf ok > ${marker}`],
    }));

    expect(result.recovered).toBe(true);
    expect(continueCalls).toBe(2);
    expect(existsSync(marker)).toBe(true);
    const validationIndex = events.findIndex((event) => event.type === 'validation:start');
    const providerCommandIndexes = events
      .map((event, index) => event.type === 'stack:provider:command' ? index : -1)
      .filter((index) => index >= 0);
    expect(validationIndex).toBeGreaterThan(providerCommandIndexes.at(-1) ?? -1);
  });
});
