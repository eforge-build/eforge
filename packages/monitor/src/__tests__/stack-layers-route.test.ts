/**
 * Tests for `GET /api/stack/layers` and parity with `stream:hello.stackLayers`.
 *
 * Covers:
 *  (a) Returns `{ layers: [] }` when `.eforge/stacks/layers.json` is absent.
 *  (b) Returns `{ layers: [] }` when the file contains invalid JSON.
 *  (c) Returns `{ layers: [] }` when the file root is invalid.
 *  (d) Returns validated layer objects when the file contains a valid state fixture.
 *  (e) `GET /api/stack/layers` and `stream:hello.stackLayers` return identical
 *      layer objects for the same fixture file — proving REST and SSE share the
 *      same `stackLayersToWire` projection helper.
 *  (f) Invalid entries invalidate the state file and return an empty layer list.
 *
 * Follows AGENTS.md conventions:
 * - No mocks. Real SQLite DB via openDatabase. Real HTTP via startServer.
 * - Constructs inputs inline.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { openDatabase } from '../db.js';
import { startServer } from '../server.js';
import type { MonitorServer } from '../server.js';
import type { StackLayerWire } from '@eforge-build/client';

function makeTmpCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eforge-stack-layers-'));
  mkdirSync(join(dir, '.eforge'), { recursive: true });
  return dir;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

/**
 * Collect SSE blocks from an HTTP response body.
 * Resolves once `minBlocks` complete SSE blocks have been received.
 */
function fetchSseFirstChunk(
  url: string,
  minBlocks = 1,
  timeoutMs = 2000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let resolved = false;

    function tryResolve(): void {
      if (resolved) return;
      const completeBlocks = buffer.split(/\r?\n\r?\n/).filter(Boolean);
      if (completeBlocks.length >= minBlocks) {
        resolved = true;
        req.destroy();
        resolve(buffer);
      }
    }

    const req = http.get(url, { headers: { accept: 'text/event-stream' } }, (res) => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`Non-2xx status: ${res.statusCode}`));
        return;
      }
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        tryResolve();
      });
      res.on('end', () => {
        if (!resolved) { resolved = true; resolve(buffer); }
      });
      res.on('error', (err) => {
        if (!resolved) { resolved = true; reject(err); }
      });
    });
    req.on('error', () => {
      if (!resolved) { resolved = true; resolve(buffer); }
    });
    setTimeout(() => {
      if (!resolved) { resolved = true; req.destroy(); resolve(buffer); }
    }, timeoutMs);
  });
}

function extractHelloData(raw: string): Record<string, unknown> {
  const blocks = raw.trim().split(/\r?\n\r?\n/).filter(Boolean);
  const helloBlock = blocks.find((b) => b.includes('event: stream:hello'));
  if (!helloBlock) throw new Error('stream:hello block not found');
  const dataLine = helloBlock.split('\n').find((l) => l.startsWith('data:'));
  if (!dataLine) throw new Error('No data: line in stream:hello block');
  return JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>;
}

/** A minimal valid StackLayerWire fixture. */
function makeLayer(overrides: Partial<StackLayerWire> = {}): StackLayerWire {
  return {
    prdId: 'prd-001',
    stackId: 'stack-abc',
    provider: 'git-spice',
    branch: 'feat/prd-001',
    status: 'pending',
    recordedAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

const servers: MonitorServer[] = [];

afterEach(async () => {
  for (const s of servers) {
    try {
      await s.stop();
    } catch {
      // best-effort
    }
  }
  servers.length = 0;
});

// ---------------------------------------------------------------------------
// (a) Absent file
// ---------------------------------------------------------------------------

describe('GET /api/stack/layers — absent file', () => {
  it('returns { layers: [] } when .eforge/stacks/layers.json does not exist', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd });
    servers.push(server);

    const result = await fetchJson(`http://127.0.0.1:${server.port}/api/stack/layers`) as { layers: unknown[] };
    expect(result).toEqual({ layers: [] });

    await server.stop();
    db.close();
  });
});

// ---------------------------------------------------------------------------
// (b) Invalid JSON
// ---------------------------------------------------------------------------

describe('GET /api/stack/layers — invalid JSON', () => {
  it('returns { layers: [] } when the file contains malformed JSON', async () => {
    const cwd = makeTmpCwd();
    mkdirSync(join(cwd, '.eforge', 'stacks'), { recursive: true });
    writeFileSync(join(cwd, '.eforge', 'stacks', 'layers.json'), 'not json {{{', 'utf-8');

    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd });
    servers.push(server);

    const result = await fetchJson(`http://127.0.0.1:${server.port}/api/stack/layers`) as { layers: unknown[] };
    expect(result).toEqual({ layers: [] });

    await server.stop();
    db.close();
  });
});

// ---------------------------------------------------------------------------
// (c) Invalid root shape
// ---------------------------------------------------------------------------

describe('GET /api/stack/layers — invalid root shape', () => {
  it('returns { layers: [] } when the file does not contain a versioned stack state object', async () => {
    const cwd = makeTmpCwd();
    mkdirSync(join(cwd, '.eforge', 'stacks'), { recursive: true });
    writeFileSync(
      join(cwd, '.eforge', 'stacks', 'layers.json'),
      JSON.stringify({ layers: [] }),
      'utf-8',
    );

    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd });
    servers.push(server);

    const result = await fetchJson(`http://127.0.0.1:${server.port}/api/stack/layers`) as { layers: unknown[] };
    expect(result).toEqual({ layers: [] });

    await server.stop();
    db.close();
  });
});

