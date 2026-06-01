import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stackLayersToWire } from '../projections/stack-layers.js';

function cwd(): string { return mkdtempSync(join(tmpdir(), 'eforge-stack-proj-')); }
function writeLayers(dir: string, value: unknown): void { mkdirSync(join(dir, '.eforge/stacks'), { recursive: true }); writeFileSync(join(dir, '.eforge/stacks/layers.json'), typeof value === 'string' ? value : JSON.stringify(value)); }

describe('stack layer projection', () => {
  it('returns [] for absent, malformed, invalid root, and invalid entry files', () => {
    const absent = cwd(); expect(stackLayersToWire(absent)).toEqual([]);
    const malformed = cwd(); writeLayers(malformed, '{'); expect(stackLayersToWire(malformed)).toEqual([]);
    const invalidRoot = cwd(); writeLayers(invalidRoot, { version: 2, layers: [] }); expect(stackLayersToWire(invalidRoot)).toEqual([]);
    const invalidEntry = cwd(); writeLayers(invalidEntry, { version: 1, layers: [{ prdId: 'x' }] }); expect(stackLayersToWire(invalidEntry)).toEqual([]);
  });
  it('returns valid layer fixtures', () => {
    const dir = cwd();
    const layer = { prdId: 'p', stackId: 's', provider: 'git-spice', branch: 'b', status: 'pending', recordedAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' };
    writeLayers(dir, { version: 1, layers: [layer] });
    expect(stackLayersToWire(dir)).toEqual([layer]);
  });
});
