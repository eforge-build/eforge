import { describe, expect, it } from 'vitest';
import {
  buildCompilePromptSourceBundle,
  GENERATED_INVENTORY_MIN_BYTES,
  LARGE_CODE_FENCE_MIN_BYTES,
} from '@eforge-build/engine/compile-resilience/preflight';

const rawSentinel = 'RAW_BOUNDARY_SENTINEL_24680';

function largeText(size: number): string {
  return `${rawSentinel}\n${'x'.repeat(size)}`;
}

describe('compile preflight compaction boundaries', () => {
  it('does not compact large ordinary code fences without generated or machine-readable hints', () => {
    const source = [
      '# Ordinary Implementation Notes',
      '',
      '```text',
      largeText(LARGE_CODE_FENCE_MIN_BYTES + 100),
      '```',
    ].join('\n');

    const bundle = buildCompilePromptSourceBundle(source);

    expect(bundle.compactions).toHaveLength(0);
    expect(bundle.promptSource).toBe(source);
    expect(bundle.promptSource).toContain(rawSentinel);
  });

  it('compacts large generated sections even when the fenced language is plain text', () => {
    const source = [
      '# PRD',
      '',
      '## Generated File List',
      '',
      '```text',
      largeText(GENERATED_INVENTORY_MIN_BYTES + 100),
      '```',
    ].join('\n');

    const bundle = buildCompilePromptSourceBundle(source);

    expect(bundle.compactions).toHaveLength(1);
    expect(bundle.compactions[0].kind).toBe('generated-inventory');
    expect(bundle.compactions[0].heading).toBe('Generated File List');
    expect(bundle.promptSource).toContain('eforge compile preflight compaction');
    expect(bundle.promptSource).not.toContain(rawSentinel);
    expect(bundle.analysis.detectedBlocks[0].omittedBytes).toBeGreaterThan(0);
  });

  it('normalizes explicit path allow-lists while preserving sidecar evidence', () => {
    const source = [
      '# PRD',
      '',
      '## Machine-readable sidecar',
      '',
      '```json data/keep.json',
      JSON.stringify(Array.from({ length: 200 }, (_, index) => ({ index, value: index === 42 ? rawSentinel : `value-${index}` }))),
      '```',
    ].join('\n');

    const bundle = buildCompilePromptSourceBundle(source, { fullContentRequiredPaths: ['./data/keep.json'] });

    expect(bundle.compactions).toHaveLength(0);
    expect(bundle.promptSource).toContain(rawSentinel);
    expect(bundle.analysis.detectedBlocks).toHaveLength(1);
    expect(bundle.analysis.detectedBlocks[0].omittedBytes).toBe(0);
    expect(bundle.analysis.detectedBlocks[0].pathReferences).toContain('data/keep.json');
  });

});
