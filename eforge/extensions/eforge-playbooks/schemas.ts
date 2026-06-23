import { Type, type Static } from '@eforge-build/extension-sdk';
import { PLANNING_MODE_CAPABILITY, PLANNING_MODE_CAPABILITY_PROVIDER, PLANNING_MODE_CAPABILITY_VERSION } from './constants.js';

const Scope = Type.Union([Type.Literal('user'), Type.Literal('project-team'), Type.Literal('project-local')]);
const Mode = Type.Union([Type.Literal('autonomous'), Type.Literal('planning')]);
const Name = Type.String({ minLength: 1, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' });
const PostMergeCommand = Type.String({ pattern: '^[^\\x00-\\x1F\\x7F]*\\S[^\\x00-\\x1F\\x7F]*$' });
const StringArray = Type.Array(PostMergeCommand);

export const SourceSchema = Type.Object({ source: Scope, path: Type.String() }, { additionalProperties: false });
export const ShadowSchema = Type.Object({ source: Scope, path: Type.String() }, { additionalProperties: false });
export const PlaybookSchema = Type.Object({
  name: Name,
  description: Type.String(),
  scope: Scope,
  mode: Mode,
  profile: Type.Optional(Type.String()),
  postMerge: Type.Optional(StringArray),
  goal: Type.String(),
  outOfScope: Type.String(),
  acceptanceCriteria: Type.String(),
  plannerNotes: Type.String(),
}, { additionalProperties: false });
export const PlaybookEntrySchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.String(),
  scope: Scope,
  mode: Mode,
  source: Scope,
  shadows: Type.Array(ShadowSchema),
  path: Type.String(),
  profile: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const ListPlaybooksInputSchema = Type.Object({
  scope: Type.Optional(Scope),
  mode: Type.Optional(Mode),
  includeShadowed: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export const ListPlaybooksOutputSchema = Type.Object({
  playbooks: Type.Array(PlaybookEntrySchema),
  warnings: Type.Array(Type.String()),
}, { additionalProperties: false });

export const ShowPlaybookInputSchema = Type.Object({ name: Name, scope: Type.Optional(Scope) }, { additionalProperties: false });
export const MovePlaybookInputSchema = Type.Object({ name: Name }, { additionalProperties: false });
export const ShowPlaybookOutputSchema = Type.Object({
  playbook: PlaybookSchema,
  source: SourceSchema,
  shadows: Type.Array(ShadowSchema),
}, { additionalProperties: false });

export const SavePlaybookInputSchema = Type.Object({
  scope: Scope,
  name: Type.Optional(Name),
  raw: Type.Optional(Type.String()),
  overwrite: Type.Optional(Type.Boolean()),
  playbook: Type.Optional(Type.Object({
    frontmatter: Type.Object({
      name: Name,
      description: Type.String(),
      scope: Type.Optional(Scope),
      mode: Mode,
      profile: Type.Optional(Type.String()),
      postMerge: Type.Optional(StringArray),
    }, { additionalProperties: false }),
    body: Type.Object({
      goal: Type.String(),
      outOfScope: Type.Optional(Type.String()),
      acceptanceCriteria: Type.Optional(Type.String()),
      plannerNotes: Type.Optional(Type.String()),
    }, { additionalProperties: false }),
  }, { additionalProperties: false })),
  description: Type.Optional(Type.String()),
  mode: Type.Optional(Mode),
  profile: Type.Optional(Type.String()),
  postMerge: Type.Optional(StringArray),
  goal: Type.Optional(Type.String()),
  outOfScope: Type.Optional(Type.String()),
  acceptanceCriteria: Type.Optional(Type.String()),
  plannerNotes: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const PathOutputSchema = Type.Object({ path: Type.String() }, { additionalProperties: false });

export const ValidatePlaybookInputSchema = Type.Object({ raw: Type.String(), scope: Type.Optional(Scope) }, { additionalProperties: false });
export const ValidatePlaybookOutputSchema = Type.Union([
  Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object({ ok: Type.Literal(false), errors: Type.Array(Type.String()) }, { additionalProperties: false }),
]);

export const CopyPlaybookInputSchema = Type.Object({
  name: Name,
  targetScope: Scope,
  sourceScope: Type.Optional(Scope),
  overwrite: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export const CopyPlaybookOutputSchema = Type.Object({ sourcePath: Type.String(), targetPath: Type.String(), targetScope: Scope }, { additionalProperties: false });

export const RunPlaybookInputSchema = Type.Object({
  name: Name,
  scope: Type.Optional(Scope),
  mode: Type.Optional(Mode),
  profile: Type.Optional(Type.String()),
  afterQueueId: Type.Optional(Type.String()),
  landingAction: Type.Optional(Type.Union([Type.Literal('pr'), Type.Literal('merge'), Type.Literal('leave')])),
  landingAutoMerge: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export const PlanSeedSchema = Type.Object({
  sessionId: Type.String(),
  topic: Type.String(),
  sections: Type.Record(Type.String(), Type.String()),
  seededFrom: Type.String(),
  profile: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const RequiredCapabilitySchema = Type.Object({
  provider: Type.Literal(PLANNING_MODE_CAPABILITY_PROVIDER),
  id: Type.Literal(PLANNING_MODE_CAPABILITY),
  range: Type.Literal(PLANNING_MODE_CAPABILITY_VERSION),
}, { additionalProperties: false });
export const PlanningEntrySchema = Type.Object({
  contributionId: Type.Literal('eforge-plan:open-planning-entry'),
  actionId: Type.Literal('eforge-plan:open-planning-entry'),
  integrationCommandId: Type.Optional(Type.Literal('eforge-plan:open-planning-entry')),
  deepLinkId: Type.Literal('eforge-plan:planning-workstation'),
  workstationId: Type.Literal('eforge-plan:planning-workstation'),
  workstationUrl: Type.Literal('/console/workstations/eforge-plan%3Aplanning-workstation'),
  seed: PlanSeedSchema,
  source: Type.Object({
    extension: Type.Literal('eforge-playbooks'),
    playbook: Type.String({ minLength: 1 }),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
const DiagnosticSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
  severity: Type.Optional(Type.Union([Type.Literal('warning'), Type.Literal('error')])),
  dependencyName: Type.Optional(Type.String()),
  providerName: Type.Optional(Type.String()),
  capabilityName: Type.Optional(Type.String()),
  requiredVersion: Type.Optional(Type.String()),
  actualVersion: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const RunPlaybookOutputSchema = Type.Union([
  Type.Object({ kind: Type.Literal('enqueued'), id: Type.String(), sessionId: Type.String(), autoBuild: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('requires-agent'), mode: Type.Literal('planning'), name: Type.String(), requiredCapability: RequiredCapabilitySchema, planningEntry: PlanningEntrySchema, message: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('planning-unavailable'), mode: Type.Literal('planning'), name: Type.String(), requiredCapability: RequiredCapabilitySchema, diagnostics: Type.Array(DiagnosticSchema), planningEntry: Type.Optional(PlanningEntrySchema), message: Type.String() }, { additionalProperties: false }),
]);

export type ListPlaybooksInput = Static<typeof ListPlaybooksInputSchema>;
export type ShowPlaybookInput = Static<typeof ShowPlaybookInputSchema>;
export type MovePlaybookInput = Static<typeof MovePlaybookInputSchema>;
export type SavePlaybookInput = Static<typeof SavePlaybookInputSchema>;
export type ValidatePlaybookInput = Static<typeof ValidatePlaybookInputSchema>;
export type CopyPlaybookInput = Static<typeof CopyPlaybookInputSchema>;
export type RunPlaybookInput = Static<typeof RunPlaybookInputSchema>;
