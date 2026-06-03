import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach } from 'vitest';
import type { WorkerTracker } from '@eforge-build/monitor/server';

let previousXdgConfigHome: string | undefined;
let hasIsolatedXdgConfigHome = false;

function isolateXdgConfigHome(tmpDir: string): void {
  if (!hasIsolatedXdgConfigHome) {
    previousXdgConfigHome = process.env.XDG_CONFIG_HOME;
    hasIsolatedXdgConfigHome = true;
  }
  process.env.XDG_CONFIG_HOME = resolve(tmpDir, 'xdg-config');
}

afterEach(() => {
  if (!hasIsolatedXdgConfigHome) return;
  if (previousXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = previousXdgConfigHome;
  }
  previousXdgConfigHome = undefined;
  hasIsolatedXdgConfigHome = false;
});

export async function setupProject(tmpDir: string): Promise<void> {
  isolateXdgConfigHome(tmpDir);
  const gitOpts = { cwd: tmpDir };
  execFileSync('git', ['init', '-b', 'main'], gitOpts);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
  execFileSync('git', ['config', 'user.name', 'Test'], gitOpts);
  await writeFile(resolve(tmpDir, '.gitignore'), '.eforge/\n', 'utf-8');
  const configDir = resolve(tmpDir, 'eforge');
  await mkdir(resolve(tmpDir, 'xdg-config'), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await writeFile(resolve(configDir, 'config.yaml'), '{}\n', 'utf-8');
  execFileSync('git', ['add', '.gitignore'], gitOpts);
  execFileSync('git', ['commit', '-m', 'chore: initial commit'], gitOpts);
}

export function makeStubTracker(): { tracker: WorkerTracker; calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  return {
    calls,
    tracker: {
      spawnWorker(command: string, args: string[]): { sessionId: string; pid: number } {
        calls.push({ command, args });
        return { sessionId: 'spawned-session', pid: 99999 };
      },
      cancelWorker(_sessionId: string): boolean {
        return false;
      },
    },
  };
}

export function validPlanningPlaybookRaw(opts: { name?: string; profile?: string } = {}): string {
  const { name = 'my-planning', profile } = opts;
  const lines = ['---', `name: ${name}`, 'description: Plan with an agent', 'scope: project-team', 'mode: planning'];
  if (profile) lines.push(`profile: ${profile}`);
  lines.push(
    '---',
    '',
    '## Goal',
    '',
    'Investigate and plan the feature.',
    '',
    '## Acceptance criteria',
    '',
    '- Plan identifies implementation steps.',
  );
  return lines.join('\n');
}

export function validAutonomousPlaybookRaw(opts: { name?: string } = {}): string {
  const { name = 'my-auto' } = opts;
  return ['---', `name: ${name}`, 'description: Run autonomously', 'scope: project-team', 'mode: autonomous', '---', '', '## Goal', '', 'Implement the feature.'].join('\n');
}

export async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function makeSessionPlanRaw(opts: {
  session?: string;
  topic?: string;
  status?: string;
  eforgeSession?: string;
  agentProfile?: string;
  requiredDimensions?: string[];
  optionalDimensions?: string[];
  skippedDimensions?: string[];
} = {}): string {
  const {
    session = '2026-01-01-add-feature',
    topic = 'Add feature',
    status = 'planning',
    eforgeSession,
    agentProfile,
    requiredDimensions = ['scope', 'acceptance-criteria'],
    optionalDimensions = ['risks'],
    skippedDimensions = [],
  } = opts;
  const lines = [
    '---',
    `session: ${session}`,
    `topic: ${topic}`,
    `status: ${status}`,
    'planning_type: feature',
    'planning_depth: focused',
  ];
  if (eforgeSession) lines.push(`eforge_session: ${eforgeSession}`);
  if (agentProfile) lines.push(`agent_profile: ${agentProfile}`);
  lines.push(
    `required_dimensions: ${JSON.stringify(requiredDimensions)}`,
    `optional_dimensions: ${JSON.stringify(optionalDimensions)}`,
    `skipped_dimensions: ${JSON.stringify(skippedDimensions.map((name) => ({ name, reason: 'Skipped by test fixture.' })))}`,
    '---',
    '',
    '## Objective',
    '',
    'Implement the requested change.',
    '',
    '## Architecture Context',
    '',
    'Use the existing route contracts.',
    '',
    '## Implementation Plan',
    '',
    'Split the work into focused steps.',
    '',
    '## Acceptance Criteria',
    '',
    '- `pnpm test` exits 0.',
  );
  return lines.join('\n');
}

export async function writeSessionPlanFile(tmpDir: string, session: string, content: string): Promise<string> {
  const dir = resolve(tmpDir, '.eforge', 'session-plans');
  await mkdir(dir, { recursive: true });
  const filePath = resolve(dir, `${session}.md`);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

export function makeLegacySessionPlanRaw(session: string): string {
  return [
    '---',
    `session: ${session}`,
    'topic: Legacy plan',
    'status: planning',
    'planning_type: feature',
    'planning_depth: focused',
    'dimensions:',
    '  architecture: true',
    '  implementation: false',
    '---',
    '',
    '## Objective',
    '',
    'Migrate the legacy plan.',
  ].join('\n');
}

export function makeSessionPlanWithAc(session: string, acLines: string[]): string {
  return [
    '---',
    `session: ${session}`,
    'topic: AC quality',
    'status: planning',
    'planning_type: feature',
    'planning_depth: focused',
    'required_dimensions: ["acceptance-criteria"]',
    'optional_dimensions: []',
    'skipped_dimensions: []',
    '---',
    '',
    '## Objective',
    '',
    'Validate acceptance criteria.',
    '',
    '## Acceptance Criteria',
    '',
    ...acLines,
  ].join('\n');
}

export async function createProfile(tmpDir: string, name: string): Promise<void> {
  const profilesDir = resolve(tmpDir, 'eforge', 'profiles');
  await mkdir(profilesDir, { recursive: true });
  await writeFile(resolve(profilesDir, `${name}.yaml`), `name: ${name}\n`, 'utf-8');
}

export function rawSessionPlan(opts: { title?: string; slug?: string } = {}): string {
  const { title = 'Test Session Plan', slug = 'test-session-plan' } = opts;
  return [
    '---',
    `title: ${title}`,
    `slug: ${slug}`,
    '---',
    '',
    '## Objective',
    '',
    'Implement the requested change.',
  ].join('\n');
}
