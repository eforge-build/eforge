import { describe, expect, it, vi } from 'vitest';
import type { ConsoleWorkstationManifestEntry, ExtensionActionInvokeResponse } from '@eforge-build/client/browser';
import {
  buildWorkstationRequestedBy,
  handleWorkstationBridgeEvent,
  type InvokeExtensionActionFn,
} from '../workstation-bridge';

function workstation(overrides: Partial<ConsoleWorkstationManifestEntry> = {}): ConsoleWorkstationManifestEntry {
  return {
    id: 'demo:board',
    localId: 'board',
    extensionName: 'demo',
    extensionPath: '/demo.js',
    title: 'Board',
    schemaVersion: 1,
    srcDoc: '<h1>Board</h1>',
    allowedActions: ['demo:render-board-markdown'],
    ...overrides,
  };
}

function sourceWindow() {
  return { postMessage: vi.fn() } as unknown as Window;
}

function bridgeEvent(source: Window, data: unknown): MessageEvent {
  const event = new MessageEvent('message', { data });
  Object.defineProperty(event, 'source', { value: source });
  return event;
}

function invokeMessage(actionId = 'render-board-markdown', bridgeToken = 'bridge-token') {
  return {
    type: 'eforge:workstation:invoke-action',
    requestId: 'req-1',
    bridgeToken,
    actionId,
    input: {},
  };
}

describe('workstation bridge', () => {
  it('builds Console workstation action provenance', () => {
    expect(buildWorkstationRequestedBy(workstation())).toEqual({
      host: 'console',
      surface: 'workstation:demo:board',
    });
  });

  it('ignores requests from non-selected source windows', async () => {
    const selectedSource = sourceWindow();
    const otherSource = sourceWindow();
    const invokeAction = vi.fn<InvokeExtensionActionFn>();

    await handleWorkstationBridgeEvent({
      event: bridgeEvent(otherSource, invokeMessage()),
      sourceWindow: selectedSource,
      workstation: workstation(),
      bridgeToken: 'bridge-token',
      invokeAction,
    });

    expect(invokeAction).not.toHaveBeenCalled();
  });

  it('rejects cyclic input without invoking the daemon', async () => {
    const source = sourceWindow();
    const invokeAction = vi.fn<InvokeExtensionActionFn>();
    const input: Record<string, unknown> = {};
    input.self = input;

    await handleWorkstationBridgeEvent({
      event: bridgeEvent(source, { ...invokeMessage(), input }),
      sourceWindow: source,
      workstation: workstation(),
      bridgeToken: 'bridge-token',
      invokeAction,
    });

    expect(invokeAction).not.toHaveBeenCalled();
    expect(source.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'req-1',
      error: expect.objectContaining({ code: 'invalid-request' }),
    }), '*');
  });

  it('rejects messages with an invalid bridge token without invoking the daemon', async () => {
    const source = sourceWindow();
    const invokeAction = vi.fn<InvokeExtensionActionFn>();

    await handleWorkstationBridgeEvent({
      event: bridgeEvent(source, invokeMessage('render-board-markdown', 'wrong-token')),
      sourceWindow: source,
      workstation: workstation(),
      bridgeToken: 'bridge-token',
      invokeAction,
    });

    expect(invokeAction).not.toHaveBeenCalled();
    expect(source.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'req-1',
      error: expect.objectContaining({ code: 'invalid-request' }),
    }), '*');
  });

  it('rejects disallowed actions without invoking the daemon', async () => {
    const source = sourceWindow();
    const invokeAction = vi.fn<InvokeExtensionActionFn>();

    await handleWorkstationBridgeEvent({
      event: bridgeEvent(source, invokeMessage('not-allowed')),
      sourceWindow: source,
      workstation: workstation(),
      bridgeToken: 'bridge-token',
      invokeAction,
    });

    expect(invokeAction).not.toHaveBeenCalled();
    expect(source.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'req-1',
      error: expect.objectContaining({ code: 'disallowed-action' }),
    }), '*');
  });

  it('invokes allowed local action ids as effective ids with provenance', async () => {
    const source = sourceWindow();
    const response: ExtensionActionInvokeResponse = { ok: true, invocationId: 'inv-1', output: { ok: true } };
    const invokeAction = vi.fn<InvokeExtensionActionFn>().mockResolvedValue(response);

    await handleWorkstationBridgeEvent({
      event: bridgeEvent(source, invokeMessage('render-board-markdown')),
      sourceWindow: source,
      workstation: workstation(),
      bridgeToken: 'bridge-token',
      invokeAction,
    });

    expect(invokeAction).toHaveBeenCalledWith({
      actionId: 'demo:render-board-markdown',
      input: {},
      requestedBy: { host: 'console', surface: 'workstation:demo:board' },
    });
  });

  it('invokes allowed effective action ids as-is', async () => {
    const source = sourceWindow();
    const invokeAction = vi.fn<InvokeExtensionActionFn>().mockResolvedValue({ ok: true, invocationId: 'inv-2', output: null });

    await handleWorkstationBridgeEvent({
      event: bridgeEvent(source, invokeMessage('demo:render-board-markdown')),
      sourceWindow: source,
      workstation: workstation(),
      bridgeToken: 'bridge-token',
      invokeAction,
    });

    expect(invokeAction.mock.calls[0][0].actionId).toBe('demo:render-board-markdown');
  });

  it('posts daemon success responses with the original requestId', async () => {
    const source = sourceWindow();
    const response: ExtensionActionInvokeResponse = { ok: true, invocationId: 'inv-ok', output: { value: 1 } };
    const invokeAction = vi.fn<InvokeExtensionActionFn>().mockResolvedValue(response);

    await handleWorkstationBridgeEvent({
      event: bridgeEvent(source, invokeMessage()),
      sourceWindow: source,
      workstation: workstation(),
      bridgeToken: 'bridge-token',
      invokeAction,
    });

    expect(source.postMessage).toHaveBeenCalledWith({
      type: 'eforge:workstation:action-result',
      requestId: 'req-1',
      response,
    }, '*');
  });

  it('posts daemon failure responses with the original requestId', async () => {
    const source = sourceWindow();
    const response: ExtensionActionInvokeResponse = { ok: false, invocationId: 'inv-fail', error: { code: 'handler-error', message: 'nope' } };
    const invokeAction = vi.fn<InvokeExtensionActionFn>().mockResolvedValue(response);

    await handleWorkstationBridgeEvent({
      event: bridgeEvent(source, invokeMessage()),
      sourceWindow: source,
      workstation: workstation(),
      bridgeToken: 'bridge-token',
      invokeAction,
    });

    expect(source.postMessage).toHaveBeenCalledWith({
      type: 'eforge:workstation:action-result',
      requestId: 'req-1',
      response,
    }, '*');
  });

  it('posts bridge errors when invocation rejects', async () => {
    const source = sourceWindow();
    const invokeAction = vi.fn<InvokeExtensionActionFn>().mockRejectedValue(new Error('network down'));

    await handleWorkstationBridgeEvent({
      event: bridgeEvent(source, invokeMessage()),
      sourceWindow: source,
      workstation: workstation(),
      bridgeToken: 'bridge-token',
      invokeAction,
    });

    expect(source.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'req-1',
      error: { code: 'bridge-error', message: 'network down' },
    }), '*');
  });
});
