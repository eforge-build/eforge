import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockFullAuditBacklogCurationPreview } from '@/fixtures/mock-data';
import { BacklogCurationFullAuditPanel, FullAuditEvidenceChips } from './backlog-curation-full-audit-panel';

describe('BacklogCurationFullAuditPanel', () => {
  it('renders server-provided coverage, caps, diagnostics, and item summaries', () => {
    render(<BacklogCurationFullAuditPanel audit={mockFullAuditBacklogCurationPreview.fullImplementationAudit} />);

    expect(screen.getByText('Analysis metadata')).toBeTruthy();
    expect(screen.getByText('Closure authority')).toBeTruthy();
    expect(screen.getByText('current source only')).toBeTruthy();
    expect(screen.getByText('Audited items')).toBeTruthy();
    expect(screen.getByText('Item audit concurrency')).toBeTruthy();
    expect(screen.getByText('File scan cap')).toBeTruthy();
    expect(screen.getAllByText('Current-source citations').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Historical navigation hints (not closure evidence)').length).toBeGreaterThan(0);
    expect(screen.getByText('pr-history-unavailable')).toBeTruthy();
    expect(screen.getByText('source-search-bounded')).toBeTruthy();
    expect(screen.getByText(/audited item summaries/i)).toBeTruthy();
  });

  it('renders evidence source and confidence chips', () => {
    render(<FullAuditEvidenceChips evidence={[{ source: 'git-history', confidence: 'strong' }, { source: 'code-search', confidence: 'ambiguous' }]} />);

    expect(screen.getByText('Git History · strong')).toBeTruthy();
    expect(screen.getByText('Code Search · ambiguous')).toBeTruthy();
  });
});
