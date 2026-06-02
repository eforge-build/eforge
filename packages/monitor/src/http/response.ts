import type { ServerResponse } from 'node:http';

export function buildJsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
}

export const jsonHeaders = buildJsonHeaders;

export function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  if (!res.headersSent) res.writeHead(status, buildJsonHeaders());
  res.end(JSON.stringify(data));
}

export function sendJsonError(res: ServerResponse, status: number, error: string): void {
  sendJson(res, { error }, status);
}

export function sendText(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  options: { contentType?: string; cors?: boolean; headers?: Record<string, string | number> } = {},
): void {
  if (!res.headersSent) {
    const headers: Record<string, string | number> = {
      'Content-Type': options.contentType ?? 'text/plain; charset=utf-8',
      ...options.headers,
    };
    if (options.cors === true) headers['Access-Control-Allow-Origin'] = '*';
    res.writeHead(status, headers);
  }
  res.end(body);
}
