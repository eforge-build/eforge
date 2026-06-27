import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import type { EforgeEvent, EforgeStatus, OrchestrationConfig, ReviewIssue } from '@eforge-build/engine/events';
import type { EforgeConfig } from '@eforge-build/engine/config';
import type { QueuedPrd } from '@eforge-build/engine/prd-queue';
import { getEventSummary } from '@eforge-build/client';
// --- eforge:region plan-06-surfaces-docs ---
import { renderCompilePreflightLines, renderCompileScopeContextFailureModel } from './compile-resilience-display.js';
// --- eforge:endregion plan-06-surfaces-docs ---

type PlaybookListEntry = {
  name: string;
  source: 'project-local' | 'project-team' | 'user';
  description: string;
  profile?: string;
  shadows: Array<{ source: string }>;
};

// Module-scoped display state
const spinners = new Map<string, Ora>();
let verbose = false;
let startTime = Date.now();

/** Per-agent buffer for streaming text - avoids one-token-per-line noise. */
const agentTextBuffers = new Map<string, string>();

function agentBufferKey(agent: string, planId?: string): string {
  return planId ? `${agent}:${planId}` : agent;
}

function flushAgentBuffer(agent: string, planId?: string): void {
  const key = agentBufferKey(agent, planId);
  const buf = agentTextBuffers.get(key);
  if (!buf) return;
  agentTextBuffers.delete(key);
  const prefix = chalk.dim(`  [${planId ? `${agent}:${planId}` : agent}] `);
  // Print each buffered line with the agent prefix
  for (const line of buf.split('\n')) {
    console.log(prefix + chalk.dim(line));
  }
}

function appendAgentBuffer(agent: string, planId: string | undefined, content: string): void {
  const key = agentBufferKey(agent, planId);
  const existing = agentTextBuffers.get(key) ?? '';
  const combined = existing + content;

  // If the content contains newlines, flush complete lines and keep the remainder
  const lastNewline = combined.lastIndexOf('\n');
  if (lastNewline !== -1) {
    const toFlush = combined.slice(0, lastNewline);
    const remainder = combined.slice(lastNewline + 1);
    const prefix = chalk.dim(`  [${planId ? `${agent}:${planId}` : agent}] `);
    for (const line of toFlush.split('\n')) {
      console.log(prefix + chalk.dim(line));
    }
    agentTextBuffers.set(key, remainder);
  } else {
    agentTextBuffers.set(key, combined);
  }
}

export function initDisplay(opts: { verbose?: boolean } = {}): void {
  verbose = opts.verbose ?? false;
  startTime = Date.now();
}

export function renderLangfuseStatus(config: EforgeConfig): void {
  if (config.langfuse.enabled) {
    console.log(chalk.dim(`  Langfuse: enabled → ${config.langfuse.host}`));
  } else {
    const missing: string[] = [];
    if (!config.langfuse.publicKey) missing.push('LANGFUSE_PUBLIC_KEY');
    if (!config.langfuse.secretKey) missing.push('LANGFUSE_SECRET_KEY');
    if (missing.length > 0) {
      console.log(chalk.dim(`  Langfuse: disabled (missing ${missing.join(', ')})`));
    } else {
      console.log(chalk.dim('  Langfuse: disabled'));
    }
  }
}

export function stopAllSpinners(): void {
  for (const spinner of spinners.values()) {
    spinner.stop();
  }
  spinners.clear();
}

function startSpinner(key: string, text: string): void {
  const existing = spinners.get(key);
  if (existing) existing.stop();
  const spinner = ora(text).start();
  spinners.set(key, spinner);
}

function succeedSpinner(key: string, text?: string): void {
  const spinner = spinners.get(key);
  if (spinner) {
    spinner.succeed(text);
    spinners.delete(key);
  }
}

function failSpinner(key: string, text?: string): void {
  const spinner = spinners.get(key);
  if (spinner) {
    spinner.fail(text);
    spinners.delete(key);
  }
}

function formatIssueSummary(issues: ReviewIssue[]): string {
  const critical = issues.filter((i) => i.severity === 'critical').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const suggestions = issues.filter((i) => i.severity === 'suggestion').length;
  const parts: string[] = [];
  if (critical > 0) parts.push(chalk.red(`${critical} critical`));
  if (warnings > 0) parts.push(chalk.yellow(`${warnings} warning`));
  if (suggestions > 0) parts.push(chalk.blue(`${suggestions} suggestion`));
  return parts.join(', ');
}

