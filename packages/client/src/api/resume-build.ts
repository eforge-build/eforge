/**
 * Typed helper for the resume-build daemon API endpoint.
 */

import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type { ResumeBuildRequest, ResumeBuildResponse } from '../routes.js';

export function apiResumeBuild(opts: { cwd: string; body: ResumeBuildRequest }) {
  return daemonRequest<ResumeBuildResponse>(opts.cwd, 'POST', API_ROUTES.resumeBuild, opts.body);
}

export function apiResumeBuildIfRunning(opts: { cwd: string; body: ResumeBuildRequest }) {
  return daemonRequestIfRunning<ResumeBuildResponse>(opts.cwd, 'POST', API_ROUTES.resumeBuild, opts.body);
}
