import { describe, it, expect } from 'vitest';
import {
  TOOLBELT_PRESETS,
  findMissingServers,
  applyToolbeltPresetToTiers,
  applyNoMcpAccessToTiers,
  getPresetById,
} from '../packages/pi-eforge/extensions/eforge/toolbelt-presets.js';
import type { TierName } from '../packages/pi-eforge/extensions/eforge/profile-payload.js';

const TIER_NAMES: TierName[] = ['planning', 'implementation', 'review', 'evaluation'];

function makeTiers(): Record<TierName, { model: string; toolbelt?: string }> {
  return {
    planning: { model: 'sonnet' },
    implementation: { model: 'sonnet' },
    review: { model: 'haiku' },
    evaluation: { model: 'haiku' },
  };
}

describe('TOOLBELT_PRESETS', () => {
  it('contains all 8 presets', () => {
    expect(TOOLBELT_PRESETS).toHaveLength(8);
  });

  it('each preset has required fields', () => {
    for (const preset of TOOLBELT_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.label).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.mcpServers.length).toBeGreaterThan(0);
      expect(preset.setupHint).toBeTruthy();
      for (const tier of TIER_NAMES) {
        expect(typeof preset.tierAssignments[tier]).toBe('string');
      }
    }
  });
});

describe('findMissingServers', () => {
  it('returns empty array when all servers present', () => {
    const preset = getPresetById('browser-ui')!;
    const existing = { playwright: {} };
    expect(findMissingServers(preset, existing)).toEqual([]);
  });

  it('returns missing server names', () => {
    const preset = getPresetById('browser-ui')!;
    expect(findMissingServers(preset, {})).toEqual(['playwright']);
  });
});

describe('applyToolbeltPresetToTiers - browser-ui', () => {
  it('sets implementation and review to browser-ui, planning and evaluation to none', () => {
    const preset = getPresetById('browser-ui')!;
    const tiers = makeTiers();
    const result = applyToolbeltPresetToTiers(preset, tiers);
    expect(result.planning.toolbelt).toBe('none');
    expect(result.implementation.toolbelt).toBe('browser-ui');
    expect(result.review.toolbelt).toBe('browser-ui');
    expect(result.evaluation.toolbelt).toBe('none');
  });

  it('preserves existing tier fields', () => {
    const preset = getPresetById('browser-ui')!;
    const tiers = makeTiers();
    const result = applyToolbeltPresetToTiers(preset, tiers);
    expect(result.planning.model).toBe('sonnet');
    expect(result.implementation.model).toBe('sonnet');
  });
});

describe('applyToolbeltPresetToTiers - docs-research', () => {
  it('sets planning and implementation to docs-research, review and evaluation to none', () => {
    const preset = getPresetById('docs-research')!;
    const tiers = makeTiers();
    const result = applyToolbeltPresetToTiers(preset, tiers);
    expect(result.planning.toolbelt).toBe('docs-research');
    expect(result.implementation.toolbelt).toBe('docs-research');
    expect(result.review.toolbelt).toBe('none');
    expect(result.evaluation.toolbelt).toBe('none');
  });
});

describe('applyNoMcpAccessToTiers', () => {
  it('sets all tiers to toolbelt: none', () => {
    const tiers = makeTiers();
    const result = applyNoMcpAccessToTiers(tiers);
    for (const tier of TIER_NAMES) {
      expect(result[tier].toolbelt).toBe('none');
    }
  });

  it('preserves other tier fields', () => {
    const tiers = makeTiers();
    const result = applyNoMcpAccessToTiers(tiers);
    expect(result.planning.model).toBe('sonnet');
  });
});

describe('toolbelt: none string behavior', () => {
  it('browser-ui assigns the literal string "none" to planning tier', () => {
    const preset = getPresetById('browser-ui')!;
    expect(preset.tierAssignments.planning).toBe('none');
  });

  it('issue-triage assigns none to implementation, review, evaluation', () => {
    const preset = getPresetById('issue-triage')!;
    expect(preset.tierAssignments.implementation).toBe('none');
    expect(preset.tierAssignments.review).toBe('none');
    expect(preset.tierAssignments.evaluation).toBe('none');
  });
});

