export const EFORGE_WORKSTATION_BROWSER_SDK_VERSION = 1 as const;

export type EforgeWorkstationBrowserSdkVersion = typeof EFORGE_WORKSTATION_BROWSER_SDK_VERSION;

export interface EforgeConsoleBridge {
  version: number;
  invokeAction<TOutput = unknown>(actionId: string, input?: Record<string, unknown>): Promise<TOutput>;
}

export interface GetEforgeConsoleBridgeOptions {
  minVersion?: EforgeWorkstationBrowserSdkVersion;
}

export interface AssertEforgeConsoleBridgeVersionOptions {
  bridge?: EforgeConsoleBridge;
}

declare global {
  interface Window {
    eforge?: EforgeConsoleBridge;
  }
}

export function assertEforgeConsoleBridgeVersion(
  expectedVersion?: EforgeWorkstationBrowserSdkVersion,
  options?: AssertEforgeConsoleBridgeVersionOptions,
): EforgeConsoleBridge;
export function assertEforgeConsoleBridgeVersion(
  bridge: EforgeConsoleBridge | undefined,
  expectedVersion?: EforgeWorkstationBrowserSdkVersion,
): EforgeConsoleBridge;
export function assertEforgeConsoleBridgeVersion(
  expectedVersionOrBridge?: EforgeWorkstationBrowserSdkVersion | EforgeConsoleBridge,
  optionsOrExpectedVersion: AssertEforgeConsoleBridgeVersionOptions | EforgeWorkstationBrowserSdkVersion = {},
): EforgeConsoleBridge {
  const { bridge, expectedVersion } = normalizeAssertBridgeVersionArgs(expectedVersionOrBridge, optionsOrExpectedVersion);
  if (!bridge) {
    throw new Error('Eforge Console bridge is unavailable: window.eforge is missing.');
  }
  if (!Number.isFinite(bridge.version)) {
    throw new Error('Eforge Console bridge is invalid: window.eforge.version must be a finite number.');
  }
  if (typeof bridge.invokeAction !== 'function') {
    throw new Error('Eforge Console bridge is invalid: window.eforge.invokeAction must be a function.');
  }
  if (bridge.version < expectedVersion) {
    throw new Error(
      `Eforge Console bridge version ${bridge.version} is below the required minimum version ${expectedVersion}.`,
    );
  }
  return bridge;
}

export function getEforgeConsoleBridge(options: GetEforgeConsoleBridgeOptions = {}): EforgeConsoleBridge {
  return assertEforgeConsoleBridgeVersion(options.minVersion ?? EFORGE_WORKSTATION_BROWSER_SDK_VERSION);
}

export function invokeAction<TOutput = unknown>(
  actionId: string,
  input: Record<string, unknown> = {},
): Promise<TOutput> {
  return getEforgeConsoleBridge().invokeAction<TOutput>(actionId, input);
}

function normalizeAssertBridgeVersionArgs(
  expectedVersionOrBridge: EforgeWorkstationBrowserSdkVersion | EforgeConsoleBridge | undefined,
  optionsOrExpectedVersion: AssertEforgeConsoleBridgeVersionOptions | EforgeWorkstationBrowserSdkVersion,
): { bridge: EforgeConsoleBridge | undefined; expectedVersion: EforgeWorkstationBrowserSdkVersion } {
  if (typeof expectedVersionOrBridge === 'number') {
    return {
      bridge: typeof optionsOrExpectedVersion === 'object' ? optionsOrExpectedVersion.bridge ?? getWindowEforgeBridge() : getWindowEforgeBridge(),
      expectedVersion: expectedVersionOrBridge,
    };
  }
  return {
    bridge: expectedVersionOrBridge ?? getWindowEforgeBridge(),
    expectedVersion: typeof optionsOrExpectedVersion === 'number' ? optionsOrExpectedVersion : EFORGE_WORKSTATION_BROWSER_SDK_VERSION,
  };
}

function getWindowEforgeBridge(): EforgeConsoleBridge | undefined {
  return globalThis.window?.eforge;
}
