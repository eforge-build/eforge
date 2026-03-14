import { describe, it, expect } from 'vitest';
import type { EforgeEvent } from '../src/engine/events.js';

describe('build:files_changed event', () => {
  it('is assignable to EforgeEvent', () => {
    // Type-level test: if this compiles, the event is part of the union
    const event: EforgeEvent = {
      type: 'build:files_changed',
      planId: 'plan-01',
      files: ['src/foo.ts', 'src/bar.ts'],
    };

    expect(event.type).toBe('build:files_changed');
    expect(event.planId).toBe('plan-01');
    expect(event.files).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('has the correct shape with planId and files array', () => {
    const event: EforgeEvent = {
      type: 'build:files_changed',
      planId: 'test-plan',
      files: [],
    };

    expect(event).toHaveProperty('type', 'build:files_changed');
    expect(event).toHaveProperty('planId', 'test-plan');
    expect(event).toHaveProperty('files');
  });

  it('can be discriminated from other build events', () => {
    const events: EforgeEvent[] = [
      { type: 'build:implement:start', planId: 'p1' },
      { type: 'build:implement:complete', planId: 'p1' },
      { type: 'build:files_changed', planId: 'p1', files: ['a.ts', 'b.ts'] },
      { type: 'build:review:start', planId: 'p1' },
    ];

    const filesChanged = events.find((e) => e.type === 'build:files_changed');
    expect(filesChanged).toBeDefined();

    // Type narrowing works via discriminated union
    if (filesChanged && filesChanged.type === 'build:files_changed') {
      expect(filesChanged.files).toEqual(['a.ts', 'b.ts']);
    }
  });
});
