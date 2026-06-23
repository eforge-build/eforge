import {
  formatExtensionContributionOutputText,
  invokeEforgeExtensionContribution,
  type ExtensionHostContributionInvokeResult,
  type ExtensionJsonObject,
} from '@eforge-build/client';

export type PlaybookCommandAction = 'list' | 'show' | 'save' | 'validate' | 'copy' | 'promote' | 'demote' | 'run';

export const PLAYBOOK_EXTENSION_NAME = 'eforge-playbooks';
export const PLAYBOOK_UNAVAILABLE_MESSAGE = 'eforge-playbooks extension is unavailable';
export const planningContributionId = 'eforge-plan:open-planning-entry';

const CLI_REQUESTED_BY = { host: 'cli' } as const;

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

export async function invokePlaybookContributionForHost(opts: {
  cwd: string;
  action: PlaybookCommandAction;
  input?: ExtensionJsonObject;
  host?: 'cli' | 'mcp';
}): Promise<ExtensionHostContributionInvokeResult> {
  try {
    return await invokeEforgeExtensionContribution({
      cwd: opts.cwd,
      kind: 'command',
      id: PLAYBOOK_CONTRIBUTION_IDS[opts.action],
      input: opts.input ?? {},
      requestedBy: opts.host === undefined ? CLI_REQUESTED_BY : { host: opts.host },
    });
  } catch (err) {
    throw new Error(`${err instanceof Error ? err.message : String(err)}\n\n${PLAYBOOK_UNAVAILABLE_MESSAGE}. Install, trust, and reload eforge-playbooks, then retry.`);
  }
}

export function renderPlaybookContributionResult(result: ExtensionHostContributionInvokeResult): void {
  if (result.response.ok) {
    console.log(formatExtensionContributionOutputText(result.response.output, { outputProfile: result.target.outputProfile }));
    return;
  }
  console.error(`${result.response.error.code}: ${result.response.error.message}`);
  if (result.response.error.details !== undefined) console.error(JSON.stringify(result.response.error.details, null, 2));
  process.exit(1);
}
