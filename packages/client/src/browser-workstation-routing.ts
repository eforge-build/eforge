// Child-side (embedded workstation) helpers for syncing the workstation's
// internal route with the Console host over the postMessage bridge.
//
// The workstation runs in a cross-origin sandboxed iframe (opaque origin), so it
// cannot share the host's History/URL. The host owns the canonical URL; the
// workstation seeds its router from the initial path delivered in the frame-URL
// hash, reports its own navigation up with `navigateWorkstation`, and follows
// host back/forward via `onWorkstationRoute`.

const NAVIGATE_MESSAGE_TYPE = 'eforge:workstation:navigate';
const ROUTE_MESSAGE_TYPE = 'eforge:workstation:route';

export interface WorkstationBridgeContext {
  bridgeToken?: string;
  /** Internal route to seed the workstation router with (nested path plus ?query). */
  initialPath?: string;
}

/** Parse the bridge token and initial route from the frame-URL hash. */
export function readWorkstationBridgeContext(hash?: string): WorkstationBridgeContext {
  const source = hash ?? (typeof window !== 'undefined' ? window.location.hash : '');
  const raw = source.startsWith('#') ? source.slice(1) : source;
  const params = new URLSearchParams(raw);
  const bridgeToken = params.get('bridgeToken') ?? undefined;
  const initialPath = params.get('path') ?? undefined;
  return {
    ...(bridgeToken ? { bridgeToken } : {}),
    ...(initialPath ? { initialPath } : {}),
  };
}

/** Report an internal navigation to the host so it can update the address bar. */
export function navigateWorkstation(path: string, options?: { bridgeToken?: string; targetWindow?: Window }): void {
  if (typeof window === 'undefined') return;
  const bridgeToken = options?.bridgeToken ?? readWorkstationBridgeContext().bridgeToken;
  if (!bridgeToken) return;
  const target = options?.targetWindow ?? window.parent;
  target?.postMessage({ type: NAVIGATE_MESSAGE_TYPE, bridgeToken, path }, '*');
}

/** Subscribe to host-driven route changes (back/forward, deep links). */
export function onWorkstationRoute(callback: (path: string) => void, options?: { bridgeToken?: string }): () => void {
  if (typeof window === 'undefined') return () => {};
  const bridgeToken = options?.bridgeToken ?? readWorkstationBridgeContext().bridgeToken;
  const listener = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; bridgeToken?: unknown; path?: unknown } | null;
    if (!data || typeof data !== 'object' || data.type !== ROUTE_MESSAGE_TYPE) return;
    if (bridgeToken && data.bridgeToken !== bridgeToken) return;
    if (typeof data.path !== 'string') return;
    callback(data.path);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
