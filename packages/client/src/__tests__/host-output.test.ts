import { describe, expect, it } from 'vitest';
import {
  HOST_OUTPUT_CHAR_BUDGET,
  HOST_OUTPUT_GUIDANCE,
  hostOutputMetadataDetail,
  renderHostOutput,
} from '../host-output.js';

function expectOversized(text: string, rawLength: number) {
  expect(text.length).toBeLessThanOrEqual(HOST_OUTPUT_CHAR_BUDGET);
  expect(text).toContain(rawLength.toLocaleString());
  expect(text).toMatch(/truncated|summarized|summary/i);
  expect(text).toContain(HOST_OUTPUT_GUIDANCE);
}

describe('host output rendering', () => {
  it('exports the shared host output budget', () => {
    expect(HOST_OUTPUT_CHAR_BUDGET).toBe(12_000);
  });

  it('keeps small JSON as parseable pretty JSON without warnings', () => {
    const formatted = renderHostOutput({ ok: true, items: [1, 2] });

    expect(formatted.kind).toBe('json');
    expect(formatted.warnings).toEqual([]);
    expect(formatted.truncated).toBe(false);
    expect(JSON.parse(formatted.text)).toEqual({ ok: true, items: [1, 2] });
    expect(formatted.text).not.toMatch(/Warning|truncated|summarized/i);
  });

  it('summarizes huge objects within the host budget', () => {
    const value = Object.fromEntries(Array.from({ length: 250 }, (_, index) => [`key-${index}`, 'x'.repeat(300)]));
    const rawLength = JSON.stringify(value, null, 2).length;
    const formatted = renderHostOutput(value);

    expect(formatted.kind).toBe('json-summary');
    expect(formatted.summarized).toBe(true);
    expectOversized(formatted.text, rawLength);
  });

  it('summarizes huge arrays within the host budget', () => {
    const value = Array.from({ length: 500 }, (_, index) => ({ id: `item-${index}`, body: 'x'.repeat(200) }));
    const rawLength = JSON.stringify(value, null, 2).length;
    const formatted = renderHostOutput(value);

    expect(formatted.kind).toBe('json-summary');
    expect(formatted.text).toContain('"count": 500');
    expect(formatted.text).toContain('"omitted": 495');
    expectOversized(formatted.text, rawLength);
  });

  it('preserves repeated non-cyclic references in small JSON', () => {
    const shared = { id: 'shared' };
    const formatted = renderHostOutput({ first: shared, second: shared });

    expect(formatted.kind).toBe('json');
    expect(JSON.parse(formatted.text)).toEqual({ first: { id: 'shared' }, second: { id: 'shared' } });
  });

  it('marks only true JSON cycles as circular', () => {
    const value: { self?: unknown } = {};
    value.self = value;
    const formatted = renderHostOutput(value);

    expect(formatted.kind).toBe('json');
    expect(JSON.parse(formatted.text)).toEqual({ self: '[Circular]' });
  });

  it('bounds recursive array summaries', () => {
    const value: unknown[] = ['x'.repeat(20_000)];
    value.unshift(value);
    const formatted = renderHostOutput(value);

    expect(formatted.kind).toBe('json-summary');
    expect(formatted.text).toContain('"count": 2');
    expect(formatted.text).toContain('"omitted": 2');
  });

  it('truncates huge strings within the host budget', () => {
    const value = 'x'.repeat(50_000);
    const formatted = renderHostOutput(value);

    expect(formatted.kind).toBe('text');
    expect(formatted.truncated).toBe(true);
    expectOversized(formatted.text, value.length);
  });

  it('normalizes huge Error instances within the host budget', () => {
    const error = new Error('failure: ' + 'x'.repeat(30_000));
    error.stack = 'stack-line\n'.repeat(4_000);
    const formatted = renderHostOutput(error);

    expect(formatted.kind).toBe('error');
    expect(formatted.text).toContain('Error');
    expectOversized(formatted.text, formatted.rawLength);
  });

  it('normalizes cyclic Error causes without overflowing', () => {
    const error = new Error('failure') as Error & { cause?: unknown };
    error.cause = error;
    const formatted = renderHostOutput(error);

    expect(formatted.kind).toBe('error');
    const parsed = JSON.parse(formatted.text);
    expect(parsed.cause ?? parsed.error?.cause).toEqual({ name: 'Error', message: '[Circular Error cause]' });
  });

  it('reports and warns when only an Error stack is oversized', () => {
    const error = new Error('failure');
    error.stack = 'stack-line\n'.repeat(4_000);
    const formatted = renderHostOutput(error);

    expect(formatted.rawLength).toBeGreaterThan(20_000);
    expect(formatted.summarized).toBe(true);
    expect(formatted.metadata.guidance).toBe(HOST_OUTPUT_GUIDANCE);
  });

  it('falls back when unknown host values cannot be JSON serialized', () => {
    const formatted = renderHostOutput({ toJSON: () => { throw new Error('nope'); } });

    expect(formatted.kind).toBe('json-summary');
    expect(formatted.summarized).toBe(true);
    expect(formatted.text).toContain('nope');
    expect(formatted.metadata.guidance).toBe(HOST_OUTPUT_GUIDANCE);
  });

  it('returns Pi-friendly metadata details', () => {
    const formatted = renderHostOutput('x'.repeat(20_000));
    const details = hostOutputMetadataDetail(formatted);

    expect(details.hostOutput).toMatchObject({ budget: HOST_OUTPUT_CHAR_BUDGET, rawLength: 20_000, truncated: true });
  });
});
