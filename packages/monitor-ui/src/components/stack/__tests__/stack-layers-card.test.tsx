// @vitest-environment jsdom
// --- eforge:region plan-03-stack-daemon-ui ---
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StackLayersCard } from '../stack-layers-card';
import type { StackLayerWire } from '@/lib/types';

afterEach(cleanup);

function makeLayer(overrides: Partial<StackLayerWire> = {}): StackLayerWire {
  return {
    prdId: 'prd-feature-001',
    stackId: 'stack-abc123',
    provider: 'git-spice',
    branch: 'feature/prd-feature-001',
    baseBranch: 'main',
    status: 'pending',
    recordedAt: '2025-05-01T10:00:00.000Z',
    updatedAt: '2025-05-01T10:05:00.000Z',
    ...overrides,
  } as unknown as StackLayerWire;
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('StackLayersCard with no layers', () => {
  it('renders nothing when layers is empty', () => {
    const { container } = render(<StackLayersCard layers={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Single layer — required fields
// ---------------------------------------------------------------------------

describe('StackLayersCard with a single layer', () => {
  it('renders the card title "Stack Layers"', () => {
    render(<StackLayersCard layers={[makeLayer()]} />);
    expect(screen.getByText('Stack Layers')).toBeDefined();
  });

  it('renders the prdId', () => {
    render(<StackLayersCard layers={[makeLayer({ prdId: 'prd-widget-123' })]} />);
    expect(screen.getByText('prd-widget-123')).toBeDefined();
  });

  it('renders the stack ID', () => {
    render(<StackLayersCard layers={[makeLayer({ stackId: 'stack-xyz999' })]} />);
    expect(screen.getByText('stack-xyz999')).toBeDefined();
  });

  it('renders the provider', () => {
    render(<StackLayersCard layers={[makeLayer({ provider: 'git-spice' })]} />);
    expect(screen.getByText('git-spice')).toBeDefined();
  });

  it('renders the branch', () => {
    render(<StackLayersCard layers={[makeLayer({ branch: 'feature/my-branch' })]} />);
    expect(screen.getByText('feature/my-branch')).toBeDefined();
  });

  it('renders the status badge', () => {
    render(<StackLayersCard layers={[makeLayer({ status: 'built' })]} />);
    expect(screen.getByText('built')).toBeDefined();
  });

  it('renders the base branch when present', () => {
    render(<StackLayersCard layers={[makeLayer({ baseBranch: 'develop' })]} />);
    expect(screen.getByText('develop')).toBeDefined();
  });

  it('renders the parent prdId when present', () => {
    render(<StackLayersCard layers={[makeLayer({ parentPrdId: 'prd-parent-000' })]} />);
    expect(screen.getByText('prd-parent-000')).toBeDefined();
  });

  it('renders the artifact branch when artifact is present', () => {
    render(
      <StackLayersCard
        layers={[
          makeLayer({
            artifact: { branch: 'artifact/pr-branch', sha: 'abc123' } as unknown as StackLayerWire['artifact'],
          }),
        ]}
      />,
    );
    expect(screen.getByText('artifact/pr-branch')).toBeDefined();
  });

  it('renders the artifact PR URL when no landing PR URL is present', () => {
    render(
      <StackLayersCard
        layers={[
          makeLayer({
            artifact: {
              branch: 'artifact/pr-branch',
              prUrl: 'https://github.com/owner/repo/pull/77',
            },
          }),
        ]}
      />,
    );
    const link = screen.getByRole('link', { name: /https:\/\/github\.com\/owner\/repo\/pull\/77/ });
    expect(link).toBeDefined();
    expect((link as HTMLAnchorElement).href).toBe('https://github.com/owner/repo/pull/77');
  });

  it('does not render base branch section when baseBranch is absent', () => {
    const layer = makeLayer({ baseBranch: undefined });
    render(<StackLayersCard layers={[layer]} />);
    // "base:" label should not appear since baseBranch is undefined
    expect(screen.queryByText('base:')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Landing information
// ---------------------------------------------------------------------------

describe('StackLayersCard landing info', () => {
  it('renders landing action and status badge when landing is present', () => {
    const layer = makeLayer({
      landing: {
        action: 'pr',
        status: 'started',
        startedAt: '2025-05-01T10:10:00.000Z',
      } as unknown as StackLayerWire['landing'],
    });
    render(<StackLayersCard layers={[layer]} />);
    expect(screen.getByText('pr - started')).toBeDefined();
  });

  it('renders the PR URL as a link when prUrl is present', () => {
    const layer = makeLayer({
      landing: {
        action: 'pr',
        status: 'complete',
        prUrl: 'https://github.com/owner/repo/pull/42',
        startedAt: '2025-05-01T10:10:00.000Z',
        completedAt: '2025-05-01T10:20:00.000Z',
      } as unknown as StackLayerWire['landing'],
    });
    render(<StackLayersCard layers={[layer]} />);
    const link = screen.getByRole('link', { name: /https:\/\/github\.com\/owner\/repo\/pull\/42/ });
    expect(link).toBeDefined();
    expect((link as HTMLAnchorElement).href).toBe('https://github.com/owner/repo/pull/42');
  });

  it('renders the reason when present and no prUrl', () => {
    const layer = makeLayer({
      landing: {
        action: 'merge',
        status: 'failed',
        reason: 'merge conflict',
        startedAt: '2025-05-01T10:10:00.000Z',
      } as unknown as StackLayerWire['landing'],
    });
    render(<StackLayersCard layers={[layer]} />);
    expect(screen.getByText('merge conflict')).toBeDefined();
  });

  it('does not render landing section when landing is absent', () => {
    const layer = makeLayer({ landing: undefined });
    render(<StackLayersCard layers={[layer]} />);
    // "landing:" label should not appear
    expect(screen.queryByText('landing:')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multiple layers
// ---------------------------------------------------------------------------

describe('StackLayersCard with multiple layers', () => {
  it('renders one entry per layer', () => {
    const layers = [
      makeLayer({ prdId: 'prd-001', branch: 'feature/prd-001' }),
      makeLayer({ prdId: 'prd-002', branch: 'feature/prd-002' }),
      makeLayer({ prdId: 'prd-003', branch: 'feature/prd-003' }),
    ];
    render(<StackLayersCard layers={layers} />);
    expect(screen.getByText('prd-001')).toBeDefined();
    expect(screen.getByText('prd-002')).toBeDefined();
    expect(screen.getByText('prd-003')).toBeDefined();
  });
});
// --- eforge:endregion plan-03-stack-daemon-ui ---
