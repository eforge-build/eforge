/**
 * Typed helpers for scheduler endpoints.
 */

import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type { SchedulerKickResponse, SchedulerPauseResponse, SchedulerResumeResponse } from '../routes/scheduler.js';

export type { SchedulerKickResponse } from '../routes/scheduler.js';

export function apiSchedulerKick(opts: { cwd: string }): Promise<{ data: SchedulerKickResponse; port: number }> {
  return daemonRequest<SchedulerKickResponse>(opts.cwd, 'POST', API_ROUTES.schedulerKick);
}

export function apiSchedulerPause(opts: { cwd: string }) {
  return daemonRequest<SchedulerPauseResponse>(opts.cwd, 'POST', API_ROUTES.schedulerPause);
}

export function apiSchedulerPauseIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<SchedulerPauseResponse>(opts.cwd, 'POST', API_ROUTES.schedulerPause);
}

export function apiSchedulerResume(opts: { cwd: string }) {
  return daemonRequest<SchedulerResumeResponse>(opts.cwd, 'POST', API_ROUTES.schedulerResume);
}

export function apiSchedulerResumeIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<SchedulerResumeResponse>(opts.cwd, 'POST', API_ROUTES.schedulerResume);
}
