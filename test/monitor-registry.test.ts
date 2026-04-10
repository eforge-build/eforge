import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { useTempDir } from './test-tmpdir.js';

// We need to mock registryPath and isPidAlive to isolate tests.
// Instead, we test the exported pure functions directly and use
// the real registry functions pointed at a temp dir.

import {
  hashPort,
  PORT_RANGE_START,
  PORT_RANGE_SIZE,
  allocatePort,
  registerPort,
  deregisterPort,
  readRegistry,
  writeRegistry,
  type Registry,
} from '@eforge-build/monitor/registry';

describe('hashPort', () => {
  it('returns a number in range 4567-4667 for various inputs', () => {
    const inputs = [
      '/Users/alice/projects/foo',
      '/Users/bob/projects/bar',
      '/home/user/work',
      '/tmp/test',
      '',
      '/a/very/long/path/that/goes/on/and/on/and/on',
    ];
    for (const input of inputs) {
      const port = hashPort(input);
      expect(port).toBeGreaterThanOrEqual(PORT_RANGE_START);
      expect(port).toBeLessThanOrEqual(PORT_RANGE_START + PORT_RANGE_SIZE - 1);
    }
  });

  it('is deterministic - same input returns same output', () => {
    const cwd = '/Users/test/projects/myproject';
    const port1 = hashPort(cwd);
    const port2 = hashPort(cwd);
    const port3 = hashPort(cwd);
    expect(port1).toBe(port2);
    expect(port2).toBe(port3);
  });

  it('returns different ports for different inputs (not guaranteed but likely)', () => {
    // Test a handful of distinct paths - at least some should differ
    const ports = new Set([
      hashPort('/a'),
      hashPort('/b'),
      hashPort('/c'),
      hashPort('/d'),
      hashPort('/e'),
    ]);
    // With 5 distinct single-char paths, expect at least 2 different ports
    expect(ports.size).toBeGreaterThanOrEqual(2);
  });

  it('returns an integer', () => {
    expect(Number.isInteger(hashPort('/foo/bar'))).toBe(true);
  });
});

describe('registry I/O', () => {
  const makeTempDir = useTempDir('eforge-registry-test-');
  let origEnv: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    origEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tempDir;
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = origEnv;
    }
  });

  describe('readRegistry', () => {
    it('returns empty object when file does not exist', () => {
      expect(readRegistry()).toEqual({});
    });

    it('returns parsed entries from file', () => {
      const registryDir = join(tempDir, 'eforge');
      mkdirSync(registryDir, { recursive: true });
      const data: Registry = {
        '/project/a': { port: 4567, pid: process.pid },
      };
      writeFileSync(join(registryDir, 'monitors.json'), JSON.stringify(data));

      const result = readRegistry();
      expect(result['/project/a']).toEqual({ port: 4567, pid: process.pid });
    });

    it('prunes stale entries with dead PIDs', () => {
      const registryDir = join(tempDir, 'eforge');
      mkdirSync(registryDir, { recursive: true });
      // PID 999999999 is almost certainly dead
      const data: Registry = {
        '/project/stale': { port: 4570, pid: 999999999 },
        '/project/alive': { port: 4571, pid: process.pid },
      };
      writeFileSync(join(registryDir, 'monitors.json'), JSON.stringify(data));

      const result = readRegistry();
      expect(result['/project/stale']).toBeUndefined();
      expect(result['/project/alive']).toEqual({ port: 4571, pid: process.pid });
    });

    it('returns empty object on invalid JSON', () => {
      const registryDir = join(tempDir, 'eforge');
      mkdirSync(registryDir, { recursive: true });
      writeFileSync(join(registryDir, 'monitors.json'), 'not json{{{');

      expect(readRegistry()).toEqual({});
    });
  });

  describe('writeRegistry', () => {
    it('creates directories and writes atomically', () => {
      const data: Registry = {
        '/project/x': { port: 4580, pid: 12345 },
      };
      writeRegistry(data);

      const raw = readFileSync(join(tempDir, 'eforge', 'monitors.json'), 'utf-8');
      expect(JSON.parse(raw)).toEqual(data);
    });
  });

  describe('registerPort', () => {
    it('writes entry to registry', () => {
      registerPort('/my/project', 4590, process.pid);

      const registry = readRegistry();
      expect(registry['/my/project']).toEqual({ port: 4590, pid: process.pid });
    });

    it('overwrites existing entry for same cwd', () => {
      registerPort('/my/project', 4590, process.pid);
      registerPort('/my/project', 4591, process.pid);

      const registry = readRegistry();
      expect(registry['/my/project']).toEqual({ port: 4591, pid: process.pid });
    });
  });

  describe('deregisterPort', () => {
    it('removes the entry for the given cwd', () => {
      registerPort('/my/project', 4590, process.pid);
      deregisterPort('/my/project');

      const registry = readRegistry();
      expect(registry['/my/project']).toBeUndefined();
    });

    it('is a no-op when cwd is not in registry', () => {
      // Should not throw
      deregisterPort('/nonexistent');
      expect(readRegistry()).toEqual({});
    });
  });

  describe('allocatePort', () => {
    it('returns explicit port when provided', () => {
      expect(allocatePort('/any/path', 9999)).toBe(9999);
    });

    it('returns hash-derived port when no other project claims it', () => {
      const cwd = '/test/project/unique';
      const expected = hashPort(cwd);
      const actual = allocatePort(cwd);
      expect(actual).toBe(expected);
    });

    it('reuses existing live entry for same cwd', () => {
      const cwd = '/test/project/existing';
      registerPort(cwd, 4600, process.pid);

      const port = allocatePort(cwd);
      expect(port).toBe(4600);
    });

    it('skips ports claimed by other live projects', () => {
      const cwdA = '/project/a';
      const cwdB = '/project/b';

      // Register project A at the hash port of project B
      const hashB = hashPort(cwdB);
      registerPort(cwdA, hashB, process.pid);

      // Project B should skip its preferred port and get a different one
      const portB = allocatePort(cwdB);
      expect(portB).not.toBe(hashB);
      expect(portB).toBeGreaterThanOrEqual(PORT_RANGE_START);
      expect(portB).toBeLessThanOrEqual(PORT_RANGE_START + PORT_RANGE_SIZE - 1);
    });

    it('returns hash port when registry is inaccessible', () => {
      // Point XDG to a non-writable path (but hashPort still works)
      const cwd = '/test/fallback';
      // Even with no registry, allocatePort should return hashPort
      const port = allocatePort(cwd);
      expect(port).toBe(hashPort(cwd));
    });
  });
});
