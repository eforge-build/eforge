import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as input from '@eforge-build/input';
import { parseSessionPlan, serializeSessionPlan } from '@eforge-build/input';

const removedInputExportNames = [
  'playbookScopeSchema',
  'playbookFrontmatterSchema',
  'parsePlaybook',
  'serializePlaybook',
  'validatePlaybook',
  'listPlaybooks',
  'loadPlaybook',
  'writePlaybook',
  'movePlaybook',
  'copyPlaybookToScope',
  'playbookToBuildSource',
  'playbookToPlanSeed',
  'PlaybookNotFoundError',
  'PlaybookModeMismatchError',
  'PlaybookScope',
  'PlaybookFrontmatter',
  'PlaybookMode',
  'PlaybookBody',
  'Playbook',
  'PlaybookShadowEntry',
  'PlaybookEntry',
  'SessionPlanInput',
  'PlaybookPlanSeed',
  'ListPlaybooksOpts',
  'LoadPlaybookOpts',
  'WritePlaybookOpts',
  'MovePlaybookOpts',
  'CopyPlaybookToScopeOpts',
  'CopyPlaybookToScopeResult',
  'createSessionPlanFromPlaybookSeed',
  'CreateSessionPlanFromPlaybookSeedOpts',
] as const;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('playbook input package boundary', () => {
  it('does not expose runtime exports with playbook names', () => {
    const runtimeExports = Object.keys(input as Record<string, unknown>);
    expect(runtimeExports.filter((name) => /playbook/i.test(name))).toEqual([]);
  });

  it('does not keep input-owned playbook source files', () => {
    expect(existsSync('packages/input/src/playbook.ts')).toBe(false);
    expect(existsSync('packages/input/src/playbook-plan-seed.ts')).toBe(false);
  });

  it('does not reference removed playbook export names in the input barrel', () => {
    const indexSource = readFileSync('packages/input/src/index.ts', 'utf8');
    for (const exportName of removedInputExportNames) {
      expect(indexSource, `${exportName} should not be exported`).not.toContain(exportName);
    }
  });

  it('does not depend on scopes or claim playbook ownership in package metadata', () => {
    const packageJson = readJson('packages/input/package.json');
    const dependencies = packageJson.dependencies as Record<string, string>;
    expect(dependencies['@eforge-build/scopes']).toBeUndefined();
    expect(packageJson.description).not.toMatch(/playbook/i);
  });

  it('does not re-emit legacy seeded_from frontmatter fields', () => {
    const raw = `---
session: 2026-04-01-legacy-seed
topic: "Legacy Seed"
status: planning
planning_type: feature
planning_depth: focused
required_dimensions: []
optional_dimensions: []
skipped_dimensions: []
open_questions: []
profile: null
seeded_from_playbook: old-domain-artifact
seeded_from_other: legacy-producer
---

# Legacy Seed
`;

    const serialized = serializeSessionPlan(parseSessionPlan(raw));

    expect(serialized).not.toContain('seeded_from_playbook');
    expect(serialized).not.toContain('seeded_from_other');
  });

  it('preserves non-seeded passthrough frontmatter while filtering retired seed provenance', () => {
    const raw = `---
session: 2026-04-01-extension-metadata
topic: "Extension Metadata"
status: planning
planning_type: feature
planning_depth: focused
required_dimensions: []
optional_dimensions: []
skipped_dimensions: []
open_questions: []
profile: null
producer_id: neutral-extension
producer_record:
  artifact: neutral-template
seeded_from_playbook: old-domain-artifact
---

# Extension Metadata
`;

    const serialized = serializeSessionPlan(parseSessionPlan(raw));

    expect(serialized).toContain('producer_id: neutral-extension');
    expect(serialized).toContain('artifact: neutral-template');
    expect(serialized).not.toContain('seeded_from_playbook');
  });
});
