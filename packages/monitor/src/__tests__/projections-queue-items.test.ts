import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countPendingQueueDepth, loadQueueItems, loadQueueItemsSync, parseQueueFrontmatter } from '../projections/queue-items.js';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'eforge-queue-proj-')); }
function prd(title: string, depends = '[]'): string { return `---\ntitle: ${title}\npriority: 2\ncreated: "2025"\ndepends_on: ${depends}\n---\n# Body`; }

describe('queue item projections', () => {
  it('parses frontmatter scalars and arrays', () => {
    expect(parseQueueFrontmatter('---\ntitle: "A"\nflag: true\ncount: -1\ndepends_on: [a, "b"]\n---')).toEqual({ title: 'A', flag: true, count: -1, depends_on: ['a', 'b'] });
  });
  it('keeps sync and async loaders in parity across statuses, sidecars, and dependsOn filtering', async () => {
    const root = tmp(); const queue = join(root, 'queue'); const locks = join(root, 'locks');
    mkdirSync(join(queue, 'failed'), { recursive: true }); mkdirSync(join(queue, 'skipped'), { recursive: true }); mkdirSync(join(queue, 'waiting'), { recursive: true }); mkdirSync(locks);
    writeFileSync(join(queue, 'a.md'), prd('A', '[b, failed]')); writeFileSync(join(queue, 'b.md'), prd('B')); writeFileSync(join(locks, 'b.lock'), '');
    writeFileSync(join(queue, 'failed', 'failed.md'), prd('F', '[a]')); writeFileSync(join(queue, 'failed', 'failed.recovery.json'), JSON.stringify({ verdict: { verdict: 'split', confidence: 'high', rationale: 'Partial work landed', completedWork: [], remainingWork: [], risks: [] }, applied: { action: 'split', appliedAt: '2025-01-01T00:00:00.000Z', successorPrdId: 'failed-successor' } }));
    writeFileSync(join(queue, 'failed', 'accepted-complete.md'), prd('Accepted Complete'));
    writeFileSync(join(queue, 'failed', 'accepted-complete.recovery.json'), JSON.stringify({ applied: { action: 'accepted-success', acceptedAt: '2025-01-02T00:00:00.000Z', reasonCategory: 'other', reason: 'ok', cleanup: { status: 'noop' }, landing: { action: 'pr', status: 'complete', branch: 'eforge/x', autoMerge: { status: 'complete' } }, dependents: { unblocked: [], remainedBlocked: [], notFound: [] } } }));
    writeFileSync(join(queue, 'failed', 'accepted-failed.md'), prd('Accepted Failed'));
    writeFileSync(join(queue, 'failed', 'accepted-failed.recovery.json'), JSON.stringify({ applied: { action: 'accepted-success', acceptedAt: '2025-01-03T00:00:00.000Z', reasonCategory: 'other', reason: 'ok', cleanup: { status: 'noop' }, landing: { action: 'pr', status: 'failed', branch: 'eforge/y', reason: 'nope' }, dependents: { unblocked: [], remainedBlocked: [], notFound: [] } } }));
    writeFileSync(join(queue, 'failed', 'malformed.md'), prd('Malformed')); writeFileSync(join(queue, 'failed', 'malformed.recovery.json'), '{');
    writeFileSync(join(queue, 'skipped', 'skipped.md'), prd('S', '[a]')); writeFileSync(join(queue, 'waiting', 'waiting.md'), prd('W', '[a, skipped]'));
    const sync = loadQueueItemsSync(queue, locks);
    const asyncItems = await loadQueueItems(queue, locks);
    expect(asyncItems).toEqual(sync);
    expect(sync.find((i) => i.id === 'b')?.status).toBe('running');
    expect(sync.find((i) => i.id === 'failed')?.recoveryVerdict).toEqual({ verdict: 'split', confidence: 'high' });
    // Applied marker projects alongside the verdict, with sync/async parity.
    expect(sync.find((i) => i.id === 'failed')?.recoveryApplied).toEqual({ action: 'split', appliedAt: '2025-01-01T00:00:00.000Z', successorPrdId: 'failed-successor' });
    expect(asyncItems.find((i) => i.id === 'failed')?.recoveryApplied).toEqual({ action: 'split', appliedAt: '2025-01-01T00:00:00.000Z', successorPrdId: 'failed-successor' });
    expect(sync.find((i) => i.id === 'accepted-complete')?.status).toBe('completed');
    expect(sync.find((i) => i.id === 'accepted-complete')?.recoveryApplied).toMatchObject({ action: 'accepted-success', landing: { status: 'complete', autoMerge: { status: 'complete' } } });
    expect(sync.find((i) => i.id === 'accepted-failed')?.status).toBe('failed');
    expect(sync.find((i) => i.id === 'malformed')?.recoveryVerdict).toBeUndefined();
    expect(sync.find((i) => i.id === 'malformed')?.recoveryApplied).toBeUndefined();
    expect(sync.find((i) => i.id === 'failed')?.dependsOn).toBeUndefined();
    expect(sync.find((i) => i.id === 'a')?.dependsOn).toEqual(['b']);
    expect(countPendingQueueDepth(root, 'queue')).toBe(2);
  });
});
