/**
 * Presentational details panel for the selected extension on the System
 * management surface.
 *
 * Renders the full `ExtensionEntry` field set (identity, scope, source, status,
 * trust and hash metadata, trust provenance, package and install provenance,
 * registration counts and details, shadows, diagnostics), the selected
 * validation output, and the management action controls. Mutating actions are
 * gated behind the shared confirmation dialog; validation is a direct read.
 * Kept separate from `extensions-section.tsx` so that file stays within the
 * maintainability limits.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { JsonDetails } from './json-details';
import { sanitizeInstallProvenance } from './extension-install-sanitizer';
import { ExtensionManagementConfirmDialog } from './extension-management-confirm-dialog';
import {
  extensionKey,
  selectTrustAction,
  canValidateExtension,
  canUntrustExtension,
  canPromoteExtension,
  canDemoteExtension,
  extensionUnavailableReason,
  extensionMutationLabel,
  extensionMutationPendingLabel,
  extensionMutationTitle,
  extensionMutationConsequence,
} from './extension-management-selectors';
import type { ExtensionMutationAction } from './extension-management-selectors';
import type { ExtensionManagementControls } from './use-extension-management-mutations';
import type { ExtensionEntry } from './system-types';

interface ExtensionManagementDetailsProps {
  ext: ExtensionEntry;
  management: ExtensionManagementControls;
}

/** A single label/value row. Renders nothing when the value is absent. */
function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 w-32 font-medium text-muted-foreground">{label}</dt>
      <dd className="font-mono break-all">{value}</dd>
    </div>
  );
}

/** Confirmation-gated button for a mutating row action. */
function MutationButton({
  ext,
  action,
  management,
}: {
  ext: ExtensionEntry;
  action: ExtensionMutationAction;
  management: ExtensionManagementControls;
}) {
  const isPending = management.pending?.action === action && management.pending.path === ext.path;
  const label = extensionMutationLabel(action);
  return (
    <ExtensionManagementConfirmDialog
      title={extensionMutationTitle(action)}
      consequence={extensionMutationConsequence(action)}
      confirmLabel={label}
      onConfirm={() => management.onMutate(action, ext.path)}
      target={{ name: ext.name, path: ext.path, scope: ext.scope, trustState: ext.trustState }}
    >
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        disabled={management.pending !== null}
      >
        {isPending ? extensionMutationPendingLabel(action) : label}
      </Button>
    </ExtensionManagementConfirmDialog>
  );
}

/** Action controls row: validate plus the eligible mutating actions. */
function ActionControls({ ext, management }: ExtensionManagementDetailsProps) {
  const key = extensionKey(ext);
  const validatePending = management.validation.pending && management.validation.key === key;
  const trustAction = selectTrustAction(ext);
  const hasMutatingAction =
    trustAction !== null ||
    canUntrustExtension(ext) ||
    canPromoteExtension(ext) ||
    canDemoteExtension(ext);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canValidateExtension(ext) && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          // Disable every selected-validation button while any validation is in
          // flight; the hook ignores concurrent requests, so an enabled button on
          // a different row would otherwise click silently with no effect.
          disabled={management.validation.pending}
          onClick={() => management.onValidateSelected(ext)}
        >
          {validatePending ? 'Validating…' : 'Validate'}
        </Button>
      )}
      {trustAction && <MutationButton ext={ext} action={trustAction} management={management} />}
      {canUntrustExtension(ext) && <MutationButton ext={ext} action="untrust" management={management} />}
      {canPromoteExtension(ext) && <MutationButton ext={ext} action="promote" management={management} />}
      {canDemoteExtension(ext) && <MutationButton ext={ext} action="demote" management={management} />}
      {!hasMutatingAction && (
        <p className="text-xs text-muted-foreground" role="note">
          {extensionUnavailableReason(ext)}
        </p>
      )}
    </div>
  );
}

