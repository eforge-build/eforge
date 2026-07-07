import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const ARCHITECTURE_MANIFEST_FENCE = 'eforge-architecture-manifest';
export const ARCHITECTURE_MANIFEST_VERSION = 1;

const boundedString = (maxLength: number) => Type.String({ maxLength });
const boundedIds = (maxLength: number, maxItems: number) => Type.Array(boundedString(maxLength), { maxItems });

const ArchitectureManifestPlanSchema = Type.Object({
  planId: boundedString(160),
  title: boundedString(240),
  residue: Type.Boolean(),
  criterionIds: boundedIds(80, 64),
  aspectIds: boundedIds(240, 128),
  dependsOnPlanIds: boundedIds(160, 32),
}, { additionalProperties: false });

const ArchitectureManifestFileOwnershipSchema = Type.Object({
  path: boundedString(500),
  ownerPlanIds: boundedIds(160, 16),
  consumerPlanIds: boundedIds(160, 32),
  shared: Type.Boolean(),
  reason: Type.Optional(boundedString(500)),
}, { additionalProperties: false });

const ArchitectureManifestContractSchema = Type.Object({
  contractId: boundedString(700),
  kind: Type.Union([Type.Literal('plan-dependency'), Type.Literal('interface'), Type.Literal('shared-file')]),
  fromPlanId: boundedString(160),
  toPlanId: boundedString(160),
  interfaceKey: Type.Optional(boundedString(160)),
  path: Type.Optional(boundedString(500)),
  summary: Type.Optional(boundedString(700)),
}, { additionalProperties: false });

const ArchitectureManifestConflictSchema = Type.Object({
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

function architectureManifestFencePattern(): RegExp {
  return new RegExp('```json ' + ARCHITECTURE_MANIFEST_FENCE + '\\n([\\s\\S]*?)\\n```');
}

/**
 * Replace the machine-readable manifest fence in an architecture.md document with
 * the canonical rendering of the given manifest, appending it under the standard
 * heading when the document carries no fence.
 */
export function replaceArchitectureManifestFence(markdown: string, manifest: PlanningArchitectureManifest): string {
  const canonicalFence = renderArchitectureManifestFence(manifest);
  const fencePattern = architectureManifestFencePattern();
  // Replacer function: the canonical fence is inserted literally, so `$`-substitution
  // patterns ($&, $', $`) inside the manifest JSON are never interpreted.
  if (fencePattern.test(markdown)) return markdown.replace(fencePattern, () => canonicalFence);
  return `${markdown.replace(/\n*$/, '')}\n\n## Machine-readable manifest\n\n${canonicalFence}\n`;
}

/**
 * Preserve the canonical machine-readable manifest fence across an agent-authored
 * architecture.md replacement. The manifest is synthesized deterministically from
 * compiler results; reviewer fixes may edit prose but must never hand-author the
 * fence. Swaps any agent-written fence in the replacement for the existing file's
 * (re-rendered) fence, appending it under the standard heading when the replacement
 * omitted it. Returns the replacement unchanged when the existing content carries
 * no schema-valid fence to preserve.
 */
export function preserveArchitectureManifestFence(existingContent: string, replacementContent: string): string {
  const existing = parseArchitectureManifest(existingContent);
  if (!existing.manifest) return replacementContent;
  return replaceArchitectureManifestFence(replacementContent, existing.manifest);
}

export function parseArchitectureManifest(markdown: string): { manifest?: PlanningArchitectureManifest; errors: string[] } {
  const match = markdown.match(architectureManifestFencePattern());
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
