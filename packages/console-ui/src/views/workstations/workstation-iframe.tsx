import * as React from 'react';
import { invokeExtensionAction, type ConsoleWorkstationManifestEntry } from '@eforge-build/client/browser';
import { buildWorkstationSrcDoc } from './workstation-srcdoc';
import { handleWorkstationBridgeEvent } from './workstation-bridge';

interface WorkstationIframeProps {
  workstation: ConsoleWorkstationManifestEntry;
}

function createBridgeToken(): string {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return `bridge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function WorkstationIframe({ workstation }: WorkstationIframeProps) {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const bridgeToken = React.useMemo(createBridgeToken, [workstation.id]);
  const workstationSrcDoc = 'srcDoc' in workstation ? workstation.srcDoc : '';
  const srcDoc = React.useMemo(() => buildWorkstationSrcDoc(workstationSrcDoc, bridgeToken), [workstationSrcDoc, bridgeToken]);
  const [loadedSrcDoc, setLoadedSrcDoc] = React.useState<{ workstationId: string; srcDoc: string } | null>(null);

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
    setLoadedSrcDoc({ workstationId: workstation.id, srcDoc });
    return () => window.removeEventListener('message', handleMessage);
  }, [workstation, bridgeToken, srcDoc]);

  const iframeSrcDoc = loadedSrcDoc?.workstationId === workstation.id && loadedSrcDoc.srcDoc === srcDoc
    ? loadedSrcDoc.srcDoc
    : undefined;

  return (
    <iframe
      key={workstation.id}
      ref={iframeRef}
      title={`${workstation.title} workstation`}
      data-testid="workstation-iframe"
      className="h-full min-h-[480px] w-full rounded-md border bg-background"
      sandbox="allow-scripts"
      srcDoc={iframeSrcDoc}
    />
  );
}
