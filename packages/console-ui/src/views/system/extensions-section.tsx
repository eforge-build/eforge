/**
 * Extensions section — a first-class native extension management surface.
 *
 * Keeps the scannable inventory (registration totals, status/scope/trust chips,
 * global validation summary, diagnostics) and adds a management area: a global
 * Reload control, a selectable row list, and a details panel for the selected
 * extension that exposes confirmation-gated validate/trust/re-trust/untrust/
 * promote/demote actions plus selected-validation output. All mutating actions
 * flow through the System management hook; package lifecycle forms
 * (new/install/update/remove/test) remain deferred.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SystemSection } from './system-section';
import { ExtensionManagementConfirmDialog } from './extension-management-confirm-dialog';
import { ExtensionManagementDetails } from './extension-management-details';
import { extensionKey } from './extension-management-selectors';
import { selectExtensionDiagnosticCounts } from '@/lib/selectors';
import type { ExtensionManagementControls } from './use-extension-management-mutations';
import type { Loadable, ExtensionListResponse, ExtensionValidateResponse } from './system-types';

interface ExtensionsSectionProps {
  list: Loadable<ExtensionListResponse>;
  validate: Loadable<ExtensionValidateResponse>;
  /**
   * System management controls. When absent the inventory still renders, but no
   * reload control, selection, or row actions are available.
   */
  management?: ExtensionManagementControls;
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  loaded: 'secondary',
  error: 'destructive',
  pending: 'outline',
  shadowed: 'outline',
  skipped: 'outline',
  excluded: 'outline',
};

function trustBadge(ext: { trustState?: string; trust?: string }): React.ReactNode {
  if (ext.trustState) {
    return (
      <Badge
        variant={
          ext.trustState === 'trusted'
            ? 'secondary'
            : ext.trustState === 'not-required'
              ? 'outline'
              : 'destructive'
        }
        className="text-xs"
      >
        {ext.trustState}
      </Badge>
    );
  }
  if (ext.trust) {
    return (
      <Badge variant={ext.trust === 'trusted' ? 'secondary' : 'destructive'} className="text-xs">
        {ext.trust}
      </Badge>
    );
  }
  return null;
}

/** Daemon message and watcher metadata after a reload. */
function ReloadFeedback({ management }: { management: ExtensionManagementControls }) {
  const { reload } = management;
  if (reload.error) {
    return <p className="text-xs text-destructive" role="alert">{reload.error}</p>;
  }
  if (!reload.result) return null;
  const watcher = reload.result.watcher;
  return (
    <div className="space-y-1" role="status">
      <p className="text-xs text-muted-foreground">{reload.result.message}</p>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline">watcher: {watcher.message}</Badge>
        <Badge variant={watcher.restarted ? 'secondary' : 'outline'}>
          {watcher.restarted ? 'watcher restarted' : 'watcher unchanged'}
        </Badge>
        <Badge variant={watcher.running ? 'secondary' : 'outline'}>
          {watcher.running ? 'watcher running' : 'watcher stopped'}
        </Badge>
        {watcher.sessionId && <Badge variant="outline">session: {watcher.sessionId}</Badge>}
      </div>
    </div>
  );
}

