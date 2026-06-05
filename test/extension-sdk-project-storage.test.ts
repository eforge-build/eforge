import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getScopeDirectory } from '@eforge-build/scopes';
import {
  createEforgeProjectPaths,
  resolveExtensionStoragePath,
  resolveProjectLocalStoragePath,
  resolveScopedStoragePath,
} from '@eforge-build/extension-sdk';

describe('extension SDK project path helpers', () => {
  it('preserves legacy project-local storage resolution', () => {
    const cwd = resolve('/tmp/project');
    expect(resolveProjectLocalStoragePath({ cwd, segments: ['session-plans'] })).toBe(
      resolve(cwd, '.eforge', 'session-plans'),
    );
  });

  it('resolves scoped roots, storage roots, and extension-owned storage paths', () => {
    const cwd = resolve('/tmp/project');
    const configDir = resolve(cwd, 'eforge-config');
    const paths = createEforgeProjectPaths({ cwd, configDir, extensionName: 'my-extension' });

    expect(paths.cwd).toBe(cwd);
    expect(paths.configDir).toBe(configDir);
    expect(paths.scopeRoot('project-team')).toBe(configDir);
    expect(paths.scopeRoot('project-local')).toBe(resolve(cwd, '.eforge'));
    expect(paths.scopeRoot('user')).toBe(getScopeDirectory('user', { cwd, configDir }));
    expect(paths.storageRoot('project-local')).toBe(resolve(cwd, '.eforge', 'storage'));
    expect(paths.storagePath('project-local', ['cache.json'])).toBe(resolve(cwd, '.eforge', 'storage', 'cache.json'));
    expect(paths.extensionStorageRoot('project-local')).toBe(resolve(cwd, '.eforge', 'storage', 'extensions', 'my-extension'));
    expect(paths.extensionStoragePath('project-local', ['trace.json'])).toBe(resolve(cwd, '.eforge', 'storage', 'extensions', 'my-extension', 'trace.json'));
  });

  it('resolves convenience scoped storage functions', () => {
    const cwd = resolve('/tmp/project');
    const configDir = resolve(cwd, 'eforge-config');
    expect(resolveScopedStoragePath({ cwd, configDir, scope: 'project-team', segments: ['cache.json'] })).toBe(
      resolve(configDir, 'storage', 'cache.json'),
    );
    expect(resolveExtensionStoragePath({ cwd, configDir, scope: 'project-local', extensionName: 'ext', segments: ['trace.json'] })).toBe(
      resolve(cwd, '.eforge', 'storage', 'extensions', 'ext', 'trace.json'),
    );
  });

  it('rejects unsafe storage segments and extension names', () => {
    const paths = createEforgeProjectPaths({ cwd: '/tmp/project', extensionName: 'safe' });
    const unsafe = ['', '.', '..', '../escape', '/tmp/escape', 'session-plans/../../escape', 'session-plans\\escape', 'session-plans\0escape', 'C:\\escape'];
    expect(() => paths.storagePath('project-local', [])).toThrow();
    expect(() => paths.extensionStoragePath('project-local', [])).toThrow();
    expect(() => resolveScopedStoragePath({ cwd: '/tmp/project', scope: 'project-local', segments: [] })).toThrow();
    expect(() => resolveExtensionStoragePath({ cwd: '/tmp/project', scope: 'project-local', extensionName: 'safe', segments: [] })).toThrow();
    for (const segment of unsafe) {
      expect(() => paths.storagePath('project-local', [segment])).toThrow();
      expect(() => paths.extensionStoragePath('project-local', [segment])).toThrow();
      expect(() => paths.extensionStoragePath('project-local', ['ok'], segment)).toThrow();
      expect(() => resolveScopedStoragePath({ cwd: '/tmp/project', scope: 'project-local', segments: [segment] })).toThrow();
      expect(() => resolveExtensionStoragePath({ cwd: '/tmp/project', scope: 'project-local', extensionName: 'safe', segments: [segment] })).toThrow();
    }
  });

  it('does not import filesystem modules from SDK path helper sources', async () => {
    const [storageSource, pathsSource] = await Promise.all([
      readFile('packages/extension-sdk/src/project-storage.ts', 'utf-8'),
      readFile('packages/extension-sdk/src/project-paths.ts', 'utf-8'),
    ]);
    expect(storageSource).not.toMatch(/from ['"]node:fs(?:\/promises)?['"]/);
    expect(pathsSource).not.toMatch(/from ['"]node:fs(?:\/promises)?['"]/);
  });
});
