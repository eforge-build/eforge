import {
  defineConsoleContribution,
  defineEforgeExtension,
  defineExtensionDeepLink,
  defineIntegrationCommand,
} from '@eforge-build/extension-sdk';
import { ACTION_IDS } from './constants.js';
import { playbookManagementActions, registerActions, type RegistrableAction } from './playbook-actions.js';
import { runPlaybookAction } from './run-playbook-action.js';

const allActions = [...playbookManagementActions, runPlaybookAction] as unknown as readonly RegistrableAction[];
const titles: Record<string, string> = {
  'list-playbooks': 'List playbooks',
  'show-playbook': 'Show playbook',
  'save-playbook': 'Save playbook',
  'validate-playbook': 'Validate playbook',
  'copy-playbook': 'Copy playbook',
  'promote-playbook': 'Promote playbook',
  'demote-playbook': 'Demote playbook',
  'run-playbook': 'Run playbook',
};

export default defineEforgeExtension((eforge) => {
  registerActions(eforge, allActions);
  for (const id of ACTION_IDS) {
    const action = allActions.find((entry) => entry.id === id);
    eforge.registerIntegrationCommand(defineIntegrationCommand({
      id,
      label: titles[id],
      description: action?.description,
      inputSchema: action?.inputSchema,
      action: { actionId: id },
    }));
  }
  eforge.registerConsoleContribution(defineConsoleContribution({
    id: 'playbook-management',
    title: 'eforge playbooks',
    description: 'Extension-owned playbook inventory, CRUD, validation, promotion, and run surface.',
    blocks: [
      { rendererId: 'markdown', title: 'Playbook management', content: 'Manage scoped eforge playbooks through extension-owned actions. Autonomous runs enqueue through the generic build queue; planning runs hand off to the optional eforge-plan capability.' },
      { rendererId: 'action-button', title: 'List playbooks', content: 'List all playbooks and their shadow chain.', action: { actionId: 'list-playbooks' } },
      { rendererId: 'action-form', title: 'Show playbook', content: 'Show one highest-precedence or exact-scope playbook.', action: { actionId: 'show-playbook' } },
      { rendererId: 'action-form', title: 'Save playbook', content: 'Write a raw, nested, or flattened playbook payload.', action: { actionId: 'save-playbook', inputDefaults: { overwrite: true } } },
      { rendererId: 'action-form', title: 'Validate playbook', content: 'Validate raw playbook Markdown without writing files.', action: { actionId: 'validate-playbook' } },
      { rendererId: 'action-form', title: 'Copy playbook', content: 'Copy a playbook to another scope.', action: { actionId: 'copy-playbook' } },
      { rendererId: 'action-form', title: 'Promote playbook', content: 'Move project-local to project-team.', action: { actionId: 'promote-playbook' } },
      { rendererId: 'action-form', title: 'Demote playbook', content: 'Move project-team to project-local.', action: { actionId: 'demote-playbook' } },
      { rendererId: 'action-form', title: 'Run playbook', content: 'Run autonomous playbooks or return planning handoff metadata.', action: { actionId: 'run-playbook' } },
    ],
  }));
  eforge.registerDeepLink(defineExtensionDeepLink({ id: 'inventory', label: 'List eforge playbooks', action: { actionId: 'list-playbooks' } }));
});

export { ACTION_IDS } from './constants.js';
export { EFORGE_PLAN_DRIFT_CONSTANTS } from './planning.js';
