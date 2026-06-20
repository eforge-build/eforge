import { describe, expect, it } from 'vitest';
import { deriveQueueCapabilitiesForSnapshot, deriveQueueItemCapabilities } from '@eforge-build/engine/queue/capabilities';
import type { QueueControlRecord, QueueControlSnapshot } from '@eforge-build/engine/queue/snapshot';

function record(id: string, status: QueueControlRecord['status'], dependsOn: string[] = [], held = false): QueueControlRecord {
  return { id, title: id, location: status === 'waiting' || status === 'failed' || status === 'skipped' ? status : 'queue', status, dependsOn, filePath: `/q/${id}.md`, content: '', frontmatter: { title: id, ...(held ? { held: true } : {}), ...(dependsOn.length ? { depends_on: dependsOn } : {}) }, prd: { id, filePath: `/q/${id}.md`, frontmatter: { title: id }, content: '', lastCommitHash: '', lastCommitDate: '' } };
}
function snapshot(records: QueueControlRecord[]): QueueControlSnapshot { return { queueDir: '/q', records, byId: new Map(records.map((r) => [r.id, r])), duplicates: new Map(), orderedIds: records.map((r) => r.id) }; }

describe('queue capabilities', () => {
  it('returns every capability key and allows hold/priority for pending items', () => {
    const s = snapshot([record('p', 'pending')]);
    const caps = deriveQueueItemCapabilities(s.records[0], s);
    expect(Object.keys(caps).sort()).toEqual(['cancel', 'cascadeCancel', 'cascadeRemove', 'dependencyOverride', 'hold', 'priority', 'remove', 'unhold'].sort());
    expect(caps.priority.allowed).toBe(true);
    expect(caps.hold.allowed).toBe(true);
    expect(caps.unhold.allowed).toBe(false);
    expect(caps.unhold.reason).toBeTruthy();
  });

  it('disables legacy remove when dependents exist but allows cascade remove', () => {
    const target = record('a', 'pending');
    const dep = record('b', 'waiting', ['a']);
    const s = snapshot([target, dep]);
    const caps = deriveQueueItemCapabilities(target, s);
    expect(caps.remove.allowed).toBe(false);
    expect(caps.remove.reason).toContain('cascade remove');
    expect(caps.cascadeRemove.allowed).toBe(true);
  });

  it('uses running ownership for cancel and cascade cancel', () => {
    const running = record('r', 'running');
    const s = snapshot([running]);
    expect(deriveQueueItemCapabilities(running, s).cancel.allowed).toBe(false);
    expect(deriveQueueCapabilitiesForSnapshot(s, new Map([['r', { owned: true, sessionId: 's' }]])).get('r')!.cancel.allowed).toBe(true);
  });
});
