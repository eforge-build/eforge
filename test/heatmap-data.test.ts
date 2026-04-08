import { describe, it, expect } from 'vitest';
import { computeHeatmapData } from '@eforge-build/monitor-ui/components/heatmap/use-heatmap-data';

describe('computeHeatmapData', () => {
  it('returns empty data for empty inputs', () => {
    const result = computeHeatmapData(new Map());
    expect(result.files).toEqual([]);
    expect(result.plans).toEqual([]);
    expect(result.matrix.size).toBe(0);
    expect(result.stats).toEqual({ totalFiles: 0, overlappingFiles: 0 });
  });

  it('single plan, no overlaps — all files single risk', () => {
    const fileChanges = new Map([
      ['plan-01', ['src/a.ts', 'src/b.ts']],
    ]);

    const result = computeHeatmapData(fileChanges);

    expect(result.files).toHaveLength(2);
    expect(result.plans).toHaveLength(1);
    expect(result.stats.totalFiles).toBe(2);
    expect(result.stats.overlappingFiles).toBe(0);

    // All files should be 'single' risk
    for (const file of result.files) {
      expect(file.maxRisk).toBe('single');
      expect(file.overlapCount).toBe(1);
    }

    // Matrix check
    expect(result.matrix.get('src/a.ts')?.get('plan-01')).toBe('single');
    expect(result.matrix.get('src/b.ts')?.get('plan-01')).toBe('single');
  });

  it('two plans sharing files — overlap risk', () => {
    const fileChanges = new Map([
      ['plan-01', ['src/shared.ts', 'src/a.ts']],
      ['plan-02', ['src/shared.ts', 'src/b.ts']],
    ]);

    const result = computeHeatmapData(fileChanges);

    expect(result.stats.totalFiles).toBe(3);
    expect(result.stats.overlappingFiles).toBe(1);

    // The shared file should be overlap risk
    const sharedFile = result.files.find((f) => f.path === 'src/shared.ts');
    expect(sharedFile).toBeDefined();
    expect(sharedFile!.maxRisk).toBe('overlap');
    expect(sharedFile!.overlapCount).toBe(2);

    // Non-shared files should be single risk
    const fileA = result.files.find((f) => f.path === 'src/a.ts');
    expect(fileA!.maxRisk).toBe('single');
  });

  it('multiple plans sharing files — overlap risk', () => {
    const fileChanges = new Map([
      ['plan-01', ['src/shared.ts', 'src/a.ts']],
      ['plan-02', ['src/shared.ts', 'src/b.ts']],
    ]);

    const result = computeHeatmapData(fileChanges);

    expect(result.stats.overlappingFiles).toBe(1);

    const sharedFile = result.files.find((f) => f.path === 'src/shared.ts');
    expect(sharedFile!.maxRisk).toBe('overlap');
    expect(sharedFile!.overlapCount).toBe(2);

    // Matrix: both plans show overlap for the shared file
    expect(result.matrix.get('src/shared.ts')?.get('plan-01')).toBe('overlap');
    expect(result.matrix.get('src/shared.ts')?.get('plan-02')).toBe('overlap');
  });

  it('mixed scenario with overlapping and non-overlapping files', () => {
    const fileChanges = new Map([
      ['plan-01', ['src/shared-a.ts', 'src/shared-b.ts', 'src/only-01.ts']],
      ['plan-02', ['src/shared-a.ts', 'src/only-02.ts']],
      ['plan-03', ['src/shared-b.ts', 'src/only-03.ts']],
    ]);

    const result = computeHeatmapData(fileChanges);

    expect(result.stats.totalFiles).toBe(5);
    expect(result.stats.overlappingFiles).toBe(2);

    // shared-a.ts: plan-01 and plan-02
    const sharedA = result.files.find((f) => f.path === 'src/shared-a.ts');
    expect(sharedA!.maxRisk).toBe('overlap');

    // shared-b.ts: plan-01 and plan-03
    const sharedB = result.files.find((f) => f.path === 'src/shared-b.ts');
    expect(sharedB!.maxRisk).toBe('overlap');
  });

  it('sorts files by overlap count descending', () => {
    const fileChanges = new Map([
      ['plan-01', ['src/a.ts', 'src/b.ts', 'src/c.ts']],
      ['plan-02', ['src/b.ts', 'src/c.ts']],
      ['plan-03', ['src/c.ts']],
    ]);

    const result = computeHeatmapData(fileChanges);

    expect(result.files[0].path).toBe('src/c.ts');
    expect(result.files[0].overlapCount).toBe(3);
    expect(result.files[1].path).toBe('src/b.ts');
    expect(result.files[1].overlapCount).toBe(2);
    expect(result.files[2].path).toBe('src/a.ts');
    expect(result.files[2].overlapCount).toBe(1);
  });

  it('orders plans alphabetically', () => {
    const fileChanges = new Map([
      ['plan-c', ['src/a.ts']],
      ['plan-a', ['src/a.ts']],
      ['plan-b', ['src/a.ts']],
    ]);

    const result = computeHeatmapData(fileChanges);

    expect(result.plans.map((p) => p.id)).toEqual(['plan-a', 'plan-b', 'plan-c']);
  });

  it('handles single plan with no overlaps', () => {
    const fileChanges = new Map([
      ['plan-01', ['src/a.ts']],
    ]);

    const result = computeHeatmapData(fileChanges);

    expect(result.plans).toHaveLength(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].maxRisk).toBe('single');
  });
});
