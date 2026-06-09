import { describe, expect, it } from 'vitest';
import { formatRelativeTime, shortTaskId } from './format-time';

const NOW = Date.parse('2026-06-09T12:00:00.000Z');

describe('formatRelativeTime', () => {
  it('returns null for missing or invalid input', () => {
    expect(formatRelativeTime(undefined, NOW)).toBeNull();
    expect(formatRelativeTime(null, NOW)).toBeNull();
    expect(formatRelativeTime('not-a-date', NOW)).toBeNull();
  });

  it('formats sub-minute, minute, hour, and day ranges', () => {
    expect(formatRelativeTime('2026-06-09T11:59:30.000Z', NOW)).toBe('just now');
    expect(formatRelativeTime('2026-06-09T11:42:00.000Z', NOW)).toBe('18m ago');
    expect(formatRelativeTime('2026-06-09T07:00:00.000Z', NOW)).toBe('5h ago');
    expect(formatRelativeTime('2026-06-07T00:05:00.000Z', NOW)).toBe('2d ago');
  });

  it('formats future timestamps and falls back to a date past a week', () => {
    expect(formatRelativeTime('2026-06-09T12:30:00.000Z', NOW)).toBe('in 30m');
    expect(formatRelativeTime('2026-05-01T12:00:00.000Z', NOW)).toMatch(/May/);
  });
});

describe('shortTaskId', () => {
  it('collapses uuid-shaped task ids to the first segment', () => {
    expect(shortTaskId('task-1eed3666-7341-4916-8c19-e66e4a93220d')).toBe('task-1eed3666');
  });

  it('passes through non-uuid ids unchanged', () => {
    expect(shortTaskId('task-mock-planning-draft')).toBe('task-mock-planning-draft');
    expect(shortTaskId('task-refresh-recommendations')).toBe('task-refresh-recommendations');
  });
});
