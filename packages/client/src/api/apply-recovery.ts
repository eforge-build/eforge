/**
 * Typed helper for the apply-recovery daemon API endpoint.
 */

import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type { ApplyRecoveryRequest, ApplyRecoveryResponse } from '../routes.js';

export function apiApplyRecovery(opts: { cwd: string; body: ApplyRecoveryRequest }) {
  return daemonRequest<ApplyRecoveryResponse>(opts.cwd, 'POST', API_ROUTES.applyRecovery, opts.body);
}

export function apiApplyRecoveryIfRunning(opts: { cwd: string; body: ApplyRecoveryRequest }) {
  return daemonRequestIfRunning<ApplyRecoveryResponse>(opts.cwd, 'POST', API_ROUTES.applyRecovery, opts.body);
}
