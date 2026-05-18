/**
 * Typed helpers for daemon status and control API endpoints.
 */

import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type { HealthResponse, AutoBuildState, ProjectContext, KeepAliveResponse } from '../types.js';
import type { AutoBuildSetRequest } from '../routes.js';

export function apiHealth(opts: { cwd: string }) {
  return daemonRequest<HealthResponse>(opts.cwd, 'GET', API_ROUTES.health);
}

export function apiKeepAlive(opts: { cwd: string }) {
  return daemonRequest<KeepAliveResponse>(opts.cwd, 'POST', API_ROUTES.keepAlive);
}

export function apiGetProjectContext(opts: { cwd: string }) {
  return daemonRequest<ProjectContext>(opts.cwd, 'GET', API_ROUTES.projectContext);
}

export function apiGetAutoBuild(opts: { cwd: string }) {
  return daemonRequest<AutoBuildState>(opts.cwd, 'GET', API_ROUTES.autoBuildGet);
}

export function apiSetAutoBuild(opts: { cwd: string; body: AutoBuildSetRequest }) {
  return daemonRequest<AutoBuildState>(opts.cwd, 'POST', API_ROUTES.autoBuildSet, opts.body);
}

export function apiHealthIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<HealthResponse>(opts.cwd, 'GET', API_ROUTES.health);
}

export function apiKeepAliveIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<KeepAliveResponse>(opts.cwd, 'POST', API_ROUTES.keepAlive);
}

export function apiGetProjectContextIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<ProjectContext>(opts.cwd, 'GET', API_ROUTES.projectContext);
}

export function apiGetAutoBuildIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<AutoBuildState>(opts.cwd, 'GET', API_ROUTES.autoBuildGet);
}

export function apiSetAutoBuildIfRunning(opts: { cwd: string; body: AutoBuildSetRequest }) {
  return daemonRequestIfRunning<AutoBuildState>(opts.cwd, 'POST', API_ROUTES.autoBuildSet, opts.body);
}
