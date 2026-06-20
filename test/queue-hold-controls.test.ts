import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { holdQueuedPrd, unholdQueuedPrd } from '@eforge-build/engine/queue/hold';
import { isQueueControlError } from '@eforge-build/engine/queue/control';
import { loadQueue } from '@eforge-build/engine/prd-queue';
import { useTempDir } from './test-tmpdir.js';

function queueRoot(dir: string): string { return join(dir, '.eforge', 'queue'); }
function writePrd(dir: string, loc: 'queue' | 'waiting' | 'failed' | 'skipped', id: string, extra = ''): string {
  const root = loc === 'queue' ? queueRoot(dir) : join(queueRoot(dir), loc);
  mkdirSync(root, { recursive: true });
  const path = join(root, `${id}.md`);
  writeFileSync(path, `---\ntitle: ${id}${extra}\n---\n\n# ${id}\n`);
  return path;
}

describe('queue hold controls', () => {
  const tmp = useTempDir('eforge-queue-hold-');

  it('holds and unholds pending PRDs without moving the file', async () => {
    const dir = tmp();
    const filePath = writePrd(dir, 'queue', 'p');
    const held = await holdQueuedPrd({ cwd: dir, queueDir: queueRoot(dir), prdId: 'p', reason: ' operator ', now: () => '2026-01-01T00:00:00.000Z' });
    expect(held.status).toBe('held');
    expect(held.location).toBe('queue');
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('held: true');
    expect(content).toContain('held_at: 2026-01-01T00:00:00.000Z');
    expect(content).toContain('hold_reason: operator');

    const unheld = await unholdQueuedPrd({ cwd: dir, queueDir: queueRoot(dir), prdId: 'p' });
    expect(unheld.status).toBe('unheld');
    expect(readFileSync(filePath, 'utf-8')).not.toMatch(/held|hold_reason|held_at/);
  });

  it('holds waiting PRDs in place and repeated hold is byte-stable', async () => {
    const dir = tmp();
    const filePath = writePrd(dir, 'waiting', 'w');
    await holdQueuedPrd({ cwd: dir, queueDir: queueRoot(dir), prdId: 'w', now: () => '2026-01-01T00:00:00.000Z' });
    const before = readFileSync(filePath, 'utf-8');
    const again = await holdQueuedPrd({ cwd: dir, queueDir: queueRoot(dir), prdId: 'w' });
    expect(again.status).toBe('already-held');
    expect(readFileSync(filePath, 'utf-8')).toBe(before);
  });

  it('repeating unhold on an unheld item is byte-stable', async () => {
    const dir = tmp();
    const filePath = writePrd(dir, 'waiting', 'w');
    const before = readFileSync(filePath, 'utf-8');
    const result = await unholdQueuedPrd({ cwd: dir, queueDir: queueRoot(dir), prdId: 'w' });
    expect(result.status).toBe('already-unheld');
    expect(readFileSync(filePath, 'utf-8')).toBe(before);
  });

  it('rejects invalid hold reasons before changing the PRD', async () => {
    const dir = tmp();
    const filePath = writePrd(dir, 'queue', 'p');
    const before = readFileSync(filePath, 'utf-8');
    await expect(holdQueuedPrd({ cwd: dir, queueDir: queueRoot(dir), prdId: 'p', reason: 'line one\nline two' })).rejects.toMatchObject({ kind: 'validation' });
    await expect(holdQueuedPrd({ cwd: dir, queueDir: queueRoot(dir), prdId: 'p', reason: 'x'.repeat(501) })).rejects.toMatchObject({ kind: 'validation' });
    expect(readFileSync(filePath, 'utf-8')).toBe(before);
  });

  it('claims root pending PRDs and releases the lock after write failures', async () => {
    const dir = tmp();
    writePrd(dir, 'queue', 'p');
    const lockPath = join(dir, '.eforge', 'queue-locks', 'p.lock');
    await expect(holdQueuedPrd({
      cwd: dir,
      queueDir: queueRoot(dir),
      prdId: 'p',
      __testHooks: { beforeWrite: async () => { throw new Error('synthetic write failure'); } },
    })).rejects.toThrow('synthetic write failure');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('refuses to hold a root pending PRD with live lock evidence', async () => {
    const dir = tmp();
    writePrd(dir, 'queue', 'p');
    const lockPath = join(dir, '.eforge', 'queue-locks', 'p.lock');
    mkdirSync(join(dir, '.eforge', 'queue-locks'), { recursive: true });
    writeFileSync(lockPath, String(process.pid));
    await expect(holdQueuedPrd({ cwd: dir, queueDir: queueRoot(dir), prdId: 'p' })).rejects.toMatchObject({ kind: 'conflict' });
    await rm(lockPath, { force: true });
  });

  it('rejects unsafe ids and terminal items with queue-control errors', async () => {
    const dir = tmp();
    writePrd(dir, 'failed', 'f');
    await expect(holdQueuedPrd({ cwd: dir, queueDir: queueRoot(dir), prdId: '../bad' })).rejects.toSatisfy(isQueueControlError);
    await expect(holdQueuedPrd({ cwd: dir, queueDir: queueRoot(dir), prdId: 'f' })).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('loadQueue round-trips hold frontmatter fields', async () => {
    const dir = tmp();
    writePrd(dir, 'queue', 'p', '\nheld: true\nhold_reason: because\nheld_at: 2026-01-01T00:00:00.000Z');
    const [prd] = await loadQueue(queueRoot(dir), dir);
    expect(prd.frontmatter).toMatchObject({ held: true, hold_reason: 'because', held_at: '2026-01-01T00:00:00.000Z' });
  });
});