function elapsed(): string {
  const ms = Date.now() - startTime;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// --- eforge:region cli-event-rendering ---
type EventOf<T extends EforgeEvent['type']> = Extract<EforgeEvent, { type: T }>;
function setSpinnerText(key: string, text: string): void {
  const spinner = spinners.get(key);
  if (spinner) spinner.text = text;
}
function setPlanBuildSpinnerText(planId: string, text: string): void {
  setSpinnerText(`build:${planId}`, `${chalk.cyan(planId)} ${text}`);
}
function completeReviewSpinner(key: string, emptyText: string, summaryLabel: string, issues: ReviewIssue[]): void {
  if (issues.length === 0) {
    succeedSpinner(key, emptyText);
  } else {
    succeedSpinner(key, `${summaryLabel}: ${formatIssueSummary(issues)}`);
  }
}
function completeEvaluationSpinner(key: string, label: string, accepted: number, rejected: number): void {
  if (accepted === 0 && rejected === 0) {
    succeedSpinner(key, `${label} evaluation: no fixes to evaluate`);
  } else {
    succeedSpinner(
      key,
      `${label} evaluation: ${chalk.green(`${accepted} accepted`)}, ${chalk.red(`${rejected} rejected`)}`,
    );
  }
}
function getPlanningScopeColor(scope: string): (s: string) => string {
  const scopeColors: Record<string, (s: string) => string> = {
    errand: chalk.green,
    excursion: chalk.yellow,
    expedition: chalk.magenta,
  };
  return scopeColors[scope] ?? chalk.cyan;
}
function getQueueStalenessVerdictColor(verdict: string): (s: string) => string {
  const verdictColors: Record<string, (s: string) => string> = {
    proceed: chalk.green,
    revise: chalk.yellow,
    obsolete: chalk.red,
  };
  return verdictColors[verdict] ?? chalk.dim;
}
function renderPrdGapComplexitySummary(gaps: EventOf<'prd_validation:complete'>['gaps']): void {
  const trivial = gaps.filter((g) => g.complexity === 'trivial').length;
  const moderate = gaps.filter((g) => g.complexity === 'moderate').length;
  const significant = gaps.filter((g) => g.complexity === 'significant').length;
  if (trivial + moderate + significant > 0) {
    const parts: string[] = [];
    if (trivial > 0) parts.push(`${trivial} trivial`);
    if (moderate > 0) parts.push(`${moderate} moderate`);
    if (significant > 0) parts.push(`${significant} significant`);
    console.log(chalk.dim(`  ${parts.join(', ')}`));
  }
}
function renderAcceptanceValidationComplete(event: EventOf<'acceptance_validation:complete'>): void {
  const verdicts = event.verdicts ?? [];
  const passCount = verdicts.filter((v) => v.verdict === 'pass').length;
  const failCount = verdicts.filter((v) => v.verdict === 'fail').length;
  const unknownCount = verdicts.filter((v) => v.verdict === 'unknown').length;
  const parts: string[] = [];
  if (passCount > 0) parts.push(chalk.green(`${passCount} passed`));
  if (failCount > 0) parts.push(chalk.red(`${failCount} failed`));
  if (unknownCount > 0) parts.push(chalk.yellow(`${unknownCount} unknown`));
  const summary = parts.length > 0 ? parts.join(', ') : 'no verdicts';
  if (event.passed) {
    console.log(chalk.green(`✓ Acceptance validation passed: ${summary}`));
  } else {
    console.log(chalk.red(`✗ Acceptance validation failed: ${summary}`));
  }
  if (event.waivers && event.waivers.length > 0) {
    for (const waiver of event.waivers) {
      console.log(chalk.dim(`  Waiver: ${waiver}`));
    }
  }
}
function renderPhaseEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'phase:start':
      console.log('');
      console.log(chalk.bold(`⚒ eforge ${event.command}`));
      console.log(chalk.dim(`  Run: ${event.runId}`));
      if (event.planSet) console.log(chalk.dim(`  Plan set: ${chalk.cyan(event.planSet)}`));
      console.log('');
      return true;
    case 'phase:end': {
      stopAllSpinners();
      const icon = event.result.status === 'completed' ? chalk.green('✓') : chalk.red('✗');
      console.log('');
      console.log(`${icon} ${event.result.summary} ${chalk.dim(`(${elapsed()})`)}`);
      console.log('');
      return true;
    }
    default:
      return false;
  }
}
function renderPlanningEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'planning:start':
      startSpinner('plan', `Planning from ${chalk.cyan(event.label ?? event.source)}...`);
      return true;
    case 'planning:skip':
      console.log(chalk.dim(`  Skipped: ${event.reason}`));
      return true;
    case 'planning:clarification': {
      const spinner = spinners.get('plan');
      if (spinner) spinner.stop();
      console.log('');
      console.log(chalk.yellow('⚠ Clarification needed:'));
      for (const q of event.questions) {
        console.log(`  ${chalk.bold(q.question)}`);
        if (q.context) console.log(chalk.dim(`    ${q.context}`));
        if (q.options) console.log(chalk.dim(`    Options: ${q.options.join(', ')}`));
      }
      return true;
    }
    case 'planning:clarification:answer':
      startSpinner('plan', 'Continuing planning...');
      return true;
    case 'planning:progress':
      setSpinnerText('plan', event.message);
      return true;
    case 'planning:continuation':
      setSpinnerText('plan', `Planning - continuing (attempt ${event.attempt}/${event.maxContinuations})`);
      return true;
    // --- eforge:region plan-06-surfaces-docs ---
    case 'planning:preflight': {
      const lines = renderCompilePreflightLines(event.risk, { verbose });
      for (const line of lines) console.log(chalk.yellow(`  ⚠ ${line}`));
      return true;
    }
    case 'planning:scope-context:failure': {
      const model = renderCompileScopeContextFailureModel(event.failure);
      if (model.attempted) {
        const spinner = spinners.get('plan');
        if (spinner) {
          spinner.stop();
          spinners.delete('plan');
        }
        console.log(chalk.yellow(`  ⚠ ${model.headline}`));
      } else {
        failSpinner('plan', `Planning stopped: ${event.failure.failureKind} at ${event.failure.stage}`);
        console.log(chalk.red(`  ✗ ${model.headline}`));
      }
      for (const detail of model.details) console.log(chalk.dim(`    ${detail}`));
      if (model.attempted) startSpinner('plan', 'Retrying planning as expedition...');
      return true;
    }
    // --- eforge:endregion plan-06-surfaces-docs ---
    case 'planning:complete':
      if (event.plans.length === 0) {
        succeedSpinner('plan', 'Nothing to plan — source is fully implemented');
      } else {
        succeedSpinner('plan', `Planning complete — ${event.plans.length} plan(s) created`);
        for (const plan of event.plans) {
          console.log(`  ${chalk.cyan(plan.id)} — ${plan.name}`);
        }
      }
      return true;
    case 'planning:error':
      failSpinner('plan', `Planning failed: ${event.reason}`);
      return true;
    case 'planning:pipeline': {
      const scopeColorFn = getPlanningScopeColor(event.scope);
      console.log(`  Pipeline: ${scopeColorFn(event.scope)} - ${chalk.dim(event.rationale)}`);
      return true;
    }
    case 'planning:warning':
      console.error(`[eforge] plan warning${event.planId ? ` (${event.planId})` : ''}: ${event.message}`);
      return true;
    default:
      return false;
  }
}
function renderPlanningReviewEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'planning:review:start':
      startSpinner('plan-review', 'Reviewing plan files...');
      return true;
    case 'planning:review:complete':
      completeReviewSpinner('plan-review', 'Plan review complete — no issues found', 'Plan review', event.issues);
      return true;
    case 'planning:evaluate:start':
      startSpinner('plan-evaluate', 'Evaluating plan review fixes...');
      return true;
    case 'planning:evaluate:continuation':
      setSpinnerText('plan-evaluate', `Evaluating plan review fixes - continuing (attempt ${event.attempt}/${event.maxContinuations})`);
      return true;
    case 'planning:evaluate:complete':
      completeEvaluationSpinner('plan-evaluate', 'Plan', event.accepted, event.rejected);
      return true;
    case 'planning:architecture:review:start':
      startSpinner('architecture-review', 'Reviewing architecture...');
      return true;
    case 'planning:architecture:review:complete':
      completeReviewSpinner('architecture-review', 'Architecture review complete — no issues found', 'Architecture review', event.issues);
      return true;
    case 'planning:architecture:evaluate:start':
      startSpinner('architecture-evaluate', 'Evaluating architecture review fixes...');
      return true;
    case 'planning:architecture:evaluate:continuation':
      setSpinnerText('architecture-evaluate', `Evaluating architecture review fixes - continuing (attempt ${event.attempt}/${event.maxContinuations})`);
      return true;
    case 'planning:architecture:evaluate:complete':
      completeEvaluationSpinner('architecture-evaluate', 'Architecture', event.accepted, event.rejected);
      return true;
    case 'planning:cohesion:start':
      startSpinner('cohesion-review', 'Reviewing cross-module cohesion...');
      return true;
    case 'planning:cohesion:complete':
      completeReviewSpinner('cohesion-review', 'Cohesion review complete — no issues found', 'Cohesion review', event.issues);
      return true;
    case 'planning:cohesion:evaluate:start':
      startSpinner('cohesion-evaluate', 'Evaluating cohesion review fixes...');
      return true;
    case 'planning:cohesion:evaluate:continuation':
      setSpinnerText('cohesion-evaluate', `Evaluating cohesion review fixes - continuing (attempt ${event.attempt}/${event.maxContinuations})`);
      return true;
    case 'planning:cohesion:evaluate:complete':
      completeEvaluationSpinner('cohesion-evaluate', 'Cohesion', event.accepted, event.rejected);
      return true;
    default:
      return false;
  }
}
function renderPlanBuildLifecycleEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'plan:build:start':
      startSpinner(`build:${event.planId}`, `${chalk.cyan(event.planId)} — starting...`);
      return true;
    case 'plan:build:progress':
      setPlanBuildSpinnerText(event.planId, `— ${event.message}`);
      return true;
    case 'plan:build:files_changed':
      console.log(chalk.dim(`  ${chalk.cyan(event.planId)} — ${event.files.length} file(s) changed`));
      return true;
    case 'plan:build:complete':
      succeedSpinner(`build:${event.planId}`, `${chalk.cyan(event.planId)} — complete`);
      return true;
    case 'plan:build:failed':
      failSpinner(`build:${event.planId}`, `${chalk.cyan(event.planId)} — ${chalk.red(event.error)}`);
      return true;
    case 'plan:build:decision':
      return false;
    default:
      return false;
  }
}
function renderPlanBuildImplementationEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'plan:build:implement:start':
      setPlanBuildSpinnerText(event.planId, '— implementing...');
      return true;
    case 'plan:build:implement:progress':
      setPlanBuildSpinnerText(event.planId, `— ${event.message}`);
      return true;
    case 'plan:build:implement:continuation':
      setPlanBuildSpinnerText(event.planId, `— continuing (attempt ${event.attempt}/${event.maxContinuations})`);
      return true;
    case 'plan:build:implement:complete':
      setPlanBuildSpinnerText(event.planId, '— implementation complete');
      return true;
    default:
      return false;
  }
}
function renderPlanBuildReviewEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'plan:build:review:start':
      setPlanBuildSpinnerText(event.planId, '— reviewing...');
      return true;
    case 'plan:build:review:complete':
      setPlanBuildSpinnerText(event.planId, '— review complete');
      if (event.issues.length > 0) {
        console.log(`  ${chalk.cyan(event.planId)} review: ${formatIssueSummary(event.issues)}`);
      }
      return true;
    case 'plan:build:review:parallel:start':
      setPlanBuildSpinnerText(event.planId, `— reviewing: ${event.perspectives.join(', ')}`);
      return true;
    case 'plan:build:review:parallel:perspective:start':
      return true;
    case 'plan:build:review:parallel:perspective:complete': {
      const pIssues = event.issues;
      if (pIssues.length > 0) {
        console.log(chalk.dim(`  ${chalk.cyan(event.planId)} ${event.perspective}: ${pIssues.length} issue(s)`));
      }
      return true;
    }
    case 'plan:build:review:fix:start':
      setPlanBuildSpinnerText(event.planId, `— applying fixes (${event.issueCount} issues)`);
      return true;
    case 'plan:build:review:fix:complete':
      setPlanBuildSpinnerText(event.planId, '— fixes applied');
      return true;
    case 'plan:build:review:fix:continuation':
      setPlanBuildSpinnerText(event.planId, `— applying fixes (continuation ${event.attempt}/${event.maxContinuations})...`);
      return true;
    default:
      return false;
  }
}
function renderPlanBuildEvaluationAndDocsEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'plan:build:evaluate:start':
      setPlanBuildSpinnerText(event.planId, '— evaluating fixes...');
      return true;
    case 'plan:build:evaluate:continuation':
      setPlanBuildSpinnerText(event.planId, `— evaluating fixes - continuing (attempt ${event.attempt}/${event.maxContinuations})`);
      return true;
    case 'plan:build:evaluate:complete':
      setPlanBuildSpinnerText(event.planId, '— evaluation complete');
      console.log(
        `  ${chalk.cyan(event.planId)} evaluate: ${chalk.green(`${event.accepted} accepted`)}, ${chalk.red(`${event.rejected} rejected`)}`,
      );
      return true;
    case 'plan:build:doc-author:start':
      setPlanBuildSpinnerText(event.planId, '— authoring docs...');
      return true;
    case 'plan:build:doc-author:complete':
      if (event.docsAuthored > 0) {
        setPlanBuildSpinnerText(event.planId, `— ${event.docsAuthored} doc(s) authored`);
      }
      return true;
    case 'plan:build:doc-sync:start':
      setPlanBuildSpinnerText(event.planId, '— syncing docs...');
      return true;
    case 'plan:build:doc-sync:complete':
      if (event.docsSynced > 0) {
        setPlanBuildSpinnerText(event.planId, `— ${event.docsSynced} doc(s) synced`);
      }
      return true;
    case 'plan:build:test:write:start':
      setPlanBuildSpinnerText(event.planId, '— writing tests...');
      return true;
    case 'plan:build:test:write:complete':
      if (event.testsWritten > 0) {
        setPlanBuildSpinnerText(event.planId, `— ${event.testsWritten} test file(s) written`);
      }
      return true;
    case 'plan:build:test:start':
      setPlanBuildSpinnerText(event.planId, '— running tests...');
      return true;
    case 'plan:build:test:complete': {
      const parts = [`${event.passed} passed`];
      if (event.failed > 0) parts.push(`${event.failed} failed`);
      if (event.testBugsFixed > 0) parts.push(`${event.testBugsFixed} test bugs fixed`);
      if (event.productionIssues.length > 0) parts.push(`${event.productionIssues.length} production issue(s)`);
      setPlanBuildSpinnerText(event.planId, `— tests: ${parts.join(', ')}`);
      return true;
    }
    default:
      return false;
  }
}
function renderPlanBuildEvent(event: EforgeEvent): boolean {
  if (renderPlanBuildLifecycleEvent(event)) return true;
  if (renderPlanBuildImplementationEvent(event)) return true;
  if (renderPlanBuildReviewEvent(event)) return true;
  if (renderPlanBuildEvaluationAndDocsEvent(event)) return true;
  return false;
}
function renderOrchestrationEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'schedule:start':
      console.log('');
      console.log(
        chalk.magenta(`━━ Scheduling ━━`) +
          chalk.dim(` [${event.planIds.join(', ')}]`),
      );
      return true;
    case 'plan:schedule:ready':
      console.log(chalk.magenta(`  ▸ Ready: ${chalk.cyan(event.planId)}`) + chalk.dim(` (${event.reason})`));
      return true;
    case 'plan:merge:start':
      startSpinner(`merge:${event.planId}`, `Merging ${chalk.cyan(event.planId)}...`);
      return true;
    case 'plan:merge:complete':
      succeedSpinner(`merge:${event.planId}`, `Merged ${chalk.cyan(event.planId)}`);
      return true;
    case 'merge:finalize:start':
      startSpinner('merge-finalize', `Merging ${chalk.cyan(event.featureBranch)} into ${chalk.cyan(event.baseBranch)}...`);
      return true;
    case 'merge:finalize:complete':
      succeedSpinner('merge-finalize', `Merged ${chalk.cyan(event.featureBranch)} into ${chalk.cyan(event.baseBranch)}`);
      return true;
    case 'merge:finalize:skipped':
      console.log(chalk.yellow(`  ⏭ Feature branch merge skipped: ${event.reason}`));
      console.log(chalk.dim(`    Branch ${chalk.cyan(event.featureBranch)} left for inspection`));
      return true;
    case 'landing:start':
      startSpinner('landing', `Landing (${event.action}): ${chalk.cyan(event.featureBranch)} → ${chalk.cyan(event.baseBranch)}...`);
      return true;
    case 'landing:skipped':
      console.log(chalk.dim(`  ⏭ Landing (${event.action}) skipped: ${event.reason}`));
      return true;
    default:
      return renderLandingCompleteEvent(event) || renderStackEvent(event) || renderPostBuildOrchestrationEvent(event);
  }
}
function renderLandingCompleteEvent(event: EforgeEvent): boolean {
  if (event.type !== 'landing:complete') return false;

  if (event.action === 'pr' && event.prUrl) {
    succeedSpinner('landing', `PR opened: ${chalk.cyan(event.featureBranch)}`);
    console.log(chalk.green(`  ✓ Pull request: ${event.prUrl}`));
  } else if (event.action === 'merge') {
    succeedSpinner('landing', `Merged ${chalk.cyan(event.featureBranch)} into ${chalk.cyan(event.baseBranch)}`);
  } else if (event.action === 'leave') {
    succeedSpinner('landing', `Branch ${chalk.cyan(event.featureBranch)} left for manual workflow`);
  } else {
    succeedSpinner('landing', `Landing complete (${event.action})`);
  }
  return true;
}
function renderStackEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'stack:layer:recorded':
      if (verbose) {
        console.log(chalk.dim(`  ↪ Stack layer: ${chalk.cyan(event.prdId)} (${event.status}) on ${chalk.cyan(event.branch)}`));
      }
      return true;
    case 'stack:provider:command': {
      if (verbose) {
        const argv = event.args ? [event.command, ...event.args].join(' ') : event.command;
        console.log(chalk.dim(`  ⚙ Stack (${event.provider}): ${argv} → exit ${event.exitCode}`));
      }
      return true;
    }
    case 'stack:landing:update': {
      if (event.prUrl) {
        console.log(chalk.green(`  ↗ PR [${chalk.cyan(event.prdId)}]: ${event.prUrl}`));
      } else if (verbose) {
        const note = event.reason ? ` — ${event.reason}` : '';
        console.log(chalk.dim(`  ↪ Stack landing: ${chalk.cyan(event.prdId)} (${event.action}) ${event.status}${note}`));
      }
      return true;
    }
    default:
      return false;
  }
}
function renderPostBuildOrchestrationEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'reconciliation:start':
      startSpinner('reconciliation', 'Reconciling worktree state...');
      return true;
    case 'reconciliation:complete': {
      const r = event.report;
      const parts: string[] = [];
      if (r.valid.length > 0) parts.push(chalk.green(`${r.valid.length} valid`));
      if (r.missing.length > 0) parts.push(chalk.yellow(`${r.missing.length} missing`));
      if (r.corrupt.length > 0) parts.push(chalk.red(`${r.corrupt.length} corrupt`));
      succeedSpinner('reconciliation', `Reconciliation complete: ${parts.join(', ')}`);
      return true;
    }
    case 'cleanup:start':
      startSpinner('cleanup', `Cleaning up plan files for ${chalk.cyan(event.planSet)}...`);
      return true;
    case 'cleanup:complete':
      succeedSpinner('cleanup', `Plan files removed for ${chalk.cyan(event.planSet)}`);
      return true;
    case 'config:warning':
      console.error(`[eforge] config warning: ${event.message}`);
      return true;
    case 'plan:merge:resolve:start':
      console.log(chalk.yellow(`  ⚡ Resolving merge conflicts for ${event.planId}...`));
      return true;
    case 'plan:merge:resolve:complete':
      if (event.resolved) {
        console.log(chalk.green(`  ✓ Merge conflicts resolved for ${event.planId}`));
      } else {
        console.log(chalk.red(`  ✗ Failed to resolve merge conflicts for ${event.planId}`));
      }
      return true;
    default:
      return false;
  }
}
function renderExpeditionEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'expedition:architecture:complete':
      succeedSpinner('plan', `Architecture complete — ${event.modules.length} modules defined`);
      for (const mod of event.modules) {
        console.log(`  ${chalk.cyan(mod.id)} — ${mod.description}`);
      }
      return true;
    case 'expedition:wave:start':
      console.log('');
      console.log(
        chalk.magenta(`━━ Module wave ${event.wave} ━━`) +
          chalk.dim(` [${event.moduleIds.join(', ')}]`),
      );
      return true;
    case 'expedition:wave:complete':
      console.log(chalk.magenta(`━━ Module wave ${event.wave} complete ━━`));
      return true;
    case 'expedition:module:start':
      startSpinner(`mod:${event.moduleId}`, `Planning module ${chalk.cyan(event.moduleId)}...`);
      return true;
    case 'expedition:module:complete':
      succeedSpinner(`mod:${event.moduleId}`, `Module ${chalk.cyan(event.moduleId)} planned`);
      return true;
    case 'expedition:compile:start':
      startSpinner('compile', 'Compiling plan files...');
      return true;
    case 'expedition:compile:complete':
      succeedSpinner('compile', `Compiled ${event.plans.length} plan file(s)`);
      return true;
    default:
      return false;
  }
}
function renderValidationEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'validation:start':
      console.log('');
      console.log(chalk.bold('Running post-merge validation...'));
      for (const cmd of event.commands) {
        console.log(chalk.dim(`  • ${cmd}`));
      }
      return true;
    case 'validation:command:start':
      startSpinner(`validation:${event.command}`, `Running: ${chalk.cyan(event.command)}`);
      return true;
    case 'validation:command:complete':
      if (event.exitCode === 0) {
        succeedSpinner(`validation:${event.command}`, `${chalk.cyan(event.command)} ${chalk.green('passed')}`);
      } else {
        failSpinner(`validation:${event.command}`, `${chalk.cyan(event.command)} ${chalk.red(`failed (exit ${event.exitCode})`)}`);
        if (event.output) {
          console.log(chalk.dim(event.output));
        }
      }
      return true;
    case 'validation:command:timeout':
      failSpinner(
        `validation:${event.command}`,
        `${chalk.cyan(event.command)} ${chalk.red(`timed out after ${Math.round(event.timeoutMs / 1000)}s`)}`,
      );
      return true;
    case 'validation:complete':
      if (event.passed) {
        console.log(chalk.green('✓ All validation commands passed'));
      } else {
        console.log(chalk.red('✗ Validation failed'));
      }
      return true;
    case 'validation:fix:start':
      console.log('');
      console.log(chalk.yellow(`Attempting validation fix (${event.attempt}/${event.maxAttempts})...`));
      startSpinner('validation-fix', `Fixing validation failures (attempt ${event.attempt})`);
      return true;
    case 'validation:fix:complete':
      succeedSpinner('validation-fix', `Validation fix attempt ${event.attempt} complete`);
      return true;
    default:
      return false;
  }
}
function renderAgentEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'agent:message':
      if (!verbose) return true;
      appendAgentBuffer(event.agent, event.planId, event.content);
      return true;
    case 'agent:tool_use':
      if (!verbose) return true;
      flushAgentBuffer(event.agent, event.planId);
      console.log(
        chalk.dim(
          `  [${event.agent}${event.planId ? `:${event.planId}` : ''}] → ${event.tool}`,
        ),
      );
      return true;
    case 'agent:tool_result':
      if (!verbose) return true;
      console.log(
        chalk.dim(
          `  [${event.agent}${event.planId ? `:${event.planId}` : ''}] ← ${event.tool}`,
        ),
      );
      return true;
    case 'agent:stop':
      flushAgentBuffer(event.agent, event.planId);
      return true;
    case 'agent:retry':
      console.log(
        chalk.dim(
          `  retry: ${event.agent} attempt ${event.attempt}/${event.maxAttempts} (${event.subtype})`,
        ),
      );
      return true;
    default:
      return false;
  }
}
function renderInteractionEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'approval:needed':
      stopAllSpinners();
      console.log('');
      console.log(chalk.yellow(`⚠ Approval needed: ${event.action}`));
      console.log(`  ${event.details}`);
      return true;
    case 'approval:response':
      console.log(event.approved ? chalk.green('  ✓ Approved') : chalk.red('  ✗ Denied'));
      return true;
    default:
      return false;
  }
}
function renderQueueEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'queue:start':
      console.log('');
      console.log(chalk.bold(`📋 PRD Queue`));
      console.log(chalk.dim(`  Directory: ${event.dir}`));
      console.log(chalk.dim(`  PRDs to process: ${event.prdCount}`));
      console.log('');
      return true;
    case 'queue:prd:start':
      startSpinner(`queue:${event.prdId}`, `Processing ${chalk.cyan(event.title)}...`);
      return true;
    case 'queue:prd:stale': {
      const verdictFn = getQueueStalenessVerdictColor(event.verdict);
      console.log(`  Staleness: ${verdictFn(event.verdict)} — ${chalk.dim(event.justification)}`);
      return true;
    }
    case 'queue:prd:skip':
      console.log(chalk.dim(`  Skipped: ${event.prdId} — ${event.reason}`));
      return true;
    case 'queue:prd:complete':
      if (event.status === 'completed') {
        succeedSpinner(`queue:${event.prdId}`, `${chalk.cyan(event.prdId)} — completed`);
      } else {
        failSpinner(`queue:${event.prdId}`, `${chalk.cyan(event.prdId)} — ${chalk.red('failed')}`);
      }
      return true;
    case 'queue:complete':
      console.log('');
      console.log(
        chalk.bold('Queue complete: ') +
        chalk.green(`${event.processed} processed`) +
        (event.skipped > 0 ? chalk.dim(`, ${event.skipped} skipped`) : ''),
      );
      console.log('');
      return true;
    case 'queue:prd:discovered':
      console.log(chalk.cyan(`  Discovered new PRD: ${event.title} (${event.prdId})`));
      return true;
    case 'enqueue:start':
      startSpinner('enqueue', `Enqueuing from ${chalk.cyan(event.source)}...`);
      return true;
    case 'enqueue:complete':
      succeedSpinner('enqueue', `Enqueued: ${chalk.cyan(event.title)} -> ${chalk.dim(event.filePath)}`);
      return true;
    case 'enqueue:failed':
      failSpinner('enqueue', `Enqueue failed: ${chalk.red(event.error)}`);
      return true;
    case 'enqueue:commit-failed':
      console.log(chalk.yellow(`  ⚠ Enqueue commit failed (non-fatal): ${event.error}`));
      return true;
    case 'queue:prd:commit-failed':
      console.log(chalk.yellow(`  ⚠ PRD ${event.prdId} commit failed (non-fatal): ${event.error}`));
      return true;
    default:
      return false;
  }
}
function renderPrdValidationEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'prd_validation:start':
      startSpinner('prd-validation', 'PRD Validation...');
      return true;
    case 'prd_validation:complete':
      if (event.passed) {
        const pctMsg = event.completionPercent !== undefined ? ` ${event.completionPercent}% complete,` : '';
        succeedSpinner('prd-validation', chalk.green(`PRD Validation passed:${pctMsg} no gaps`));
      } else {
        const pctMsg = event.completionPercent !== undefined ? `${event.completionPercent}% complete, ` : '';
        failSpinner('prd-validation', chalk.red(`PRD Validation failed: ${pctMsg}${event.gaps.length} gap(s) found`));
        for (const gap of event.gaps) {
          console.log(chalk.red(`  - ${gap.requirement}: ${gap.explanation}`));
        }
        renderPrdGapComplexitySummary(event.gaps);
      }
      return true;
    case 'gap_close:start':
      startSpinner('gap-close', 'Closing PRD validation gaps...');
      return true;
    case 'gap_close:complete':
      if (event.passed) {
        succeedSpinner('gap-close', 'Gap closing complete');
      } else {
        failSpinner('gap-close', chalk.red('Gap closing failed'));
      }
      return true;
    default:
      return false;
  }
}
function renderRecoveryEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'recovery:start':
      startSpinner('recovery', `Analysing failed build for PRD ${chalk.cyan(event.prdId)}...`);
      return true;
    case 'recovery:complete':
      succeedSpinner('recovery', `Recovery analysis complete: ${chalk.bold(event.verdict.verdict.toUpperCase())}`);
      return true;
    case 'recovery:error':
      console.log(chalk.yellow(`  ⚠ Recovery parse failed — writing manual verdict sidecar: ${event.error}`));
      return true;
    case 'recovery:apply:complete':
      if (!event.noAction) {
        console.log(chalk.green(`  ✓ Recovery applied: ${chalk.bold(event.verdict.toUpperCase())}`));
      } else {
        console.log(chalk.dim(`  ℹ Recovery verdict is manual — no changes made. Review the recovery report.`));
      }
      return true;
    case 'recovery:apply:error':
      console.log(chalk.red(`  ✗ Recovery apply failed: ${event.message}`));
      return true;
    default:
      return false;
  }
}
function renderDaemonExtensionAcceptanceEvent(event: EforgeEvent): boolean {
  switch (event.type) {
    case 'daemon:auto-build:paused':
      console.log(chalk.yellow(`  ⚠ Auto-build paused: ${event.reason}`));
      return true;
    case 'extension:event-handler:failed':
      console.log(chalk.red(`  ✗ Extension ${event.extensionName} hook failed [${event.pattern} on ${event.triggeringEventType}]: ${event.message}`));
      return true;
    case 'extension:event-handler:timeout':
      console.log(chalk.yellow(`  ⚠ Extension ${event.extensionName} hook timed out after ${event.timeoutMs}ms [${event.pattern} on ${event.triggeringEventType}]`));
      return true;
    case 'extension:input-source:fetched':
      console.log(chalk.dim(`  ↓ Input source [${event.adapterName}] fetched "${event.sourceId}" (${event.contentLength} chars)`));
      return true;
    case 'extension:input-source:failed':
      console.log(chalk.red(`  ✗ Input source [${event.adapterName}] failed for "${event.sourceId}" (${event.reason}): ${event.message}`));
      return true;
    case 'extension:prd-enricher:applied':
      if (event.changed) {
        console.log(chalk.dim(`  ✎ Enricher [${event.enricherName}] applied (${event.inputLength} → ${event.outputLength} chars)`));
      } else {
        console.log(chalk.dim(`  · Enricher [${event.enricherName}] no-op`));
      }
      return true;
    case 'extension:prd-enricher:failed':
      console.log(chalk.yellow(`  ⚠ Enricher [${event.enricherName}] failed for "${event.sourceId}" (${event.reason}): ${event.message}`));
      return true;
    case 'daemon:warning':
      console.log(chalk.yellow(`  ⚠ Daemon warning [${event.source}]: ${event.message}`));
      return true;
    case 'daemon:error':
      console.log(chalk.red(`  ✗ Daemon error [${event.source}]: ${event.message}`));
      return true;
    case 'acceptance_validation:complete':
      renderAcceptanceValidationComplete(event);
      return true;
    default:
      return false;
  }
}
function renderDefaultEvent(event: EforgeEvent): void {
  const summary = getEventSummary(event);
  if (summary) {
    console.log(chalk.dim(`  ${summary}`));
  }
}
/**
 * Render a single EforgeEvent to stdout.
 */
