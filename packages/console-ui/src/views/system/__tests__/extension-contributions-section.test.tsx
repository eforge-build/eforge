// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExtensionContributionsSection } from '../extension-contributions-section';
import {
  sanitizeContributionHref,
  statusToneToBadgeVariant,
  formatJsonPreview,
  coerceFormValues,
} from '../extension-contribution-rendering';
import type { ExtensionContributionManifestResponse } from '../system-types';

const invokeExtensionAction = vi.fn();
vi.mock('@eforge-build/client/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@eforge-build/client/browser')>();
  return { ...actual, invokeExtensionAction: (...args: unknown[]) => invokeExtensionAction(...args) };
});

function manifest(overrides: Partial<ExtensionContributionManifestResponse> = {}): ExtensionContributionManifestResponse {
  return {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    actions: [{
      id: 'demo.echo',
      localId: 'echo',
      extensionName: 'demo',
      extensionPath: '/demo.js',
      title: 'Echo',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          count: { type: 'integer' },
          enabled: { type: 'boolean' },
          mode: { type: 'string', enum: ['fast', 'safe'] },
          payload: { type: 'object' },
        },
      },
    }],
    consoleContributions: [{
      id: 'demo.panel',
      localId: 'panel',
      extensionName: 'demo',
      extensionPath: '/demo.js',
      title: 'Demo panel',
      description: 'Panel description',
      schemaVersion: 1,
      blocks: [
        { rendererId: 'text', title: 'Plain', content: 'hello text' },
        { rendererId: 'markdown', content: '# Hello\n<script>alert(1)</script><img src=x onerror=alert(1)>' },
        { rendererId: 'status-badge', content: 'healthy', status: 'success' },
        { rendererId: 'link', content: 'Docs', href: 'https://example.test/docs' },
        { rendererId: 'link', content: 'Bad', href: 'javascript:alert(1)' },
        { rendererId: 'action-button', content: 'Run echo', action: { actionId: 'demo.echo', inputDefaults: { message: 'default' } } },
        { rendererId: 'action-form', content: 'Configure echo', action: { actionId: 'demo.echo', inputDefaults: { message: 'default', count: 1 } } },
      ],
    }],
    consoleWorkstations: [],
    integrationCommands: [],
    deepLinks: [],
    diagnostics: [],
    ...overrides,
  };
}

beforeEach(() => {
  invokeExtensionAction.mockReset();
});

describe('extension contribution rendering helpers', () => {
  it('filters URLs, maps status tones, truncates previews, and validates form values', () => {
    expect(sanitizeContributionHref('https://example.test')).toContain('https://example.test');
    expect(sanitizeContributionHref('http://example.test')).toContain('http://example.test');
    expect(sanitizeContributionHref('mailto:user@example.test')).toBe('mailto:user@example.test');
    expect(sanitizeContributionHref('/console/system')).toBe('/console/system');
    expect(sanitizeContributionHref('javascript:alert(1)')).toBeNull();
    expect(sanitizeContributionHref('data:text/html,hi')).toBeNull();
    expect(sanitizeContributionHref('vbscript:msgbox(1)')).toBeNull();
    expect(sanitizeContributionHref('file:///tmp/x')).toBeNull();
    expect(sanitizeContributionHref('http://[bad')).toBeNull();
    expect(statusToneToBadgeVariant('success')).toBe('secondary');
    expect(statusToneToBadgeVariant('warning')).toBe('outline');
    expect(statusToneToBadgeVariant('danger')).toBe('destructive');
    expect(statusToneToBadgeVariant('neutral')).toBe('outline');
    expect(statusToneToBadgeVariant('error')).toBe('destructive');
    expect(statusToneToBadgeVariant('unknown-tone')).toBe('outline');
    expect(formatJsonPreview({ value: 'abcdef' }, 12)).toContain('…');

    const coerced = coerceFormValues(
      { type: 'object', properties: { ok: { type: 'number' }, bad: { type: 'number' }, huge: { type: 'number' }, nested: { type: 'object' }, optional: { type: 'string' }, mode: { enum: ['fast', 2, false, null] } } },
      { ok: '2', bad: 'NaN', huge: '1e9999', nested: '{"a":1}', optional: '', mode: 'enum:1' },
    );
    expect(coerced.input.ok).toBe(2);
    expect(coerced.input.mode).toBe(2);
    expect(coerced.input.nested).toEqual({ a: 1 });
    expect(coerced.input.optional).toBeUndefined();
    expect(coerced.errors.bad).toMatch(/number/);
    expect(coerced.errors.huge).toMatch(/number/);
  });
});

