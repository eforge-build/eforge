import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RunInfo } from '@eforge-build/client';
import { parseAcceptSuccessAppliedMetadata } from '@eforge-build/engine/recovery/applied-sidecar';

interface AcceptedSuccessRunTarget {
  setName: string;
  failedAt?: string;
  acceptedAt: string;
}

function readAcceptedSuccessCompletedRuns(queueDir: string): AcceptedSuccessRunTarget[] {
  const targets: AcceptedSuccessRunTarget[] = [];
  const failedDir = resolve(queueDir, 'failed');
  let entries: string[];
  try { entries = readdirSync(failedDir); } catch { return targets; }
  for (const file of entries.filter((entry) => entry.endsWith('.recovery.json'))) {
    try {
      const parsed = JSON.parse(readFileSync(resolve(failedDir, file), 'utf-8')) as { summary?: { setName?: unknown; failedAt?: unknown }; applied?: unknown };
      const setName = parsed.summary?.setName;
      const failedAt = parsed.summary?.failedAt;
      const applied = parseAcceptSuccessAppliedMetadata(parsed.applied);
      if (typeof setName === 'string' && applied?.landing.status === 'complete') {
        targets.push({ setName, ...(typeof failedAt === 'string' ? { failedAt } : {}), acceptedAt: applied.acceptedAt });
      }
    } catch {
      // Ignore malformed sidecars in read-time projections.
    }
  }
  return targets;
}

function isAcceptedSuccessFailedRun(run: RunInfo, setName: string): boolean {
  return run.planSet === setName && run.status === 'failed' && ['build', 'resume', 'run'].includes(run.command);
}

export function selectAcceptedSuccessRun(runs: RunInfo[], setName: string, failedAt?: string): RunInfo | undefined {
  const matching = runs.filter((run) => isAcceptedSuccessFailedRun(run, setName));
  if (failedAt) {
    const exact = matching.find((run) => run.completedAt === failedAt);
    if (exact) return exact;
  }
  return [...matching].sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt))[0];
}

export function projectRunsForAcceptedSuccess(runs: RunInfo[], queueDir?: string): RunInfo[] {
  if (!queueDir) return runs;
  const targets = readAcceptedSuccessCompletedRuns(queueDir);
  if (targets.length === 0) return runs;
  const acceptedAtByRunId = new Map<string, string>();
  for (const target of targets) {
    const run = selectAcceptedSuccessRun(runs, target.setName, target.failedAt);
    if (run) acceptedAtByRunId.set(run.id, target.acceptedAt);
  }
  if (acceptedAtByRunId.size === 0) return runs;
  return runs.map((run) => {
    const acceptedAt = acceptedAtByRunId.get(run.id);
    if (!acceptedAt) return run;
    return { ...run, status: 'completed', completedAt: run.completedAt ?? acceptedAt };
  });
}