export function renderEvent(event: EforgeEvent): void {
  if (renderPhaseEvent(event)) return;
  if (renderPlanningEvent(event)) return;
  if (renderPlanningReviewEvent(event)) return;
  if (renderPlanBuildEvent(event)) return;
  if (renderOrchestrationEvent(event)) return;
  if (renderExpeditionEvent(event)) return;
  if (renderValidationEvent(event)) return;
  if (renderAgentEvent(event)) return;
  if (renderInteractionEvent(event)) return;
  if (renderQueueEvent(event)) return;
  if (renderPrdValidationEvent(event)) return;
  if (renderRecoveryEvent(event)) return;
  if (renderDaemonExtensionAcceptanceEvent(event)) return;
  renderDefaultEvent(event);
}
// --- eforge:endregion cli-event-rendering ---

/**
 * Render the current eforge status as a formatted table.
 */
export function renderStatus(status: EforgeStatus): void {
  if (!status.running && Object.keys(status.plans).length === 0) {
    console.log(chalk.dim('No active builds.'));
    return;
  }

  if (status.setName) {
    console.log(chalk.bold(`Plan set: ${chalk.cyan(status.setName)}`));
  }
  console.log(chalk.bold(status.running ? chalk.green('Running') : chalk.dim('Idle')));
  console.log('');

  const statusIcons: Record<string, string> = {
    pending: chalk.dim('\u25cb'),
    running: chalk.blue('\u25c9'),
    completed: chalk.green('\u2713'),
    failed: chalk.red('\u2717'),
    blocked: chalk.yellow('\u2298'),
    merged: chalk.green('\u2295'),
  };

  for (const [id, planStatus] of Object.entries(status.plans)) {
    const icon = statusIcons[planStatus] ?? chalk.dim('?');
    console.log(`  ${icon} ${chalk.cyan(id)} \u2014 ${planStatus}`);
  }

  if (status.completedPlans.length > 0) {
    console.log('');
    console.log(chalk.dim(`Completed: ${status.completedPlans.join(', ')}`));
  }
}