/** Selected validation result/error/diagnostics for the selected extension. */
function SelectedValidation({ ext, management }: ExtensionManagementDetailsProps) {
  const { validation } = management;
  if (validation.key !== extensionKey(ext)) return null;
  if (validation.pending) {
    return <p className="text-xs text-muted-foreground" aria-live="polite">Validating selected extension…</p>;
  }
  if (validation.error) {
    return <p className="text-xs text-destructive" role="alert">{validation.error}</p>;
  }
  const result = validation.result;
  if (!result) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground font-medium">Selected validation</span>
        <Badge variant={result.valid ? 'secondary' : 'destructive'}>
          {result.valid ? 'valid' : 'invalid'}
        </Badge>
      </div>
      {result.diagnostics.length > 0 && (
        <ul className="pl-3 space-y-0.5">
          {result.diagnostics.map((d, i) => (
            <li key={i} className={d.severity === 'error' ? 'text-destructive' : 'text-yellow-600'}>
              [{d.severity}] {d.code}: {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ExtensionManagementDetails({ ext, management }: ExtensionManagementDetailsProps) {
  const reg = ext.registrations;
  const error = management.errors[ext.path];
  const success = management.successes[ext.path];

  return (
    <div
      className="rounded border bg-muted/30 p-3 space-y-3 text-xs"
      aria-label={`Extension details: ${ext.name}`}
    >
      <dl className="space-y-1">
        <Field label="Name" value={ext.name} />
        <Field label="Path" value={ext.path} />
        <Field label="Entrypoint" value={ext.entrypoint} />
        <Field label="Scope" value={ext.scope} />
        <Field label="Source" value={ext.source} />
        <Field label="Status" value={ext.status} />
        <Field label="Enabled" value={ext.enabled === undefined ? undefined : String(ext.enabled)} />
        <Field label="Trust state" value={ext.trustState} />
        <Field label="Trust (legacy)" value={ext.trust} />
        <Field label="Current hash" value={ext.currentHash} />
        <Field label="Trusted hash" value={ext.trustedHash} />
        <Field label="Trusted at" value={ext.trustedAt} />
        <Field label="Trusted by" value={ext.trustedBy} />
        <Field label="Trust store" value={ext.trustStorePath} />
        <Field label="Format" value={ext.format} />
        <Field label="Layout" value={ext.layout} />
        <Field label="Strategy" value={ext.strategy} />
      </dl>

      <div>
        <p className="text-muted-foreground font-medium mb-1">Registrations</p>
        <div className="flex flex-wrap gap-1.5">
          {reg.eventHooks > 0 && <Badge variant="outline">event hooks: {reg.eventHooks}</Badge>}
          {reg.agentRunHooks > 0 && <Badge variant="outline">agent run hooks: {reg.agentRunHooks}</Badge>}
          {reg.policyGates > 0 && <Badge variant="outline">policy gates: {reg.policyGates}</Badge>}
          {reg.profileRouters > 0 && <Badge variant="outline">profile routers: {reg.profileRouters}</Badge>}
          {reg.inputSources > 0 && <Badge variant="outline">input sources: {reg.inputSources}</Badge>}
          {reg.reviewerPerspectives > 0 && <Badge variant="outline">reviewer perspectives: {reg.reviewerPerspectives}</Badge>}
          {reg.validationProviders > 0 && <Badge variant="outline">validation providers: {reg.validationProviders}</Badge>}
          {reg.tools > 0 && <Badge variant="outline">tools: {reg.tools}</Badge>}
          {reg.prdEnrichers > 0 && <Badge variant="outline">prd enrichers: {reg.prdEnrichers}</Badge>}
          {reg.actions > 0 && <Badge variant="outline">actions: {reg.actions}</Badge>}
          {reg.consoleContributions > 0 && <Badge variant="outline">Console contributions: {reg.consoleContributions}</Badge>}
          {reg.consoleWorkstations > 0 && <Badge variant="outline">workstations: {reg.consoleWorkstations}</Badge>}
          {reg.integrationCommands > 0 && <Badge variant="outline">integration commands: {reg.integrationCommands}</Badge>}
          {reg.deepLinks > 0 && <Badge variant="outline">deep links: {reg.deepLinks}</Badge>}
        </div>
      </div>

      {(ext.reviewerPerspectiveDetails?.length ?? 0) > 0 && (
        <JsonDetails label="Reviewer perspective details" value={ext.reviewerPerspectiveDetails} />
      )}
      {(ext.validationProviderDetails?.length ?? 0) > 0 && (
        <JsonDetails label="Validation provider details" value={ext.validationProviderDetails} />
      )}
      {(ext.actionDetails?.length ?? 0) > 0 && (
        <JsonDetails label="Action details" value={ext.actionDetails} />
      )}
      {(ext.consoleContributionDetails?.length ?? 0) > 0 && (
        <JsonDetails label="Console contribution details" value={ext.consoleContributionDetails} />
      )}
      {(ext.consoleWorkstationDetails?.length ?? 0) > 0 && (
        <JsonDetails label="Console workstation details" value={ext.consoleWorkstationDetails} />
      )}
      {(ext.integrationCommandDetails?.length ?? 0) > 0 && (
        <JsonDetails label="Integration command details" value={ext.integrationCommandDetails} />
      )}
      {(ext.deepLinkDetails?.length ?? 0) > 0 && (
        <JsonDetails label="Deep link details" value={ext.deepLinkDetails} />
      )}
      {ext.shadows.length > 0 && <JsonDetails label={`Shadows (${ext.shadows.length})`} value={ext.shadows} />}
      {ext.package && <JsonDetails label="Package provenance" value={ext.package} />}
      {ext.install && (
        <JsonDetails label="Install provenance" value={sanitizeInstallProvenance(ext.install)} />
      )}

      {ext.diagnostics.length > 0 && (
        <div>
          <p className="text-muted-foreground font-medium mb-1">Diagnostics</p>
          <ul className="pl-3 space-y-0.5">
            {ext.diagnostics.map((d, i) => (
              <li key={i} className={d.severity === 'error' ? 'text-destructive' : 'text-yellow-600'}>
                [{d.severity}] {d.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ActionControls ext={ext} management={management} />

      {error && <p className="text-destructive" role="alert">{error}</p>}
      {success && <p className="text-muted-foreground">{success}</p>}

      <SelectedValidation ext={ext} management={management} />
    </div>
  );
}
