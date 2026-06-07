import * as React from 'react';
import { invokeExtensionAction, type ConsoleWorkstationManifestEntry } from '@eforge-build/client/browser';
import { buildWorkstationSrcDoc } from './workstation-srcdoc';
import { buildWorkstationRouteMessage, handleWorkstationBridgeEvent } from './workstation-bridge';
import { buildWorkstationFrameUrl } from './workstation-frame-url';
import { isFrameBundleWorkstation } from './workstation-manifest-mode';

interface WorkstationIframeProps {
  workstation: ConsoleWorkstationManifestEntry;
  /** Current internal route the host owns (nested path plus optional ?query). */
  subPath?: string;
  /** Called when the embedded workstation navigates its own router. */
  onNavigate?: (subPath: string) => void;
}

type WorkstationRenderSource =
  | { mode: 'srcDoc'; value: string }
  | { mode: 'frameBundle'; value: string };

type LoadedWorkstationSource = WorkstationRenderSource & { workstationId: string };

function createBridgeToken(): string {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return `bridge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function WorkstationIframe({ workstation, subPath, onNavigate }: WorkstationIframeProps) {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const bridgeToken = React.useMemo(createBridgeToken, [workstation.id]);

  // Capture the initial route once per workstation so it seeds the frame URL
  // hash without folding later route changes into `src` (which would reload the
  // iframe and wipe its state). Reset only when the mounted workstation changes.
  const initialSubPathRef = React.useRef(subPath);
  const mountedWorkstationId = React.useRef(workstation.id);
  if (mountedWorkstationId.current !== workstation.id) {
    mountedWorkstationId.current = workstation.id;
    initialSubPathRef.current = subPath;
  }

  // Tracks the last path the child reported so the host->child sync can skip
  // echoing it straight back and avoid a navigation ping-pong.
  const childOriginatedPath = React.useRef<string | null>(null);

  // Hold the latest callback in a ref so the bridge listener effect does not
  // depend on its identity (which changes every render).
  const onNavigateRef = React.useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const renderSource = React.useMemo<WorkstationRenderSource>(() => {
    if (isFrameBundleWorkstation(workstation)) {
      return { mode: 'frameBundle', value: buildWorkstationFrameUrl(workstation.frameBundle.frameUrl, bridgeToken, initialSubPathRef.current) };
    }
    return { mode: 'srcDoc', value: buildWorkstationSrcDoc(workstation.srcDoc, bridgeToken) };
  }, [workstation, bridgeToken]);
  const [loadedSource, setLoadedSource] = React.useState<LoadedWorkstationSource | null>(null);

  React.useLayoutEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      void handleWorkstationBridgeEvent({
        event,
        sourceWindow: iframeRef.current?.contentWindow ?? null,
        workstation,
        bridgeToken,
        invokeAction: invokeExtensionAction,
        onNavigate: (path) => {
          childOriginatedPath.current = path;
          onNavigateRef.current?.(path);
        },
      });
    };
    window.addEventListener('message', handleMessage);
    setLoadedSource({ workstationId: workstation.id, ...renderSource });
    return () => window.removeEventListener('message', handleMessage);
  }, [workstation, bridgeToken, renderSource]);

  // Push host-driven route changes (back/forward, external links) down to the
  // child, except when the change merely echoes what the child just reported.
  React.useEffect(() => {
    const current = subPath ?? '';
    if (childOriginatedPath.current === current) {
      childOriginatedPath.current = null;
      return;
    }
    iframeRef.current?.contentWindow?.postMessage(buildWorkstationRouteMessage(bridgeToken, current), '*');
  }, [subPath, bridgeToken]);

  const loadedMatchesCurrent = loadedSource?.workstationId === workstation.id
    && loadedSource.mode === renderSource.mode
    && loadedSource.value === renderSource.value;
  const iframeSrcDoc = loadedMatchesCurrent && loadedSource.mode === 'srcDoc' ? loadedSource.value : undefined;
  const iframeSrc = loadedMatchesCurrent && loadedSource.mode === 'frameBundle' ? loadedSource.value : undefined;

  return (
    <iframe
      key={`${workstation.id}:${renderSource.mode}`}
      ref={iframeRef}
      title={`${workstation.title} workstation`}
      data-testid="workstation-iframe"
      className="h-full min-h-[480px] w-full rounded-md border bg-background"
      sandbox="allow-scripts"
      srcDoc={iframeSrcDoc}
      src={iframeSrc}
    />
  );
}
