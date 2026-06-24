import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockMissingStoreStatus, mockStoreStatus } from '@/fixtures/mock-storage';
import type { EforgeBridge } from '@/types';
import { StoreStatusBadge, StoreStatusCard } from './store-status-card';

function setBridge(bridge: EforgeBridge) { (window as Window & { eforge?: EforgeBridge }).eforge = bridge; }

describe('StoreStatusCard', () => {
  it('renders missing-store import guidance', () => {
    render(<StoreStatusCard status={mockMissingStoreStatus} error={null} onRefresh={async () => {}} />);
    expect(screen.getByText(/not initialized/)).toBeTruthy();
    expect(screen.getByText(/import-planning-store/)).toBeTruthy();
    expect(screen.getByText(/\{ "dryRun": false \}/)).toBeTruthy();
    expect(screen.getByText(/\{ "dryRun": false, "replaceExisting": true \}/)).toBeTruthy();
  });

  it('renders initialized-store schema, file, search, retention, and maintenance summaries', () => {
    const { container } = render(<StoreStatusCard status={mockStoreStatus} error={null} onRefresh={async () => {}} />);
    const text = container.textContent ?? '';
    expect(text).toContain('Schema: 1');
    expect(text).toContain('eforge-plan-private.sqlite');
    expect(text).toContain('Files: SQLite 256 KB');
    expect(text).toContain('WAL 32 KB');
    expect(text).toContain('SHM 32 KB');
    expect(text).toContain('index dirty (3 docs)');
    expect(text).toContain('5 eligible records');
    expect(text).toContain('import-report-payloads: 2');
    expect(text).toContain('5 records eligible for compaction');
  });

  it('summarizes header badge states without invoking actions', () => {
    const { rerender } = render(<StoreStatusBadge status={mockStoreStatus} error={null} />);
    expect(screen.getByText(/SQLite store · dirty index/)).toBeTruthy();
    rerender(<StoreStatusBadge status={mockMissingStoreStatus} error={null} />);
    expect(screen.getByText(/SQLite store · not initialized/)).toBeTruthy();
    rerender(<StoreStatusBadge status={null} error="store status: unavailable" />);
    expect(screen.getByText(/SQLite store · status unavailable/)).toBeTruthy();
  });

  it('invokes maintenance actions explicitly with confirmation for vacuum', async () => {
    const calls: unknown[] = [];
    const refresh = vi.fn(async () => {});
    setBridge({ async invokeAction<TOutput>(actionId: string, input?: unknown): Promise<TOutput> { calls.push({ actionId, input: input ?? {} }); return { actionId, summary: `${actionId} ok` } as TOutput; } });
    render(<StoreStatusCard status={mockStoreStatus} error={null} onRefresh={refresh} />);
    fireEvent.click(screen.getByText('Dry-run compaction'));
    await waitFor(() => expect(calls).toContainEqual({ actionId: 'compact-planning-store', input: { dryRun: true, sampleLimit: 5 } }));
    fireEvent.click(screen.getByText('Rebuild search index'));
    await waitFor(() => expect(calls).toContainEqual({ actionId: 'rebuild-search-index', input: {} }));
    fireEvent.click(screen.getByText('Optimize search index'));
    await waitFor(() => expect(calls).toContainEqual({ actionId: 'optimize-search-index', input: {} }));
    fireEvent.click(screen.getByText('Vacuum store…'));
    expect(calls).not.toContainEqual({ actionId: 'vacuum-planning-store', input: {} });
    fireEvent.click(screen.getByText('Confirm VACUUM'));
    await waitFor(() => expect(calls).toContainEqual({ actionId: 'vacuum-planning-store', input: {} }));
    expect(refresh).toHaveBeenCalled();
  });

  it('renders maintenance action failures', async () => {
    setBridge({ async invokeAction(): Promise<never> { throw new Error('maintenance failed'); } });
    render(<StoreStatusCard status={mockStoreStatus} error={null} onRefresh={async () => {}} />);
    fireEvent.click(screen.getByText('Dry-run compaction'));
    await waitFor(() => expect(screen.getByText('maintenance failed')).toBeTruthy());
  });

  it('omits raw maintenance payload fields from rendered reports', async () => {
    setBridge({ async invokeAction<TOutput>(actionId: string): Promise<TOutput> { return { actionId, summary: 'Maintenance complete.', payload_json: 'secret payload', raw_request_json: 'secret request', raw_result_json: 'secret result', raw_model_json: 'secret model', verbose_report_json: 'secret verbose', details_json: 'secret details' } as TOutput; } });
    render(<StoreStatusCard status={mockStoreStatus} error={null} onRefresh={async () => {}} />);
    fireEvent.click(screen.getByText('Dry-run compaction'));
    await waitFor(() => expect(screen.getByText('Maintenance complete.')).toBeTruthy());
    for (const rawField of ['payload_json', 'raw_request_json', 'raw_result_json', 'raw_model_json', 'verbose_report_json', 'details_json', 'secret payload', 'secret request', 'secret result', 'secret model', 'secret verbose', 'secret details']) {
      expect(screen.queryByText(rawField)).toBeNull();
    }
  });
});
