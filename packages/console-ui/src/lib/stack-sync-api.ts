/**
 * Browser POST helper for the stack sync API.
 * Uses API_ROUTES constants — never hardcodes /api/ path strings.
 */
import { API_ROUTES } from '@eforge-build/client/browser';
import type { StackSyncRequest, StackSyncResponse } from '@eforge-build/client/browser';

/**
 * POST to the stack sync route with the given request body.
 * Rejects with an Error containing the HTTP status on non-2xx responses.
 */
export async function postStackSync(body: StackSyncRequest): Promise<StackSyncResponse> {
  const res = await fetch(API_ROUTES.stackSync, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} posting stack sync`);
  }
  return res.json() as Promise<StackSyncResponse>;
}
