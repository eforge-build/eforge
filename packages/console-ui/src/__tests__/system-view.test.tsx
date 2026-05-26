// --- eforge:region plan-05-system-activity-progressive-disclosure-and-guards ---
/**
 * system-view — Models section provider disclosure and search assertions.
 */
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ModelsSection } from '@/views/system/models-section';
import type { SystemModelCatalog, SystemModelHarness } from '@/views/system/system-types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeLoadedCatalog(
  providers: string[],
  models: Array<{ id: string; provider: string }>,
): SystemModelCatalog {
  return {
    providers: { status: 'success', data: { providers }, updatedAt: 1 },
    models: { status: 'success', data: { models }, updatedAt: 1 },
  };
}

function makeEmptyCatalog(): SystemModelCatalog {
  return {
    providers: { status: 'empty', data: { providers: [] }, updatedAt: 1 },
    models: { status: 'empty', data: { models: [] }, updatedAt: 1 },
  };
}

function makeCatalogs(
  overrides: Partial<Record<SystemModelHarness, SystemModelCatalog>> = {},
): Record<SystemModelHarness, SystemModelCatalog> {
  return {
    pi: makeEmptyCatalog(),
    'claude-sdk': makeEmptyCatalog(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Provider disclosure
// ---------------------------------------------------------------------------

describe('ModelsSection — provider disclosure', () => {
  it('renders one <details> element per provider in the model list', () => {
    const catalogs = makeCatalogs({
      'claude-sdk': makeLoadedCatalog(
        ['anthropic', 'openai'],
        [
          { id: 'claude-3-5-sonnet', provider: 'anthropic' },
          { id: 'claude-3-haiku', provider: 'anthropic' },
          { id: 'gpt-4o', provider: 'openai' },
        ],
      ),
    });

    const { container } = render(<ModelsSection catalogs={catalogs} />);
    // claude-sdk has 2 providers → 2 <details> elements
    const details = container.querySelectorAll('details');
    expect(details.length).toBeGreaterThanOrEqual(2);
  });

  it('every provider <details> is closed on initial render', () => {
    const catalogs = makeCatalogs({
      'claude-sdk': makeLoadedCatalog(
        ['anthropic', 'openai'],
        [
          { id: 'claude-3-5-sonnet', provider: 'anthropic' },
          { id: 'gpt-4o', provider: 'openai' },
        ],
      ),
    });

    const { container } = render(<ModelsSection catalogs={catalogs} />);
    const details = container.querySelectorAll('details');
    for (const detail of Array.from(details)) {
      expect(detail.hasAttribute('open')).toBe(false);
    }
  });

  it('initial Models section DOM contains zero <li> descendants while all details are closed', () => {
    const catalogs = makeCatalogs({
      'claude-sdk': makeLoadedCatalog(
        ['anthropic', 'openai'],
        [
          { id: 'claude-3-5-sonnet', provider: 'anthropic' },
          { id: 'gpt-4o', provider: 'openai' },
        ],
      ),
    });

    const { container } = render(<ModelsSection catalogs={catalogs} />);
    const listItems = container.querySelectorAll('li');
    expect(listItems.length).toBe(0);
  });

  it('renders <li> model rows only after a provider is expanded', () => {
    const catalogs = makeCatalogs({
      'claude-sdk': makeLoadedCatalog(
        ['anthropic'],
        [
          { id: 'claude-3-5-sonnet', provider: 'anthropic' },
          { id: 'claude-3-haiku', provider: 'anthropic' },
        ],
      ),
    });

    const { container, getByText } = render(<ModelsSection catalogs={catalogs} />);

    // No li before expanding
    expect(container.querySelectorAll('li').length).toBe(0);

    // Click the anthropic summary to expand
    const summary = getByText(/anthropic/i, { selector: 'summary, summary *' });
    fireEvent.click(summary);

    // li elements should now be in the DOM
    const listItems = container.querySelectorAll('li');
    expect(listItems.length).toBeGreaterThanOrEqual(2);
    expect(getByText('claude-3-5-sonnet')).toBeDefined();
    expect(getByText('claude-3-haiku')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Model search input
// ---------------------------------------------------------------------------

describe('ModelsSection — model search input', () => {
  it('renders a text input with an accessible name indicating model search', () => {
    const catalogs = makeCatalogs({
      'claude-sdk': makeLoadedCatalog(
        ['anthropic'],
        [{ id: 'claude-3-5-sonnet', provider: 'anthropic' }],
      ),
    });

    const { container } = render(<ModelsSection catalogs={catalogs} />);
    const input = container.querySelector('input[type="text"]');
    expect(input).not.toBeNull();
    const label = input!.getAttribute('aria-label') ?? '';
    expect(label.toLowerCase()).toMatch(/search.*model|model.*search/i);
  });

  it('filters provider groups by search query', () => {
    const catalogs = makeCatalogs({
      'claude-sdk': makeLoadedCatalog(
        ['anthropic', 'openai'],
        [
          { id: 'claude-3-5-sonnet', provider: 'anthropic' },
          { id: 'gpt-4o', provider: 'openai' },
        ],
      ),
    });

    const { container, queryByText } = render(<ModelsSection catalogs={catalogs} />);

    // Type into the search input for claude-sdk
    const inputs = container.querySelectorAll('input[type="text"]');
    // Find the claude-sdk search input
    const searchInput = Array.from(inputs).find(
      (el) => (el.getAttribute('aria-label') ?? '').includes('claude-sdk'),
    ) as HTMLInputElement | undefined;

    expect(searchInput).toBeDefined();

    // Search for 'claude' — should filter to anthropic provider only
    fireEvent.change(searchInput!, { target: { value: 'claude' } });

    // 'gpt-4o' summary (openai group) should not be visible since no openai models match
    // (the openai provider is filtered out)
    expect(queryByText(/openai/)).toBeNull();
  });
});
// --- eforge:endregion plan-05-system-activity-progressive-disclosure-and-guards ---