// ---------------------------------------------------------------------------
// (d) Valid fixture
// ---------------------------------------------------------------------------

describe('GET /api/stack/layers — valid fixture', () => {
  it('returns all valid layer objects from the fixture file', async () => {
    const cwd = makeTmpCwd();
    mkdirSync(join(cwd, '.eforge', 'stacks'), { recursive: true });

    const layer1 = makeLayer({ prdId: 'prd-001', stackId: 'stack-a', branch: 'feat/prd-001' });
    const layer2 = makeLayer({
      prdId: 'prd-002',
      stackId: 'stack-a',
      parentPrdId: 'prd-001',
      branch: 'feat/prd-002',
      baseBranch: 'feat/prd-001',
      status: 'building',
      artifact: { branch: 'feat/prd-002', commitSha: 'abc123', prUrl: 'https://github.com/org/repo/pull/42' },
    });

    writeFileSync(
      join(cwd, '.eforge', 'stacks', 'layers.json'),
      JSON.stringify({ version: 1, layers: [layer1, layer2] }),
      'utf-8',
    );

    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd });
    servers.push(server);

    const result = await fetchJson(`http://127.0.0.1:${server.port}/api/stack/layers`) as { layers: StackLayerWire[] };
    expect(result.layers).toHaveLength(2);
    expect(result.layers[0]).toEqual(layer1);
    expect(result.layers[1]).toEqual(layer2);

    await server.stop();
    db.close();
  });
});

// ---------------------------------------------------------------------------
// (e) REST and SSE snapshot parity
// ---------------------------------------------------------------------------

describe('GET /api/stack/layers parity with stream:hello.stackLayers', () => {
  it('REST and stream:hello return identical layer objects for the same fixture', async () => {
    const cwd = makeTmpCwd();
    mkdirSync(join(cwd, '.eforge', 'stacks'), { recursive: true });

    const layers: StackLayerWire[] = [
      makeLayer({
        prdId: 'prd-parity-1',
        stackId: 'stack-parity',
        branch: 'feat/parity-1',
        status: 'built',
        artifact: { branch: 'feat/parity-1', prUrl: 'https://github.com/org/repo/pull/10' },
        landing: {
          action: 'pr',
          status: 'complete',
          prUrl: 'https://github.com/org/repo/pull/10',
          startedAt: '2024-01-15T11:00:00.000Z',
          completedAt: '2024-01-15T11:05:00.000Z',
        },
      }),
      makeLayer({
        prdId: 'prd-parity-2',
        stackId: 'stack-parity',
        parentPrdId: 'prd-parity-1',
        branch: 'feat/parity-2',
        baseBranch: 'feat/parity-1',
        status: 'pending',
      }),
    ];

    writeFileSync(
      join(cwd, '.eforge', 'stacks', 'layers.json'),
      JSON.stringify({ version: 1, layers }),
      'utf-8',
    );

    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;

    // Fetch stream:hello snapshot
    const raw = await fetchSseFirstChunk(`${base}/api/daemon-events`, 1, 2000);
    const helloData = extractHelloData(raw);

    // Fetch REST endpoint
    const restResult = await fetchJson(`${base}/api/stack/layers`) as { layers: StackLayerWire[] };

    // Defensive: assert both sides are non-empty
    expect(Array.isArray(helloData['stackLayers'])).toBe(true);
    expect((helloData['stackLayers'] as unknown[]).length).toBe(2);
    expect(restResult.layers.length).toBe(2);

    // Parity: stream:hello.stackLayers === REST /api/stack/layers.layers
    expect(helloData['stackLayers']).toEqual(restResult.layers);
    // Both must also equal the original fixture (no field is dropped or mangled)
    expect(restResult.layers).toEqual(layers);

    await server.stop();
    db.close();
  });

  it('stream:hello.stackLayers is [] when file is absent and REST also returns []', async () => {
    const cwd = makeTmpCwd();
    // No layers.json written
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd });
    servers.push(server);

    const base = `http://127.0.0.1:${server.port}`;

    const raw = await fetchSseFirstChunk(`${base}/api/daemon-events`, 1, 2000);
    const helloData = extractHelloData(raw);
    const restResult = await fetchJson(`${base}/api/stack/layers`) as { layers: unknown[] };

    expect(helloData['stackLayers']).toEqual([]);
    expect(restResult.layers).toEqual([]);

    await server.stop();
    db.close();
  });
});

// ---------------------------------------------------------------------------
// (f) Invalid entries invalidate the file
// ---------------------------------------------------------------------------

describe('GET /api/stack/layers — invalid layer entries', () => {
  it('returns { layers: [] } when any layer entry is invalid', async () => {
    const cwd = makeTmpCwd();
    mkdirSync(join(cwd, '.eforge', 'stacks'), { recursive: true });

    const validLayer = makeLayer({ prdId: 'prd-valid' });
    const invalidEntry = { prdId: 'prd-invalid' }; // missing required fields

    writeFileSync(
      join(cwd, '.eforge', 'stacks', 'layers.json'),
      JSON.stringify({ version: 1, layers: [validLayer, invalidEntry] }),
      'utf-8',
    );

    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const server = await startServer(db, 0, { cwd });
    servers.push(server);

    const result = await fetchJson(`http://127.0.0.1:${server.port}/api/stack/layers`) as { layers: StackLayerWire[] };
    expect(result).toEqual({ layers: [] });

    await server.stop();
    db.close();
  });
});
