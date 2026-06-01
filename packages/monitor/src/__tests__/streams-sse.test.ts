import { describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import { parseLastEventIdHeader, writeJsonDataFrame, writeNamedFrame } from '../streams/sse.js';

function captureRes(): { res: ServerResponse; chunks: string[] } {
  const chunks: string[] = [];
  return { res: { write: (chunk: string) => { chunks.push(chunk); return true; } } as unknown as ServerResponse, chunks };
}

describe('streams/sse helpers', () => {
  it('formats JSON data frames with and without id', () => {
    const a = captureRes();
    writeJsonDataFrame(a.res, { ok: true }, 7);
    expect(a.chunks.join('')).toBe('id: 7\ndata: {"ok":true}\n\n');

    const b = captureRes();
    writeJsonDataFrame(b.res, { ok: true });
    expect(b.chunks.join('')).toBe('data: {"ok":true}\n\n');
  });

  it('formats named frames', () => {
    const c = captureRes();
    writeNamedFrame(c.res, 'monitor:shutdown-pending', 'soon');
    expect(c.chunks.join('')).toBe('event: monitor:shutdown-pending\ndata: soon\n\n');
  });

  it('parses Last-Event-ID values using current semantics', () => {
    expect(parseLastEventIdHeader({})).toBeUndefined();
    expect(parseLastEventIdHeader({ 'last-event-id': '0' })).toBe(0);
    expect(parseLastEventIdHeader({ 'last-event-id': '42' })).toBe(42);
    expect(parseLastEventIdHeader({ 'last-event-id': '42abc' })).toBe(42);
    expect(parseLastEventIdHeader({ 'last-event-id': '-1' })).toBeUndefined();
    expect(parseLastEventIdHeader({ 'last-event-id': '1.5' })).toBe(1);
    expect(parseLastEventIdHeader({ 'last-event-id': 'nope' })).toBeUndefined();
  });
});
