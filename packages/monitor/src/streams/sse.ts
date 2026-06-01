import type { IncomingHttpHeaders, ServerResponse } from 'node:http';

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'Access-Control-Allow-Origin': '*',
} as const;

export function writeSseHeaders(res: ServerResponse): void {
  res.writeHead(200, SSE_HEADERS);
}

export function parseLastEventIdHeader(headers: IncomingHttpHeaders): number | undefined {
  const value = headers['last-event-id'];
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw.trim() === '') return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function dataLines(payload: string): string {
  return payload.split('\n').map((line) => `data: ${line}`).join('\n');
}

export function writeJsonDataFrame(res: ServerResponse, payload: unknown, id?: number): void {
  const serialized = JSON.stringify(payload);
  const idLine = id !== undefined ? `id: ${id}\n` : '';
  res.write(`${idLine}${dataLines(serialized)}\n\n`);
}

export function writeNamedFrame(res: ServerResponse, eventName: string, data: unknown): void {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  res.write(`event: ${eventName}\n${dataLines(payload)}\n\n`);
}

export function safeEnd(res: ServerResponse): void {
  try {
    res.end();
  } catch {
    // Response may already be closed.
  }
}
