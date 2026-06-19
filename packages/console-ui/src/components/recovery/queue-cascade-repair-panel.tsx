import * as React from 'react';
import type { QueueRecoveryApplyResponse, QueueRecoveryAnalyzeResponse } from '@eforge-build/client/browser';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  deriveCascadeRepairState,
  formatRepairResult,
  removalKey,
  type RemovalSelection,
  type StackParentSelection,
} from './queue-cascade-repair-state';

interface QueueCascadeRepairPanelProps {
  analysis: QueueRecoveryAnalyzeResponse;
  selectedRemovals: RemovalSelection;
  selectedStackParents: StackParentSelection;
  applyResult: QueueRecoveryApplyResponse | null;
  onToggleRemoval: (key: string, checked: boolean) => void;
  onSelectStackParent: (targetPrdId: string, parentId: string) => void;
}

function statusBadge(status: string) {
  const className = status === 'blocking'
    ? 'border-red/30 bg-red/10 text-red'
    : status === 'satisfied'
      ? 'border-blue/30 bg-blue/10 text-blue'
      : status === 'terminal'
        ? 'border-yellow/30 bg-yellow/10 text-yellow'
        : 'border-border text-muted-foreground';
  return <Badge variant="outline" className={className}>{status}</Badge>;
}

function metadataSummary(value: unknown): string {
  return value ? JSON.stringify(value) : '—';
}

export function QueueCascadeRepairPanel({
  analysis,
  selectedRemovals,
  selectedStackParents,
  applyResult,
  onToggleRemoval,
  onSelectStackParent,
}: QueueCascadeRepairPanelProps) {
  const state = deriveCascadeRepairState(analysis, selectedRemovals, selectedStackParents, applyResult);
  const preflight = analysis.dispatchPreflight;

  return (
    <div className="space-y-3 rounded-md border border-border/60 p-3">
      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">Dependency classifications</p>
        {state.dependencyGroups.length === 0 ? (
          <p className="text-xs text-muted-foreground">No dependency classifications reported.</p>
        ) : state.dependencyGroups.map((group) => (
          <div key={group.targetPrdId} className="space-y-1 rounded-md border border-border/50 p-2">
            <p className="text-xs font-medium text-foreground">Target {group.targetPrdId}</p>
            {group.rows.map((row) => (
              <div key={`${row.targetPrdId}-${row.dependentPrdId}-${row.dependencyPrdId}`} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {statusBadge(row.status)}
                <span>{row.dependentPrdId} depends on {row.dependencyPrdId}</span>
                <span>{row.reason}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {preflight && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Dispatch preflight</p>
          <p className="text-xs text-muted-foreground">Can apply: {preflight.canApply ? 'yes' : 'no'}</p>
          {[...preflight.blockers, ...preflight.warnings].map((notice) => (
            <p key={`${notice.code}-${notice.prdId ?? ''}-${notice.message}`} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{notice.code}</span>: {notice.message}
            </p>
          ))}
          {preflight.items.map((item) => (
            <div key={item.targetPrdId} className="rounded-md border border-border/50 p-2 text-xs text-muted-foreground">
              <p><span className="font-medium text-foreground">{item.targetPrdId}</span> meaningful dependencies: {item.meaningfulDependencyIds.join(', ') || 'none'}</p>
              {item.currentStackParent && <p>Current stack_parent: {item.currentStackParent}</p>}
              {[...item.blockers, ...item.warnings].map((message) => <p key={message}>{message}</p>)}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">Repair actions</p>
        {state.removableDependencies.length === 0 && state.stackParentChoices.length === 0 ? (
          <p className="text-xs text-muted-foreground">No explicit metadata repairs are available.</p>
        ) : null}
        {state.removableDependencies.map((item) => {
          const key = removalKey(item.targetPrdId, item.dependencyId);
          return (
            <label key={key} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Checkbox checked={selectedRemovals[key] === true} onCheckedChange={(checked) => onToggleRemoval(key, checked === true)} />
              <span>Remove satisfied dependency <span className="font-medium text-foreground">{item.dependencyId}</span> from {item.targetPrdId}</span>
            </label>
          );
        })}
        {state.stackParentChoices.map((choice) => (
          <div key={choice.targetPrdId} className="space-y-1 text-xs text-muted-foreground">
            <p>Select stack_parent for <span className="font-medium text-foreground">{choice.targetPrdId}</span>{choice.required ? ' (required)' : ''}</p>
            <Select value={selectedStackParents[choice.targetPrdId] ?? ''} onValueChange={(value) => onSelectStackParent(choice.targetPrdId, value)}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Choose stack_parent" /></SelectTrigger>
              <SelectContent>
                {choice.candidates.map((candidate) => <SelectItem key={candidate} value={candidate}>{candidate}</SelectItem>)}
              </SelectContent>
            </Select>
            {choice.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}
          </div>
        ))}
      </div>

      {state.selectedRepairActions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">Selected repairs</p>
          {state.selectedRepairActions.map((action) => (
            <p key={`${action.kind}-${action.targetPrdId}-${action.kind === 'remove-depends-on' ? action.dependencyIds.join(',') : action.selectedParentId}`} className="text-xs text-muted-foreground">
              {action.kind === 'remove-depends-on'
                ? `Remove depends_on [${action.dependencyIds.join(', ')}] from ${action.targetPrdId}`
                : `Set ${action.targetPrdId} stack_parent to ${action.selectedParentId}`}
            </p>
          ))}
        </div>
      )}

      {state.unresolvedPreflightBlockers.map((blocker) => <p key={blocker} role="alert" className="text-xs text-destructive">{blocker}</p>)}

      {applyResult?.repairResults && applyResult.repairResults.length > 0 && (
        <div className="space-y-1 rounded-md border border-border/50 p-2">
          <p className="text-xs font-medium text-foreground">Repair results</p>
          {applyResult.repairResults.map((result, index) => (
            <div key={`${result.action.kind}-${result.action.targetPrdId}-${index}`} className="text-xs text-muted-foreground">
              <p>{formatRepairResult(result)}</p>
              <p>before: {metadataSummary(result.before)} after: {metadataSummary(result.after)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
