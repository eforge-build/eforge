import { describe, it, expect } from 'vitest';
import {
  extensionKey,
  selectValidateTarget,
  canReloadExtensions,
  canValidateExtension,
  canTrustExtension,
  canRetrustExtension,
  canUntrustExtension,
  canPromoteExtension,
  canDemoteExtension,
  selectTrustAction,
  hasAnyExtensionAction,
  extensionMutationLabel,
  extensionMutationPendingLabel,
  extensionMutationTitle,
  extensionMutationConsequence,
  extensionUnavailableReason,
} from '../extension-management-selectors';
import type {
  ExtensionEntry,
  ExtensionScope,
  ExtensionTrust,
  ExtensionTrustState,
} from '@eforge-build/client/browser';

function makeExt(
  overrides: Partial<ExtensionEntry> & { scope: ExtensionScope } & {
    name?: string;
    trust?: ExtensionTrust;
    trustState?: ExtensionTrustState;
  },
): ExtensionEntry {
  return {
    name: overrides.name ?? 'ext',
    path: overrides.path ?? `/repo/eforge/extensions/${overrides.name ?? 'ext'}.ts`,
    scope: overrides.scope,
    source: 'auto',
    status: 'loaded',
    shadows: [],
    registrations: { eventHooks: 0, agentRunHooks: 0, policyGates: 0, profileRouters: 0, inputSources: 0, reviewerPerspectives: 0, validationProviders: 0, tools: 0, prdEnrichers: 0, actions: 0, consoleContributions: 0, consoleWorkstations: 0, integrationCommands: 0, deepLinks: 0 },
    diagnostics: [],
    ...overrides,
  };
}

describe('extensionKey', () => {
  it('combines scope and path for collision-resistant identity', () => {
    expect(extensionKey(makeExt({ scope: 'project-team', path: '/a.ts' }))).toBe('project-team:/a.ts');
    // Same name, different path => distinct keys.
    const a = extensionKey(makeExt({ scope: 'project-local', name: 'dup', path: '/x/dup.ts' }));
    const b = extensionKey(makeExt({ scope: 'project-local', name: 'dup', path: '/y/dup.ts' }));
    expect(a).not.toBe(b);
  });
});

describe('selectValidateTarget', () => {
  it('uses path for project-local and project-team entries', () => {
    expect(selectValidateTarget(makeExt({ scope: 'project-team', path: '/pt.ts' }))).toEqual({ path: '/pt.ts' });
    expect(selectValidateTarget(makeExt({ scope: 'project-local', path: '/pl.ts' }))).toEqual({ path: '/pl.ts' });
  });

  it('uses name for user and external entries when a name exists', () => {
    expect(selectValidateTarget(makeExt({ scope: 'user', name: 'u', path: '/u.ts' }))).toEqual({ name: 'u' });
    expect(selectValidateTarget(makeExt({ scope: 'external', name: 'e', path: '/e.ts' }))).toEqual({ name: 'e' });
  });

  it('falls back to path for user/external entries without a name', () => {
    expect(selectValidateTarget(makeExt({ scope: 'external', name: '', path: '/e.ts' }))).toEqual({ path: '/e.ts' });
  });
});

