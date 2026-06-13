/**
 * Typed Node helpers for the read-only continue-and-repair eligibility daemon API endpoint.
 *
 * `GET /api/recover/continue-repair/eligibility` is a preflight query: it reports
 * whether continue-and-repair can use preserved compiled artifacts without
 * creating worktrees, materializing artifacts, or mutating the queue.
 */

import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type { ContinueRepairEligibilityRequest, ContinueRepairEligibilityResponse } from '../routes.js';

function buildContinueRepairEligibilityPath(query: ContinueRepairEligibilityRequest): string {
  const params = new URLSearchParams({ prdId: query.prdId });
  if (query.setName !== undefined) {
    params.set('setName', query.setName);
  }
  return `${API_ROUTES.continueRepairEligibility}?${params.toString()}`;
}

export function apiCheckContinueRepairEligibility(opts: { cwd: string; query: ContinueRepairEligibilityRequest }) {
  return daemonRequest<ContinueRepairEligibilityResponse>(opts.cwd, 'GET', buildContinueRepairEligibilityPath(opts.query));
}

export function apiCheckContinueRepairEligibilityIfRunning(opts: { cwd: string; query: ContinueRepairEligibilityRequest }) {
  return daemonRequestIfRunning<ContinueRepairEligibilityResponse>(opts.cwd, 'GET', buildContinueRepairEligibilityPath(opts.query));
}
