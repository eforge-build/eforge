import { describe, it, expect } from 'vitest';
import { safeParseEforgeEvent } from '../events.schemas.js';
import { eventRegistry, getEventSummary } from '../event-registry.js';
import { inputSourceVariants, prdEnricherVariants } from './events-schema-test-helpers.js';

describe('safeParseEforgeEvent — extension:input-source:* and extension:prd-enricher:* variants', () => {
  it('accepts input-source and prd-enricher variants with required fields', () => {
    for (const event of [...inputSourceVariants, ...prdEnricherVariants]) {
      const result = safeParseEforgeEvent(event);
      expect(result.success, `${event.type} should be accepted`).toBe(true);
    }
  });

  it('accepts extension:input-source:failed with all reason literals', () => {
    const reasons = ['not-found', 'error', 'timeout', 'invalid-result'] as const;
    for (const reason of reasons) {
      const result = safeParseEforgeEvent({
        type: 'extension:input-source:failed',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionPath: '/ext.js',
        extensionName: 'my-ext',
        adapterName: 'my-ext:linear',
        sourceId: 'LIN-1',
        reason,
        message: 'failed',
      });
      expect(result.success, `reason '${reason}' should be accepted`).toBe(true);
    }
  });

  it('accepts extension:input-source:failed with optional timeoutMs', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:input-source:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      extensionName: 'my-ext',
      adapterName: 'my-ext:linear',
      sourceId: 'LIN-1',
      reason: 'timeout',
      message: 'timed out',
      timeoutMs: 5000,
    });
    expect(result.success).toBe(true);
  });

  it('accepts extension:prd-enricher:failed with all reason literals', () => {
    const reasons = ['error', 'timeout', 'invalid-result'] as const;
    for (const reason of reasons) {
      const result = safeParseEforgeEvent({
        type: 'extension:prd-enricher:failed',
        timestamp: '2025-01-01T00:00:00.000Z',
        extensionPath: '/ext.js',
        extensionName: 'my-ext',
        enricherName: 'my-ext:enricher',
        sourceId: 'LIN-1',
        reason,
        message: 'failed',
      });
      expect(result.success, `reason '${reason}' should be accepted`).toBe(true);
    }
  });

  it('rejects extension:prd-enricher:applied missing enricherName', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:prd-enricher:applied',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      extensionName: 'my-ext',
      // enricherName intentionally omitted
      sourceId: 'LIN-1',
      changed: true,
      inputLength: 100,
      outputLength: 200,
    });
    expect(result.success).toBe(false);
  });

  it('rejects extension:input-source:failed with invalid reason literal', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:input-source:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      extensionName: 'my-ext',
      adapterName: 'my-ext:linear',
      sourceId: 'LIN-1',
      reason: 'network-error',
      message: 'failed',
    });
    expect(result.success).toBe(false);
  });

  it('rejects extension:prd-enricher:failed with invalid reason literal', () => {
    const result = safeParseEforgeEvent({
      type: 'extension:prd-enricher:failed',
      timestamp: '2025-01-01T00:00:00.000Z',
      extensionPath: '/ext.js',
      extensionName: 'my-ext',
      enricherName: 'my-ext:enricher',
      sourceId: 'LIN-1',
      reason: 'not-found',
      message: 'failed',
    });
    expect(result.success).toBe(false);
  });

  it('round-trips all four input-source/prd-enricher variants through JSON', () => {
    for (const event of [...inputSourceVariants, ...prdEnricherVariants]) {
      const parsed = JSON.parse(JSON.stringify(event));
      expect(parsed).toEqual(event);
      const result = safeParseEforgeEvent(parsed);
      expect(result.success, `${event.type} should roundtrip through safeParseEforgeEvent`).toBe(true);
    }
  });
});

describe('eventRegistry — extension:input-source:* and extension:prd-enricher:* variants', () => {
  it('registers all four variants as session-scoped, non-persistent events with summaries', () => {
    expect(eventRegistry['extension:input-source:fetched']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['extension:input-source:failed']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['extension:prd-enricher:applied']).toMatchObject({ scope: 'session', persist: false });
    expect(eventRegistry['extension:prd-enricher:failed']).toMatchObject({ scope: 'session', persist: false });
  });

  it('summary for input-source:fetched includes extension name, adapter name, source id, and content length', () => {
    const summary = getEventSummary(inputSourceVariants[0]!);
    expect(summary).toContain('my-ext');
    expect(summary).toContain('my-ext:linear');
    expect(summary).toContain('LIN-123');
    expect(summary).toContain('4200');
  });

  it('summary for input-source:failed includes extension name, adapter name, source id, and reason', () => {
    const summary = getEventSummary(inputSourceVariants[1]!);
    expect(summary).toContain('my-ext');
    expect(summary).toContain('my-ext:linear');
    expect(summary).toContain('LIN-404');
    expect(summary).toContain('not-found');
  });

  it('summary for prd-enricher:applied includes extension name, enricher name, source id, and changed flag', () => {
    const summary = getEventSummary(prdEnricherVariants[0]!);
    expect(summary).toContain('my-ext');
    expect(summary).toContain('my-ext:context-injector');
    expect(summary).toContain('LIN-123');
    expect(summary).toContain('true');
  });

  it('summary for prd-enricher:failed includes extension name, enricher name, source id, and reason', () => {
    const summary = getEventSummary(prdEnricherVariants[1]!);
    expect(summary).toContain('my-ext');
    expect(summary).toContain('my-ext:context-injector');
    expect(summary).toContain('LIN-123');
    expect(summary).toContain('error');
  });
});



// ---------------------------------------------------------------------------
// Dynamic perspective key tests
// ---------------------------------------------------------------------------
