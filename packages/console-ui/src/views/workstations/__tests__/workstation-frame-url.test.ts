import { describe, expect, it } from 'vitest';
import { buildWorkstationFrameUrl } from '../workstation-frame-url';

describe('buildWorkstationFrameUrl', () => {
  it('appends an encoded bridge token fragment', () => {
    expect(buildWorkstationFrameUrl('/frame', 'token one')).toBe('/frame#bridgeToken=token%20one');
  });

  it('preserves query text and keeps bridgeToken out of the query', () => {
    const frameUrl = buildWorkstationFrameUrl('/frame?tab=one&mode=debug', 'token one');
    const parsed = new URL(frameUrl, 'https://console.test');

    expect(parsed.search).toBe('?tab=one&mode=debug');
    expect(parsed.searchParams.has('bridgeToken')).toBe(false);
    expect(parsed.hash).toBe('#bridgeToken=token%20one');
  });

  it('replaces any existing fragment', () => {
    expect(buildWorkstationFrameUrl('/frame?x=1#old=value', 'new-token')).toBe('/frame?x=1#bridgeToken=new-token');
  });

  it('encodes URL delimiter characters in tokens', () => {
    const token = 'a?b&c=d#e f';
    expect(buildWorkstationFrameUrl('/frame', token)).toBe(`/frame#bridgeToken=${encodeURIComponent(token)}`);
  });

  it('appends an encoded initial path after the bridge token', () => {
    expect(buildWorkstationFrameUrl('/frame', 'tok', 'backlog?group=epic')).toBe('/frame#bridgeToken=tok&path=backlog%3Fgroup%3Depic');
  });

  it('omits the path fragment when no initial path is supplied', () => {
    expect(buildWorkstationFrameUrl('/frame', 'tok', '')).toBe('/frame#bridgeToken=tok');
  });
});
