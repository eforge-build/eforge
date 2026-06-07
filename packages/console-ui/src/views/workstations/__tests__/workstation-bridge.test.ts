import { describe, expect, it, vi } from 'vitest';
import type { ExtensionActionInvokeResponse } from '@eforge-build/client/browser';
import type { FrameBundleWorkstationManifestEntry, SrcDocWorkstationManifestEntry } from '../workstation-manifest-mode';
import {
  buildWorkstationRequestedBy,
  buildWorkstationRouteMessage,
  handleWorkstationBridgeEvent,
  validateWorkstationNavigateMessage,
  type InvokeExtensionActionFn,
} from '../workstation-bridge';

const assetId = 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-path-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function srcDocWorkstation(overrides: Partial<SrcDocWorkstationManifestEntry> = {}): SrcDocWorkstationManifestEntry {
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

function frameBundleWorkstation(overrides: Partial<FrameBundleWorkstationManifestEntry> = {}): FrameBundleWorkstationManifestEntry {
  return {
    id: 'bundle:board',
    localId: 'board',
    extensionName: 'bundle',
    extensionPath: '/bundle.js',
    title: 'Bundle Board',
    schemaVersion: 1,
    frameBundle: {
      browserSdkVersion: 1,
      frameUrl: '/api/extensions/workstations/bundle%3Aboard/frame',
      entrypoint: {
        id: assetId,
        url: `/api/extensions/workstations/bundle%3Aboard/assets/${assetId}`,
        relativePath: 'dist/index.js',
        sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      styles: [],
      assets: [],
    },
    allowedActions: ['bundle:render-board-markdown'],
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
    expect(buildWorkstationRequestedBy(srcDocWorkstation())).toEqual({
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
      workstation: srcDocWorkstation(),
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
      workstation: srcDocWorkstation(),
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
      workstation: srcDocWorkstation(),
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
      workstation: srcDocWorkstation(),
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
      workstation: srcDocWorkstation(),
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
      workstation: srcDocWorkstation(),
      bridgeToken: 'bridge-token',
      invokeAction,
    });

    expect(invokeAction.mock.calls[0][0].actionId).toBe('demo:render-board-markdown');
  });

  it('invokes allowed actions from frameBundle workstations with the same provenance semantics', async () => {
    const source = sourceWindow();
    const response: ExtensionActionInvokeResponse = { ok: true, invocationId: 'inv-bundle', output: { ok: true } };
    const invokeAction = vi.fn<InvokeExtensionActionFn>().mockResolvedValue(response);

    await handleWorkstationBridgeEvent({
      event: bridgeEvent(source, invokeMessage('render-board-markdown')),
      sourceWindow: source,
      workstation: frameBundleWorkstation(),
      bridgeToken: 'bridge-token',
      invokeAction,
    });

    expect(invokeAction).toHaveBeenCalledWith({
      actionId: 'bundle:render-board-markdown',
      input: {},
      requestedBy: { host: 'console', surface: 'workstation:bundle:board' },
    });
  });

  it('rejects disallowed frameBundle workstation actions without invoking the daemon', async () => {
    const source = sourceWindow();
    const invokeAction = vi.fn<InvokeExtensionActionFn>();

    await handleWorkstationBridgeEvent({
      event: bridgeEvent(source, invokeMessage('not-allowed')),
      sourceWindow: source,
      workstation: frameBundleWorkstation(),
      bridgeToken: 'bridge-token',
      invokeAction,
    });

    expect(invokeAction).not.toHaveBeenCalled();
    expect(source.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'req-1',
      error: expect.objectContaining({ code: 'disallowed-action' }),
    }), '*');
  });

  it('posts daemon success responses with the original requestId', async () => {
    const source = sourceWindow();
    const response: ExtensionActionInvokeResponse = { ok: true, invocationId: 'inv-ok', output: { value: 1 } };
    const invokeAction = vi.fn<InvokeExtensionActionFn>().mockResolvedValue(response);

    await handleWorkstationBridgeEvent({
      event: bridgeEvent(source, invokeMessage()),
      sourceWindow: source,
      workstation: srcDocWorkstation(),
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
      workstation: srcDocWorkstation(),
      bridgeToken: 'bridge-token',
      invokeAction,
    });

    expect(source.postMessage).toHaveBeenCalledWith({
      type: 'eforge:workstation:action-result',
      requestId: 'req-1',
      response,
    }, '*');
  });

  it('routes child navigate messages to onNavigate without invoking the daemon', async () => {
    const source = sourceWindow();
    const invokeAction = vi.fn<InvokeExtensionActionFn>();
    const onNavigate = vi.fn();

    const result = await handleWorkstationBridgeEvent({
      event: bridgeEvent(source, { type: 'eforge:workstation:navigate', bridgeToken: 'bridge-token', path: 'backlog?group=epic' }),
      sourceWindow: source,
      workstation: frameBundleWorkstation(),
      bridgeToken: 'bridge-token',
      invokeAction,
      onNavigate,
    });

    expect(result).toBe('navigated');
    expect(onNavigate).toHaveBeenCalledWith('backlog?group=epic');
    expect(invokeAction).not.toHaveBeenCalled();
    expect(source.postMessage).not.toHaveBeenCalled();
  });

  it('ignores navigate messages carrying the wrong bridge token', async () => {
    const source = sourceWindow();
    const onNavigate = vi.fn();

    const result = await handleWorkstationBridgeEvent({
      event: bridgeEvent(source, { type: 'eforge:workstation:navigate', bridgeToken: 'wrong', path: 'backlog' }),
      sourceWindow: source,
      workstation: frameBundleWorkstation(),
      bridgeToken: 'bridge-token',
      invokeAction: vi.fn<InvokeExtensionActionFn>(),
      onNavigate,
    });

    // Falls through to invoke-action validation, which rejects the malformed message.
    expect(result).toBe('posted-error');
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('validates and builds route-sync messages', () => {
    expect(validateWorkstationNavigateMessage({ type: 'eforge:workstation:navigate', bridgeToken: 't', path: 'plans' }, 't')).toEqual({ ok: true, path: 'plans' });
    expect(validateWorkstationNavigateMessage({ type: 'eforge:workstation:navigate', bridgeToken: 'x', path: 'plans' }, 't')).toEqual({ ok: false });
    expect(validateWorkstationNavigateMessage({ type: 'other' }, 't')).toEqual({ ok: false });
    expect(buildWorkstationRouteMessage('t', 'backlog')).toEqual({ type: 'eforge:workstation:route', bridgeToken: 't', path: 'backlog' });
  });

  it('posts bridge errors when invocation rejects', async () => {
    const source = sourceWindow();
    const invokeAction = vi.fn<InvokeExtensionActionFn>().mockRejectedValue(new Error('network down'));

    await handleWorkstationBridgeEvent({
      event: bridgeEvent(source, invokeMessage()),
      sourceWindow: source,
      workstation: srcDocWorkstation(),
      bridgeToken: 'bridge-token',
      invokeAction,
    });

    expect(source.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'req-1',
      error: { code: 'bridge-error', message: 'network down' },
    }), '*');
  });
});
