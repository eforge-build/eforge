/**
 * Typed Node helpers for the read-only resume eligibility daemon API endpoint.
 *
 * `GET /api/recover/resume-eligibility` is a preflight query: it reports whether
 * a compiled-build resume is available without creating worktrees, materializing
 * artifacts, or spawning a resume worker.
 */

import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type { ResumeEligibilityRequest, ResumeEligibilityResponse } from '../routes.js';

function buildResumeEligibilityPath(query: ResumeEligibilityRequest): string {
  const params = new URLSearchParams({ prdId: query.prdId });
  if (query.setName !== undefined) {
    params.set('setName', query.setName);
  }
  return `${API_ROUTES.resumeEligibility}?${params.toString()}`;
}

export function apiCheckResumeEligibility(opts: { cwd: string; query: ResumeEligibilityRequest }) {
  return daemonRequest<ResumeEligibilityResponse>(opts.cwd, 'GET', buildResumeEligibilityPath(opts.query));
}

export function apiCheckResumeEligibilityIfRunning(opts: { cwd: string; query: ResumeEligibilityRequest }) {
  return daemonRequestIfRunning<ResumeEligibilityResponse>(opts.cwd, 'GET', buildResumeEligibilityPath(opts.query));
}
