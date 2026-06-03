import { describe, expect, it } from 'vitest';

import { parseMaintainabilityOutput } from '../eforge/extensions/eforge-guardrails/maintainability-parser.js';

describe('eforge guardrails maintainability parser', () => {
  it('parses baseline file-size violations as structural annotations', () => {
    const result = parseMaintainabilityOutput('BASELINE EXCEEDED  packages/client/src/routes.ts: 628 lines (ceiling: 626)');

    expect(result.status).toBe('failed');
    expect(result.details).toBe('BASELINE EXCEEDED  packages/client/src/routes.ts: 628 lines (ceiling: 626)');
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations?.[0]).toMatchObject({
      severity: 'error',
      file: 'packages/client/src/routes.ts',
      failureKind: 'maintainability:file-size-baseline',
      repairClass: 'structural',
      metadata: {
        thresholdType: 'baseline',
        currentLines: 628,
        ceiling: 626,
        overflow: 2,
      },
    });
    expect(result.annotations?.[0]?.fix).toContain('comment shortening');
  });

  it('parses cap file-size violations with cap metadata', () => {
    const result = parseMaintainabilityOutput('CAP EXCEEDED  src/new.ts: 612 lines (implementation cap: 600)');

    expect(result.annotations).toHaveLength(1);
    expect(result.annotations?.[0]).toMatchObject({
      severity: 'error',
      file: 'src/new.ts',
      failureKind: 'maintainability:file-size-cap',
      repairClass: 'structural',
      metadata: {
        thresholdType: 'cap',
        category: 'implementation',
        currentLines: 612,
        cap: 600,
        overflow: 12,
      },
    });
  });

  it('parses region-marker balance sections when a file path is present', () => {
    const result = parseMaintainabilityOutput(`
Region marker balance violations:
  packages/engine/src/example.ts: endregion for "plan-01" at line 42 has no matching region marker (stack is empty)
`);

    expect(result.annotations).toHaveLength(1);
    expect(result.annotations?.[0]).toMatchObject({
      severity: 'error',
      file: 'packages/engine/src/example.ts',
      line: 42,
      failureKind: 'maintainability:region-marker-balance',
      repairClass: 'narrow',
      metadata: {
        markerLine: 42,
        markerMessage: 'endregion for "plan-01" at line 42 has no matching region marker (stack is empty)',
      },
    });
  });

  it('returns a structured generic failure for unparseable non-empty output', () => {
    const output = 'unexpected maintainability failure format';
    const result = parseMaintainabilityOutput(output);

    expect(result).toEqual({
      status: 'failed',
      message: 'Agent maintainability check failed with unparseable output.',
      details: output,
    });
  });
});
