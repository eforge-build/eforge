/**
 * Extensions section — registration totals, extension rows, trust/status/scope chips,
 * reviewer/validation provider counts, and diagnostic list.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SystemSection } from './system-section';
import { TrustConfirmDialog } from '@/components/extensions/trust-confirm-dialog';
import {
  selectExtensionDiagnosticCounts,
  extensionNeedsTrust,
  extensionTrustActionLabel,
} from '@/lib/selectors';
import type { Loadable, ExtensionListResponse, ExtensionValidateResponse } from './system-types';

/**
 * Trust mutation controls threaded down from the System route. When absent, no
 * trust buttons render. Keyed by extension path so each row reflects its own
 * pending/error/success state.
 */
export interface ExtensionTrustControls {
  pendingPath: string | null;
  errors: Record<string, string>;
  successes: Record<string, string>;
  onTrust: (path: string) => void;
}

interface ExtensionsSectionProps {
  list: Loadable<ExtensionListResponse>;
  validate: Loadable<ExtensionValidateResponse>;
  trust?: ExtensionTrustControls;
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  loaded: 'secondary',
  error: 'destructive',
  pending: 'outline',
  shadowed: 'outline',
  skipped: 'outline',
  excluded: 'outline',
};

export function ExtensionsSection({ list, validate, trust }: ExtensionsSectionProps) {
  const isLoading = list.status === 'loading' || validate.status === 'loading';
  const listError = list.status === 'error' ? list.error : undefined;
  const validateError = validate.status === 'error' ? validate.error : undefined;

  const extensions = (list.status === 'success' || (list.status === 'error' && list.data))
    ? list.data?.extensions ?? []
    : [];
  const diagnostics = (list.status === 'success' || (list.status === 'error' && list.data))
    ? list.data?.diagnostics ?? []
    : [];
  const totals = (list.status === 'success' || (list.status === 'error' && list.data))
    ? list.data?.totals
    : undefined;

  const diagCounts = selectExtensionDiagnosticCounts(diagnostics);
  const isEmpty = list.status === 'empty' || (list.status === 'success' && extensions.length === 0 && diagnostics.length === 0);
  const isValid = validate.status === 'success' ? validate.data.valid : null;

  return (
    <SystemSection
      title="Extensions"
      description="Discovered extensions, registration counts, trust states, and diagnostics."
      loading={isLoading}
      empty={isEmpty}
      emptyText="No extensions discovered"
    >
      {listError && <p className="text-xs text-destructive" role="alert">{listError}</p>}
      {validateError && <p className="text-xs text-destructive" role="alert">{validateError}</p>}

      <div className="space-y-3 text-xs">
        {isValid !== null && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-medium">Validation</span>
            <Badge variant={isValid ? 'secondary' : 'destructive'}>
              {isValid ? 'valid' : 'invalid'}
            </Badge>
          </div>
        )}

        {totals && (
          <div>
            <p className="text-muted-foreground font-medium mb-1">Registration totals</p>
            <div className="flex flex-wrap gap-1.5">
              {totals.eventHooks > 0 && <Badge variant="outline">event hooks: {totals.eventHooks}</Badge>}
              {totals.agentRunHooks > 0 && <Badge variant="outline">agent run hooks: {totals.agentRunHooks}</Badge>}
              {totals.policyGates > 0 && <Badge variant="outline">policy gates: {totals.policyGates}</Badge>}
              {totals.profileRouters > 0 && <Badge variant="outline">profile routers: {totals.profileRouters}</Badge>}
              {totals.inputSources > 0 && <Badge variant="outline">input sources: {totals.inputSources}</Badge>}
              {totals.reviewerPerspectives > 0 && <Badge variant="outline">reviewer perspectives: {totals.reviewerPerspectives}</Badge>}
              {totals.validationProviders > 0 && <Badge variant="outline">validation providers: {totals.validationProviders}</Badge>}
              {totals.tools > 0 && <Badge variant="outline">tools: {totals.tools}</Badge>}
              {totals.prdEnrichers > 0 && <Badge variant="outline">prd enrichers: {totals.prdEnrichers}</Badge>}
              {totals.actions > 0 && <Badge variant="outline">actions: {totals.actions}</Badge>}
              {totals.consoleContributions > 0 && <Badge variant="outline">Console contributions: {totals.consoleContributions}</Badge>}
              {totals.integrationCommands > 0 && <Badge variant="outline">integration commands: {totals.integrationCommands}</Badge>}
              {totals.deepLinks > 0 && <Badge variant="outline">deep links: {totals.deepLinks}</Badge>}
            </div>
          </div>
        )}

        {extensions.length > 0 && (
          <ul className="space-y-2">
            {extensions.map((ext) => (
              <li key={`${ext.scope}:${ext.name}`} className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-medium">{ext.name}</span>
                  <Badge variant={STATUS_VARIANTS[ext.status] ?? 'outline'} className="text-xs">
                    {ext.status}
                  </Badge>
                  <Badge variant="outline" className="text-xs">{ext.scope}</Badge>
                  {ext.trustState ? (
                    <Badge variant={
                      ext.trustState === 'trusted' ? 'secondary' :
                      ext.trustState === 'not-required' ? 'outline' :
                      'destructive'
                    } className="text-xs">
                      {ext.trustState}
                    </Badge>
                  ) : ext.trust ? (
                    <Badge variant={ext.trust === 'trusted' ? 'secondary' : 'destructive'} className="text-xs">
                      {ext.trust}
                    </Badge>
                  ) : null}
                  {ext.format && <Badge variant="outline" className="text-xs">{ext.format}</Badge>}
                  {(ext.actionDetails?.length ?? 0) > 0 && <Badge variant="outline" className="text-xs">actions: {ext.actionDetails?.length}</Badge>}
                  {(ext.consoleContributionDetails?.length ?? 0) > 0 && <Badge variant="outline" className="text-xs">Console panels: {ext.consoleContributionDetails?.length}</Badge>}
                  {(ext.integrationCommandDetails?.length ?? 0) > 0 && <Badge variant="outline" className="text-xs">commands: {ext.integrationCommandDetails?.length}</Badge>}
                  {(ext.deepLinkDetails?.length ?? 0) > 0 && <Badge variant="outline" className="text-xs">deep links: {ext.deepLinkDetails?.length}</Badge>}
                  {trust && extensionNeedsTrust(ext) && (
                    <TrustConfirmDialog
                      name={ext.name}
                      path={ext.path}
                      trustState={ext.trustState}
                      actionLabel={extensionTrustActionLabel(ext)}
                      onConfirm={() => trust.onTrust(ext.path)}
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        disabled={trust.pendingPath !== null}
                      >
                        {trust.pendingPath === ext.path ? 'Trusting…' : extensionTrustActionLabel(ext)}
                      </Button>
                    </TrustConfirmDialog>
                  )}
                </div>
                {trust?.errors[ext.path] && (
                  <p className="text-xs text-destructive" role="alert">{trust.errors[ext.path]}</p>
                )}
                {trust?.successes[ext.path] && (
                  <p className="text-xs text-muted-foreground">{trust.successes[ext.path]}</p>
                )}
                {ext.diagnostics.length > 0 && (
                  <ul className="pl-3 space-y-0.5">
                    {ext.diagnostics.map((d, i) => (
                      <li key={i} className={d.severity === 'error' ? 'text-destructive' : 'text-yellow-600'}>
                        [{d.severity}] {d.message}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}

        {diagCounts.total > 0 && (
          <div>
            <p className="text-muted-foreground font-medium mb-1">
              Global diagnostics ({diagCounts.errors} error{diagCounts.errors !== 1 ? 's' : ''}, {diagCounts.warnings} warning{diagCounts.warnings !== 1 ? 's' : ''})
            </p>
            <ul className="space-y-0.5">
              {diagnostics.map((d, i) => (
                <li key={i} className={d.severity === 'error' ? 'text-destructive' : 'text-yellow-600'}>
                  [{d.severity}] {d.code}: {d.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SystemSection>
  );
}
