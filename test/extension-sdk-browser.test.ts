import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CONSOLE_WORKSTATION_BROWSER_SDK_VERSION,
} from '@eforge-build/client/browser';
import * as rootSdk from '@eforge-build/extension-sdk';
import {
  EFORGE_WORKSTATION_BROWSER_SDK_VERSION,
  getEforgeConsoleBridge,
  invokeAction,
  type EforgeConsoleBridge,
} from '@eforge-build/extension-sdk/browser';

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

afterEach(() => {
  vi.restoreAllMocks();
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    delete (globalThis as { window?: unknown }).window;
  }
});

function installBridge(bridge: unknown): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { eforge: bridge },
  });
}

describe('@eforge-build/extension-sdk/browser', () => {
  it('throws a deterministic error when window.eforge is missing', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {},
    });

    expect(() => getEforgeConsoleBridge()).toThrow('window.eforge is missing');
  });

  it('throws a deterministic error for malformed bridge shapes', () => {
    installBridge({ version: '1', invokeAction: vi.fn() });
    expect(() => getEforgeConsoleBridge()).toThrow('window.eforge.version must be a finite number');

    installBridge({ version: NaN, invokeAction: vi.fn() });
    expect(() => getEforgeConsoleBridge()).toThrow('window.eforge.version must be a finite number');

    installBridge({ version: Infinity, invokeAction: vi.fn() });
    expect(() => getEforgeConsoleBridge()).toThrow('window.eforge.version must be a finite number');

    installBridge({ version: 1, invokeAction: 'not-a-function' });
    expect(() => getEforgeConsoleBridge()).toThrow('window.eforge.invokeAction must be a function');
  });

  it('throws a deterministic error for incompatible bridge versions', () => {
    installBridge({ version: 0, invokeAction: vi.fn() });

    expect(() => getEforgeConsoleBridge({ minVersion: 1 })).toThrow(
      'Eforge Console bridge version 0 is below the required minimum version 1.',
    );
  });

  it('returns a v1 bridge with a function-valued invokeAction', () => {
    const bridge: EforgeConsoleBridge = { version: 1, invokeAction: vi.fn() };
    installBridge(bridge);

    expect(getEforgeConsoleBridge({ minVersion: 1 })).toBe(bridge);
  });

  it('normalizes omitted action input to an empty object', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    installBridge({ version: 1, invokeAction: invoke });

    await expect(invokeAction('say-hi')).resolves.toEqual({ ok: true });

    expect(invoke).toHaveBeenCalledWith('say-hi', {});
  });

  it('forwards explicit action input by identity', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const input = { name: 'Ada' };
    installBridge({ version: 1, invokeAction: invoke });

    await invokeAction('say-hi', input);

    expect(invoke).toHaveBeenCalledWith('say-hi', input);
  });

  it('keeps the SDK version constant aligned with the client manifest contract', () => {
    expect(EFORGE_WORKSTATION_BROWSER_SDK_VERSION).toBe(CONSOLE_WORKSTATION_BROWSER_SDK_VERSION);
  });

  it('keeps browser runtime helpers out of the package root', () => {
    const rootRuntime = rootSdk as Record<string, unknown>;

    expect(rootRuntime.getEforgeConsoleBridge).toBeUndefined();
    expect(rootRuntime.assertEforgeConsoleBridgeVersion).toBeUndefined();
    expect(rootRuntime.invokeAction).toBeUndefined();
    expect(rootRuntime.EFORGE_WORKSTATION_BROWSER_SDK_VERSION).toBeUndefined();
  });

  it('declares the browser subpath in package exports and tsup entrypoints', () => {
    const packageJson = JSON.parse(readFileSync(resolve('packages/extension-sdk/package.json'), 'utf8')) as {
      exports?: Record<string, { types?: string; import?: string }>;
    };
    const tsupSource = readFileSync(resolve('packages/extension-sdk/tsup.config.ts'), 'utf8');

    expect(packageJson.exports?.['./browser']).toEqual({
      types: './dist/browser.d.ts',
      import: './dist/browser.js',
    });
    expect(tsupSource).toContain('src/browser.ts');
  });

  it('keeps the browser entrypoint free of forbidden runtime imports', () => {
    const source = readFileSync(resolve('packages/extension-sdk/src/browser.ts'), 'utf8');
    const importOrExportFromLines = source
      .split('\n')
      .filter((line) => /^\s*(?:import\b|export\s+.+\s+from\s+)/.test(line));
    const forbidden = [
      'node:',
      '@sinclair/typebox',
      './schema',
      './api',
      './context',
      './project-paths',
      '@eforge-build/client',
      'packages/console-ui',
      '@eforge-build/console-ui',
    ];

    expect(importOrExportFromLines).toEqual([]);
    for (const line of importOrExportFromLines) {
      for (const token of forbidden) {
        expect(line).not.toContain(token);
      }
    }
  });
});
