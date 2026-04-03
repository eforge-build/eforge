import { describe, it, expect, beforeEach } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverPiExtensions } from '../src/engine/backends/pi-extensions.js';
import { useTempDir } from './test-tmpdir.js';

describe('discoverPiExtensions', () => {
  const makeTempDir = useTempDir();

  let cwd: string;

  beforeEach(async () => {
    cwd = makeTempDir();
    // Create project-local .pi/extensions/ with some extension dirs
    const extDir = join(cwd, '.pi', 'extensions');
    await mkdir(extDir, { recursive: true });
    await mkdir(join(extDir, 'alpha'));
    await mkdir(join(extDir, 'beta'));
    await mkdir(join(extDir, 'gamma'));
  });

  it('auto-discovers all extensions when no include/exclude is set', async () => {
    const result = await discoverPiExtensions(cwd);
    expect(result).toHaveLength(3);
    expect(result.map(p => p.split('/').pop())).toEqual(expect.arrayContaining(['alpha', 'beta', 'gamma']));
  });

  it('filters auto-discovered extensions with include whitelist', async () => {
    const result = await discoverPiExtensions(cwd, { include: ['alpha', 'gamma'] });
    expect(result).toHaveLength(2);
    expect(result.map(p => p.split('/').pop())).toEqual(expect.arrayContaining(['alpha', 'gamma']));
  });

  it('filters auto-discovered extensions with exclude blacklist', async () => {
    const result = await discoverPiExtensions(cwd, { exclude: ['beta'] });
    expect(result).toHaveLength(2);
    expect(result.map(p => p.split('/').pop())).toEqual(expect.arrayContaining(['alpha', 'gamma']));
  });

  it('applies include first then exclude when both are set', async () => {
    const result = await discoverPiExtensions(cwd, {
      include: ['alpha', 'beta'],
      exclude: ['beta'],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/alpha$/);
  });

  it('does not filter explicit paths by include/exclude', async () => {
    const explicitDir = join(cwd, 'my-ext');
    await mkdir(explicitDir, { recursive: true });

    const result = await discoverPiExtensions(cwd, {
      paths: [explicitDir],
      include: ['alpha'],
      exclude: ['my-ext'],
    });

    // explicit path should be present despite being in exclude and not in include
    expect(result.some(p => p.endsWith('my-ext'))).toBe(true);
    // auto-discovered should only include alpha
    const autoDiscovered = result.filter(p => !p.endsWith('my-ext'));
    expect(autoDiscovered).toHaveLength(1);
    expect(autoDiscovered[0]).toMatch(/alpha$/);
  });

  it('returns only explicit paths when autoDiscover is false', async () => {
    const explicitDir = join(cwd, 'explicit-ext');
    await mkdir(explicitDir, { recursive: true });

    const result = await discoverPiExtensions(cwd, {
      paths: [explicitDir],
      autoDiscover: false,
      include: ['alpha'],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/explicit-ext$/);
  });

  it('returns empty array when include matches nothing', async () => {
    const result = await discoverPiExtensions(cwd, { include: ['nonexistent'] });
    expect(result).toHaveLength(0);
  });

  it('returns all when exclude matches nothing', async () => {
    const result = await discoverPiExtensions(cwd, { exclude: ['nonexistent'] });
    expect(result).toHaveLength(3);
  });

  it('excludes auto-discovered eforge extension with no config', async () => {
    const extDir = join(cwd, '.pi', 'extensions');
    await mkdir(join(extDir, 'eforge'));
    const result = await discoverPiExtensions(cwd);
    // alpha, beta, gamma from beforeEach — eforge excluded
    expect(result).toHaveLength(3);
    expect(result.map(p => p.split('/').pop())).not.toContain('eforge');
  });

  it('does not filter explicit eforge path', async () => {
    const eforgePath = join(cwd, 'eforge');
    await mkdir(eforgePath, { recursive: true });
    const result = await discoverPiExtensions(cwd, { paths: [eforgePath] });
    expect(result.some(p => p.endsWith('eforge'))).toBe(true);
  });

  it('returns empty array when no extensions exist and no config', async () => {
    const emptyDir = join(cwd, 'empty-project');
    await mkdir(emptyDir, { recursive: true });
    const result = await discoverPiExtensions(emptyDir);
    expect(result).toHaveLength(0);
  });
});
