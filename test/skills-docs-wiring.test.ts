/**
 * Wiring tests for plan-03-skills-docs.
 *
 * Plan-03 is documentation/content-only: skill file updates (scope column,
 * Step 0 scope prompt, precedence docs), docs/config.md backend profiles
 * section, init skill one-liners, and a plugin version bump. These tests
 * verify file content statically - no runtime behavior to test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve paths relative to the repo root (one dir up from `test/`).
const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function readRepoFile(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), 'utf-8');
}

function compareSemver(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Plugin profile skill - scope column and precedence docs
// ---------------------------------------------------------------------------

describe('eforge-plugin/skills/profile/profile.md - user-scope updates', () => {
  const raw = readRepoFile('eforge-plugin/skills/profile/profile.md');

  it('contains "Scope" in the list output table header', () => {
    // The table header should include a Scope column, Description column, and Active column (added in plan-02)
    expect(raw).toMatch(/\|\s*Name\s*\|\s*Scope\s*\|\s*Harness\s*\|\s*Description\s*\|\s*Active\s*\|/);
  });

  it('shows project and user scope values in the example table', () => {
    expect(raw).toContain('`project`');
    expect(raw).toContain('`user`');
  });

  it('documents user (shadowed) in the Scope column', () => {
    expect(raw).toContain('user (shadowed)');
  });

  it('documents precedence steps (4-step chain after plan-02 removed defaultAgentRuntime)', () => {
    expect(raw).toContain('## Active Profile Precedence');
    expect(raw).toMatch(/1\.\s+\*\*Project-local marker\*\*/);
    expect(raw).toMatch(/2\.\s+\*\*Project marker\*\*/);
    expect(raw).toMatch(/3\.\s+\*\*User marker\*\*/);
    expect(raw).toMatch(/4\.\s+\*\*None\*\*/);
    // Plan-02 removed defaultAgentRuntime; "Project config" and "User config"
    // steps are no longer present since they depended on that field
    expect(raw).not.toContain('defaultAgentRuntime');
  });

  it('documents the scope parameter section', () => {
    expect(raw).toContain('## Scope Parameter');
    expect(raw).toContain('"project"');
    expect(raw).toContain('"user"');
    expect(raw).toContain('"all"');
    expect(raw).toContain('default `"all"`');
    expect(raw).toContain('default `"project"`');
  });

  it('mentions user-scope paths', () => {
    expect(raw).toContain('~/.config/eforge/profiles/');
    expect(raw).toContain('~/.config/eforge/.active-profile');
  });

  it('notes scope parameter availability on list, use, create, delete', () => {
    const scopeSection = raw.slice(raw.indexOf('## Scope Parameter'));
    expect(scopeSection).toContain('list');
    expect(scopeSection).toContain('use');
    expect(scopeSection).toContain('create');
    expect(scopeSection).toContain('delete');
  });
});

// ---------------------------------------------------------------------------
// Plugin profile-new skill - Step 0 scope prompt
// ---------------------------------------------------------------------------

