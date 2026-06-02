import type { IncomingMessage } from 'node:http';

export const MAX_JSON_BODY_BYTES = 1024 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor(message = 'Request body too large') {
    super(message);
    this.name = 'RequestBodyTooLargeError';
  }
}

export function isRequestBodyTooLargeError(value: unknown): value is RequestBodyTooLargeError {
  return value instanceof RequestBodyTooLargeError;
}

export function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let settled = false;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      totalSize += chunk.length;
      if (totalSize > MAX_JSON_BODY_BYTES) {
        settle(() => reject(new RequestBodyTooLargeError()));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      settle(() => {
        const body = Buffer.concat(chunks).toString('utf-8');
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', (err) => settle(() => reject(err)));
  });
}
