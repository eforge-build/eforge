import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const ARCHITECTURE_MANIFEST_FENCE = 'eforge-architecture-manifest';
export const ARCHITECTURE_MANIFEST_VERSION = 1;

const boundedString = (maxLength: number) => Type.String({ maxLength });
const boundedIds = (maxLength: number, maxItems: number) => Type.Array(boundedString(maxLength), { maxItems });

export const ArchitectureManifestPlanSchema = Type.Object({
  planId: boundedString(160),
  title: boundedString(240),
  residue: Type.Boolean(),
  criterionIds: boundedIds(80, 64),
  aspectIds: boundedIds(240, 128),
  dependsOnPlanIds: boundedIds(160, 32),
}, { additionalProperties: false });

export const ArchitectureManifestFileOwnershipSchema = Type.Object({
  path: boundedString(500),
  ownerPlanIds: boundedIds(160, 16),
  consumerPlanIds: boundedIds(160, 32),
  shared: Type.Boolean(),
  reason: Type.Optional(boundedString(500)),
}, { additionalProperties: false });

export const ArchitectureManifestContractSchema = Type.Object({
  contractId: boundedString(700),
  kind: Type.Union([Type.Literal('plan-dependency'), Type.Literal('interface'), Type.Literal('shared-file')]),
  fromPlanId: boundedString(160),
  toPlanId: boundedString(160),
  interfaceKey: Type.Optional(boundedString(160)),
  path: Type.Optional(boundedString(500)),
  summary: Type.Optional(boundedString(700)),
}, { additionalProperties: false });

export const ArchitectureManifestConflictSchema = Type.Object({
  conflictId: boundedString(160),
  title: boundedString(240),
  criterionIds: boundedIds(80, 64),
  planIds: boundedIds(160, 32),
}, { additionalProperties: false });

export const PlanningArchitectureManifestSchema = Type.Object({
  version: Type.Literal(ARCHITECTURE_MANIFEST_VERSION),
  plans: Type.Array(ArchitectureManifestPlanSchema, { maxItems: 128 }),
  fileOwnership: Type.Array(ArchitectureManifestFileOwnershipSchema, { maxItems: 256 }),
  contracts: Type.Array(ArchitectureManifestContractSchema, { maxItems: 256 }),
  conflicts: Type.Array(ArchitectureManifestConflictSchema, { maxItems: 128 }),
}, { additionalProperties: false });

export type PlanningArchitectureManifest = Static<typeof PlanningArchitectureManifestSchema>;
export type PlanningArchitectureManifestPlan = Static<typeof ArchitectureManifestPlanSchema>;
export type PlanningArchitectureManifestFileOwnership = Static<typeof ArchitectureManifestFileOwnershipSchema>;
export type PlanningArchitectureManifestContract = Static<typeof ArchitectureManifestContractSchema>;
export type PlanningArchitectureManifestConflict = Static<typeof ArchitectureManifestConflictSchema>;

export function renderArchitectureManifestFence(manifest: PlanningArchitectureManifest): string {
  return ['```json ' + ARCHITECTURE_MANIFEST_FENCE, JSON.stringify(manifest, null, 2), '```'].join('\n');
}

export function parseArchitectureManifest(markdown: string): { manifest?: PlanningArchitectureManifest; errors: string[] } {
  const match = markdown.match(new RegExp('```json ' + ARCHITECTURE_MANIFEST_FENCE + '\\n([\\s\\S]*?)\\n```'));
  if (!match) return { errors: [`architecture manifest fence not found (${ARCHITECTURE_MANIFEST_FENCE})`] };
  let value: unknown;
  try {
    value = JSON.parse(match[1]);
  } catch (err) {
    return { errors: [`architecture manifest is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (!Value.Check(PlanningArchitectureManifestSchema, value)) {
    const errors = [...Value.Errors(PlanningArchitectureManifestSchema, value)].slice(0, 16).map((error) => `architecture manifest invalid at ${error.path || '/'}: ${error.message}`);
    return { errors };
  }
  return { manifest: value, errors: [] };
}
