import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCascadeExpectedAffected,
  findCascadeDependents,
  loadQueueControlSnapshot,
} from '@eforge-build/engine/queue/snapshot';
import { useTempDir } from './test-tmpdir.js';

function queueRoot(dir: string): string { return join(dir, '.eforge', 'queue'); }

function writePrd(dir: string, loc: 'queue' | 'waiting' | 'failed' | 'skipped', id: string, extraFrontmatter = ''): string {
  const root = loc === 'queue' ? queueRoot(dir) : join(queueRoot(dir), loc);
  mkdirSync(root, { recursive: true });
  const path = join(root, `${id}.md`);
  writeFileSync(path, `---\ntitle: ${id}${extraFrontmatter}\n---\n\n# ${id}\n`);
  return path;
}

describe('queue-control snapshot helpers', () => {
  const tmp = useTempDir('eforge-queue-snapshot-');

  it('loads queue, waiting, failed, and skipped records with deterministic ids', async () => {
    const dir = tmp();
    writePrd(dir, 'waiting', 'b', '\ndepends_on: ["a"]');
    writePrd(dir, 'queue', 'a', '\nheld: true\nhold_reason: operator\nheld_at: 2026-01-01T00:00:00.000Z');
    writePrd(dir, 'failed', 'c');
    writePrd(dir, 'skipped', 'd');

    const snapshot = await loadQueueControlSnapshot({ cwd: dir, queueDir: queueRoot(dir), classifyRootLocks: 'read-only' });

    expect(snapshot.orderedIds).toEqual(['a', 'b', 'c', 'd']);
    expect(snapshot.byId.get('a')).toMatchObject({ status: 'pending', location: 'queue', hold: { held: true, reason: 'operator', heldAt: '2026-01-01T00:00:00.000Z' } });
    expect(snapshot.byId.get('b')).toMatchObject({ status: 'waiting', dependsOn: ['a'] });
    expect(snapshot.byId.get('c')).toMatchObject({ status: 'failed' });
    expect(snapshot.byId.get('d')).toMatchObject({ status: 'skipped' });
  });

  it('read-only lock classification keeps stale lock files in place', async () => {
    const dir = tmp();
    writePrd(dir, 'queue', 'a');
    const lockPath = join(dir, '.eforge', 'queue-locks', 'a.lock');
    mkdirSync(join(dir, '.eforge', 'queue-locks'), { recursive: true });
    writeFileSync(lockPath, '99999999');

    const snapshot = await loadQueueControlSnapshot({ cwd: dir, queueDir: queueRoot(dir), classifyRootLocks: 'read-only' });

    expect(snapshot.byId.get('a')).toMatchObject({ lock: { state: 'stale', pid: 99999999 } });
    expect(existsSync(lockPath)).toBe(true);
  });

  it('mutation lock classification cleans stale root lock files before mutations', async () => {
    const dir = tmp();
    writePrd(dir, 'queue', 'a');
    const lockPath = join(dir, '.eforge', 'queue-locks', 'a.lock');
    mkdirSync(join(dir, '.eforge', 'queue-locks'), { recursive: true });
    writeFileSync(lockPath, '99999999');

    const snapshot = await loadQueueControlSnapshot({ cwd: dir, queueDir: queueRoot(dir), classifyRootLocks: 'mutation' });

    expect(snapshot.byId.get('a')).toMatchObject({ status: 'pending', lock: { state: 'absent' } });
    expect(existsSync(lockPath)).toBe(false);
  });

  it('detects duplicate PRD ids across queue locations', async () => {
    const dir = tmp();
    writePrd(dir, 'queue', 'a');
    writePrd(dir, 'waiting', 'a');

    const snapshot = await loadQueueControlSnapshot({ cwd: dir, queueDir: queueRoot(dir), classifyRootLocks: 'read-only' });

    expect(snapshot.byId.has('a')).toBe(false);
    expect(snapshot.duplicates.get('a')?.map((record) => record.location).sort()).toEqual(['queue', 'waiting']);
  });

  it('computes transitive dependents and changes drift token when hold state changes', async () => {
    const dir = tmp();
    writePrd(dir, 'queue', 'a');
    writePrd(dir, 'waiting', 'b', '\ndepends_on: ["a"]');
    writePrd(dir, 'waiting', 'c', '\ndepends_on: ["b"]');
    const first = await loadQueueControlSnapshot({ cwd: dir, queueDir: queueRoot(dir), classifyRootLocks: 'read-only' });
    const target = first.byId.get('a')!;
    const dependents = findCascadeDependents('a', first.records);
    const firstExpected = buildCascadeExpectedAffected(target, dependents);

    writePrd(dir, 'queue', 'a', '\nheld: true');
    const second = await loadQueueControlSnapshot({ cwd: dir, queueDir: queueRoot(dir), classifyRootLocks: 'read-only' });
    const secondExpected = buildCascadeExpectedAffected(second.byId.get('a')!, findCascadeDependents('a', second.records));

    expect(dependents.map((dependent) => [dependent.record.id, dependent.depth])).toEqual([['b', 1], ['c', 2]]);
    expect(firstExpected.prdIds).toEqual(['a', 'b', 'c']);
    expect(secondExpected.prdIds).toEqual(firstExpected.prdIds);
    expect(secondExpected.token).not.toBe(firstExpected.token);
  });
});