describe('eforge-plugin/skills/profile-new/profile-new.md - user-scope updates', () => {
  const raw = readRepoFile('eforge-plugin/skills/profile-new/profile-new.md');

  it('contains Step 0 scope prompt before Step 1', () => {
    const step0Idx = raw.indexOf('Step 0');
    const step1Idx = raw.indexOf('Step 1');
    expect(step0Idx).toBeGreaterThan(-1);
    expect(step1Idx).toBeGreaterThan(-1);
    expect(step0Idx).toBeLessThan(step1Idx);
  });

  it('Step 0 asks about scope with both project and user options', () => {
    const step0Start = raw.indexOf('Step 0');
    const step1Start = raw.indexOf('Step 1');
    const step0Content = raw.slice(step0Start, step1Start);
    expect(step0Content).toContain('Project scope');
    expect(step0Content).toContain('User scope');
    expect(step0Content).toContain('eforge/profiles/');
    expect(step0Content).toContain('~/.config/eforge/profiles/');
  });

  it('passes scope to create action', () => {
    // Plan-02 renumbered steps; create action is now Step 4 (not Step 7)
    expect(raw).toMatch(/scope:\s*["']<local\|project\|user>["']/);
  });

  it('passes scope to use action when activating', () => {
    // Plan-02 renumbered steps; activate offer is now Step 5 (not Step 7)
    const step5Start = raw.indexOf('Step 5');
    expect(step5Start).toBeGreaterThan(-1);
    const step5Content = raw.slice(step5Start);
    expect(step5Content).toContain('scope');
  });

  it('mentions user scope in the file path description', () => {
    expect(raw).toContain('user: `~/.config/eforge/profiles/<name>.yaml`');
  });
});

// ---------------------------------------------------------------------------
// Pi profile skill - mirrors plugin profile changes
// ---------------------------------------------------------------------------

describe('packages/pi-eforge/skills/eforge-profile/SKILL.md - user-scope updates', () => {
  const raw = readRepoFile('packages/pi-eforge/skills/eforge-profile/SKILL.md');

  it('contains "Scope" in the list output table header', () => {
    // The table header should include a Scope column, Description column, and Active column (added in plan-02)
    expect(raw).toMatch(/\|\s*Name\s*\|\s*Scope\s*\|\s*Harness\s*\|\s*Description\s*\|\s*Active\s*\|/);
  });

  it('documents user (shadowed) in the Scope column', () => {
    expect(raw).toContain('user (shadowed)');
  });

  it('documents precedence steps (4-step chain after plan-02 removed defaultAgentRuntime)', () => {
    expect(raw).toContain('## Active Profile Precedence');
    expect(raw).toMatch(/1\.\s+\*\*Project-local marker\*\*/);
    expect(raw).toMatch(/2\.\s+\*\*Project marker\*\*/);
    expect(raw).toMatch(/3\.\s+\*\*User marker\*\*/);
    expect(raw).toMatch(/4\.\s+\*\*None\*\*/);
    // Plan-02 removed defaultAgentRuntime; "Project config" and "User config"
    // steps are no longer present since they depended on that field
    expect(raw).not.toContain('defaultAgentRuntime');
  });

  it('documents the scope parameter section', () => {
    expect(raw).toContain('## Scope Parameter');
    expect(raw).toContain('"project"');
    expect(raw).toContain('"user"');
    expect(raw).toContain('"all"');
    expect(raw).toContain('default `"all"`');
    expect(raw).toContain('default `"project"`');
  });

  it('uses bare tool names (no mcp__eforge__ prefix) - Pi convention', () => {
    expect(raw).not.toContain('mcp__eforge__');
  });

  it('mentions user-scope paths', () => {
    expect(raw).toContain('~/.config/eforge/profiles/');
    expect(raw).toContain('~/.config/eforge/.active-profile');
  });
});

// ---------------------------------------------------------------------------
// Pi profile-new skill - mirrors plugin profile-new changes
// ---------------------------------------------------------------------------

describe('packages/pi-eforge/skills/eforge-profile-new/SKILL.md - user-scope updates', () => {
  const raw = readRepoFile('packages/pi-eforge/skills/eforge-profile-new/SKILL.md');

  it('contains Step 0 scope prompt before Step 1', () => {
    const step0Idx = raw.indexOf('Step 0');
    const step1Idx = raw.indexOf('Step 1');
    expect(step0Idx).toBeGreaterThan(-1);
    expect(step1Idx).toBeGreaterThan(-1);
    expect(step0Idx).toBeLessThan(step1Idx);
  });

  it('Step 0 asks about scope with both project and user options', () => {
    const step0Start = raw.indexOf('Step 0');
    const step1Start = raw.indexOf('Step 1');
    const step0Content = raw.slice(step0Start, step1Start);
    expect(step0Content).toContain('Project scope');
    expect(step0Content).toContain('User scope');
    expect(step0Content).toContain('~/.config/eforge/profiles/');
  });

  it('passes scope to create action in Step 7', () => {
    expect(raw).toMatch(/scope:\s*["']<local\|project\|user>["']/);
  });

  it('uses bare tool names (no mcp__eforge__ prefix) - Pi convention', () => {
    expect(raw).not.toContain('mcp__eforge__');
  });
});

// ---------------------------------------------------------------------------
// Plugin init skill - user-scope one-liner
// ---------------------------------------------------------------------------

describe('eforge-plugin/skills/init/init.md - user-scope one-liner', () => {
  const raw = readRepoFile('eforge-plugin/skills/init/init.md');

  it('mentions ~/.config/eforge/profiles/ for user-scope profiles', () => {
    expect(raw).toContain('~/.config/eforge/profiles/');
  });

  it('mentions scope in the context of /eforge:profile-new', () => {
    expect(raw).toContain('/eforge:profile-new');
    expect(raw).toMatch(/scope/i);
  });
});

// ---------------------------------------------------------------------------
// Pi init skill - mirrors plugin init one-liner
// ---------------------------------------------------------------------------

describe('packages/pi-eforge/skills/eforge-init/SKILL.md - user-scope one-liner', () => {
  const raw = readRepoFile('packages/pi-eforge/skills/eforge-init/SKILL.md');

  it('mentions ~/.config/eforge/profiles/ for user-scope profiles', () => {
    expect(raw).toContain('~/.config/eforge/profiles/');
  });

  it('mentions scope in the context of /eforge:profile-new', () => {
    expect(raw).toContain('/eforge:profile-new');
    expect(raw).toMatch(/scope/i);
  });
});

// ---------------------------------------------------------------------------
// docs/config.md - Backend Profiles section with User-Scoped Profiles
// ---------------------------------------------------------------------------

describe('docs/config.md - Backend Profiles section', () => {
  const raw = readRepoFile('docs/config.md');

  it('contains a ## Backend Profiles section', () => {
    expect(raw).toContain('## Backend Profiles');
  });

  it('contains a ### User-Scoped Profiles subsection', () => {
    expect(raw).toContain('### User-Scoped Profiles');
  });

  it('documents user-scope profile path', () => {
    expect(raw).toContain('~/.config/eforge/profiles/');
  });

  it('documents user-scope active-backend marker', () => {
    expect(raw).toContain('~/.config/eforge/.active-profile');
  });

  it('documents the 6-step precedence chain', () => {
    // Find the Backend Profiles section
    const sectionStart = raw.indexOf('## Backend Profiles');
    expect(sectionStart).toBeGreaterThan(-1);
    // Find the next ## section to bound the search
    const nextSection = raw.indexOf('\n## ', sectionStart + 1);
    const section = raw.slice(sectionStart, nextSection > -1 ? nextSection : undefined);

    // Plan-02 removed defaultAgentRuntime, collapsing the 6-step chain to 4 steps
    // "Project config" and "User config" steps are no longer present
    expect(section).toMatch(/1\.\s+\*\*Project-local marker\*\*/);
    expect(section).toMatch(/2\.\s+\*\*Project marker\*\*/);
    expect(section).toMatch(/3\.\s+\*\*User marker\*\*/);
    expect(section).toMatch(/4\.\s+\*\*None\*\*/);
  });

  it('documents the scope parameter for create, use, delete', () => {
    const sectionStart = raw.indexOf('## Backend Profiles');
    const nextSection = raw.indexOf('\n## ', sectionStart + 1);
    const section = raw.slice(sectionStart, nextSection > -1 ? nextSection : undefined);

    expect(section).toContain('scope: "project"');
    expect(section).toContain('scope: "user"');
  });

  it('documents that project profiles shadow user profiles', () => {
    const sectionStart = raw.indexOf('## Backend Profiles');
    const nextSection = raw.indexOf('\n## ', sectionStart + 1);
    const section = raw.slice(sectionStart, nextSection > -1 ? nextSection : undefined);

    expect(section).toMatch(/shadow/i);
  });

  it('mentions shadowedBy: project annotation', () => {
    expect(raw).toContain('shadowedBy: project');
  });
});

// ---------------------------------------------------------------------------
// Parity checks: plugin <-> Pi skills should contain matching content
// ---------------------------------------------------------------------------

describe('plugin <-> Pi skill parity for user-scope updates', () => {
  const pluginBackend = readRepoFile('eforge-plugin/skills/profile/profile.md');
  const piBackend = readRepoFile('packages/pi-eforge/skills/eforge-profile/SKILL.md');
  const pluginBackendNew = readRepoFile('eforge-plugin/skills/profile-new/profile-new.md');
  const piBackendNew = readRepoFile('packages/pi-eforge/skills/eforge-profile-new/SKILL.md');
  const pluginInit = readRepoFile('eforge-plugin/skills/init/init.md');
  const piInit = readRepoFile('packages/pi-eforge/skills/eforge-init/SKILL.md');

  it('both profile skills have the same 4-step precedence list (plan-02 removed defaultAgentRuntime)', () => {
    // Plan-02 removed defaultAgentRuntime, collapsing the 6-step chain to 4 steps
    for (const raw of [pluginBackend, piBackend]) {
      expect(raw).toMatch(/1\.\s+\*\*Project-local marker\*\*/);
      expect(raw).toMatch(/2\.\s+\*\*Project marker\*\*/);
      expect(raw).toMatch(/4\.\s+\*\*None\*\*/);
      expect(raw).not.toContain('defaultAgentRuntime');
    }
  });

  it('both profile skills have the Scope column in the table', () => {
    for (const raw of [pluginBackend, piBackend]) {
      expect(raw).toMatch(/\|\s*Scope\s*\|/);
    }
  });

  it('both profile-new skills have Step 0 scope prompt', () => {
    for (const raw of [pluginBackendNew, piBackendNew]) {
      expect(raw).toContain('Step 0');
      expect(raw).toContain('~/.config/eforge/profiles/');
    }
  });

  it('both init skills mention ~/.config/eforge/profiles/', () => {
    for (const raw of [pluginInit, piInit]) {
      expect(raw).toContain('~/.config/eforge/profiles/');
    }
  });
});

// ---------------------------------------------------------------------------
// Enum drift: piThinkingLevel and effortLevel values in consumer-facing docs
// ---------------------------------------------------------------------------

describe('enum drift - piThinkingLevel and effortLevel values', () => {
  const piBackendNew = readRepoFile('packages/pi-eforge/skills/eforge-profile-new/SKILL.md');
  const pluginBackendNew = readRepoFile('eforge-plugin/skills/profile-new/profile-new.md');
  const piConfig = readRepoFile('packages/pi-eforge/skills/eforge-config/SKILL.md');
  const pluginConfig = readRepoFile('eforge-plugin/skills/config/config.md');
  const docsConfig = readRepoFile('docs/config.md');

  it('Pi config skill contains xhigh for thinkingLevel and effort (profile-new no longer has tuning step)', () => {
    // profile-new skills no longer document thinkingLevel/effort (tuning step removed by plan-01);
    // verify the config skill still has them
    expect(piConfig).toMatch(/thinkingLevel.*xhigh/i);
    expect(piConfig).toMatch(/effort.*xhigh/i);
  });

  it('Plugin config skill contains xhigh for thinkingLevel and effort (profile-new no longer has tuning step)', () => {
    expect(pluginConfig).toMatch(/thinkingLevel.*xhigh/i);
    expect(pluginConfig).toMatch(/effort.*xhigh/i);
  });

  it('docs/config.md contains xhigh for both thinkingLevel and effort', () => {
    expect(docsConfig).toMatch(/effort.*xhigh/i);
    expect(docsConfig).toMatch(/thinkingLevel.*xhigh/i);
  });

  it('Pi and plugin config skills contain low as a thinkingLevel option (profile-new no longer has tuning step)', () => {
    // profile-new skills no longer document thinkingLevel (tuning step removed by plan-01);
    // verify the config skills still have 'low'
    expect(piConfig).toMatch(/thinkingLevel.*low/);
    expect(pluginConfig).toMatch(/thinkingLevel.*low/);
  });

  // --- Occurrence count assertions (catch partial fixes) ---

  it('Pi config skill contains xhigh at least 3 times (body + YAML comments for effort and thinkingLevel)', () => {
    const matches = piConfig.match(/xhigh/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });

  it('Plugin config skill contains xhigh at least 3 times (body + YAML comments for effort and thinkingLevel)', () => {
    const matches = pluginConfig.match(/xhigh/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });

  it('docs/config.md contains xhigh at least 2 times (effort + thinkingLevel)', () => {
    const matches = docsConfig.match(/xhigh/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('docs/config.md contains low as a thinkingLevel option', () => {
    expect(docsConfig).toMatch(/thinkingLevel.*low/);
  });

  // --- Complete enum sequence validation (backend-new skills) ---

  it('Pi config skill lists the full thinkingLevel enum: off | low | medium | high | xhigh', () => {
    // profile-new skills no longer document these enums (tuning step removed by plan-01)
    expect(piConfig).toMatch(/off.*low.*medium.*high.*xhigh/);
  });

  it('Pi config skill lists the full effort enum: low | medium | high | xhigh | max', () => {
    // profile-new skills no longer document these enums (tuning step removed by plan-01)
    expect(piConfig).toMatch(/low.*medium.*high.*xhigh.*max/);
  });

  it('Plugin config skill lists the full thinkingLevel enum: off | low | medium | high | xhigh', () => {
    // profile-new skills no longer document these enums (tuning step removed by plan-01)
    expect(pluginConfig).toMatch(/off.*low.*medium.*high.*xhigh/);
  });

  it('Plugin config skill lists the full effort enum: low | medium | high | xhigh | max', () => {
    // profile-new skills no longer document these enums (tuning step removed by plan-01)
    expect(pluginConfig).toMatch(/low.*medium.*high.*xhigh.*max/);
  });
});

// ---------------------------------------------------------------------------
// AC quality guidance in formatter/planner prompts (plan skill removed)
// ---------------------------------------------------------------------------

describe('formatter prompt — AC quality guidance', () => {
  const raw = readRepoFile('packages/engine/src/prompts/formatter.md');

  it('documents the flat, standalone, atomic, objectively validatable AC rule', () => {
    expect(raw).toMatch(/flat.*standalone.*atomic.*objectively validatable/s);
  });

  it('documents grouping labels, bare command fragments, and vague criteria', () => {
    expect(raw).toContain('grouping label');
    expect(raw).toContain('bare command fragment');
    expect(raw).toContain('vague');
  });

  it('includes valid and invalid AC examples', () => {
    expect(raw).toContain('`pnpm type-check` exits 0.');
    expect(raw).toContain('Tests cover:');
    expect(raw).toMatch(/`pnpm type-check`\./);
    expect(raw).toContain('Works correctly.');
    expect(raw).toContain('Improves reliability.');
  });
});

// ---------------------------------------------------------------------------
// Actionable planning-playbook contract (plan-01-actionable-planning-playbooks)
// ---------------------------------------------------------------------------

describe('playbook skills — generic eforge-plan planning entry contract', () => {
  const piPlaybook = readRepoFile('packages/pi-eforge/skills/eforge-playbook/SKILL.md');
  const pluginPlaybook = readRepoFile('eforge-plugin/skills/playbook/playbook.md');

  it('both playbook skills name the eforge-plan planning workstation capability', () => {
    for (const raw of [piPlaybook, pluginPlaybook]) {
      expect(raw).toContain('eforge.plan.planning-workstation');
    }
  });

  it('both playbook skills route planning continuation through generic contribution discovery and invocation', () => {
    expect(piPlaybook).toContain('eforge_extension_contribution');
    expect(pluginPlaybook).toContain('mcp__eforge__eforge_extension_contribution');
    for (const raw of [piPlaybook, pluginPlaybook]) {
      expect(raw).toContain('eforge-plan:open-planning-entry');
      expect(raw).toContain('eforge-plan:planning-workstation');
      expect(raw).toContain('implementation-ready session plan');
    }
  });

  it('both playbook skills name the eforge-plan workstation route and avoid plan-command continuation', () => {
    for (const raw of [piPlaybook, pluginPlaybook]) {
      expect(raw).toContain('/console/workstations/eforge-plan%3Aplanning-workstation');
      expect(raw).not.toContain('/eforge:plan');
    }
  });

  it('both playbook skills document eforge-playbooks action ownership and avoid removed direct-route wording', () => {
    const directRoute = '/api/' + 'playbook';
    for (const raw of [piPlaybook, pluginPlaybook]) {
      expect(raw).toContain('eforge-playbooks');
      expect(raw).toContain('eforge-playbooks:run-playbook');
      expect(raw).toContain('eforge-playbooks:copy-playbook');
      expect(raw).not.toContain(directRoute);
      expect(raw).not.toContain('create-from-' + 'playbook');
    }
    expect(piPlaybook).toContain('eforge_extension_contribution');
    expect(pluginPlaybook).toContain('mcp__eforge__eforge_extension_contribution');
  });
});

describe('docs/config.md — planning playbook prose', () => {
  const docsConfig = readRepoFile('docs/config.md');

  it('documents planning playbook profile inheritance without the removed plan skill', () => {
    expect(docsConfig).toContain('eforge-plan planning flow');
    expect(docsConfig).toContain('agent_profile');
    expect(docsConfig).not.toContain('/eforge:plan');
  });
});

// ---------------------------------------------------------------------------

describe('plan-skill removal versioning', () => {
  it('bumps the Claude plugin patch version and leaves the Pi package version unchanged', () => {
    const plugin = JSON.parse(readRepoFile('eforge-plugin/.claude-plugin/plugin.json')) as { version: string };
    const piPackage = JSON.parse(readRepoFile('packages/pi-eforge/package.json')) as { version: string };

    expect(compareSemver(plugin.version, '0.25.64')).toBeGreaterThan(0);
    expect(piPackage.version).toBe('0.7.21');
  });
});

// ---------------------------------------------------------------------------
// Manual-only acceptance criteria guidance (plan-01-manual-only-ac-gate)
// ---------------------------------------------------------------------------

describe('manual-only AC prompt guidance', () => {
  const formatterPrompt = readRepoFile('packages/engine/src/prompts/formatter.md');
  const extractorPrompt = readRepoFile('packages/engine/src/prompts/acceptance-criteria-extractor.md');
  const validatorPrompt = readRepoFile('packages/engine/src/prompts/prd-validator.md');

  it('formatter prompt forbids manual-only/visual-only ACs and preserves notes', () => {
    expect(formatterPrompt).toMatch(/manual-only.*visual-only/s);
    expect(formatterPrompt).toContain('Manually verify dashboard rendering in the browser.');
    expect(formatterPrompt).toContain('Visually inspect UI');
    expect(formatterPrompt).toContain('Manual Verification Notes');
    expect(formatterPrompt).toMatch(/concrete automatable outcome|automatable criterion/s);
  });

  it('acceptance criteria extractor prompt omits manual-only notes and emits warnings', () => {
    expect(extractorPrompt).toMatch(/Omit manual-only or visual-only notes/);
    expect(extractorPrompt).toMatch(/warnings?.*omitted|omitted.*warning/s);
  });

  it('PRD validator prompt treats Manual Verification Notes as informational and Expected AC as authoritative', () => {
    expect(validatorPrompt).toMatch(/Expected Acceptance Criteria[\s\S]*authoritative/);
    expect(validatorPrompt).toMatch(/Manual Verification Notes[\s\S]*informational and non-gating/);
  });
});
