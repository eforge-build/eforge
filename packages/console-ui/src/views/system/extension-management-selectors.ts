/**
 * Pure UI selectors for the System extension management surface.
 *
 * These selectors are intentionally free of React and fetch concerns so the
 * component and hook layers can stay focused on rendering and side effects.
 * They cover stable extension keys, the selected-validation target identifier,
 * per-action eligibility, button labels, disabled reasons, and the consequence
 * copy rendered inside each confirmation dialog. Wire types come from the
 * client browser bundle (via `./system-types`); no daemon response interfaces
 * are declared here.
 */
import type { ExtensionEntry } from './system-types';
import type { SystemExtensionTarget } from './system-fetches';

/** Mutating row actions the management surface can dispatch. */
export type ExtensionMutationAction = 'trust' | 're-trust' | 'untrust' | 'promote' | 'demote';

/**
 * Stable, collision-resistant key for an extension row. Path-based so duplicate
 * extension names across scopes never collide. Scope is included so the same
 * file discovered under two scopes (shadowing) still produces distinct keys.
 */
export function extensionKey(ext: ExtensionEntry): string {
  return `${ext.scope}:${ext.path}`;
}

/**
 * The single target identifier used for selected validation. Project-local and
 * project-team entries validate by `path`; user and external entries validate
 * by `name` when present (their paths can sit outside the project-root
 * validation guard), falling back to `path` only when no name is available.
 */
export function selectValidateTarget(ext: ExtensionEntry): SystemExtensionTarget {
  if (ext.scope === 'project-local' || ext.scope === 'project-team') {
    return { path: ext.path };
  }
  if (ext.name && ext.name.length > 0) {
    return { name: ext.name };
  }
  return { path: ext.path };
}

/** Whether the extension is currently coarse- or richly-trusted. */
function isTrusted(ext: ExtensionEntry): boolean {
  if (ext.trustState) return ext.trustState === 'trusted';
  return ext.trust === 'trusted';
}

/** Whether the extension is currently untrusted (richer or legacy coarse field). */
function isUntrusted(ext: ExtensionEntry): boolean {
  if (ext.trustState) return ext.trustState === 'untrusted';
  return ext.trust === 'untrusted';
}

/** Reload is always available while the section renders. */
export function canReloadExtensions(): boolean {
  return true;
}

/**
 * Validate is available for project-local, project-team, and user entries, and
 * for external entries only when a name exists (so a single target identifier
 * can always be sent).
 */
export function canValidateExtension(ext: ExtensionEntry): boolean {
  if (ext.scope === 'project-local' || ext.scope === 'project-team' || ext.scope === 'user') {
    return true;
  }
  return ext.scope === 'external' && !!ext.name && ext.name.length > 0;
}

/** Trust is available for project-team entries that are untrusted. */
export function canTrustExtension(ext: ExtensionEntry): boolean {
  return ext.scope === 'project-team' && isUntrusted(ext);
}

/** Re-trust is available for project-team entries whose content changed. */
export function canRetrustExtension(ext: ExtensionEntry): boolean {
  return ext.scope === 'project-team' && ext.trustState === 'changed';
}

/** Untrust is available for project-team entries that are currently trusted. */
export function canUntrustExtension(ext: ExtensionEntry): boolean {
  return ext.scope === 'project-team' && isTrusted(ext);
}

/** Promote is available for project-local entries. */
export function canPromoteExtension(ext: ExtensionEntry): boolean {
  return ext.scope === 'project-local';
}

/** Demote is available for project-team entries. */
export function canDemoteExtension(ext: ExtensionEntry): boolean {
  return ext.scope === 'project-team';
}

/**
 * The trust-family action a row offers, if any: `re-trust` for changed
 * project-team content, `trust` for untrusted project-team content, otherwise
 * null (already trusted, not-required, or a non-project-team scope).
 */
export function selectTrustAction(ext: ExtensionEntry): 'trust' | 're-trust' | null {
  if (canRetrustExtension(ext)) return 're-trust';
  if (canTrustExtension(ext)) return 'trust';
  return null;
}

/**
 * Whether any management control should render for the selected extension.
 * User entries (and other ineligible rows) render an explanatory note instead.
 */
export function hasAnyExtensionAction(ext: ExtensionEntry): boolean {
  return (
    canValidateExtension(ext) ||
    selectTrustAction(ext) !== null ||
    canUntrustExtension(ext) ||
    canPromoteExtension(ext) ||
    canDemoteExtension(ext)
  );
}

/** Human-readable button label for a mutating action. */
export function extensionMutationLabel(action: ExtensionMutationAction): string {
  switch (action) {
    case 'trust':
      return 'Trust';
    case 're-trust':
      return 'Re-trust';
    case 'untrust':
      return 'Untrust';
    case 'promote':
      return 'Promote';
    case 'demote':
      return 'Demote';
  }
}

/** Pending-state label shown on the in-flight action button. */
export function extensionMutationPendingLabel(action: ExtensionMutationAction): string {
  switch (action) {
    case 'trust':
      return 'Trusting…';
    case 're-trust':
      return 'Re-trusting…';
    case 'untrust':
      return 'Untrusting…';
    case 'promote':
      return 'Promoting…';
    case 'demote':
      return 'Demoting…';
  }
}

/** Confirmation dialog title for a mutating action. */
export function extensionMutationTitle(action: ExtensionMutationAction): string {
  switch (action) {
    case 'trust':
      return 'Trust project-team extension?';
    case 're-trust':
      return 'Re-trust project-team extension?';
    case 'untrust':
      return 'Untrust project-team extension?';
    case 'promote':
      return 'Promote project-local extension?';
    case 'demote':
      return 'Demote project-team extension?';
  }
}

/**
 * Action-specific consequence copy for the confirmation dialog. Every string is
 * paired with a separate supply-chain/unsandboxed-code warning rendered by the
 * dialog itself.
 */
export function extensionMutationConsequence(action: ExtensionMutationAction): string {
  switch (action) {
    case 'trust':
    case 're-trust':
      return 'Trusting this extension lets its project-team code execute as unsandboxed native code after the next reload. Only continue if you have reviewed the extension and trust its source.';
    case 'untrust':
      return 'Untrusting removes this extension from the project-team trust record. Future reloads will block the project-team extension until it is trusted again.';
    case 'promote':
      return 'Promoting moves this project-local extension into project-team scope, where teammates may discover it. It is not trusted by this action.';
    case 'demote':
      return 'Demoting moves this project-team extension to project-local scope. The daemon removes its project-team trust record as part of the demotion.';
  }
}

/**
 * Explanation rendered in the details panel when no management action is
 * available for the selected extension (for example user-scope entries).
 */
export function extensionUnavailableReason(ext: ExtensionEntry): string {
  if (ext.scope === 'user') {
    return 'User-scope extensions are managed outside the project. Trust, untrust, promote, and demote are unavailable here.';
  }
  if (ext.scope === 'external') {
    return 'External extensions are managed outside the project. Trust, untrust, promote, and demote are unavailable here.';
  }
  return 'No management actions are available for this extension in its current state.';
}
