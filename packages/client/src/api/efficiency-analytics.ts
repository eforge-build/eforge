import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type { EfficiencyAnalyticsSummary } from '../types.js';

function efficiencyAnalyticsPath(days?: number): string {
  if (days === undefined) return API_ROUTES.efficiencyAnalytics;
  const query = new URLSearchParams({ days: String(days) });
  return `${API_ROUTES.efficiencyAnalytics}?${query.toString()}`;
}

export function apiGetEfficiencyAnalytics(opts: { cwd: string; days?: number }) {
  return daemonRequest<EfficiencyAnalyticsSummary>(opts.cwd, 'GET', efficiencyAnalyticsPath(opts.days));
}

export function apiGetEfficiencyAnalyticsIfRunning(opts: { cwd: string; days?: number }) {
  return daemonRequestIfRunning<EfficiencyAnalyticsSummary>(opts.cwd, 'GET', efficiencyAnalyticsPath(opts.days));
}
