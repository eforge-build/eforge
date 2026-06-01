import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { sendJson, sendJsonError, sendText } from '../http/response.js';

let closeServer: (() => Promise<void>) | undefined;

async function hit(handler: (res: ServerResponse) => void): Promise<Response> {
  const server = createServer((_req, res) => handler(res));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  closeServer = () => new Promise((resolve) => server.close(() => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return fetch(`http://127.0.0.1:${addr.port}`);
}

afterEach(async () => {
  await closeServer?.();
  closeServer = undefined;
});

describe('response helpers', () => {
  it('sendJson emits defaults', async () => {
    const res = await hit((r) => sendJson(r, { ok: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('sendJson honors status', async () => {
    expect((await hit((r) => sendJson(r, { ok: false }, 201))).status).toBe(201);
  });

  it('sendJsonError emits error body', async () => {
    const res = await hit((r) => sendJsonError(r, 418, 'teapot'));
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: 'teapot' });
  });

  it('sendText only includes CORS when requested', async () => {
    const plain = await hit((r) => sendText(r, 200, 'plain'));
    expect(plain.headers.get('access-control-allow-origin')).toBeNull();
    const cors = await hit((r) => sendText(r, 200, 'cors', { cors: true }));
    expect(cors.headers.get('access-control-allow-origin')).toBe('*');
  });
});
