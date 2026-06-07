import { describe, expect, it, vi } from 'vitest';
import { navigateWorkstation, onWorkstationRoute, readWorkstationBridgeContext } from '@eforge-build/client/browser';

describe('readWorkstationBridgeContext', () => {
  it('parses the bridge token and initial path from a hash', () => {
    expect(readWorkstationBridgeContext('#bridgeToken=tok&path=backlog%3Fgroup%3Depic')).toEqual({
      bridgeToken: 'tok',
      initialPath: 'backlog?group=epic',
    });
  });

  it('omits absent fields', () => {
    expect(readWorkstationBridgeContext('#bridgeToken=tok')).toEqual({ bridgeToken: 'tok' });
    expect(readWorkstationBridgeContext('')).toEqual({});
  });
});

describe('navigateWorkstation', () => {
  it('posts a navigate message to the target window with the bridge token', () => {
    const target = { postMessage: vi.fn() } as unknown as Window;
    navigateWorkstation('plans/plan:x', { bridgeToken: 'tok', targetWindow: target });
    expect(target.postMessage).toHaveBeenCalledWith(
      { type: 'eforge:workstation:navigate', bridgeToken: 'tok', path: 'plans/plan:x' },
      '*',
    );
  });

  it('does nothing without a bridge token', () => {
    const target = { postMessage: vi.fn() } as unknown as Window;
    navigateWorkstation('plans', { targetWindow: target });
    expect(target.postMessage).not.toHaveBeenCalled();
  });
});

describe('onWorkstationRoute', () => {
  it('invokes the callback for matching route messages and ignores the rest', () => {
    const callback = vi.fn();
    const unsubscribe = onWorkstationRoute(callback, { bridgeToken: 'tok' });

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'eforge:workstation:route', bridgeToken: 'tok', path: 'backlog' } }));
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'eforge:workstation:route', bridgeToken: 'other', path: 'plans' } }));
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'eforge:workstation:navigate', bridgeToken: 'tok', path: 'plans' } }));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('backlog');
    unsubscribe();
  });
});
