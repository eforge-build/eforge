import { describe, it, expect } from 'vitest';
import { shortenPath } from '../src/monitor/ui/src/lib/format';

describe('shortenPath', () => {
  it('returns short paths unchanged', () => {
    expect(shortenPath('src/a.ts', 50)).toBe('src/a.ts');
  });

  it('truncates deep paths preserving filename', () => {
    // Greedily includes as many trailing dirs as fit within maxChars
    expect(
      shortenPath('src/monitor/ui/src/components/preview/plan-preview-context.tsx', 50),
    ).toBe('…/src/components/preview/plan-preview-context.tsx');
  });

  it('truncates with shorter maxChars preserving fewer dirs', () => {
    expect(
      shortenPath('src/monitor/ui/src/components/preview/plan-preview-context.tsx', 40),
    ).toBe('…/preview/plan-preview-context.tsx');
  });

  it('greedily includes trailing directories', () => {
    const result = shortenPath('a/b/c/d/e/f/g/h/i/file.ts', 20);
    // Should include as many trailing dirs as fit with …/ prefix
    expect(result).toMatch(/^…\//);
    expect(result).toMatch(/file\.ts$/);
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it('never truncates the filename even if it exceeds maxChars', () => {
    const longFilename = 'very-long-filename-that-exceeds-max-chars.tsx';
    const result = shortenPath(longFilename, 10);
    // Single segment, returned unchanged
    expect(result).toBe(longFilename);
  });

  it('returns …/filename for long filename in a path', () => {
    const result = shortenPath('src/very-long-filename-that-exceeds-max-chars.tsx', 10);
    expect(result).toBe('…/very-long-filename-that-exceeds-max-chars.tsx');
  });

  it('returns empty string for empty input', () => {
    expect(shortenPath('')).toBe('');
  });

  it('returns single-segment paths unchanged', () => {
    expect(shortenPath('file.ts')).toBe('file.ts');
  });

  it('respects custom maxChars parameter', () => {
    const path = 'a/b/c/d/e/f/g/file.ts';
    const result = shortenPath(path, 15);
    expect(result).toMatch(/^…\//);
    expect(result).toMatch(/file\.ts$/);
    expect(result.length).toBeLessThanOrEqual(15);
  });
});
