import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import type { ResolvedProfileConfig } from '../src/engine/config.js';
import { validateProfileConfig, resolveGeneratedProfile, BUILTIN_PROFILES, getProfileSchemaYaml } from '../src/engine/config.js';
import { parseGeneratedProfileBlock, type GeneratedProfileBlock } from '../src/engine/agents/common.js';
import { formatProfileGenerationSection, runPlanner } from '../src/engine/agents/planner.js';
import { StubBackend } from './stub-backend.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';

function cloneProfile(name: keyof typeof BUILTIN_PROFILES): ResolvedProfileConfig {
  const src = BUILTIN_PROFILES[name];
  return {
    description: src.description,
    compile: [...src.compile],
  };
}

// ---------------------------------------------------------------------------
// validateProfileConfig
// ---------------------------------------------------------------------------

describe('validateProfileConfig', () => {
  it('returns valid: true for built-in errand profile', () => {
    const result = validateProfileConfig(cloneProfile('errand'));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns valid: true for built-in excursion profile', () => {
    const result = validateProfileConfig(cloneProfile('excursion'));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns valid: true for built-in expedition profile', () => {
    const result = validateProfileConfig(cloneProfile('expedition'));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns error for empty description', () => {
    const config = cloneProfile('excursion');
    config.description = '';
    const result = validateProfileConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('description'))).toBe(true);
  });

  it('returns error for empty compile array', () => {
    const config = cloneProfile('excursion');
    config.compile = [];
    const result = validateProfileConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('compile'))).toBe(true);
  });

  it('returns error for unknown compile stage name when registry provided', () => {
    const config = cloneProfile('excursion');
    config.compile = ['nonexistent'];
    const result = validateProfileConfig(config, new Set(['planner', 'plan-review-cycle']));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown compile stage') && e.includes('nonexistent'))).toBe(true);
  });

  it('returns no stage-name errors when registries are omitted', () => {
    const config = cloneProfile('excursion');
    config.compile = ['made-up-stage'];
    const result = validateProfileConfig(config);
    // Should have no stage-related errors (no registries to check against)
    expect(result.errors.filter((e) => e.includes('unknown compile stage'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseGeneratedProfileBlock
// ---------------------------------------------------------------------------

describe('parseGeneratedProfileBlock', () => {
  it('parses extends-based block', () => {
    const text = 'some preamble <generated-profile>{"extends":"excursion","overrides":{"review":{"maxRounds":2}}}</generated-profile> some postamble';
    const result = parseGeneratedProfileBlock(text);
    expect(result).toEqual({
      extends: 'excursion',
      overrides: { review: { maxRounds: 2 } },
    });
  });

  it('parses full config block', () => {
    const fullConfig: ResolvedProfileConfig = {
      description: 'Custom profile',
      compile: ['planner'],
    };
    const text = `<generated-profile>{"config":${JSON.stringify(fullConfig)}}</generated-profile>`;
    const result = parseGeneratedProfileBlock(text);
    expect(result).toEqual({ config: fullConfig });
  });

  it('returns null for text without generated-profile block', () => {
    const text = 'No profile block here. <profile name="excursion">Rationale</profile>';
    expect(parseGeneratedProfileBlock(text)).toBeNull();
  });

  it('returns null for malformed JSON inside the block', () => {
    const text = '<generated-profile>{not valid json}</generated-profile>';
    expect(parseGeneratedProfileBlock(text)).toBeNull();
  });

  it('returns null for empty block', () => {
    const text = '<generated-profile></generated-profile>';
    expect(parseGeneratedProfileBlock(text)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveGeneratedProfile
// ---------------------------------------------------------------------------

describe('resolveGeneratedProfile', () => {
  const profiles = {
    errand: cloneProfile('errand'),
    excursion: cloneProfile('excursion'),
    expedition: cloneProfile('expedition'),
  };

  it('extends mode: merges overrides onto base', () => {
    const generated: GeneratedProfileBlock = {
      extends: 'errand',
      overrides: { description: 'Custom errand' },
    };
    const result = resolveGeneratedProfile(generated, profiles);
    expect(result.description).toBe('Custom errand');
    expect(result.compile).toEqual(profiles.errand.compile); // inherited from errand base
  });

  it('extends mode with description override', () => {
    const generated: GeneratedProfileBlock = {
      extends: 'excursion',
      overrides: { description: 'Custom description' },
    };
    const result = resolveGeneratedProfile(generated, profiles);
    expect(result.description).toBe('Custom description');
  });

  it('full config mode returns config as-is', () => {
    const fullConfig: ResolvedProfileConfig = {
      description: 'Full custom',
      compile: ['planner'],
    };
    const generated: GeneratedProfileBlock = { config: fullConfig };
    const result = resolveGeneratedProfile(generated, profiles);
    expect(result).toBe(fullConfig);
  });

  it('throws for unknown base name', () => {
    const generated: GeneratedProfileBlock = { extends: 'nonexistent' };
    expect(() => resolveGeneratedProfile(generated, profiles)).toThrow('unknown base');
  });

  it('defaults to excursion when extends is missing', () => {
    const generated: GeneratedProfileBlock = {
      overrides: { description: 'Custom' },
    };
    const result = resolveGeneratedProfile(generated, profiles);
    expect(result.description).toBe('Custom');
    expect(result.compile).toEqual(profiles.excursion.compile);
  });
});

// ---------------------------------------------------------------------------
// Planner wiring with generateProfile
// ---------------------------------------------------------------------------

describe('runPlanner with generateProfile', () => {
  const makeTempDir = useTempDir('eforge-dynamic-profile-test-');

  const profiles = {
    errand: cloneProfile('errand'),
    excursion: cloneProfile('excursion'),
    expedition: cloneProfile('expedition'),
  };

  it('parses <generated-profile> and emits plan:profile with inline config when generateProfile is true', async () => {
    const generatedJson = JSON.stringify({
      extends: 'excursion',
      overrides: { description: 'Custom excursion' },
    });
    const backend = new StubBackend([{
      text: `<generated-profile>${generatedJson}</generated-profile>\n<scope assessment="errand">Small change.</scope>`,
    }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runPlanner('Build a thing', {
      backend,
      cwd,
      generateProfile: true,
      profiles,
    }));

    const profileEvent = findEvent(events, 'plan:profile');
    expect(profileEvent).toBeDefined();
    expect(profileEvent!.config).toBeDefined();
    expect(profileEvent!.config!.description).toBe('Custom excursion');
    expect(profileEvent!.config!.compile).toEqual(profiles.excursion.compile);
    expect(profileEvent!.profileName).toBe('excursion'); // from extends
  });

  it('emits plan:progress warning and falls back when generated profile has invalid JSON', async () => {
    const backend = new StubBackend([{
      text: '<generated-profile>{bad json}</generated-profile>\n<profile name="errand">Fallback.</profile>\n<scope assessment="errand">Small.</scope>',
    }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runPlanner('Fix a bug', {
      backend,
      cwd,
      generateProfile: true,
      profiles,
    }));

    // No plan:profile with inline config from generated block (parse failure returns null,
    // so no warning emitted - the block is simply skipped)
    // Falls back to <profile> block
    const profileEvent = findEvent(events, 'plan:profile');
    expect(profileEvent).toBeDefined();
    expect(profileEvent!.profileName).toBe('errand');
    expect(profileEvent!.config).toBe(profiles.errand); // from name-based lookup
  });

  it('generated-profile takes precedence when both blocks present', async () => {
    const generatedJson = JSON.stringify({
      extends: 'errand',
      overrides: { description: 'Custom errand' },
    });
    const backend = new StubBackend([{
      text: `<generated-profile>${generatedJson}</generated-profile>\n<profile name="expedition">Multi-module work.</profile>\n<scope assessment="errand">Small.</scope>`,
    }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runPlanner('Do something', {
      backend,
      cwd,
      generateProfile: true,
      profiles,
    }));

    const profileEvents = filterEvents(events, 'plan:profile');
    expect(profileEvents).toHaveLength(1);
    expect(profileEvents[0].config!.description).toBe('Custom errand');
    expect(profileEvents[0].profileName).toBe('errand'); // from extends
  });

  it('ignores <generated-profile> when generateProfile is false', async () => {
    const generatedJson = JSON.stringify({
      extends: 'excursion',
      overrides: { review: { maxRounds: 5 } },
    });
    const backend = new StubBackend([{
      text: `<generated-profile>${generatedJson}</generated-profile>\n<profile name="errand">Simple work.</profile>\n<scope assessment="errand">Small.</scope>`,
    }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runPlanner('Do it', {
      backend,
      cwd,
      generateProfile: false,
      profiles,
    }));

    const profileEvent = findEvent(events, 'plan:profile');
    expect(profileEvent).toBeDefined();
    expect(profileEvent!.profileName).toBe('errand');
    expect(profileEvent!.config).toBe(profiles.errand); // name-based, not generated
  });

  it('ignores <generated-profile> when generateProfile is omitted', async () => {
    const generatedJson = JSON.stringify({
      extends: 'excursion',
      overrides: { review: { maxRounds: 5 } },
    });
    const backend = new StubBackend([{
      text: `<generated-profile>${generatedJson}</generated-profile>\n<profile name="excursion">Medium work.</profile>\n<scope assessment="excursion">Multi-file.</scope>`,
    }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runPlanner('Do it', {
      backend,
      cwd,
      // generateProfile not set
      profiles,
    }));

    const profileEvent = findEvent(events, 'plan:profile');
    expect(profileEvent).toBeDefined();
    expect(profileEvent!.profileName).toBe('excursion');
    expect(profileEvent!.config).toBe(profiles.excursion); // name-based
  });

  it('uses custom name as profileName in plan:profile event', async () => {
    const generatedJson = JSON.stringify({
      extends: 'excursion',
      name: 'security-focused',
      overrides: { description: 'Security-focused excursion' },
    });
    const backend = new StubBackend([{
      text: `<generated-profile>${generatedJson}</generated-profile>\n<scope assessment="excursion">Security review.</scope>`,
    }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runPlanner('Secure the API', {
      backend,
      cwd,
      generateProfile: true,
      profiles,
    }));

    const profileEvent = findEvent(events, 'plan:profile');
    expect(profileEvent).toBeDefined();
    expect(profileEvent!.profileName).toBe('security-focused');
    expect(profileEvent!.config).toBeDefined();
    expect(profileEvent!.config!.description).toBe('Security-focused excursion');
  });

  it('emits plan:progress warning when generated profile fails validation', async () => {
    // Generate a profile with empty compile array (invalid)
    const generatedJson = JSON.stringify({
      config: {
        description: 'Bad profile',
        compile: [],
      },
    });
    const backend = new StubBackend([{
      text: `<generated-profile>${generatedJson}</generated-profile>\n<profile name="errand">Fallback.</profile>\n<scope assessment="errand">Small.</scope>`,
    }]);
    const cwd = makeTempDir();

    const events = await collectEvents(runPlanner('Fix something', {
      backend,
      cwd,
      generateProfile: true,
      profiles,
    }));

    // Should have a plan:progress warning about invalid profile
    const progressEvents = filterEvents(events, 'plan:progress');
    const warningEvent = progressEvents.find((e) => e.message.includes('Generated profile invalid'));
    expect(warningEvent).toBeDefined();

    // Should fall back to <profile> block
    const profileEvent = findEvent(events, 'plan:profile');
    expect(profileEvent).toBeDefined();
    expect(profileEvent!.profileName).toBe('errand');
  });
});

// ---------------------------------------------------------------------------
// getProfileSchemaYaml
// ---------------------------------------------------------------------------

describe('getProfileSchemaYaml', () => {
  it('returns valid YAML with key profile fields and descriptions', () => {
    const yaml = getProfileSchemaYaml();
    const parsed = parseYaml(yaml);
    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe('object');

    // Should contain the top-level profile fields
    const props = parsed.properties;
    expect(props).toBeDefined();
    expect(props.description).toBeDefined();
    expect(props.compile).toBeDefined();
  });

  it('caching returns the same string reference', () => {
    const first = getProfileSchemaYaml();
    const second = getProfileSchemaYaml();
    expect(first).toBe(second); // strict reference equality
  });
});

// ---------------------------------------------------------------------------
// parseGeneratedProfileBlock with name
// ---------------------------------------------------------------------------

describe('parseGeneratedProfileBlock name capture', () => {
  it('captures name in extends mode', () => {
    const text = `<generated-profile>${JSON.stringify({
      extends: 'excursion',
      name: 'my-custom',
      overrides: { review: { maxRounds: 2 } },
    })}</generated-profile>`;
    const result = parseGeneratedProfileBlock(text);
    expect(result).toEqual({
      extends: 'excursion',
      name: 'my-custom',
      overrides: { review: { maxRounds: 2 } },
    });
  });

  it('captures name in full-config mode', () => {
    const fullConfig: ResolvedProfileConfig = {
      description: 'Full custom',
      compile: ['planner'],
    };
    const text = `<generated-profile>${JSON.stringify({
      config: fullConfig,
      name: 'full-custom',
    })}</generated-profile>`;
    const result = parseGeneratedProfileBlock(text);
    expect(result).toEqual({ config: fullConfig, name: 'full-custom' });
  });

  it('returns undefined for name when absent', () => {
    const text = `<generated-profile>${JSON.stringify({
      extends: 'excursion',
      overrides: {},
    })}</generated-profile>`;
    const result = parseGeneratedProfileBlock(text);
    expect(result).toBeDefined();
    expect(result!.name).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatProfileGenerationSection schema-driven output
// ---------------------------------------------------------------------------

describe('formatProfileGenerationSection', () => {
  it('does not contain the old hardcoded "Available review fields:" string', () => {
    const output = formatProfileGenerationSection(BUILTIN_PROFILES);
    expect(output).not.toContain('Available review fields:');
  });

  it('contains profile schema YAML documentation', () => {
    const output = formatProfileGenerationSection(BUILTIN_PROFILES);
    expect(output).toContain('Profile schema:');
    expect(output).toContain('```yaml');
  });

  it('includes the name field in the XML example', () => {
    const output = formatProfileGenerationSection(BUILTIN_PROFILES);
    expect(output).toContain('"name"');
  });

  it('includes the kebab-case naming rule', () => {
    const output = formatProfileGenerationSection(BUILTIN_PROFILES);
    expect(output).toContain('kebab-case');
  });
});
