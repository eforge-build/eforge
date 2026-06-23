import {
  invokeEforgeExtensionContributionIfRunning,
  type ExtensionHostContributionInvokeResult,
  type ExtensionJsonObject,
} from '@eforge-build/client';
import { DAEMON_NOT_RUNNING_GUIDANCE } from './daemon-requests.js';

export type PlaybookCommandAction = 'list' | 'show' | 'save' | 'validate' | 'copy' | 'promote' | 'demote' | 'run';

export const PLAYBOOK_CONTRIBUTION_IDS = {
  list: 'eforge-playbooks:list-playbooks',
  show: 'eforge-playbooks:show-playbook',
  save: 'eforge-playbooks:save-playbook',
  validate: 'eforge-playbooks:validate-playbook',
  copy: 'eforge-playbooks:copy-playbook',
  promote: 'eforge-playbooks:promote-playbook',
  demote: 'eforge-playbooks:demote-playbook',
  run: 'eforge-playbooks:run-playbook',
} as const satisfies Record<PlaybookCommandAction, string>;

export async function invokePlaybookContributionIfRunning(opts: {
  cwd: string;
  action: PlaybookCommandAction;
  input?: ExtensionJsonObject;
}): Promise<ExtensionHostContributionInvokeResult> {
  const result = await invokeEforgeExtensionContributionIfRunning({
    cwd: opts.cwd,
    kind: 'command',
    id: PLAYBOOK_CONTRIBUTION_IDS[opts.action],
    input: opts.input ?? {},
    requestedBy: { host: 'pi' },
  });
  if (result === null) throw new Error(DAEMON_NOT_RUNNING_GUIDANCE);
  return result;
}

export function eforgePlaybooksUnavailableMessage(message: string): string {
  return `${message}\n\neforge-playbooks extension is unavailable. Install, trust, and reload eforge-playbooks, then retry.`;
}
