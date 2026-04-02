import { describe, it, expect } from 'vitest';
import { parseGaps } from '../src/engine/agents/prd-validator.js';

describe('parseGaps', () => {
  it('parses JSON with completionPercent and complexity fields', () => {
    const input = '```json\n{"completionPercent": 85, "gaps": [{"requirement": "x", "explanation": "y", "complexity": "moderate"}]}\n```';
    const result = parseGaps(input);
    expect(result).toEqual({
      gaps: [{ requirement: 'x', explanation: 'y', complexity: 'moderate' }],
      completionPercent: 85,
    });
  });

  it('handles missing completionPercent and complexity (backward compat)', () => {
    const input = '```json\n{"gaps": [{"requirement": "x", "explanation": "y"}]}\n```';
    const result = parseGaps(input);
    expect(result).toEqual({
      gaps: [{ requirement: 'x', explanation: 'y' }],
      completionPercent: undefined,
    });
  });

  it('strips invalid complexity values', () => {
    const input = '```json\n{"completionPercent": 50, "gaps": [{"requirement": "a", "explanation": "b", "complexity": "extreme"}]}\n```';
    const result = parseGaps(input);
    expect(result.gaps[0].complexity).toBeUndefined();
    expect(result.completionPercent).toBe(50);
  });

  it('handles all valid complexity values', () => {
    const input = `\`\`\`json
{
  "completionPercent": 60,
  "gaps": [
    {"requirement": "a", "explanation": "b", "complexity": "trivial"},
    {"requirement": "c", "explanation": "d", "complexity": "moderate"},
    {"requirement": "e", "explanation": "f", "complexity": "significant"}
  ]
}
\`\`\``;
    const result = parseGaps(input);
    expect(result.gaps).toHaveLength(3);
    expect(result.gaps[0].complexity).toBe('trivial');
    expect(result.gaps[1].complexity).toBe('moderate');
    expect(result.gaps[2].complexity).toBe('significant');
    expect(result.completionPercent).toBe(60);
  });

  it('returns empty gaps and undefined completionPercent for no JSON match', () => {
    const result = parseGaps('no json here');
    expect(result).toEqual({ gaps: [], completionPercent: undefined });
  });

  it('returns empty gaps and undefined completionPercent for invalid JSON', () => {
    const input = '```json\n{invalid json}\n```';
    const result = parseGaps(input);
    expect(result).toEqual({ gaps: [], completionPercent: undefined });
  });

  it('handles raw JSON without fences', () => {
    const input = 'Some text {"completionPercent": 90, "gaps": []} more text';
    const result = parseGaps(input);
    expect(result).toEqual({ gaps: [], completionPercent: 90 });
  });

  it('handles completionPercent of 0', () => {
    const input = '```json\n{"completionPercent": 0, "gaps": [{"requirement": "all", "explanation": "nothing done", "complexity": "significant"}]}\n```';
    const result = parseGaps(input);
    expect(result.completionPercent).toBe(0);
    expect(result.gaps).toHaveLength(1);
  });

  it('ignores non-number completionPercent values', () => {
    const input = '```json\n{"completionPercent": "high", "gaps": []}\n```';
    const result = parseGaps(input);
    expect(result.completionPercent).toBeUndefined();
  });
});
