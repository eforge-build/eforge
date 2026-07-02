import { describe, expect, it } from 'vitest';
import { eventRegistry } from '../event-registry.js';
import { EforgeEventSchema, safeParseEforgeEvent } from '../events.schemas.js';
import { EforgeEventSchema as eventsBarrelSchema, safeParseEforgeEvent as eventsBarrelParse } from '../events.js';
import { EforgeEventSchema as indexSchema, safeParseEforgeEvent as indexParse } from '../index.js';
import {
  REVIEW_PERSPECTIVES as browserReviewPerspectives,
  SEVERITY_ORDER as browserSeverityOrder,
  isAlwaysYieldedAgentEvent as browserIsAlwaysYieldedAgentEvent,
} from '../browser.js';
import type { EforgeEvent } from '../events.schemas.js';
import type { EforgeEvent as EventsBarrelEvent } from '../events.js';
import type { EforgeEvent as IndexEvent } from '../index.js';
import type { EforgeEvent as BrowserEvent } from '../browser.js';

interface SchemaObject {
  anyOf?: SchemaObject[];
  allOf?: SchemaObject[];
  properties?: Record<string, SchemaObject>;
  const?: unknown;
  required?: string[];
}

function hasDirectDiscriminant(entry: SchemaObject): boolean {
  return typeof entry.properties?.type?.const === 'string';
}

function schemaObject(value: unknown): SchemaObject {
  return value as SchemaObject;
}

function collectDiscriminantsFromEntry(entry: SchemaObject): Set<string> {
  const found = new Set<string>();
  const directType = entry.properties?.type?.const;
  if (typeof directType === 'string') found.add(directType);
  for (const nested of entry.anyOf ?? []) {
    for (const type of collectDiscriminantsFromEntry(nested)) found.add(type);
  }
  return found;
}

function variantSchema(): SchemaObject {
  const schema = schemaObject(EforgeEventSchema);
  const variants = schema.allOf?.find((entry) => Array.isArray(entry.anyOf));
  expect(variants, 'root intersect should include a variants union entry').toBeDefined();
  return variants!;
}

describe('EforgeEventSchema root shape', () => {
  it('keeps the envelope intersected with one flat variants union', () => {
    const schema = schemaObject(EforgeEventSchema);
    expect(Array.isArray(schema.allOf)).toBe(true);
    expect(schema.allOf).toHaveLength(2);

    const envelope = schema.allOf?.find((entry) => entry.properties?.timestamp);
    expect(envelope?.properties?.sessionId).toBeDefined();
    expect(envelope?.properties?.runId).toBeDefined();

    const variants = variantSchema();
    expect(Array.isArray(variants.anyOf)).toBe(true);
    expect(variants.anyOf!.length).toBeGreaterThan(Object.keys(eventRegistry).length);

    for (const entry of variants.anyOf!) {
      expect(
        hasDirectDiscriminant(entry) || Array.isArray(entry.anyOf),
        'each top-level variant entry should be a direct variant object or same-discriminant nested union',
      ).toBe(true);
      const discriminants = collectDiscriminantsFromEntry(entry);
      expect(discriminants.size, 'each top-level variant entry should expose a discriminant').toBeGreaterThan(0);
      if (!entry.anyOf) continue;
      expect(discriminants.size, 'nested direct entries are allowed only for same-discriminant variants, not event-family unions').toBe(1);
    }
  });

  it('exports schema discriminants for every registered event type', () => {
    const discriminants = new Set<string>();
    for (const entry of variantSchema().anyOf ?? []) {
      for (const type of collectDiscriminantsFromEntry(entry)) discriminants.add(type);
    }

    for (const type of Object.keys(eventRegistry)) {
      expect(discriminants.has(type), `${type} should be present in EforgeEventSchema`).toBe(true);
    }
  });
});

describe('EforgeEvent variant narrowing', () => {
  it('keeps representative Extract aliases structurally precise', () => {
    const reviewComplete: Extract<EforgeEvent, { type: 'plan:build:review:complete' }> = {
      type: 'plan:build:review:complete',
      timestamp: '2025-01-01T00:00:00.000Z',
      planId: 'plan-01',
      issues: [{ severity: 'warning', category: 'style', file: 'src/a.ts', description: 'Fix style' }],
    };
    const daemonRun: Extract<EforgeEvent, { type: 'daemon:run:upsert' }> = {
      type: 'daemon:run:upsert',
      timestamp: '2025-01-01T00:00:00.000Z',
      run: {
        id: 'run-1',
        planSet: 'feature-a',
        command: 'build',
        status: 'running',
        startedAt: '2025-01-01T00:00:00.000Z',
        cwd: '/repo',
      },
    };
    const stackLayer: Extract<EforgeEvent, { type: 'stack:layer:recorded' }> = {
      type: 'stack:layer:recorded',
      timestamp: '2025-01-01T00:00:00.000Z',
      prdId: 'prd-1',
      stackId: 'stack-1',
      provider: 'git-spice',
      branch: 'feature/prd-1',
      status: 'pending',
    };

    expect(reviewComplete.planId).toBe('plan-01');
    expect(reviewComplete.issues).toHaveLength(1);
    expect(daemonRun.run.planSet).toBe('feature-a');
    expect(daemonRun.run.command).toBe('build');
    expect(daemonRun.run.cwd).toBe('/repo');
    expect(stackLayer.stackId).toBe('stack-1');
  });
});

describe('safeParseEforgeEvent validation order', () => {
  it('reports review-issue metadata bounds before TypeBox failures', () => {
    const result = safeParseEforgeEvent({
      type: 'plan:build:review:complete',
      planId: 'plan-01',
      issues: [{ severity: 'warning', category: 'style', file: 'src/a.ts', description: 'Fix style', metadata: { huge: 'x'.repeat(4097) } }],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('metadata string');
  });

  it('returns TypeBox parse failures before semantic validation', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:action:start',
      invocationId: 'inv-1',
      actionId: 'tools.echo',
      extensionName: 'tools',
      extensionPath: '/repo/.eforge/extensions/tools.js',
      requestedBy: { host: 'console' },
      rawInput: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).not.toContain('raw input');
  });

  it('still returns semantic errors for TypeBox-valid raw extension action fields', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:action:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      invocationId: 'inv-1',
      actionId: 'tools.echo',
      extensionName: 'tools',
      extensionPath: '/repo/.eforge/extensions/tools.js',
      requestedBy: { host: 'console' },
      rawInput: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('raw input');
  });
});

describe('public event exports', () => {
  it('keeps representative event symbols available from public barrels', () => {
    const fromEvents: EventsBarrelEvent['type'] = 'session:start';
    const fromIndex: IndexEvent['type'] = 'session:end';
    const fromBrowser: BrowserEvent['type'] = 'daemon:auto-build:disabled';

    expect(eventsBarrelSchema).toBe(EforgeEventSchema);
    expect(indexSchema).toBe(EforgeEventSchema);
    expect(eventsBarrelParse).toBe(safeParseEforgeEvent);
    expect(indexParse).toBe(safeParseEforgeEvent);
    expect(browserReviewPerspectives).toContain('code');
    expect(browserSeverityOrder.critical).toBeLessThan(browserSeverityOrder.warning);
    expect(browserIsAlwaysYieldedAgentEvent({
      type: 'agent:stop',
      timestamp: '2025-01-01T00:00:00.000Z',
      agentId: 'agent-1',
      agent: 'builder',
    })).toBe(true);
    expect([fromEvents, fromIndex, fromBrowser]).toEqual(['session:start', 'session:end', 'daemon:auto-build:disabled']);
  });
});