describe('TOOLBELT_PRESETS exact gallery', () => {
  it('browser-ui has correct servers, tier assignments, and auto-add', () => {
    const preset = getPresetById('browser-ui')!;
    expect(preset.mcpServers).toEqual(['playwright']);
    expect(preset.tierAssignments).toEqual({
      planning: 'none',
      implementation: 'browser-ui',
      review: 'browser-ui',
      evaluation: 'none',
    });
    expect(preset.autoAdd).toBeDefined();
    expect(Object.keys(preset.autoAdd!.servers)).toContain('playwright');
  });

  it('docs-research has correct servers and tier assignments', () => {
    const preset = getPresetById('docs-research')!;
    expect(preset.mcpServers).toEqual(['fetch', 'context7']);
    expect(preset.tierAssignments).toEqual({
      planning: 'docs-research',
      implementation: 'docs-research',
      review: 'none',
      evaluation: 'none',
    });
    expect(preset.autoAdd).toBeUndefined();
  });

  it('issue-triage has correct servers and tier assignments', () => {
    const preset = getPresetById('issue-triage')!;
    expect(preset.mcpServers).toEqual(['github']);
    expect(preset.tierAssignments).toEqual({
      planning: 'issue-triage',
      implementation: 'none',
      review: 'none',
      evaluation: 'none',
    });
    expect(preset.autoAdd).toBeUndefined();
  });

  it('repo-review has correct servers and tier assignments', () => {
    const preset = getPresetById('repo-review')!;
    expect(preset.mcpServers).toEqual(['github']);
    expect(preset.tierAssignments).toEqual({
      planning: 'repo-review',
      implementation: 'none',
      review: 'repo-review',
      evaluation: 'none',
    });
    expect(preset.autoAdd).toBeUndefined();
  });

  it('observability has correct servers and tier assignments', () => {
    const preset = getPresetById('observability')!;
    expect(preset.mcpServers).toEqual(['datadog', 'sentry']);
    expect(preset.tierAssignments).toEqual({
      planning: 'observability',
      implementation: 'none',
      review: 'none',
      evaluation: 'observability',
    });
    expect(preset.autoAdd).toBeUndefined();
  });

  it('database-readonly has correct servers and tier assignments', () => {
    const preset = getPresetById('database-readonly')!;
    expect(preset.mcpServers).toEqual(['postgres', 'sqlite']);
    expect(preset.tierAssignments).toEqual({
      planning: 'database-readonly',
      implementation: 'none',
      review: 'none',
      evaluation: 'none',
    });
    expect(preset.autoAdd).toBeUndefined();
  });

  it('api-testing has correct servers and tier assignments', () => {
    const preset = getPresetById('api-testing')!;
    expect(preset.mcpServers).toEqual(['fetch']);
    expect(preset.tierAssignments).toEqual({
      planning: 'none',
      implementation: 'api-testing',
      review: 'api-testing',
      evaluation: 'none',
    });
    expect(preset.autoAdd).toBeUndefined();
  });

  it('design-ui has correct servers and tier assignments', () => {
    const preset = getPresetById('design-ui')!;
    expect(preset.mcpServers).toEqual(['figma']);
    expect(preset.tierAssignments).toEqual({
      planning: 'design-ui',
      implementation: 'design-ui',
      review: 'design-ui',
      evaluation: 'none',
    });
    expect(preset.autoAdd).toBeUndefined();
  });

  it('only browser-ui has auto-add servers', () => {
    const presetsWithAutoAdd = TOOLBELT_PRESETS.filter((p) => p.autoAdd !== undefined);
    expect(presetsWithAutoAdd).toHaveLength(1);
    expect(presetsWithAutoAdd[0].id).toBe('browser-ui');
  });
});
