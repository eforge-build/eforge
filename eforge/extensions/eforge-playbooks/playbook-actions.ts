import { defineExtensionAction, type ExtensionAction, type TObject, type TSchema } from '@eforge-build/extension-sdk';
import { listPlaybooks, movePlaybook, validatePlaybook, writePlaybook, type PlaybookScope } from '@eforge-build/input';
import {
  CopyPlaybookInputSchema,
  CopyPlaybookOutputSchema,
  ListPlaybooksInputSchema,
  ListPlaybooksOutputSchema,
  MovePlaybookInputSchema,
  PathOutputSchema,
  SavePlaybookInputSchema,
  ShowPlaybookInputSchema,
  ShowPlaybookOutputSchema,
  ValidatePlaybookInputSchema,
  ValidatePlaybookOutputSchema,
} from './schemas.js';
import { assertRequestedPlaybookName, copyHighest, exists, loadExact, playbookPath, projectEntry, savePlaybook } from './storage.js';
import { userError, wrapUserError } from './action-errors.js';

export type RegistrableAction = ExtensionAction<TObject, TSchema | undefined>;

export const playbookManagementActions = [
  defineExtensionAction({
    id: 'list-playbooks', title: 'List playbooks', description: 'List scoped eforge playbooks with source and shadow metadata.',
    inputSchema: ListPlaybooksInputSchema, outputSchema: ListPlaybooksOutputSchema, outputProfile: 'agent-compact', sideEffects: ['local-read'],
    async handler(input, ctx) {
      const includeShadowed = input.includeShadowed ?? true;
      const result = await listPlaybooks({ cwd: ctx.cwd, configDir: ctx.paths.configDir });
      const playbooks = result.playbooks
        .filter((entry) => input.scope === undefined || entry.source === input.scope)
        .filter((entry) => input.mode === undefined || entry.mode === input.mode)
        .map((entry) => projectEntry(entry, includeShadowed));
      return { playbooks, warnings: result.warnings };
    },
  }),
  defineExtensionAction({
    id: 'show-playbook', title: 'Show playbook', description: 'Show the highest-precedence or exact-scope copy of a playbook.',
    inputSchema: ShowPlaybookInputSchema, outputSchema: ShowPlaybookOutputSchema, sideEffects: ['local-read'],
    async handler(input, ctx) { return loadExact(ctx, input.name, input.scope); },
  }),
  defineExtensionAction({
    id: 'save-playbook', title: 'Save playbook', description: 'Validate and write a playbook to a scoped playbooks directory.',
    inputSchema: SavePlaybookInputSchema, outputSchema: PathOutputSchema, sideEffects: ['local-write'],
    async handler(input, ctx) { return savePlaybook(ctx, input); },
  }),
  defineExtensionAction({
    id: 'validate-playbook', title: 'Validate playbook', description: 'Validate raw playbook Markdown without writing files.',
    inputSchema: ValidatePlaybookInputSchema, outputSchema: ValidatePlaybookOutputSchema, sideEffects: ['none'],
    handler(input) {
      const result = validatePlaybook(input.raw);
      return result.ok ? { ok: true as const } : { ok: false as const, errors: result.errors };
    },
  }),
  defineExtensionAction({
    id: 'copy-playbook', title: 'Copy playbook', description: 'Copy a playbook to another scope and update its scope frontmatter.',
    inputSchema: CopyPlaybookInputSchema, outputSchema: CopyPlaybookOutputSchema, sideEffects: ['local-read', 'local-write'],
    async handler(input, ctx) {
      if (input.sourceScope === undefined) return copyHighest(ctx, input.name, input.targetScope, input.overwrite);
      const source = await loadExact(ctx, input.name, input.sourceScope);
      assertRequestedPlaybookName(input.name, source.playbook.name);
      const targetPath = playbookPath(ctx, input.targetScope, input.name);
      if (input.overwrite === false && await exists(targetPath)) throw userError(`Playbook "${input.name}" already exists at ${targetPath}.`, '/overwrite');
      const written = await writePlaybook({ cwd: ctx.cwd, configDir: ctx.paths.configDir, scope: input.targetScope, playbook: { ...source.playbook, scope: input.targetScope as PlaybookScope } });
      return { sourcePath: source.source.path, targetPath: written.path, targetScope: input.targetScope };
    },
  }),
  defineExtensionAction({
    id: 'promote-playbook', title: 'Promote playbook', description: 'Move a project-local playbook to project-team scope.',
    inputSchema: MovePlaybookInputSchema, outputSchema: PathOutputSchema, sideEffects: ['local-write'],
    async handler(input, ctx) {
      return movePlaybook({ cwd: ctx.cwd, configDir: ctx.paths.configDir, name: input.name, fromScope: 'project-local', toScope: 'project-team' })
        .catch((err) => wrapUserError(err, `Unable to promote playbook "${input.name}".`, '/name'));
    },
  }),
  defineExtensionAction({
    id: 'demote-playbook', title: 'Demote playbook', description: 'Move a project-team playbook to project-local scope.',
    inputSchema: MovePlaybookInputSchema, outputSchema: PathOutputSchema, sideEffects: ['local-write'],
    async handler(input, ctx) {
      return movePlaybook({ cwd: ctx.cwd, configDir: ctx.paths.configDir, name: input.name, fromScope: 'project-team', toScope: 'project-local' })
        .catch((err) => wrapUserError(err, `Unable to demote playbook "${input.name}".`, '/name'));
    },
  }),
] as const;

export function registerActions(eforge: { registerAction(action: RegistrableAction): void }, actions: readonly RegistrableAction[]): void {
  for (const action of actions) eforge.registerAction(action);
}
