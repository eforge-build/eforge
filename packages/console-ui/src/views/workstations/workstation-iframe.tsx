import * as React from 'react';
import { invokeExtensionAction, type ConsoleWorkstationManifestEntry } from '@eforge-build/client/browser';
import { buildWorkstationSrcDoc } from './workstation-srcdoc';
import { handleWorkstationBridgeEvent } from './workstation-bridge';
import { buildWorkstationFrameUrl } from './workstation-frame-url';
import { isFrameBundleWorkstation } from './workstation-manifest-mode';

interface WorkstationIframeProps {
  workstation: ConsoleWorkstationManifestEntry;
}

type WorkstationRenderSource =
  | { mode: 'srcDoc'; value: string }
  | { mode: 'frameBundle'; value: string };

type LoadedWorkstationSource = WorkstationRenderSource & { workstationId: string };

function createBridgeToken(): string {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return `bridge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function WorkstationIframe({ workstation }: WorkstationIframeProps) {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const bridgeToken = React.useMemo(createBridgeToken, [workstation.id]);
  const renderSource = React.useMemo<WorkstationRenderSource>(() => {
    if (isFrameBundleWorkstation(workstation)) {
      return { mode: 'frameBundle', value: buildWorkstationFrameUrl(workstation.frameBundle.frameUrl, bridgeToken) };
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
      });
    };
    window.addEventListener('message', handleMessage);
    setLoadedSource({ workstationId: workstation.id, ...renderSource });
    return () => window.removeEventListener('message', handleMessage);
  }, [workstation, bridgeToken, renderSource]);

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
