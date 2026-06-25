import { describe, expect, it } from 'vitest';
import { formatBytes, lifecycleDisplay, reasonCodeDisplay, storeStatusSummary } from './sqlite-lifecycle-labels';

describe('sqlite lifecycle labels', () => {
  it('maps SQL and legacy reason codes to storage-neutral labels', () => {
    expect(reasonCodeDisplay('queued-build').label).toBe('Queued build');
    expect(reasonCodeDisplay('queued-trace').label).toBe('Queued build');
    expect(reasonCodeDisplay('failed-result').tone).toBe('danger');
  });

  it('formats lifecycle and store summaries', () => {
    expect(lifecycleDisplay('pr-open')?.label).toBe('PR open');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(storeStatusSummary(undefined).label).toBe('loading');
    expect(storeStatusSummary({ schemaVersion: 1, initialized: false, storePath: 'store.sqlite', fileSizes: { dbBytes: 0, walBytes: 0, shmBytes: 0 }, tableCounts: [], retentionEligibilityCounts: {}, recentMaintenanceRuns: [] }).label).toBe('not initialized');
    expect(storeStatusSummary({ schemaVersion: 1, initialized: true, storePath: 'store.sqlite', fileSizes: { dbBytes: 0, walBytes: 0, shmBytes: 0 }, tableCounts: [], retentionEligibilityCounts: {}, recentMaintenanceRuns: [], searchIndexStatus: { dirty: true, dirtyCount: 2, dirtyTypes: ['backlog_item'] } }).label).toBe('dirty index');
    expect(storeStatusSummary({ schemaVersion: 1, initialized: true, storePath: 'store.sqlite', fileSizes: { dbBytes: 0, walBytes: 0, shmBytes: 0 }, tableCounts: [], retentionEligibilityCounts: {}, recentMaintenanceRuns: [], searchIndexStatus: { dirty: false, dirtyCount: 0, dirtyTypes: [] } }).label).toBe('ready');
  });
});
