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
  it.each([
    ['validate target: project-team', makeExt({ scope: 'project-team', path: '/pt.ts' }), { path: '/pt.ts' }],
    ['validate target: project-local', makeExt({ scope: 'project-local', path: '/pl.ts' }), { path: '/pl.ts' }],
    ['validate target: user named', makeExt({ scope: 'user', name: 'u', path: '/u.ts' }), { name: 'u' }],
    ['validate target: external named', makeExt({ scope: 'external', name: 'e', path: '/e.ts' }), { name: 'e' }],
    ['validate target: external unnamed', makeExt({ scope: 'external', name: '', path: '/e.ts' }), { path: '/e.ts' }],
  ])('%s', (_label, extension, expected) => {
    expect(selectValidateTarget(extension)).toEqual(expected);
  });
});

describe('action eligibility', () => {
  it('reload is always available', () => {
    expect(canReloadExtensions()).toBe(true);
  });

  it.each([
    ['validate eligibility: project-local', makeExt({ scope: 'project-local' }), true],
    ['validate eligibility: project-team', makeExt({ scope: 'project-team' }), true],
    ['validate eligibility: user', makeExt({ scope: 'user' }), true],
    ['validate eligibility: external named', makeExt({ scope: 'external', name: 'has-name' }), true],
    ['validate eligibility: external unnamed', makeExt({ scope: 'external', name: '' }), false],
  ])('%s', (_label, extension, expected) => {
    expect(canValidateExtension(extension)).toBe(expected);
  });

  it.each([
    ['trust eligibility: project-team rich untrusted', makeExt({ scope: 'project-team', trustState: 'untrusted' }), true],
    ['trust eligibility: project-team legacy untrusted', makeExt({ scope: 'project-team', trust: 'untrusted' }), true],
    ['trust eligibility: project-team rich trusted', makeExt({ scope: 'project-team', trustState: 'trusted' }), false],
    ['trust eligibility: project-local untrusted', makeExt({ scope: 'project-local', trustState: 'untrusted' }), false],
  ])('%s', (_label, extension, expected) => {
    expect(canTrustExtension(extension)).toBe(expected);
  });

  it.each([
    ['re-trust eligibility: project-team changed', makeExt({ scope: 'project-team', trustState: 'changed' }), true],
    ['re-trust eligibility: project-team untrusted', makeExt({ scope: 'project-team', trustState: 'untrusted' }), false],
  ])('%s', (_label, extension, expected) => {
    expect(canRetrustExtension(extension)).toBe(expected);
  });

  it.each([
    ['untrust eligibility: project-team rich trusted', makeExt({ scope: 'project-team', trustState: 'trusted' }), true],
    ['untrust eligibility: project-team legacy trusted', makeExt({ scope: 'project-team', trust: 'trusted' }), true],
    ['untrust eligibility: project-team untrusted', makeExt({ scope: 'project-team', trustState: 'untrusted' }), false],
  ])('%s', (_label, extension, expected) => {
    expect(canUntrustExtension(extension)).toBe(expected);
  });

  it.each([
    ['promote eligibility: project-local', canPromoteExtension, makeExt({ scope: 'project-local' }), true],
    ['promote eligibility: project-team', canPromoteExtension, makeExt({ scope: 'project-team' }), false],
    ['demote eligibility: project-team', canDemoteExtension, makeExt({ scope: 'project-team' }), true],
    ['demote eligibility: project-local', canDemoteExtension, makeExt({ scope: 'project-local' }), false],
  ])('%s', (_label, selector, extension, expected) => {
    expect(selector(extension)).toBe(expected);
  });
});

describe('selectTrustAction', () => {
  it.each([
    ['trust action: project-team changed', makeExt({ scope: 'project-team', trustState: 'changed' }), 're-trust'],
    ['trust action: project-team untrusted', makeExt({ scope: 'project-team', trustState: 'untrusted' }), 'trust'],
    ['trust action: project-team trusted', makeExt({ scope: 'project-team', trustState: 'trusted' }), null],
    ['trust action: user', makeExt({ scope: 'user' }), null],
  ])('%s', (_label, extension, expected) => {
    expect(selectTrustAction(extension)).toBe(expected);
  });
});

describe('hasAnyExtensionAction', () => {
  it.each([
    ['action availability: project-team untrusted', makeExt({ scope: 'project-team', trustState: 'untrusted' }), true],
    ['action availability: project-local', makeExt({ scope: 'project-local' }), true],
    ['action availability: user', makeExt({ scope: 'user' }), true],
    ['action availability: external unnamed', makeExt({ scope: 'external', name: '' }), false],
  ])('%s', (_label, extension, expected) => {
    expect(hasAnyExtensionAction(extension)).toBe(expected);
  });
});

describe('label and copy selectors', () => {
  it.each([
    ['label: trust', () => extensionMutationLabel('trust'), 'Trust'],
    ['label: re-trust', () => extensionMutationLabel('re-trust'), 'Re-trust'],
    ['label: untrust', () => extensionMutationLabel('untrust'), 'Untrust'],
    ['label: promote', () => extensionMutationLabel('promote'), 'Promote'],
    ['label: demote', () => extensionMutationLabel('demote'), 'Demote'],
    ['pending label: untrust', () => extensionMutationPendingLabel('untrust'), 'Untrusting…'],
    ['pending label: promote', () => extensionMutationPendingLabel('promote'), 'Promoting…'],
  ])('%s', (_label, selector, expected) => {
    expect(selector()).toBe(expected);
  });

  it.each([
    ['title copy: trust', 'trust', /Trust/],
    ['title copy: untrust', 'untrust', /Untrust/],
    ['title copy: promote', 'promote', /Promote/],
    ['title copy: demote', 'demote', /Demote/],
  ] as const)('%s', (_label, action, expected) => {
    expect(extensionMutationTitle(action)).toMatch(expected);
  });

  it.each([
    ['consequence copy: trust', 'trust', /unsandboxed native code/i],
    ['consequence copy: untrust', 'untrust', /block/i],
    ['consequence copy: promote names project-team scope', 'promote', /project-team scope/i],
    ['consequence copy: demote names trust record', 'demote', /trust record/i],
  ] as const)('%s', (_label, action, expected) => {
    expect(extensionMutationConsequence(action)).toMatch(expected);
  });

  it('consequence copy: promote does not claim trust is granted', () => {
    expect(extensionMutationConsequence('promote')).not.toMatch(/(?<!not )trusted by this action\.\s*$/i);
  });

  it.each([
    ['unavailable reason: user', makeExt({ scope: 'user' }), /user-scope/i],
    ['unavailable reason: external', makeExt({ scope: 'external' }), /external/i],
  ])('%s', (_label, extension, expected) => {
    expect(extensionUnavailableReason(extension)).toMatch(expected);
  });
});