/**
 * Render the PRD queue as a formatted table, grouped by location-based status.
 * Accepts separate arrays for each state (pending, running, waiting, failed, skipped).
 *
 * PRDs with `depends_on` referencing another PRD in the same listing are
 * rendered indented under their parent with a `  \u21b3 ` prefix.
 */
export function renderQueueList(groups: {
  pending: QueuedPrd[];
  running: QueuedPrd[];
  failed: QueuedPrd[];
  skipped: QueuedPrd[];
  waiting?: QueuedPrd[];
}): void {
  const total = groups.pending.length + groups.running.length + groups.failed.length + groups.skipped.length + (groups.waiting?.length ?? 0);
  if (total === 0) {
    console.log(chalk.dim('No PRDs in queue.'));
    return;
  }

  function staleDaysColor(days: number): string {
    const padded = String(days).padStart(5);
    if (days < 7) return chalk.green(padded);
    if (days <= 14) return chalk.yellow(padded);
    return chalk.red(padded);
  }

  /**
   * Build a parent-to-children map for nesting display.
   * A PRD is a child if its `depends_on` references another PRD in the same group.
   */
  function buildChildMap(group: QueuedPrd[]): Map<string, string> {
    const groupIds = new Set(group.map((p) => p.id));
    // childId -> parentId (first matching parent in group)
    const childOf = new Map<string, string>();
    for (const prd of group) {
      const deps = prd.frontmatter.depends_on ?? [];
      for (const dep of deps) {
        if (groupIds.has(dep)) {
          childOf.set(prd.id, dep);
          break;
        }
      }
    }
    return childOf;
  }

  function renderGroup(group: QueuedPrd[], label: string, dim: boolean): void {
    if (group.length === 0) return;

    console.log('');
    console.log(dim ? chalk.dim(label) : chalk.bold(label));
    console.log(
      dim
        ? chalk.dim('  Priority  Title                          Created      Stale  Depends On')
        : '  Priority  Title                          Created      Stale  Depends On',
    );
    console.log(chalk.dim('  --------  -----------------------------  -----------  -----  ----------'));

    const TITLE_COL_WIDTH = 29;
    const childOf = buildChildMap(group);
    const rendered = new Set<string>();

    function renderPrd(prd: QueuedPrd, isChild: boolean): void {
      if (rendered.has(prd.id)) return;
      rendered.add(prd.id);

      const indent = isChild ? chalk.cyan('  \u21b3 ') : '  ';
      const indentWidth = isChild ? 4 : 2; // \u21b3 + space = 4 chars wide (visual)
      const effectiveTitleWidth = isChild ? TITLE_COL_WIDTH - 2 : TITLE_COL_WIDTH;
      const pri = prd.frontmatter.priority !== undefined ? String(prd.frontmatter.priority) : '-';
      const title = prd.frontmatter.title.length > effectiveTitleWidth
        ? prd.frontmatter.title.slice(0, effectiveTitleWidth - 1) + '\u2026'
        : prd.frontmatter.title;
      const created = prd.frontmatter.created ?? '-';
      const deps = prd.frontmatter.depends_on?.join(', ') ?? '-';

      let staleDaysStr: string;
      if (prd.frontmatter.created) {
        const createdDate = new Date(prd.frontmatter.created);
        const days = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
        const padded = String(days).padStart(5);
        staleDaysStr = dim ? chalk.dim(padded) : staleDaysColor(days);
      } else {
        staleDaysStr = '    -';
      }

      const padding = isChild ? '' : ' '.repeat(indentWidth - 2);
      const line = `${indent}${padding}${pri.padEnd(10)}${title.padEnd(effectiveTitleWidth + 2)}  ${created.padEnd(13)}${staleDaysStr}  ${deps}`;
      console.log(dim ? chalk.dim(line) : line);
    }

    // Render parents first, then their immediate children
    for (const prd of group) {
      if (childOf.has(prd.id)) continue; // skip children in first pass
      renderPrd(prd, false);
      // Render direct children of this parent
      for (const child of group) {
        if (childOf.get(child.id) === prd.id) {
          renderPrd(child, true);
        }
      }
    }

    // Render any unrendered PRDs (orphaned children whose parent is in a different group)
    for (const prd of group) {
      if (!rendered.has(prd.id)) {
        renderPrd(prd, false);
      }
    }
  }

  renderGroup(groups.running, 'Running', false);
  renderGroup(groups.pending, 'Pending', false);
  renderGroup(groups.waiting ?? [], 'Waiting (blocked by upstream)', false);
  renderGroup(groups.failed, 'Failed', true);
  renderGroup(groups.skipped, 'Skipped', true);
}

