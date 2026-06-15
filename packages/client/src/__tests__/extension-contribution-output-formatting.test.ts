import { describe, expect, it } from 'vitest';
import { formatExtensionContributionOutput } from '../extension-contribution-output-formatting.js';

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
});
