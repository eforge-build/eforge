export interface ControlMonitorRuntime {
  getOnKeepAlive(): (() => void) | null;
  setOnKeepAlive(cb: (() => void) | null): void;
  notifyKeepAlive(): void;
}

export function createControlMonitorRuntime(): ControlMonitorRuntime {
  let onKeepAlive: (() => void) | null = null;
  return {
    getOnKeepAlive: () => onKeepAlive,
    setOnKeepAlive(cb) { onKeepAlive = cb; },
    notifyKeepAlive() { onKeepAlive?.(); },
  };
}
