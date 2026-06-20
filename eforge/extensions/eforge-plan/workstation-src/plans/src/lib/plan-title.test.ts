import { describe, expect, it } from 'vitest';
import { isGeneratedPlannerPrompt, planDisplayTitle, selectionItemsLabel } from './plan-title';

describe('plan-title', () => {
  it('detects the seeded planner prompt', () => {
    expect(isGeneratedPlannerPrompt('Draft a session plan for recommendation group-x covering A, B.')).toBe(true);
    expect(isGeneratedPlannerPrompt('Eforge-plan product maturity: annotation-driven revisions')).toBe(false);
  });

  it('keeps an authored topic', () => {
    expect(planDisplayTitle('Fast workstation and Console UX bugfixes', 'group-fast-ux-bugfixes')).toBe('Fast workstation and Console UX bugfixes');
  });

  it('humanizes the session slug when the topic is the seed prompt', () => {
    expect(planDisplayTitle('Draft a session plan for recommendation group-kernel-playbook-migration covering X.', 'group-kernel-playbook-migration')).toBe('Kernel Playbook Migration');
  });

  it('falls back to the slug when no topic is present', () => {
    expect(planDisplayTitle(undefined, 'epic-roadmap-cleanup')).toBe('Roadmap Cleanup');
  });

  it('falls back to the raw slug when it cannot be humanized', () => {
    // A prefix-only / separator-only slug humanizes to empty; the final fallback
    // must yield a non-empty label rather than an empty string.
    expect(planDisplayTitle(undefined, 'epic-')).toBe('epic-');
    expect(planDisplayTitle('Draft a session plan for x', '---')).toBe('Draft a session plan for x');
  });

  describe('selectionItemsLabel', () => {
    const titles = new Map([
      ['item-a', 'Add bounded auto-resume policy'],
      ['item-b', 'Editable convergence drafts'],
    ]);

    it('names a single backlog item by its title', () => {
      expect(selectionItemsLabel({ itemIds: ['item-a'] }, titles)).toBe('Add bounded auto-resume policy');
    });

    it('names the first item and counts the rest for multiple items', () => {
      expect(selectionItemsLabel({ itemIds: ['item-a', 'item-b'] }, titles)).toBe('Add bounded auto-resume policy +1 more');
    });

    it('falls back to a count when titles are unavailable', () => {
      expect(selectionItemsLabel({ itemIds: ['item-x', 'item-y'] }, titles)).toBe('2 backlog items');
      expect(selectionItemsLabel({ itemIds: ['item-x'] })).toBe('1 backlog item');
    });

    it('returns null when there are no item ids so callers fall back to lane/epic refs', () => {
      expect(selectionItemsLabel({ recommendationRef: 'group-x' }, titles)).toBeNull();
      expect(selectionItemsLabel({ itemIds: [] }, titles)).toBeNull();
    });
  });
});
