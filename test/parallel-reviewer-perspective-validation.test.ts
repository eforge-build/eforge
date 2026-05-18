import { describe, it, expect } from 'vitest';
import { reviewProfileConfigSchema } from '@eforge-build/engine/config';
import { runParallel } from '@eforge-build/engine/concurrency';
import type { ParallelTask } from '@eforge-build/engine/concurrency';
import type { EforgeEvent } from '@eforge-build/client';
import { isBuiltInReviewPerspective } from '@eforge-build/client';

describe('reviewProfileConfigSchema perspective safe-key validation', () => {
  const baseConfig = {
    strategy: 'parallel' as const,
    maxRounds: 1,
    evaluatorStrictness: 'standard' as const,
  };

  it('accepts a config with all six built-in perspective names', () => {
    const result = reviewProfileConfigSchema.safeParse({
      ...baseConfig,
      perspectives: ['code', 'security', 'api', 'docs', 'test', 'verify'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a config with a valid custom perspective key (lowercase slug)', () => {
    const result = reviewProfileConfigSchema.safeParse({
      ...baseConfig,
      perspectives: ['accessibility'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts custom keys with hyphens and digits', () => {
    const result = reviewProfileConfigSchema.safeParse({
      ...baseConfig,
      perspectives: ['performance-review', 'a11y', 'custom-check-v2'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts the previously-misleading "performance" key as a valid slug', () => {
    // "performance" is a valid lowercase slug and now accepted as a custom key.
    // It was previously used misleadingly as a perspective name in tests; now it
    // is a valid custom extension key, not a built-in.
    const result = reviewProfileConfigSchema.safeParse({
      ...baseConfig,
      perspectives: ['performance'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config with an uppercase perspective name', () => {
    const result = reviewProfileConfigSchema.safeParse({
      ...baseConfig,
      perspectives: ['CODE'],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.map(i => i.message).join(' ');
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it('rejects a perspective key with spaces', () => {
    const result = reviewProfileConfigSchema.safeParse({
      ...baseConfig,
      perspectives: ['my perspective'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a perspective key starting with a digit', () => {
    const result = reviewProfileConfigSchema.safeParse({
      ...baseConfig,
      perspectives: ['1code'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a perspective key with a path separator', () => {
    const result = reviewProfileConfigSchema.safeParse({
      ...baseConfig,
      perspectives: ['code/check'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a perspective key with shell metacharacters', () => {
    const result = reviewProfileConfigSchema.safeParse({
      ...baseConfig,
      perspectives: ['code;rm -rf /'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a perspective key starting with a hyphen', () => {
    const result = reviewProfileConfigSchema.safeParse({
      ...baseConfig,
      perspectives: ['-code'],
    });
    expect(result.success).toBe(false);
  });
});

describe('isBuiltInReviewPerspective', () => {
  it('returns true for all six built-in perspective names', () => {
    for (const name of ['code', 'security', 'api', 'docs', 'test', 'verify']) {
      expect(isBuiltInReviewPerspective(name)).toBe(true);
    }
  });

  it('returns false for valid custom keys that are not built-ins', () => {
    for (const name of ['accessibility', 'performance', 'performance-review', 'a11y']) {
      expect(isBuiltInReviewPerspective(name)).toBe(false);
    }
  });

  it('returns false for invalid strings', () => {
    for (const name of ['CODE', 'my perspective', '1code', 'code/check', '']) {
      expect(isBuiltInReviewPerspective(name)).toBe(false);
    }
  });
});

describe('parallel-reviewer surfaces errors as :perspective:error events', () => {
  it('runParallel collects domain-specific error events from a failing task', async () => {
    const tasks: ParallelTask<EforgeEvent>[] = [
      {
        id: 'review-code',
        run: async function* (): AsyncGenerator<EforgeEvent> {
          yield {
            timestamp: new Date().toISOString(),
            type: 'plan:build:review:parallel:perspective:start',
            planId: 'plan-test',
            perspective: 'code',
          };
          try {
            throw new Error('boom');
          } catch (err) {
            yield {
              timestamp: new Date().toISOString(),
              type: 'plan:build:review:parallel:perspective:error',
              planId: 'plan-test',
              perspective: 'code',
              error: err instanceof Error ? err.message : String(err),
            };
          }
        },
      },
    ];

    const events: EforgeEvent[] = [];
    for await (const event of runParallel(tasks)) {
      events.push(event);
    }

    const errorEvent = events.find(
      (e) => e.type === 'plan:build:review:parallel:perspective:error',
    );
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.type).toBe('plan:build:review:parallel:perspective:error');
    if (errorEvent?.type === 'plan:build:review:parallel:perspective:error') {
      expect(errorEvent.error).toBe('boom');
      expect(errorEvent.perspective).toBe('code');
    }
  });
});
