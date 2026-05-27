import { describe, it, expect } from 'vitest';
import { computeHeatmapData } from '../use-heatmap-data';

describe('computeHeatmapData', () => {
  it('returns empty data for empty fileChanges', () => {
    const result = computeHeatmapData(new Map());
    expect(result.files).toHaveLength(0);
    expect(result.plans).toHaveLength(0);
    expect(result.stats.totalFiles).toBe(0);
    expect(result.stats.overlappingFiles).toBe(0);
  });

  it('assigns single risk level when only one plan touches a file', () => {
    const fileChanges = new Map([
      ['plan-01', ['src/foo.ts', 'src/bar.ts']],
    ]);
    const result = computeHeatmapData(fileChanges);

    expect(result.stats.totalFiles).toBe(2);
    expect(result.stats.overlappingFiles).toBe(0);

    // All files should have 'single' risk for plan-01
    for (const file of result.files) {
      const risks = result.matrix.get(file.path);
      expect(risks?.get('plan-01')).toBe('single');
      expect(file.maxRisk).toBe('single');
    }
  });

  it('assigns overlap risk level when multiple plans touch the same file', () => {
    const fileChanges = new Map([
      ['plan-01', ['src/shared.ts', 'src/only-plan-01.ts']],
      ['plan-02', ['src/shared.ts', 'src/only-plan-02.ts']],
    ]);
    const result = computeHeatmapData(fileChanges);

    expect(result.stats.overlappingFiles).toBe(1);

    // shared.ts should have overlap risk
    const sharedRisks = result.matrix.get('src/shared.ts');
    expect(sharedRisks?.get('plan-01')).toBe('overlap');
    expect(sharedRisks?.get('plan-02')).toBe('overlap');

    // plan-only files should have single risk
    const only01Risks = result.matrix.get('src/only-plan-01.ts');
    expect(only01Risks?.get('plan-01')).toBe('single');
    expect(only01Risks?.get('plan-02')).toBe('none');
  });

  it('sorts files with highest overlap count first', () => {
    const fileChanges = new Map([
      ['plan-01', ['src/shared.ts', 'src/a.ts']],
      ['plan-02', ['src/shared.ts', 'src/b.ts']],
      ['plan-03', ['src/shared.ts']],
    ]);
    const result = computeHeatmapData(fileChanges);

    // shared.ts touched by 3 plans should be first
    expect(result.files[0].path).toBe('src/shared.ts');
    expect(result.files[0].overlapCount).toBe(3);
  });

  it('lists plans alphabetically', () => {
    const fileChanges = new Map([
      ['plan-03', ['src/foo.ts']],
      ['plan-01', ['src/bar.ts']],
      ['plan-02', ['src/baz.ts']],
    ]);
    const result = computeHeatmapData(fileChanges);

    expect(result.plans.map((p) => p.id)).toEqual(['plan-01', 'plan-02', 'plan-03']);
  });

  it('assigns none risk to plans that did not touch a file', () => {
    const fileChanges = new Map([
      ['plan-01', ['src/foo.ts']],
      ['plan-02', ['src/bar.ts']],
    ]);
    const result = computeHeatmapData(fileChanges);

    const fooRisks = result.matrix.get('src/foo.ts');
    expect(fooRisks?.get('plan-01')).toBe('single');
    expect(fooRisks?.get('plan-02')).toBe('none');

    const barRisks = result.matrix.get('src/bar.ts');
    expect(barRisks?.get('plan-01')).toBe('none');
    expect(barRisks?.get('plan-02')).toBe('single');
  });
});
