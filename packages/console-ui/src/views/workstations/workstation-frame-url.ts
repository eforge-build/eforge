export function buildWorkstationFrameUrl(frameUrl: string, bridgeToken: string, initialPath?: string): string {
  const [baseUrl] = frameUrl.split('#', 1);
  const params = [`bridgeToken=${encodeURIComponent(bridgeToken)}`];
  // The initial internal route is delivered once in the hash so deep-links and
  // reloads land on the right view. Later navigation syncs over postMessage.
  if (initialPath) params.push(`path=${encodeURIComponent(initialPath)}`);
  return `${baseUrl}#${params.join('&')}`;
}
