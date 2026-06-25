import { describe, expect, it } from 'vitest';
import { HOST_OUTPUT_CHAR_BUDGET } from '../host-output.js';
import {
  formatExtensionContributionDetailText,
  formatExtensionContributionFailedInvocationEnvelopeText,
  formatExtensionContributionListText,
  formatExtensionContributionOutput,
} from '../extension-contribution-output-formatting.js';
import type {
  ExtensionHostContributionDetailResponse,
  ExtensionHostContributionFailedInvocationEnvelope,
  ExtensionHostContributionListResponse,
} from '../api/extension-contribution-dispatch.js';

describe('extension contribution output formatting', () => {
  it('renders exact markdown outputs as markdown text', () => {
    const formatted = formatExtensionContributionOutput({ markdown: '# Done\n- ok' });

    expect(formatted.kind).toBe('markdown');
    expect(formatted.text).toBe('# Done\n- ok');
    expect(formatted.text).not.toContain('"markdown"');
    expect(formatted.text).not.toContain('\\n');
  });

  it('summarizes oversized JSON arrays while preserving identity fields and omitted counts', () => {
    const output = {
      items: Array.from({ length: 20 }, (_, index) => ({
        id: `item-${index}`,
        itemId: `I-${index}`,
        title: `Item ${index}`,
        status: index % 2 === 0 ? 'planned' : 'candidate',
        lane: 'ready',
        body: 'x'.repeat(300),
      })),
      total: 20,
      limit: 5,
      offset: 0,
      nextOffset: 5,
    };

    const formatted = formatExtensionContributionOutput(output, { maxChars: 900, arrayItems: 3 });

    expect(formatted.kind).toBe('json-summary');
    expect(formatted.text).toContain('Warning: extension action output was');
    expect(formatted.text).toContain('"items"');
    expect(formatted.text).toContain('"count": 20');
    expect(formatted.text).toContain('"omitted": 17');
    expect(formatted.text).toContain('"id": "item-0"');
    expect(formatted.text).toContain('"itemId": "I-0"');
    expect(formatted.text).toContain('"title": "Item 0"');
    expect(formatted.text).toContain('"status": "planned"');
    expect(formatted.text).toContain('"lane": "ready"');
    expect(formatted.text).toContain('"nextOffset": 5');
    expect(formatted.text).not.toContain('x'.repeat(300));
  });

  it('preserves top-level object keys and cursor continuation hints in summaries', () => {
    const formatted = formatExtensionContributionOutput({
      pageInfo: { cursor: 'cur-1', nextCursor: 'cur-2', hasMore: true },
      epics: Array.from({ length: 12 }, (_, index) => ({ epicId: `E-${index}`, name: `Epic ${index}`, state: 'open' })),
      counts: { openCount: 12, closedCount: 4 },
      debug: 'debug '.repeat(300),
    }, { maxChars: 1_100, arrayItems: 2 });

    expect(formatted.text).toContain('"pageInfo"');
    expect(formatted.text).toContain('"epics"');
    expect(formatted.text).toContain('"counts"');
    expect(formatted.text).toContain('"cursor": "cur-1"');
    expect(formatted.text).toContain('"nextCursor": "cur-2"');
    expect(formatted.text).toContain('"openCount": 12');
    expect(formatted.text).toContain('"closedCount": 4');
    expect(formatted.text).toContain('"epicId": "E-0"');
    expect(formatted.text).toContain('"omitted": 10');
  });

  it('emits rich profile warnings even for small outputs', () => {
    const uiRich = formatExtensionContributionOutput({ ok: true }, { outputProfile: 'ui-rich' });
    const debugRich = formatExtensionContributionOutput({ ok: true }, { outputProfile: 'debug-rich' });

    expect(uiRich.text).toContain('outputProfile "ui-rich"');
    expect(uiRich.text).toContain('"ok": true');
    expect(debugRich.text).toContain('outputProfile "debug-rich"');
    expect(debugRich.text).toContain('"ok": true');
  });

  it('enforces the final host character budget after rich profile warnings', () => {
    const formatted = formatExtensionContributionOutput({ value: 'x'.repeat(350) }, { maxChars: 400, outputProfile: 'debug-rich' });

    expect(formatted.kind).toBe('json');
    expect(formatted.truncated).toBe(true);
    expect(formatted.text.length).toBeLessThanOrEqual(400);
    expect(formatted.text).toContain('outputProfile "debug-rich"');
    expect(formatted.text).toContain('final host character budget');
  });

  it('enforces the final host character budget after semantic summarization', () => {
    const formatted = formatExtensionContributionOutput({
      items: Array.from({ length: 60 }, (_, index) => ({
        id: `item-${index}`,
        title: `Item ${index}`,
        status: 'planned',
        details: 'x'.repeat(500),
      })),
      total: 60,
      nextOffset: 5,
    }, { maxChars: 400, arrayItems: 10 });

    expect(formatted.kind).toBe('json-summary');
    expect(formatted.truncated).toBe(true);
    expect(formatted.text.length).toBeLessThanOrEqual(400);
    expect(formatted.text).toContain('final host character budget');
    expect(formatted.text).not.toContain('x'.repeat(500));
  });

  it('formats compact contribution lists with pagination and input metadata', () => {
    const response: ExtensionHostContributionListResponse = {
      generatedAt: '2026-06-03T00:00:00.000Z',
      diagnosticCount: 2,
      total: 12,
      returned: 1,
      offset: 5,
      limit: 1,
      hasMore: true,
      nextOffset: 6,
      entries: [{
        kind: 'command',
        id: 'ext.command',
        label: 'Run command',
        extensionName: 'example',
        extensionPath: '/extensions/example',
        actionId: 'ext.run',
        actionBacked: true,
        outputProfile: 'agent-compact',
        hasInputSchema: true,
        requiredInputKeys: ['name'],
        inputPropertyKeys: ['name', 'count'],
        inputDefaultKeys: ['count'],
      }],
    };

    const text = formatExtensionContributionListText(response, { maxChars: 800 });

    expect(text).toContain('1 returned of 12 total');
    expect(text).toContain('nextOffset 6');
    expect(text).toContain('command:ext.command');
    expect(text).toContain('required=name');
    expect(text).toContain('properties=name,count');
  });

  it('formats contribution detail with schema only when present in the shared projection', () => {
    const response: ExtensionHostContributionDetailResponse = {
      generatedAt: '2026-06-03T00:00:00.000Z',
      diagnosticCount: 0,
      entry: {
        kind: 'action',
        id: 'ext.run',
        label: 'Run',
        extensionName: 'example',
        extensionPath: '/extensions/example',
        actionId: 'ext.run',
        actionBacked: true,
        hasInputSchema: true,
        requiredInputKeys: ['name'],
        inputPropertyKeys: ['name'],
        inputDefaultKeys: [],
        inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
    };

    const text = formatExtensionContributionDetailText(response, { maxChars: 1_200 });

    expect(text).toContain('Extension contribution: action:ext.run');
    expect(text).toContain('Input schema:');
    expect(text).toContain('```json');
    expect(text).toContain('"name"');
  });

  it('keeps default contribution host output within the shared budget and reports raw-size guidance', () => {
    const output = {
      items: Array.from({ length: 500 }, (_, index) => ({
        id: `item-${index}`,
        title: `Item ${index}`,
        status: 'planned',
        body: 'x'.repeat(500),
      })),
      total: 500,
      limit: 5,
      offset: 0,
      nextOffset: 5,
    };

    const formatted = formatExtensionContributionOutput(output);

    expect(formatted.text.length).toBeLessThanOrEqual(HOST_OUTPUT_CHAR_BUDGET);
    expect(formatted.rawLength).toBeGreaterThan(HOST_OUTPUT_CHAR_BUDGET);
    expect(formatted.text).toContain(formatted.rawLength.toLocaleString());
    expect(formatted.text).toContain('Hint: continuation fields preserved');
  });

  it('keeps default list, show, and debug-rich contribution output within the shared budget', () => {
    const inputSchema = { type: 'object', properties: Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`field${index}`, { type: 'string', description: 'x'.repeat(120) }])) };
    const entry = {
      kind: 'action' as const,
      id: 'ext.run',
      label: 'Run',
      extensionName: 'example',
      extensionPath: '/extensions/example',
      actionId: 'ext.run',
      actionBacked: true,
      outputProfile: 'agent-compact' as const,
      hasInputSchema: true,
      requiredInputKeys: ['name'],
      inputPropertyKeys: ['name'],
      inputDefaultKeys: [],
      inputSchema,
    };
    const listText = formatExtensionContributionListText({
      generatedAt: '2026-06-03T00:00:00.000Z',
      diagnosticCount: 0,
      total: 1,
      returned: 1,
      offset: 0,
      hasMore: false,
      entries: [entry],
    });
    const showText = formatExtensionContributionDetailText({ generatedAt: '2026-06-03T00:00:00.000Z', diagnosticCount: 0, entry });
    const debugRich = formatExtensionContributionOutput({ value: 'x'.repeat(30_000) }, { outputProfile: 'debug-rich' });

    expect(listText.length).toBeLessThanOrEqual(HOST_OUTPUT_CHAR_BUDGET);
    expect(showText.length).toBeLessThanOrEqual(HOST_OUTPUT_CHAR_BUDGET);
    expect(debugRich.text.length).toBeLessThanOrEqual(HOST_OUTPUT_CHAR_BUDGET);
    expect(debugRich.text).toContain(debugRich.rawLength.toLocaleString());
  });

  it('reports raw size and continuation guidance for oversized output that fits after summarization', () => {
    const formatted = formatExtensionContributionOutput({ body: 'x'.repeat(5_000), nextOffset: 2 }, { maxChars: 600 });

    expect(formatted.text.length).toBeLessThanOrEqual(600);
    expect(formatted.truncated).toBe(false);
    expect(formatted.text).toContain(formatted.rawLength.toLocaleString());
    expect(formatted.text).toContain('showing a semantic summary');
    expect(formatted.text).toContain('Hint: continuation fields preserved: nextOffset');
    expect(formatted.text).toContain('continue with a smaller read');
  });

  it('formats failure envelopes without raw input values', () => {
    const largeValue = 'secret-large-value-'.repeat(200);
    const envelope: ExtensionHostContributionFailedInvocationEnvelope = {
      ok: false,
      invocationId: 'invoke-1',
      target: {
        kind: 'action',
        id: 'ext.run',
        label: 'Run',
        extensionName: 'example',
        extensionPath: '/extensions/example',
        actionId: 'ext.run',
      },
      requestedBy: { host: 'cli' },
      error: { code: 'invalid-input', message: 'Bad input' },
      inputSummary: {
        inputKeys: ['largeValue'],
        inputKeyCount: 3,
        serializedInputSize: JSON.stringify({ largeValue }).length,
        omittedInputKeyCount: 1,
        truncatedInputKeyCount: 1,
      },
    };

    const text = formatExtensionContributionFailedInvocationEnvelopeText(envelope);

    expect(text).toContain('action:ext.run');
    expect(text).toContain('invalid-input: Bad input');
    expect(text).toContain('largeValue');
    expect(text).toContain('serialized size');
    expect(text).toContain('1 omitted keys');
    expect(text).toContain('1 truncated keys');
    expect(text).not.toContain(largeValue);
  });
});
