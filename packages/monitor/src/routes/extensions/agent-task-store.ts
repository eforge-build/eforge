import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  parseExtensionAgentTaskRecord,
  type ExtensionAgentTaskRecord,
} from '@eforge-build/client';

export interface ExtensionAgentTaskOwner {
  extensionName: string;
  extensionPath: string;
}

export type StoredExtensionAgentTaskRecord = ExtensionAgentTaskRecord & {
  owner?: ExtensionAgentTaskOwner;
};

const TASK_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export class AgentTaskStoreError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = 'AgentTaskStoreError';
  }
}

export function createAgentTaskId(): string {
  return `task-${randomUUID()}`;
}

export function isValidAgentTaskId(taskId: string): boolean {
  return TASK_ID_PATTERN.test(taskId);
}

export function assertValidAgentTaskId(taskId: string): void {
  if (!isValidAgentTaskId(taskId)) {
    throw new AgentTaskStoreError('Invalid task id', 400);
  }
}

export function resolveAgentTaskStorageDir(cwd: string): string {
  return resolve(cwd, '.eforge', 'storage', 'agent-tasks');
}

export function resolveAgentTaskRecordPath(cwd: string, taskId: string): string {
  assertValidAgentTaskId(taskId);
  return resolve(resolveAgentTaskStorageDir(cwd), `${taskId}.json`);
}

export async function readAgentTaskRecord(cwd: string, taskId: string): Promise<StoredExtensionAgentTaskRecord | null> {
  const path = resolveAgentTaskRecordPath(cwd, taskId);
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const parsed = JSON.parse(raw) as StoredExtensionAgentTaskRecord;
  parseExtensionAgentTaskRecord(projectAgentTaskRecord(parsed));
  return parsed;
}

export async function writeAgentTaskRecord(cwd: string, record: StoredExtensionAgentTaskRecord): Promise<void> {
  assertValidAgentTaskId(record.taskId);
  parseExtensionAgentTaskRecord(projectAgentTaskRecord(record));
  const dir = resolveAgentTaskStorageDir(cwd);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const target = resolveAgentTaskRecordPath(cwd, record.taskId);
  const tmp = `${target}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  await rename(tmp, target);
  await chmod(target, 0o600);
}

export function projectAgentTaskRecord(record: StoredExtensionAgentTaskRecord): ExtensionAgentTaskRecord {
  const { owner: _owner, ...projected } = record;
  return projected as ExtensionAgentTaskRecord;
}
