import { ExtensionActionInputValidationError, ExtensionActionUserError, defineExtensionAction } from '@eforge-build/extension-sdk';
import { analyzeAcceptanceCriteriaInBody, formatAcDiagnostics } from '@eforge-build/input';
import { playbookToBuildSource, playbookToPlanSeed } from './compile.js';
import { RunPlaybookInputSchema, RunPlaybookOutputSchema } from './schemas.js';
import { invalidField, userError } from './action-errors.js';
import { loadExact } from './storage.js';
import { planningRunResult } from './planning.js';
import { omitUndefined } from './json-safe.js';

export const runPlaybookAction = defineExtensionAction({
  id: 'run-playbook',
  title: 'Run playbook',
  description: 'Run a playbook through planning-mode metadata handoff or autonomous generic build-queue enqueue.',
  inputSchema: RunPlaybookInputSchema,
  outputSchema: RunPlaybookOutputSchema,
  sideEffects: ['local-read', 'daemon-state', 'build-queue'],
  async handler(input, ctx) {
    const { playbook } = await loadExact(ctx, input.name, input.scope);
    if (input.mode !== undefined && input.mode !== playbook.mode) {
      throw invalidField('/mode', `Requested mode "${input.mode}" does not match playbook mode "${playbook.mode}".`);
    }
    if (playbook.mode === 'planning') return planningRunResult(ctx, playbook.name, playbookToPlanSeed({ ...playbook, profile: input.profile ?? playbook.profile }));

    const compiled = playbookToBuildSource(playbook);
    const quality = analyzeAcceptanceCriteriaInBody(compiled.source);
    if (quality !== null && !quality.valid) throw userError(formatAcDiagnostics(quality.diagnostics), '/playbook/body/acceptanceCriteria', { diagnostics: quality.diagnostics });
    try {
      const enqueued = await ctx.buildQueue.enqueue(omitUndefined({
        source: compiled.source,
        profile: input.profile ?? compiled.profile,
        postMerge: compiled.postMerge,
        afterQueueId: input.afterQueueId,
        landingAction: input.landingAction,
        landingAutoMerge: input.landingAutoMerge,
      }));
      return omitUndefined({ kind: 'enqueued' as const, id: enqueued.sessionId, sessionId: enqueued.sessionId, autoBuild: enqueued.autoBuild });
    } catch (err) {
      if (err instanceof ExtensionActionUserError) throw err;
      if (err instanceof ExtensionActionInputValidationError) {
        throw new ExtensionActionUserError(`Playbook enqueue failed: ${err.message}`, err.details);
      }
      throw err;
    }
  },
});