describe('action eligibility', () => {
  it('reload is always available', () => {
    expect(canReloadExtensions()).toBe(true);
  });

  it('validate is available for project-local, project-team, user, and named external', () => {
    expect(canValidateExtension(makeExt({ scope: 'project-local' }))).toBe(true);
    expect(canValidateExtension(makeExt({ scope: 'project-team' }))).toBe(true);
    expect(canValidateExtension(makeExt({ scope: 'user' }))).toBe(true);
    expect(canValidateExtension(makeExt({ scope: 'external', name: 'has-name' }))).toBe(true);
    expect(canValidateExtension(makeExt({ scope: 'external', name: '' }))).toBe(false);
  });

  it('trust is available only for untrusted project-team (richer or legacy)', () => {
    expect(canTrustExtension(makeExt({ scope: 'project-team', trustState: 'untrusted' }))).toBe(true);
    expect(canTrustExtension(makeExt({ scope: 'project-team', trust: 'untrusted' }))).toBe(true);
    expect(canTrustExtension(makeExt({ scope: 'project-team', trustState: 'trusted' }))).toBe(false);
    expect(canTrustExtension(makeExt({ scope: 'project-local', trustState: 'untrusted' }))).toBe(false);
  });

  it('re-trust is available only for changed project-team', () => {
    expect(canRetrustExtension(makeExt({ scope: 'project-team', trustState: 'changed' }))).toBe(true);
    expect(canRetrustExtension(makeExt({ scope: 'project-team', trustState: 'untrusted' }))).toBe(false);
  });

  it('untrust is available only for trusted project-team (richer or legacy)', () => {
    expect(canUntrustExtension(makeExt({ scope: 'project-team', trustState: 'trusted' }))).toBe(true);
    expect(canUntrustExtension(makeExt({ scope: 'project-team', trust: 'trusted' }))).toBe(true);
    expect(canUntrustExtension(makeExt({ scope: 'project-team', trustState: 'untrusted' }))).toBe(false);
  });

  it('promote is available only for project-local', () => {
    expect(canPromoteExtension(makeExt({ scope: 'project-local' }))).toBe(true);
    expect(canPromoteExtension(makeExt({ scope: 'project-team' }))).toBe(false);
  });

  it('demote is available only for project-team', () => {
    expect(canDemoteExtension(makeExt({ scope: 'project-team' }))).toBe(true);
    expect(canDemoteExtension(makeExt({ scope: 'project-local' }))).toBe(false);
  });
});

describe('selectTrustAction', () => {
  it('maps changed to re-trust, untrusted to trust, otherwise null', () => {
    expect(selectTrustAction(makeExt({ scope: 'project-team', trustState: 'changed' }))).toBe('re-trust');
    expect(selectTrustAction(makeExt({ scope: 'project-team', trustState: 'untrusted' }))).toBe('trust');
    expect(selectTrustAction(makeExt({ scope: 'project-team', trustState: 'trusted' }))).toBeNull();
    expect(selectTrustAction(makeExt({ scope: 'user' }))).toBeNull();
  });
});

describe('hasAnyExtensionAction', () => {
  it('is true for an actionable project-team entry', () => {
    expect(hasAnyExtensionAction(makeExt({ scope: 'project-team', trustState: 'untrusted' }))).toBe(true);
  });

  it('is true for a project-local entry (validate + promote)', () => {
    expect(hasAnyExtensionAction(makeExt({ scope: 'project-local' }))).toBe(true);
  });

  it('is true for a user entry (validate only)', () => {
    expect(hasAnyExtensionAction(makeExt({ scope: 'user' }))).toBe(true);
  });

  it('is false for an unnamed external entry', () => {
    expect(hasAnyExtensionAction(makeExt({ scope: 'external', name: '' }))).toBe(false);
  });
});

describe('label and copy selectors', () => {
  it('returns distinct labels and pending labels per action', () => {
    expect(extensionMutationLabel('trust')).toBe('Trust');
    expect(extensionMutationLabel('re-trust')).toBe('Re-trust');
    expect(extensionMutationLabel('untrust')).toBe('Untrust');
    expect(extensionMutationLabel('promote')).toBe('Promote');
    expect(extensionMutationLabel('demote')).toBe('Demote');
    expect(extensionMutationPendingLabel('untrust')).toBe('Untrusting…');
    expect(extensionMutationPendingLabel('promote')).toBe('Promoting…');
  });

  it('titles name the action and scope', () => {
    expect(extensionMutationTitle('trust')).toContain('Trust');
    expect(extensionMutationTitle('untrust')).toContain('Untrust');
    expect(extensionMutationTitle('promote')).toContain('Promote');
    expect(extensionMutationTitle('demote')).toContain('Demote');
  });

  it('consequence copy describes the effect of each action', () => {
    expect(extensionMutationConsequence('trust')).toMatch(/unsandboxed native code/i);
    expect(extensionMutationConsequence('untrust')).toMatch(/block/i);
    expect(extensionMutationConsequence('promote')).toMatch(/project-team scope/i);
    expect(extensionMutationConsequence('promote')).not.toMatch(/(?<!not )trusted by this action\.\s*$/i);
    expect(extensionMutationConsequence('demote')).toMatch(/trust record/i);
  });

  it('explains why user and external entries lack management actions', () => {
    expect(extensionUnavailableReason(makeExt({ scope: 'user' }))).toMatch(/user-scope/i);
    expect(extensionUnavailableReason(makeExt({ scope: 'external' }))).toMatch(/external/i);
  });
});
