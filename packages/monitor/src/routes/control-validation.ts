import { relative, isAbsolute } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseJsonBody, isRequestBodyTooLargeError } from '../http/request.js';
import { sendJsonError, sendText } from '../http/response.js';

export interface JsonObjectParseResult {
  ok: boolean;
  value?: Record<string, unknown>;
  tooLarge?: boolean;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidPathSegment(value: string): boolean {
  return value.length > 0 && !value.includes('/') && !value.includes('\\') && !value.includes('..') && !value.includes('\0');
}

export function isSafeRouteId(value: string | undefined): value is string {
  return typeof value === 'string' && /^[\w-]+$/.test(value);
}

export function isWithinDir(resolvedPath: string, baseDir: string): boolean {
  const rel = relative(baseDir, resolvedPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export async function parseJsonObjectBody(req: IncomingMessage): Promise<JsonObjectParseResult> {
  try {
    const raw = await parseJsonBody(req);
    if (!isPlainObject(raw)) return { ok: false };
    return { ok: true, value: raw };
  } catch (err) {
    return { ok: false, tooLarge: isRequestBodyTooLargeError(err) };
  }
}

export async function readJsonBody(req: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; tooLarge?: boolean }> {
  try { return { ok: true, value: await parseJsonBody(req) }; }
  catch (err) { return { ok: false, tooLarge: isRequestBodyTooLargeError(err) }; }
}

export function sendLegacyTextParameterFailure(res: ServerResponse, message: string): void {
  sendText(res, 400, message);
}

export function sendInvalidJson(res: ServerResponse): void {
  sendJsonError(res, 400, 'Invalid JSON body');
}
