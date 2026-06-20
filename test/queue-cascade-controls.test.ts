import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { applyQueueCascade, previewQueueCascade } from '@eforge-build/engine/queue/cascade-control';
import { useTempDir } from './test-tmpdir.js';

function queueRoot(dir: string): string { return join(dir, '.eforge', 'queue'); }
function writePrd(dir: string, loc: 'queue' | 'waiting' | 'failed' | 'skipped', id: string, dependsOn: string[] = []): string {
  const root = loc === 'queue' ? queueRoot(dir) : join(queueRoot(dir), loc);
  mkdirSync(root, { recursive: true });
  const deps = dependsOn.length ? `depends_on: [${dependsOn.map((d) => `"${d}"`).join(', ')}]\n` : '';
  const path = join(root, `${id}.md`);
  writeFileSync(path, `---\ntitle: ${id}\n${deps}---\n\n# ${id}\n`);
  return path;
}

describe('queue cascade controls', () => {
  const tmp = useTempDir('eforge-queue-cascade-');

  it('previews target and transitive dependents without changing files', async () => {
    const dir = tmp();
    const a = writePrd(dir, 'queue', 'a');
    const b = writePrd(dir, 'waiting', 'b', ['a']);
    writePrd(dir, 'waiting', 'c', ['b']);
    const before = readFileSync(a, 'utf-8') + readFileSync(b, 'utf-8');
    const preview = await previewQueueCascade({ cwd: dir, queueDir: queueRoot(dir), prdId: 'a', operation: 'remove' });
    expect(preview.target.prdId).toBe('a');
    expect(preview.dependents.map((d) => [d.prdId, d.depth])).toEqual([['b', 1], ['c', 2]]);
    expect(preview.defaultRefusalReason).toBeTruthy();
    expect(preview.safeStrategies).toContain('cascade-dependents');
    expect(preview.expectedAffected.token).toBeTruthy();
    expect(readFileSync(a, 'utf-8') + readFileSync(b, 'utf-8')).toBe(before);
  });

  it('refuses target-only and unconfirmed cascade before mutation', async () => {
    const dir = tmp();
    const a = writePrd(dir, 'queue', 'a');
    const b = writePrd(dir, 'waiting', 'b', ['a']);
    const preview = await previewQueueCascade({ cwd: dir, queueDir: queueRoot(dir), prdId: 'a', operation: 'remove' });
    await expect(applyQueueCascade({ cwd: dir, queueDir: queueRoot(dir), prdId: 'a', operation: 'remove', strategy: 'target-only', expectedAffected: preview.expectedAffected, confirmDependents: false })).resolves.toMatchObject({ applied: false });
    await expect(applyQueueCascade({ cwd: dir, queueDir: queueRoot(dir), prdId: 'a', operation: 'remove', strategy: 'cascade-dependents', expectedAffected: preview.expectedAffected, confirmDependents: false })).resolves.toMatchObject({ applied: false });
    expect(existsSync(a)).toBe(true);
    expect(existsSync(b)).toBe(true);
  });

  it('applies confirmed cascade remove and deletes failed sidecars', async () => {
    const dir = tmp();
    writePrd(dir, 'failed', 'a');
    writeFileSync(join(queueRoot(dir), 'failed', 'a.recovery.json'), '{}');
    writePrd(dir, 'skipped', 'b', ['a']);
    const preview = await previewQueueCascade({ cwd: dir, queueDir: queueRoot(dir), prdId: 'a', operation: 'remove' });
    const applied = await applyQueueCascade({ cwd: dir, queueDir: queueRoot(dir), prdId: 'a', operation: 'remove', strategy: 'cascade-dependents', expectedAffected: preview.expectedAffected, confirmDependents: true });
    expect(applied.applied).toBe(true);
    expect(existsSync(join(queueRoot(dir), 'failed', 'a.md'))).toBe(false);
    expect(existsSync(join(queueRoot(dir), 'failed', 'a.recovery.json'))).toBe(false);
    expect(existsSync(join(queueRoot(dir), 'skipped', 'b.md'))).toBe(false);
  });

  it('cancels pending/waiting to skipped and requires ownership for running cancellation', async () => {
    const dir = tmp();
    writePrd(dir, 'queue', 'a');
    writePrd(dir, 'waiting', 'b', ['a']);
    const preview = await previewQueueCascade({ cwd: dir, queueDir: queueRoot(dir), prdId: 'a', operation: 'cancel' });
    const applied = await applyQueueCascade({ cwd: dir, queueDir: queueRoot(dir), prdId: 'a', operation: 'cancel', strategy: 'cascade-dependents', expectedAffected: preview.expectedAffected, confirmDependents: true });
    expect(applied.applied).toBe(true);
    expect(readFileSync(join(queueRoot(dir), 'skipped', 'a.md'), 'utf-8')).toContain('cancelled by operator');
    expect(readFileSync(join(queueRoot(dir), 'skipped', 'b.md'), 'utf-8')).toContain('upstream a');
  });

  it('refuses drifted or cross-operation expected affected tokens before mutation', async () => {
    const dir = tmp();
    const path = writePrd(dir, 'queue', 'a');
    const preview = await previewQueueCascade({ cwd: dir, queueDir: queueRoot(dir), prdId: 'a', operation: 'remove' });
    const applied = await applyQueueCascade({
      cwd: dir,
      queueDir: queueRoot(dir),
      prdId: 'a',
      operation: 'remove',
      strategy: 'target-only',
      expectedAffected: { ...preview.expectedAffected, token: 'stale-token' },
      confirmDependents: false,
    });
    expect(applied).toMatchObject({ applied: false, blockers: [expect.stringContaining('drifted')] });
    const crossOperation = await applyQueueCascade({
      cwd: dir,
      queueDir: queueRoot(dir),
      prdId: 'a',
      operation: 'cancel',
      strategy: 'target-only',
      expectedAffected: preview.expectedAffected,
      confirmDependents: false,
    });
    expect(crossOperation).toMatchObject({ applied: false, blockers: [expect.stringContaining('drifted')] });
    expect(existsSync(path)).toBe(true);
  });

  it('refuses running cancellation without ownership and does not invoke the cancel delegate', async () => {
    const dir = tmp();
    writePrd(dir, 'queue', 'run');
    mkdirSync(join(dir, '.eforge', 'queue-locks'), { recursive: true });
    writeFileSync(join(dir, '.eforge', 'queue-locks', 'run.lock'), String(process.pid));
    const preview = await previewQueueCascade({ cwd: dir, queueDir: queueRoot(dir), prdId: 'run', operation: 'cancel' });
    expect(preview.target.blockers.join(' ')).toContain('cannot be cancelled');
    let invoked = false;
    const applied = await applyQueueCascade({
      cwd: dir,
      queueDir: queueRoot(dir),
      prdId: 'run',
      operation: 'cancel',
      strategy: 'target-only',
      expectedAffected: preview.expectedAffected,
      confirmDependents: false,
      cancelRunning: () => { invoked = true; return { cancelled: true }; },
    });
    expect(applied.applied).toBe(false);
    expect(invoked).toBe(false);
  });

  it('writes a running cancellation marker before invoking the cancel delegate when ownership is present', async () => {
    const dir = tmp();
    writePrd(dir, 'queue', 'run');
    mkdirSync(join(dir, '.eforge', 'queue-locks'), { recursive: true });
    writeFileSync(join(dir, '.eforge', 'queue-locks', 'run.lock'), String(process.pid));
    const owned = { owned: true, sessionId: 'session-1', runId: 'run-1', pid: process.pid } as const;
    const preview = await previewQueueCascade({ cwd: dir, queueDir: queueRoot(dir), prdId: 'run', operation: 'cancel', resolveRunningOwnership: () => owned });
    const markerPath = join(dir, '.eforge', 'queue-cancellations', 'run.json');
    const applied = await applyQueueCascade({
      cwd: dir,
      queueDir: queueRoot(dir),
      prdId: 'run',
      operation: 'cancel',
      strategy: 'target-only',
      expectedAffected: preview.expectedAffected,
      confirmDependents: false,
      resolveRunningOwnership: () => owned,
      cancelRunning: () => {
        expect(existsSync(markerPath)).toBe(true);
        expect(JSON.parse(readFileSync(markerPath, 'utf-8'))).toMatchObject({ prdId: 'run', sessionId: 'session-1', runId: 'run-1', pid: process.pid });
        return { cancelled: true, reason: 'signalled' };
      },
    });
    expect(applied).toMatchObject({ applied: true, target: { prdId: 'run', status: 'cancelled', sessionId: 'session-1' } });
    rmSync(markerPath, { force: true });
  });
});
