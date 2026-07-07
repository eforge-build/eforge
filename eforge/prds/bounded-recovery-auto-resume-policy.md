---
title: Bounded Recovery Auto-Resume Policy
created: 2026-07-05
depends_on: ["per-invocation-runtime-choice-routing"]
stack_parent: per-invocation-runtime-choice-routing
priority: 0
---

# Bounded Recovery Auto-Resume Policy

## Problem / Motivation

Queued builds that fail after making preserved compiled-artifact progress currently require repeated manual recovery actions. Current source already has deterministic recovery recommendations for eligible compiled-artifact continue-and-repair, explicit apply/continue-repair routes, recovery sidecars, and Console confirmation UI, but failed queued builds still pause auto-build and no bounded policy/budget/state exists for daemon-owned auto-resume.

The desired feature is an opt-in, fail-closed daemon/controller policy: when recovery analysis confidently recommends continue-and-repair from preserved compiled artifacts, the daemon may automatically queue that resume up to a configured attempt budget, emit durable audit events, and surface state to users. The feature should reduce repetitive manual resume clicks without hiding manual controls or expanding automation to unsafe/ambiguous recovery paths.

## Goal

Create an opt-in, bounded daemon/controller policy that can auto-queue continue-and-repair resumes only after recovery analysis produces a high-confidence compiled-artifact recommendation.

The work changes recovery policy/config, daemon watcher behavior, typed client events/projections, Console queue/run visibility, and recovery docs/skills while keeping the engine as the recommendation/apply helper provider and preserving all manual controls.

## Approach

High-level implementation should:

- Add a safe, disabled-by-default auto-resume config policy with a configurable maximum attempt budget.
- Add a policy evaluator for failed queued builds/recovery sidecars that allows only high-confidence `continue-repair` recommendations with eligible compiled artifacts and no safety blockers.
- Add durable typed events/audit records for decisions, queued attempts, attempt counts, budget exhaustion, and stop reasons.
- Persist or derive attempt counts across daemon restarts so repeated failures do not reset the budget silently.
- Integrate with the daemon watcher path that currently pauses on `queue:prd:complete` failures, allowing eligible auto-resume to queue through existing continue-and-repair helpers and otherwise preserving the pause behavior.
- Surface policy and current auto-resume state in daemon/Console queue or run details while retaining manual buttons and confirmation flows.
- Update recovery documentation and Pi/Claude plugin skill text that currently implies recovery actions are never auto-applied.
- Update tests for default-disabled behavior, enabled policy behavior, safety stops, progress-making resumes, repeated-identical failure stops, and compatibility with existing manual recovery routes.

Design decisions:

- Fail closed: the policy is disabled by default and applies only to `continue-repair` with `confidence: "high"` and eligible compiled artifacts.
- Reuse existing recovery/resume machinery: auto-resume should call the same underlying continue-and-repair preparation/apply path as manual routes, not write queue files directly.
- Keep budget durable: count attempts from durable daemon events and/or a small runtime sidecar so restart cannot clear an exhausted budget accidentally.
- Define a conservative failure signature from bounded recovery evidence: PRD/set identity, failing plan, terminal failure scope/stage/subtype, normalized terminal message, artifact commit/availability, and relevant landed-commit/progress indicators.
- Treat progress as explicit evidence, not hope: allow another attempt only when the new failure differs materially or preserved work advanced; otherwise stop with `repeated-identical-failure` or equivalent.
- Emit before mutating and after mutating: record decision/attempt intent, then success/failure/stop result with attempt count and budget so users can audit what happened.
- Preserve current manual UX: Console can show that automation queued or stopped, but manual analyze/apply/continue controls remain available when safe.
- Keep route constants and event/wire shapes in `@eforge-build/client`; monitor and Console import shared helpers/types instead of inlining `/api/...` paths or local wire interfaces.
- Keep scheduling architecture disciplined: the daemon/controller owns this narrow recovery orchestration, while the engine remains responsible for build execution, recovery summaries, deterministic recommendations, sidecars, and reusable apply helpers.

Likely code surfaces:

- `packages/engine/src/config.ts`: add config schema/defaults/types for the opt-in policy and generated config docs impact.
- `packages/client/src/events/variants/*`, `packages/client/src/events/snapshots.ts`, `packages/client/src/types.ts`, and related tests: define typed auto-resume decision/attempt/stop events and queue/run wire state in the client-owned contracts.
- `packages/monitor/src/server-main.ts`: replace or extend the current failure-pause decision point so failed queue events can be evaluated for auto-resume before or immediately after pausing.
- New focused monitor service/module such as `packages/monitor/src/recovery-auto-resume-policy.ts`: policy evaluation, attempt budget lookup, failure-signature comparison, and stop-reason mapping.
- `packages/monitor/src/routes/recovery.ts` and `packages/monitor/src/routes/continue-repair-service.ts`: reuse existing queueing/preflight helpers; avoid duplicating queue mutation logic.
- `packages/monitor/src/projections/queue-items.ts`, `packages/monitor/src/projections/runs.ts`, and/or monitor state projection modules: expose auto-resume state for REST and SSE snapshots using shared client wire types.
- `packages/console-ui/src/components/recovery/*` and queue/run detail components/selectors: render policy state, attempt counts, and stop reasons without removing manual confirmation controls.
- `packages/pi-eforge/skills/eforge-recover/SKILL.md` and `eforge-plugin/skills/recover/recover.md`: update user-facing recovery guidance to explain the opt-in automation exception to the current “never auto-apply” language; bump the Claude plugin version if plugin content changes.
- Tests in `test/` and `packages/monitor/src/__tests__/`: add policy, event-schema, route compatibility, projection, and Console/UI tests near existing recovery and auto-build pause/resume coverage.

