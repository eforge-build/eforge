import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { MAX_JSON_BODY_BYTES, isRequestBodyTooLargeError, parseJsonBody } from '../http/request.js';

function req(body: string): IncomingMessage {
  const stream = new PassThrough();
  stream.end(body);
  return stream as unknown as IncomingMessage;
}

describe('parseJsonBody', () => {
  it('returns empty object for empty bodies', async () => {
    await expect(parseJsonBody(req(''))).resolves.toEqual({});
  });

  it('parses valid JSON', async () => {
    await expect(parseJsonBody(req('{"ok":true}'))).resolves.toEqual({ ok: true });
  });

  it('rejects invalid JSON without body-too-large classification', async () => {
    try {
      await parseJsonBody(req('{'));
      throw new Error('expected rejection');
    } catch (err) {
      expect(isRequestBodyTooLargeError(err)).toBe(false);
    }
  });

  it('rejects bodies larger than the limit', async () => {
    await expect(parseJsonBody(req('x'.repeat(MAX_JSON_BODY_BYTES + 1)))).rejects.toSatisfy(isRequestBodyTooLargeError);
  });
});
