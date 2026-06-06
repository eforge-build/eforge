import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { buildWorkstationSrcDoc, workstationHelperScriptForTest } from '../workstation-srcdoc';

describe('workstation srcDoc bootstrap', () => {
  it('injects a window.eforge helper with invokeAction', () => {
    const srcDoc = buildWorkstationSrcDoc('<main>hello</main>', 'bridge-token');

    expect(srcDoc).toContain('window.eforge');
    expect(srcDoc).toContain('invokeAction');
    expect(srcDoc).toContain('eforge:workstation:invoke-action');
  });

  it('injects before extension-authored inline scripts when present', () => {
    const srcDoc = buildWorkstationSrcDoc('<html><body><script>window.eforge.invokeAction("ready")</script></body></html>', 'bridge-token');

    expect(srcDoc.indexOf('window.eforge = Object.freeze')).toBeLessThan(srcDoc.indexOf('window.eforge.invokeAction("ready")'));
  });

  it('installs the helper before inline scripts execute during parsing', () => {
    const srcDoc = buildWorkstationSrcDoc(`<!doctype html><html><body><script>
      window.inlineEforgeType = typeof window.eforge;
      window.eforge.invokeAction('ready', {});
    </script></body></html>`, 'bridge-token');
    const dom = new JSDOM(srcDoc, { runScripts: 'dangerously', url: 'https://workstation.test/' });

    expect((dom.window as Window & { inlineEforgeType?: string }).inlineEforgeType).toBe('object');
  });

  it('posts invoke messages and resolves bridge results', async () => {
    const listeners: Array<(event: MessageEvent) => void> = [];
    const posted: unknown[] = [];
    const fakeWindow = {
      crypto: { randomUUID: () => 'req-1' },
      parent: { postMessage: (message: unknown) => posted.push(message) },
      addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.push(listener),
      eforge: undefined,
    };

    vi.stubGlobal('window', fakeWindow);
    try {
      Function(workstationHelperScriptForTest())();
      const promise = fakeWindow.eforge.invokeAction('render-board-markdown', {});

      expect(posted[0]).toEqual({
        type: 'eforge:workstation:invoke-action',
        requestId: 'req-1',
        actionId: 'render-board-markdown',
        bridgeToken: 'test-token',
        input: {},
      });

      listeners[0](new MessageEvent('message', {
        data: {
          type: 'eforge:workstation:action-result',
          requestId: 'req-1',
          response: { ok: true, invocationId: 'inv-1', output: { markdown: '# hi' } },
        },
      }));

      await expect(promise).resolves.toEqual({ markdown: '# hi' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects helper promises when bridge results carry errors', async () => {
    const listeners: Array<(event: MessageEvent) => void> = [];
    const fakeWindow = {
      crypto: { randomUUID: () => 'req-2' },
      parent: { postMessage: vi.fn() },
      addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.push(listener),
      eforge: undefined,
    };

    vi.stubGlobal('window', fakeWindow);
    try {
      Function(workstationHelperScriptForTest())();
      const promise = fakeWindow.eforge.invokeAction('render-board-markdown', {});
      listeners[0](new MessageEvent('message', {
        data: {
          type: 'eforge:workstation:action-result',
          requestId: 'req-2',
          error: { code: 'bridge-error', message: 'boom' },
        },
      }));

      await expect(promise).rejects.toThrow('boom');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
