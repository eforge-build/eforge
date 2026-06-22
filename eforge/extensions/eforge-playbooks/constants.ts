export const EXTENSION_NAME = 'eforge-playbooks';

export const PLAYBOOK_MANAGEMENT_CAPABILITY = 'eforge.playbooks.management';
export const PLAYBOOK_RUN_CAPABILITY = 'eforge.playbooks.run';
export const PLANNING_MODE_CAPABILITY = 'eforge.plan.planning-mode-playbook';
export const PLANNING_MODE_CAPABILITY_VERSION = '>=1.0.0';

export const PLANNING_ENTRY_ACTION_ID = 'eforge-plan:open-planning-entry';
export const PLANNING_ENTRY_COMMAND_ID = 'eforge-plan:open-planning-entry';
export const PLANNING_ENTRY_DEEP_LINK_ID = 'eforge-plan:planning-workstation';
export const PLANNING_WORKSTATION_ID = 'eforge-plan:planning-workstation';
export const PLANNING_WORKSTATION_URL = '/console/workstations/eforge-plan%3Aplanning-workstation';

export const ACTION_IDS = [
  'list-playbooks',
  'show-playbook',
  'save-playbook',
  'validate-playbook',
  'copy-playbook',
  'promote-playbook',
  'demote-playbook',
  'run-playbook',
] as const;

export type PlaybookActionId = typeof ACTION_IDS[number];
export const PLAYBOOK_SCOPES = ['user', 'project-team', 'project-local'] as const;
export const PLAYBOOK_MODES = ['autonomous', 'planning'] as const;
