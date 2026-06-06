export function buildWorkstationFrameUrl(frameUrl: string, bridgeToken: string): string {
  const [baseUrl] = frameUrl.split('#', 1);
  return `${baseUrl}#bridgeToken=${encodeURIComponent(bridgeToken)}`;
}