const PLAYBOOK_SOURCE_COLORS: Record<string, (s: string) => string> = {
  'project-local': chalk.yellow,
  'project-team': chalk.cyan,
  'user': chalk.blue,
};

/**
 * Render the playbook listing with name, source label, description, and shadow chain.
 * Source labels are color-coded: yellow=project-local, cyan=project-team, blue=user.
 */
export function renderPlaybookList(playbooks: PlaybookListEntry[]): void {
  if (playbooks.length === 0) {
    console.log(chalk.dim('No playbooks found.'));
    return;
  }

  const NAME_COL = 24;
  const SRC_COL = 16;
  const DESC_COL = 36;

  console.log('');
  console.log(`  ${'Name'.padEnd(NAME_COL)}  ${'Source'.padEnd(SRC_COL)}  Description`);
  console.log(chalk.dim(`  ${'─'.repeat(NAME_COL)}  ${'─'.repeat(SRC_COL)}  ${'─'.repeat(DESC_COL)}`));

  for (const pb of playbooks) {
    const name = pb.name.length > NAME_COL
      ? pb.name.slice(0, NAME_COL - 1) + '…'
      : pb.name.padEnd(NAME_COL);

    const srcLabel = `[${pb.source}]`.padEnd(SRC_COL);
    const colorFn = PLAYBOOK_SOURCE_COLORS[pb.source] ?? chalk.dim;
    const srcColored = colorFn(srcLabel);

    const profileNote = pb.profile ? chalk.dim(` [profile: ${pb.profile}]`) : '';
    const desc = pb.description.length > DESC_COL
      ? pb.description.slice(0, DESC_COL - 1) + '…'
      : pb.description;

    console.log(`  ${name}  ${srcColored}  ${desc}${profileNote}`);

    if (pb.shadows.length > 0) {
      const shadowSources = pb.shadows.map((s) => s.source).join(', ');
      console.log(chalk.dim(`    shadows ${shadowSources}`));
    }
  }

  console.log('');
}

/**
 * Render a dry-run execution plan display.
 */
export function renderDryRun(
  config: OrchestrationConfig,
  waves: string[][],
  mergeOrder: string[],
): void {
  console.log('');
  console.log(chalk.bold(`Dry run: ${chalk.cyan(config.name)}`));
  if (config.description) console.log(chalk.dim(config.description));
  console.log('');

  console.log(chalk.bold('Execution plan:'));
  for (let i = 0; i < waves.length; i++) {
    console.log(chalk.magenta(`  Wave ${i + 1}:`));
    for (const planId of waves[i]) {
      const plan = config.plans.find((p) => p.id === planId);
      const deps = plan?.dependsOn.length
        ? chalk.dim(` (depends on: ${plan.dependsOn.join(', ')})`)
        : '';
      console.log(`    ${chalk.cyan(planId)} \u2014 ${plan?.name ?? ''}${deps}`);
    }
  }

  console.log('');
  console.log(chalk.bold('Merge order:'));
  for (let i = 0; i < mergeOrder.length; i++) {
    console.log(`  ${i + 1}. ${chalk.cyan(mergeOrder[i])}`);
  }
  console.log('');
}