export function ExtensionsSection({ list, validate, management }: ExtensionsSectionProps) {
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);

  const isLoading = list.status === 'loading' || validate.status === 'loading';
  const listError = list.status === 'error' ? list.error : undefined;
  const validateError = validate.status === 'error' ? validate.error : undefined;

  const hasData = list.status === 'success' || (list.status === 'error' && list.data);
  const extensions = hasData ? list.data?.extensions ?? [] : [];
  const diagnostics = hasData ? list.data?.diagnostics ?? [] : [];
  const totals = hasData ? list.data?.totals : undefined;

  const diagCounts = selectExtensionDiagnosticCounts(diagnostics);
  const isEmpty = list.status === 'empty' || (list.status === 'success' && extensions.length === 0 && diagnostics.length === 0);
  const isValid = validate.status === 'success' ? validate.data.valid : null;

  // Selection is keyed by `scope:path`, but promote/demote change an extension's
  // scope after the required refresh. When the exact key no longer matches, fall
  // back to the unchanged path so the selection (and its path-keyed success
  // message) survive the refresh; re-sync the stored key to the new scope below.
  const selectedPath =
    selectedKey === null ? null : selectedKey.slice(selectedKey.indexOf(':') + 1);
  const selected =
    extensions.find((ext) => extensionKey(ext) === selectedKey) ??
    (selectedPath !== null ? extensions.find((ext) => ext.path === selectedPath) : undefined);

  React.useEffect(() => {
    if (selected !== undefined && extensionKey(selected) !== selectedKey) {
      setSelectedKey(extensionKey(selected));
    }
  }, [selected, selectedKey]);

  return (
    <SystemSection
      title="Extensions"
      description="Discovered extensions, registration counts, trust states, diagnostics, and management actions."
      loading={isLoading}
      empty={isEmpty}
      emptyText="No extensions discovered"
    >
      {listError && <p className="text-xs text-destructive" role="alert">{listError}</p>}
      {validateError && <p className="text-xs text-destructive" role="alert">{validateError}</p>}

      <div className="space-y-3 text-xs">
        {management && (
          <div className="space-y-2">
            <ExtensionManagementConfirmDialog
              title="Reload extensions?"
              consequence="Reloading rediscovers extensions and restarts or replaces the runtime watcher. Newly trusted project-team code may begin executing as unsandboxed native code after the reload."
              confirmLabel="Reload"
              onConfirm={management.onReload}
            >
              <Button variant="outline" size="sm" disabled={management.reload.pending}>
                {management.reload.pending ? 'Reloading…' : 'Reload extensions'}
              </Button>
            </ExtensionManagementConfirmDialog>
            <ReloadFeedback management={management} />
          </div>
        )}

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
            {extensions.map((ext) => {
              const key = extensionKey(ext);
              const isSelected = key === selectedKey;
              return (
                <li key={key} className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {management ? (
                      <button
                        type="button"
                        className="font-mono font-medium underline-offset-2 hover:underline"
                        aria-pressed={isSelected}
                        onClick={() => setSelectedKey(isSelected ? null : key)}
                      >
                        {ext.name}
                      </button>
                    ) : (
                      <span className="font-mono font-medium">{ext.name}</span>
                    )}
                    <Badge variant={STATUS_VARIANTS[ext.status] ?? 'outline'} className="text-xs">
                      {ext.status}
                    </Badge>
                    <Badge variant="outline" className="text-xs">{ext.scope}</Badge>
                    {trustBadge(ext)}
                    {ext.format && <Badge variant="outline" className="text-xs">{ext.format}</Badge>}
                    {(ext.actionDetails?.length ?? 0) > 0 && <Badge variant="outline" className="text-xs">actions: {ext.actionDetails?.length}</Badge>}
                    {(ext.consoleContributionDetails?.length ?? 0) > 0 && <Badge variant="outline" className="text-xs">Console panels: {ext.consoleContributionDetails?.length}</Badge>}
                    {(ext.integrationCommandDetails?.length ?? 0) > 0 && <Badge variant="outline" className="text-xs">commands: {ext.integrationCommandDetails?.length}</Badge>}
                    {(ext.deepLinkDetails?.length ?? 0) > 0 && <Badge variant="outline" className="text-xs">deep links: {ext.deepLinkDetails?.length}</Badge>}
                  </div>
                  {ext.diagnostics.length > 0 && (
                    <ul className="pl-3 space-y-0.5">
                      {ext.diagnostics.map((d, i) => (
                        <li key={i} className={d.severity === 'error' ? 'text-destructive' : 'text-yellow-600'}>
                          [{d.severity}] {d.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  {management && isSelected && (
                    <ExtensionManagementDetails ext={ext} management={management} />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {management && selected === undefined && selectedKey !== null && (
          // Selected extension disappeared after a refresh (e.g. demote changed its key).
          <p className="text-muted-foreground">Select an extension to manage it.</p>
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
