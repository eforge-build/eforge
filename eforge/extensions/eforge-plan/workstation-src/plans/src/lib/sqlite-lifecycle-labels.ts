import type { RecommendationDisposition, SQLiteLifecycleReasonCode, PlanningStoreStatus } from '@/workstation-view-model-types';
import type { Tone } from './tone';

const REASON_LABELS: Record<string, { label: string; tone: Tone }> = {
  'queued-build': { label: 'Queued build', tone: 'info' },
  'running-build': { label: 'Running build', tone: 'info' },
  'open-pr': { label: 'Open PR', tone: 'warn' },
  'merged-result': { label: 'Merged result', tone: 'done' },
  'shipped-result': { label: 'Shipped result', tone: 'done' },
  'failed-result': { label: 'Failed result', tone: 'danger' },
  'partial-plan': { label: 'Partial plan', tone: 'warn' },
  'planned-session-plan': { label: 'Planned session plan', tone: 'neutral' },
  'submitted-session-plan': { label: 'Submitted session plan', tone: 'info' },
  'active-planning-task': { label: 'Active planning task', tone: 'info' },
  'queued-trace': { label: 'Queued build', tone: 'info' },
  'building-trace': { label: 'Running build', tone: 'info' },
  'active-build-session-trace': { label: 'Running build session', tone: 'info' },
  'open-pr-trace': { label: 'Open PR', tone: 'warn' },
};

const LIFECYCLE_LABELS: Record<string, { label: string; tone: Tone }> = {
  none: { label: 'No lifecycle evidence', tone: 'neutral' },
  planned: { label: 'Planned', tone: 'neutral' },
  active: { label: 'Active', tone: 'info' },
  queue: { label: 'Queued', tone: 'info' },
  build: { label: 'Building', tone: 'info' },
  'pr-open': { label: 'PR open', tone: 'warn' },
  merged: { label: 'Merged', tone: 'done' },
  shipped: { label: 'Shipped', tone: 'done' },
  failed: { label: 'Failed', tone: 'danger' },
  partial: { label: 'Partial', tone: 'warn' },
};

const DISPOSITION_LABELS: Record<RecommendationDisposition, { label: string; tone: Tone }> = {
  actionable: { label: 'Actionable', tone: 'done' },
  suppressed: { label: 'Suppressed', tone: 'neutral' },
  'de-actioned': { label: 'De-actioned', tone: 'warn' },
  relocated: { label: 'Relocated', tone: 'info' },
};

export function reasonCodeDisplay(code: SQLiteLifecycleReasonCode | undefined): { label: string; tone: Tone } {
  if (!code) return { label: 'Lifecycle evidence', tone: 'neutral' };
  return REASON_LABELS[code] ?? { label: titleize(code), tone: 'neutral' };
}

export function lifecycleDisplay(value: string | undefined): { label: string; tone: Tone } | null {
  if (!value) return null;
  return LIFECYCLE_LABELS[value] ?? { label: titleize(value), tone: 'neutral' };
}

export function dispositionDisplay(value: RecommendationDisposition | undefined): { label: string; tone: Tone } | null {
  if (!value) return null;
  return DISPOSITION_LABELS[value] ?? { label: titleize(value), tone: 'neutral' };
}

export function formatBytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return 'unknown size';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let amount = value / 1024;
  let unit = units[0];
  for (let index = 1; amount >= 1024 && index < units.length; index += 1) { amount /= 1024; unit = units[index]; }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${unit}`;
}

export function formatCount(value: number | undefined, singular: string, plural = `${singular}s`): string {
  const count = value ?? 0;
  return `${count} ${count === 1 ? singular : plural}`;
}

export function storeStatusSummary(status: PlanningStoreStatus | null | undefined, error?: string | null): { label: string; tone: Tone } {
  if (error) return { label: 'status unavailable', tone: 'danger' };
  if (!status) return { label: 'loading', tone: 'neutral' };
  if (!status.initialized) return { label: 'not initialized', tone: 'warn' };
  if (status.searchIndexStatus?.dirty) return { label: 'dirty index', tone: 'warn' };
  return { label: 'ready', tone: 'done' };
}

function titleize(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}
