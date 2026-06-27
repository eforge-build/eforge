import type {
  CompilePreflightRisk,
  CompileRecoveryAction,
  CompileScopeContextFailure,
  RecoverySidecarRecoveryOption,
} from '@eforge-build/client/browser';

export interface CompileFailureBannerModel {
  title: string;
  summary: string;
  details: string[];
}

export type CompileScopeContextOption = Extract<RecoverySidecarRecoveryOption, { kind: 'compile-scope-context' }>;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KiB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 1 : 2)} MiB`;
}

export function recoveryActionLabel(action: CompileRecoveryAction | CompileScopeContextOption['action']): string {
  switch (action) {
    case 'none': return 'none';
    case 'retry-as-expedition': return 'retry as expedition';
    case 'bounded-decomposition': return 'bounded decomposition';
    case 'manual-reduce-scope': return 'manual scope reduction';
    case 'repair-existing-artifacts': return 'repair existing artifacts';
  }
}

function generatedInventoryCount(risk: CompilePreflightRisk): number {
  const inventory = risk.generatedInventory;
  return inventory.blockCount + inventory.sidecarCount + inventory.contentHashes.length + inventory.pathReferences.length + inventory.headings.length;
}

export function compilePreflightSummary(risk: CompilePreflightRisk): string {
  return `Compile preflight: ${risk.level} (${formatBytes(risk.sourceBytes)} source, ${formatBytes(risk.promptSourceBytes)} prompt, ${recoveryActionLabel(risk.recommendation.action)})`;
}

export function compilePreflightDetail(risk: CompilePreflightRisk): string {
  const lines = [
    `Acceptance criteria: ${risk.acceptanceCriteriaCount}`,
    `Generated inventory: ${generatedInventoryCount(risk)} item(s); ${risk.generatedInventory.blockCount} block(s), ${risk.generatedInventory.sidecarCount} sidecar(s), ${risk.generatedInventory.omittedBytes} omitted byte(s)`,
    `Subsystem breadth: ${risk.subsystemBreadth.count}`,
    `Recommendation: ${recoveryActionLabel(risk.recommendation.action)} (${risk.recommendation.eligible ? 'eligible' : 'ineligible'}) — ${risk.recommendation.reason}`,
  ];
  if (risk.reasons.length > 0) lines.push(`Reasons: ${risk.reasons.join('; ')}`);
  if (risk.generatedInventory.contentHashes.length > 0) lines.push(`Representative hashes: ${risk.generatedInventory.contentHashes.join(', ')}`);
  if (risk.generatedInventory.pathReferences.length > 0) lines.push(`Representative paths: ${risk.generatedInventory.pathReferences.join(', ')}`);
  if (risk.generatedInventory.headings.length > 0) lines.push(`Representative headings: ${risk.generatedInventory.headings.join(', ')}`);
  if (risk.subsystemBreadth.subsystems.length > 0) lines.push(`Subsystems: ${risk.subsystemBreadth.subsystems.join(', ')}`);
  if (risk.subsystemBreadth.evidence.length > 0) lines.push(`Subsystem evidence: ${risk.subsystemBreadth.evidence.join('; ')}`);
  if (risk.pipelineScope) lines.push(`Pipeline scope: ${risk.pipelineScope}`);
  if (risk.selectedProfile) lines.push(`Profile: ${risk.selectedProfile}`);
  return lines.join('\n');
}

function artifactSummary(failure: CompileScopeContextFailure): string {
  const a = failure.artifacts;
  const parts = [
    `orchestration ${a.orchestrationExists ? 'present' : 'missing'}`,
    `${a.validPlanCount} valid plan(s)`,
    `${a.invalidPlanCount} invalid plan(s)`,
    `${a.missingPlanFileCount} missing plan file(s)`,
  ];
  if (a.missingPlanFiles.length > 0) parts.push(`missing: ${a.missingPlanFiles.join(', ')}`);
  if (a.invalidPlanFiles.length > 0) parts.push(`invalid: ${a.invalidPlanFiles.join(', ')}`);
  return parts.join('; ');
}

function observedSummary(failure: CompileScopeContextFailure): string | undefined {
  const observed = failure.observed;
  if (!observed) return undefined;
  const parts: string[] = [];
  if (observed.promptBytes !== undefined) parts.push(`${formatBytes(observed.promptBytes)} prompt`);
  if (observed.inputTokens !== undefined) parts.push(`${observed.inputTokens} input token(s)`);
  if (observed.outputTokens !== undefined) parts.push(`${observed.outputTokens} output token(s)`);
  if (observed.turns !== undefined) parts.push(`${observed.turns} turn(s)`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function guardDiagnosticLines(failure: CompileScopeContextFailure): string[] {
  const guard = failure.guardDiagnostics;
  if (!guard) return [];
  const lines: string[] = [];
  if (guard.provider && guard.modelId) lines.push(`Model: ${guard.provider}/${guard.modelId}`);
  const limitParts = [
    `maxObservedInputTokens=${guard.limits.maxObservedInputTokens}`,
    `metadataSource=${guard.metadataSource}`,
  ];
  if (guard.contextWindow !== undefined) limitParts.push(`contextWindow=${guard.contextWindow}`);
  limitParts.push(`outputReserveTokens=${guard.outputReserveTokens}`);
  limitParts.push(`overheadReserveTokens=${guard.overheadReserveTokens}`);
  limitParts.push(`safetyMargin=${guard.safetyMargin}`);
  lines.push(`Guard: ${limitParts.join(', ')}`);
  if (guard.fallbackReason) lines.push(`Fallback: ${guard.fallbackReason}`);
  return lines;
}

export function compileScopeContextFailureSummary(failure: CompileScopeContextFailure): string {
  return `Compile scope/context failure: ${failure.failureKind} from ${failure.source} at ${failure.stage} — ${recoveryActionLabel(failure.recovery.action)}`;
}

export function compileScopeContextFailureDetail(failure: CompileScopeContextFailure): string {
  const lines = [
    `Explanation: ${failure.explanation}`,
    `Recovery: ${recoveryActionLabel(failure.recovery.action)}; eligible ${failure.recovery.eligible ? 'yes' : 'no'}; attempted ${failure.recovery.attempted ? 'yes' : 'no'}; attempt ${failure.recovery.attempt}/${failure.recovery.maxAttempts}`,
    `Recovery reason: ${failure.recovery.reason}`,
    `Artifacts: ${artifactSummary(failure)}`,
  ];
  const observed = observedSummary(failure);
  if (observed) lines.push(`Observed: ${observed}`);
  lines.push(...guardDiagnosticLines(failure));
  if (failure.risk) lines.push(`Preflight: ${compilePreflightSummary(failure.risk)}`);
  return lines.join('\n');
}

export function compileFailureBannerModel(failure: CompileScopeContextFailure): CompileFailureBannerModel {
  return {
    title: 'Compile scope/context failure',
    summary: `${failure.failureKind} from ${failure.source} at ${failure.stage}`,
    details: compileScopeContextFailureDetail(failure).split('\n'),
  };
}

export function compileScopeContextOptions(options: RecoverySidecarRecoveryOption[] | undefined): CompileScopeContextOption[] {
  return options?.filter((option): option is CompileScopeContextOption => option.kind === 'compile-scope-context') ?? [];
}
