import { describe, expect, it } from 'vitest';
import { classifySourceFirstAuditItem, normalizeItemAuditConcurrency, runBoundedWorkerPool } from '../backlog-curation-source-first-audit.js';

const item = {
  id: 'source-first-widget',
  title: 'Source First Widget',
  status: 'candidate',
  priority: 'medium',
  tags: [],
  depends_on: [],
  body: '# Source First Widget\n\n## Acceptance Criteria\n\n- Widget is exported.\n',
};

describe('source-first backlog audit core', () => {
  it('defaults and caps trusted internal item audit concurrency', () => {
    expect(normalizeItemAuditConcurrency(undefined)).toBe(4);
    expect(normalizeItemAuditConcurrency(0)).toBe(4);
    expect(normalizeItemAuditConcurrency(9)).toBe(8);
  });

  it('runs the bounded worker pool without exceeding configured concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    await runBoundedWorkerPool([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value;
    });
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('defaults the worker pool to four active audits', async () => {
    let active = 0;
    let maxActive = 0;
    await runBoundedWorkerPool([1, 2, 3, 4, 5, 6], undefined, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value;
    });
    expect(maxActive).toBe(4);
  });

  it('classifies current implementation plus product-surface wiring as source-shipped', () => {
    const result = classifySourceFirstAuditItem({
      item: item as any,
      currentEvidence: [
        { source: 'code-search', confidence: 'strong', path: 'src/widget.ts', excerpt: 'class SourceFirstWidget implements source-first-widget behavior' },
        { source: 'code-search', confidence: 'strong', path: 'src/index.ts', excerpt: 'export { SourceFirstWidget } from "./widget";' },
      ],
      historicalHints: [{ source: 'git-history', confidence: 'strong', intent: 'shipped', citation: 'old commit', closureAuthority: false }],
    });
    expect(result.intent).toBe('source-shipped');
    expect(result.historicalHints[0]).toMatchObject({ closureAuthority: false });
  });

  it('classifies same-file exported implementations as source-shipped', () => {
    const result = classifySourceFirstAuditItem({
      item: item as any,
      currentEvidence: [{ source: 'code-search', confidence: 'strong', path: 'src/widget.ts', excerpt: 'export class SourceFirstWidget implements source-first-widget behavior {}' }],
    });
    expect(result.intent).toBe('source-shipped');
  });

  it('classifies replacement implementation plus product-surface wiring as source-superseded', () => {
    const result = classifySourceFirstAuditItem({
      item: { ...item, body: `${item.body}\nSuperseded by the replacement widget.` } as any,
      currentEvidence: [
        { source: 'code-search', confidence: 'strong', path: 'src/replacement-widget.ts', excerpt: 'class ReplacementWidget replaces source-first-widget behavior' },
        { source: 'code-search', confidence: 'strong', path: 'src/index.ts', excerpt: 'export { ReplacementWidget } from "./replacement-widget";' },
      ],
    });
    expect(result.intent).toBe('source-superseded');
  });

  it('does not close when only historical hints, partial source, or supporting docs/tests are present', () => {
    expect(classifySourceFirstAuditItem({ item: item as any, currentEvidence: [], historicalHints: [{ source: 'pr-history', confidence: 'strong', intent: 'shipped', closureAuthority: false }] }).intent).toBe('not-found');
    expect(classifySourceFirstAuditItem({ item: item as any, currentEvidence: [{ source: 'code-search', confidence: 'strong', path: 'src/widget.ts', excerpt: 'class SourceFirstWidget implements source-first-widget behavior' }] }).intent).toBe('partial');
    expect(classifySourceFirstAuditItem({ item: item as any, currentEvidence: [{ source: 'documentation-search', confidence: 'strong', path: 'docs/widget.md', excerpt: 'Source First Widget docs' }] }).intent).toBe('recheck-note');
  });
});
