/**
 * Typed helper for the queued continue-and-repair daemon API endpoint.
 */

import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type { ContinueRepairRequest, ContinueRepairResponse } from '../routes.js';

export function apiContinueRepair(opts: { cwd: string; body: ContinueRepairRequest }) {
  return daemonRequest<ContinueRepairResponse>(opts.cwd, 'POST', API_ROUTES.continueRepair, opts.body);
}

export function apiContinueRepairIfRunning(opts: { cwd: string; body: ContinueRepairRequest }) {
  return daemonRequestIfRunning<ContinueRepairResponse>(opts.cwd, 'POST', API_ROUTES.continueRepair, opts.body);
}