Assumptions:

- Existing deterministic recommendation and recovery sidecar paths remain the source of recovery truth.
- Existing continue-and-repair helper/preflight behavior can represent dirty worktree, missing artifact, already-queued, and conflicting applied-marker blockers.
- The daemon DB/event log is acceptable as the primary durable audit source; if retention or pruning makes budgets unreliable, add a small persisted auto-resume ledger under `.eforge/`.

Risks and mitigations:

- Runaway loop risk: disabled default, max-attempt budget, repeated-identical failure detection, and durable attempt accounting.
- Unsafe mutation risk: reuse existing continue-and-repair preflights and stop on partial/ambiguous sidecars or conflicts.
- Event-order race risk: cover failure/recovery ordering with integration tests and idempotent decision handling.
- UX trust risk: emit visible audit events, surface stop reasons, and keep manual controls available.

Validation confidence should come from fail-closed policy tests, event/schema parity, Console rendering tests, existing route compatibility tests, and full type/test/maintainability gates.

Validation plan:

- Unit-test policy evaluation for disabled/enabled policy, high-confidence allow, non-continue verdicts, low confidence, partial sidecars, missing eligibility, manual gates, dirty/preflight blockers, exhausted budgets, and repeated signatures.
- Integration-test watcher behavior around failed `queue:prd:complete` and `recovery:complete` ordering so existing pause behavior remains when policy does not apply.
- Route compatibility tests: manual `applyRecovery` and `continueRepair` still work and emit existing wake reasons/events.
- Event/client tests: new event variants parse, invalid attempt counts fail validation, REST/SSE snapshot parity remains intact.
- Projection/UI tests: queue/run details show policy state and stop reasons; manual confirmation components remain rendered.
- Run `pnpm type-check`, `pnpm test`, `pnpm docs:check` if generated docs are affected, and `pnpm maintainability:check`.

## Scope

In scope:

- Add a safe, disabled-by-default auto-resume config policy with a configurable maximum attempt budget.
- Add a policy evaluator for failed queued builds/recovery sidecars that allows only high-confidence `continue-repair` recommendations with eligible compiled artifacts and no safety blockers.
- Add durable typed events/audit records for decisions, queued attempts, attempt counts, budget exhaustion, and stop reasons.
- Persist or derive attempt counts across daemon restarts so repeated failures do not reset the budget silently.
- Integrate with the daemon watcher path that currently pauses on `queue:prd:complete` failures, allowing eligible auto-resume to queue through existing continue-and-repair helpers and otherwise preserving the pause behavior.
- Surface policy and current auto-resume state in daemon/Console queue or run details while retaining manual buttons and confirmation flows.
- Update recovery documentation and Pi/Claude plugin skill text that currently implies recovery actions are never auto-applied.
- Update tests for default-disabled behavior, enabled policy behavior, safety stops, progress-making resumes, repeated-identical failure stops, and compatibility with existing manual recovery routes.

Out of scope:

- Auto-applying `retry`, `abandon`, accepted-success, queue-cascade repair, or compile scope/context guidance.
- Generating successor PRDs or broad Auto-drain workflow orchestration.
- Removing or weakening existing user confirmations for manual actions.
- Moving scheduling policy into the engine kernel.
- Auto-applying retry, abandon, accepted-success, queue-cascade repair, or broader Auto-drain scheduling beyond this narrow bounded recovery auto-resume policy.

## Acceptance Criteria

- With default configuration, failed queued builds still pause auto-build and no auto-resume mutation occurs.
- With policy enabled and remaining budget, a high-confidence `continue-repair` verdict plus eligible compiled artifacts queues continue-and-repair through existing resume/apply helpers, records the attempt count, wakes/resumes scheduling as appropriate, and emits typed audit events.
- The policy stops and emits a user-visible stop reason for exhausted budget, low/medium confidence, manual/retry/abandon verdicts, partial or malformed sidecars, ineligible compiled artifacts, dirty/conflicting worktree or queue preflight blockers, existing conflicting applied markers, active manual gates/holds/approvals, and repeated identical failures with no progress signal.
- Progress-making failures may consume the next attempt until budget is exhausted; identical failure signatures after an auto-resume attempt are not looped.
- Queue/run/auto-build projections expose enough state for Console to show enabled/disabled policy, attempt count, last decision, and stop reason.
- Console keeps manual recovery controls visible and clearly distinguishes auto-resume decisions from user-confirmed actions.
- Existing manual `applyRecovery` and `continueRepair` route tests remain valid, and typed event/schema parity tests cover the new variants.
- Validation includes targeted unit/integration tests plus `pnpm type-check`, `pnpm test`, `pnpm docs:check` when generated config/reference docs change, and `pnpm maintainability:check`.