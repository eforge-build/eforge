import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EFORGE_PLAN_STORE_RELATIVE_DIR } from '../sqlite/constants.js';
import type { ArchivePathReport, ArchiveRow, MaintenanceCategory } from './types.js';

export function archiveDirectory(cwd: string, runId: string): string {
  assertSafeSegment(runId, 'runId');
  return join(cwd, EFORGE_PLAN_STORE_RELATIVE_DIR, 'archives', 'maintenance', runId);
}

export function archiveCategoryRows(cwd: string, runId: string, category: MaintenanceCategory, rows: ArchiveRow[]): ArchivePathReport | undefined {
  if (rows.length === 0) return undefined;
  assertSafeSegment(category, 'category');
  const dir = archiveDirectory(cwd, runId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${category}.jsonl`);
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  return { category, path: relative(cwd, path), rowCount: rows.length };
}

function assertSafeSegment(value: string, label: string): void {
  if (value.includes('/') || value.includes('\\') || value.includes('..') || value.length === 0) throw new Error(`Invalid ${label} for maintenance archive path.`);
}