describe('ExtensionContributionsSection', () => {
  it('renders empty and error states with family counts when stale data exists', () => {
    render(<ExtensionContributionsSection manifest={{ status: 'empty', updatedAt: 1, data: manifest({ consoleContributions: [], consoleWorkstations: [], actions: [], integrationCommands: [], deepLinks: [] }) }} />);
    expect(screen.getAllByText(/No Console contributions discovered/i).length).toBeGreaterThan(0);

    render(<ExtensionContributionsSection manifest={{ status: 'error', error: 'manifest failed', data: manifest({ diagnostics: [{ severity: 'warning', code: 'W1', message: 'warn' }] }) }} />);
    expect(screen.getByRole('alert').textContent).toContain('manifest failed');
    expect(screen.getByText(/Demo panel/)).toBeDefined();
    expect(screen.getByText(/\[warning\] W1: warn/)).toBeDefined();
  });

  it('renders renderer blocks with sanitized markdown and filtered links', () => {
    render(<ExtensionContributionsSection manifest={{ status: 'success', updatedAt: 1, data: manifest() }} />);
    expect(screen.getByText('hello text')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Hello' })).toBeDefined();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('href')).toBe('https://example.test/docs');
    expect(screen.getByText(/Blocked unsafe link/)).toBeDefined();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByText('healthy')).toBeDefined();
  });

  it('invokes action buttons and renders success, typed failure, and transport errors', async () => {
    invokeExtensionAction.mockResolvedValueOnce({ ok: true, invocationId: 'inv-1', output: { done: true } });
    render(<ExtensionContributionsSection manifest={{ status: 'success', updatedAt: 1, data: manifest() }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run echo' }));
    await waitFor(() => expect(invokeExtensionAction).toHaveBeenCalled());
    expect(invokeExtensionAction.mock.calls[0][0]).toMatchObject({
      actionId: 'demo.echo',
      input: { message: 'default' },
      requestedBy: { host: 'console', surface: 'contribution:demo.panel' },
    });
    expect(await screen.findByText(/Action succeeded: inv-1/)).toBeDefined();

    invokeExtensionAction.mockResolvedValueOnce({ ok: false, invocationId: 'inv-2', error: { code: 'handler-error', message: 'boom' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run echo' }));
    expect((await screen.findByRole('alert')).textContent).toContain('handler-error');

    invokeExtensionAction.mockRejectedValueOnce(new Error('network down'));
    fireEvent.click(screen.getByRole('button', { name: 'Run echo' }));
    expect(await screen.findByText(/network down/)).toBeDefined();
  });

  it('disables action buttons while invocation is pending', async () => {
    let resolveAction: (value: { ok: true; invocationId: string; output: null }) => void = () => {};
    invokeExtensionAction.mockReturnValueOnce(new Promise((resolve) => { resolveAction = resolve; }));
    render(<ExtensionContributionsSection manifest={{ status: 'success', updatedAt: 1, data: manifest() }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Run echo' }));

    expect((await screen.findByRole('button', { name: 'Running…' })).hasAttribute('disabled')).toBe(true);
    resolveAction({ ok: true, invocationId: 'inv-pending', output: null });
    expect(await screen.findByText(/Action succeeded: inv-pending/)).toBeDefined();
  });

  it('submits action forms and blocks invalid numbers and JSON', async () => {
    invokeExtensionAction.mockResolvedValueOnce({ ok: true, invocationId: 'inv-form', output: null });
    render(<ExtensionContributionsSection manifest={{ status: 'success', updatedAt: 1, data: manifest() }} />);

    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'edited' } });
    fireEvent.change(screen.getByLabelText('count'), { target: { value: '3' } });
    fireEvent.click(screen.getByLabelText('enabled'));
    fireEvent.change(screen.getByLabelText('mode'), { target: { value: 'enum:1' } });
    fireEvent.change(screen.getByLabelText('payload'), { target: { value: '{"nested":true}' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit action/i }));

    await waitFor(() => expect(invokeExtensionAction).toHaveBeenCalled());
    expect(invokeExtensionAction.mock.calls[0][0].input).toMatchObject({ message: 'edited', count: 3, enabled: true, mode: 'safe', payload: { nested: true } });

    invokeExtensionAction.mockClear();
    fireEvent.change(screen.getByLabelText('count'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit action/i }));
    expect(await screen.findByText(/Enter a valid integer/)).toBeDefined();
    expect(invokeExtensionAction).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/count/), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/payload/), { target: { value: '{nope' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit action/i }));
    expect(await screen.findByText(/Enter valid JSON/)).toBeDefined();
    expect(invokeExtensionAction).not.toHaveBeenCalled();
  });
});
