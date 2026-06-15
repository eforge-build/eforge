import { describe, expect, it } from 'vitest';
import { isGeneratedPlannerPrompt, planDisplayTitle } from './plan-title';

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
});
