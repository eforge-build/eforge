import { describe, it, expect } from 'vitest';
import { planSetSubmissionSchema, architectureSubmissionSchema } from '@eforge-build/engine/schemas';

function makePlan(overrides: Record<string, unknown> = {}) {
  return {
    frontmatter: {
      id: 'plan-01-auth',
      name: 'Auth Plan',
      dependsOn: [],
      branch: 'auth/main',
      ...overrides,
    },
    body: '# Auth Plan\n\nImplement auth.',
  };
}

function makeValidPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'my-plan-set',
    description: 'A plan set',
    mode: 'excursion' as const,
    baseBranch: 'main',
    plans: [
      makePlan(),
      makePlan({ id: 'plan-02-api', name: 'API Plan', dependsOn: ['plan-01-auth'], branch: 'api/main' }),
    ],
    orchestration: {
      plans: [
        { id: 'plan-01-auth', name: 'Auth Plan', dependsOn: [], branch: 'auth/main' },
        { id: 'plan-02-api', name: 'API Plan', dependsOn: ['plan-01-auth'], branch: 'api/main' },
      ],
    },
    ...overrides,
  };
}

describe('planSetSubmissionSchema', () => {
  it('accepts a valid payload', () => {
    const result = planSetSubmissionSchema.safeParse(makeValidPayload());
    expect(result.success).toBe(true);
  });

  it('rejects duplicate plan IDs', () => {
    const payload = makeValidPayload({
      plans: [
        makePlan({ id: 'plan-01-dup' }),
        makePlan({ id: 'plan-01-dup', name: 'Dup Plan' }),
      ],
      orchestration: {
        plans: [
          { id: 'plan-01-dup', name: 'Dup Plan', dependsOn: [], branch: 'dup/main' },
        ],
      },
    });
    const result = planSetSubmissionSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message);
      expect(messages.some(m => m.includes('Duplicate plan ID'))).toBe(true);
    }
  });

  it('rejects dangling dependsOn references', () => {
    const payload = makeValidPayload({
      plans: [
        makePlan({ id: 'plan-01-a', dependsOn: ['plan-99-nonexistent'] }),
      ],
      orchestration: {
        plans: [
          { id: 'plan-01-a', name: 'A', dependsOn: ['plan-99-nonexistent'], branch: 'a/main' },
        ],
      },
    });
    const result = planSetSubmissionSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message);
      expect(messages.some(m => m.includes('unknown plan'))).toBe(true);
    }
  });

  it('rejects dependency cycles (A depends on B, B depends on A)', () => {
    const payload = makeValidPayload({
      plans: [
        makePlan({ id: 'plan-a', dependsOn: ['plan-b'], branch: 'a/main' }),
        makePlan({ id: 'plan-b', name: 'B', dependsOn: ['plan-a'], branch: 'b/main' }),
      ],
      orchestration: {
        plans: [
          { id: 'plan-a', name: 'A', dependsOn: ['plan-b'], branch: 'a/main' },
          { id: 'plan-b', name: 'B', dependsOn: ['plan-a'], branch: 'b/main' },
        ],
      },
    });
    const result = planSetSubmissionSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message);
      expect(messages.some(m => m.includes('cycle'))).toBe(true);
    }
  });

  it('rejects when orchestration plan IDs do not match submitted plan IDs', () => {
    const payload = makeValidPayload({
      plans: [makePlan({ id: 'plan-01-auth' })],
      orchestration: {
        plans: [
          { id: 'plan-99-wrong', name: 'Wrong', dependsOn: [], branch: 'wrong/main' },
        ],
      },
    });
    const result = planSetSubmissionSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message);
      expect(messages.some(m => m.includes('do not match'))).toBe(true);
    }
  });

  it('rejects invalid migration timestamps', () => {
    const payload = makeValidPayload({
      plans: [
        makePlan({
          id: 'plan-01-mig',
          migrations: [{ timestamp: 'not-a-timestamp', description: 'bad migration' }],
        }),
      ],
      orchestration: {
        plans: [
          { id: 'plan-01-mig', name: 'Mig Plan', dependsOn: [], branch: 'mig/main' },
        ],
      },
    });
    const result = planSetSubmissionSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('accepts valid migration timestamps (14 digits)', () => {
    const payload = makeValidPayload({
      plans: [
        makePlan({
          id: 'plan-01-mig',
          migrations: [{ timestamp: '20260415120000', description: 'add table' }],
        }),
      ],
      orchestration: {
        plans: [
          { id: 'plan-01-mig', name: 'Mig Plan', dependsOn: [], branch: 'mig/main' },
        ],
      },
    });
    const result = planSetSubmissionSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});

describe('architectureSubmissionSchema', () => {
  it('accepts a valid payload', () => {
    const result = architectureSubmissionSchema.safeParse({
      architecture: '# Architecture\n\nDesign doc.',
      modules: [
        { id: 'mod-auth', description: 'Auth module', dependsOn: [] },
        { id: 'mod-api', description: 'API module', dependsOn: ['mod-auth'] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('validates architecture as non-empty string', () => {
    const result = architectureSubmissionSchema.safeParse({
      architecture: '',
      modules: [{ id: 'mod-a', description: 'A', dependsOn: [] }],
    });
    expect(result.success).toBe(false);
  });

  it('validates modules as a non-empty array', () => {
    const result = architectureSubmissionSchema.safeParse({
      architecture: '# Arch',
      modules: [],
    });
    expect(result.success).toBe(false);
  });

  it('requires module id, description, and dependsOn', () => {
    const result = architectureSubmissionSchema.safeParse({
      architecture: '# Arch',
      modules: [{ id: '', description: 'test', dependsOn: [] }],
    });
    expect(result.success).toBe(false);
  });
});
