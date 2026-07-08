---
title: Same-plan within-build recovery
created: 2026-07-01
depends_on: ["per-invocation-runtime-choice-routing", "bounded-recovery-auto-resume-policy", "direct-pr-base-sync-recovery-ux"]
stack_parent: direct-pr-base-sync-recovery-ux
---

# Same-plan within-build recovery

## Executive Summary

Plan a bounded engine feature that adds a distinct same-plan recovery phase after normal review/test repair convergence fails, only when the remaining blocking outcomes are localized to the currently running plan and no manual gate is present. The work changes engine orchestration, typed client event schemas/projections, monitor/console visibility, recovery prompt context, and regression tests while preserving fail-closed behavior and the existing sidecar/manual recovery path for unsafe, cross-plan, low-confidence, or budget-exhausted cases. Validation should rely on real orchestration/unit coverage for successful recovery, refusal modes, budget exhaustion, and unchanged terminal failure semantics, with normal build/type/test gates expected before handoff confidence is high.

## Problem Statement

When a build plan exhausts normal review or test repair rounds, the engine currently proceeds to terminal failure/sidecar recovery even if the remaining blockers are narrow, localized to the currently running plan, and likely repairable in-place. The desired behavior is not to hide this by inflating normal maxRounds; it should introduce a separately observable, bounded same-plan recovery phase that can repair localized convergence failures while still failing closed for unsafe or ambiguous cases.

## Scope

- Add eligibility detection for review-cycle and test-cycle verdict exhaustion where all remaining blocking issues are attributable to the currently running plan.
- Add a distinct bounded same-plan recovery phase with explicit attempt budgeting and typed lifecycle/decision events.
- Feed the recovery fixer prompt with final verifier/test verdicts, rejected or unresolved issue outcomes, retry guidance, changed-file context, and prior repair attempt summaries.
- Re-run required checks after the recovery pass and continue normal build flow only when blocking outcomes are cleared.
- Update daemon/client projections and Console/run surfaces so same-plan recovery attempts are distinguishable from normal review rounds.

Out of scope:
- No unbounded autonomous retry loop.
- No broad dependency-graph recovery or upstream plan repair beyond refusing same-plan recovery when failures are cross-plan.
- No replacement of existing sidecar recovery, manual gate, or failed-build retry flows.
- No silent success path that bypasses required verifier/test checks.

## Acceptance Criteria

- Review/test verdict exhaustion is classified for same-plan recovery only when every remaining blocking issue targets the currently running plan and no manual/human-review gate is present.
- Same-plan recovery emits its own typed start/attempt/result/skip-or-exhausted events and does not reuse normal review-round counters as a hidden extra round.
- Recovery attempts are bounded by an explicit budget and fail closed when budget is exhausted.
- Recovery fixer context includes final verifier verdicts, rejected/unresolved issue outcomes, retry guidance, changed-file context, and prior repair attempts.
- Required checks are re-run after a recovery attempt; build execution continues only after blocking outcomes are cleared.
- Unsafe worktree/preflight failures, low-confidence classification, manual gates, and upstream/cross-plan issues bypass same-plan recovery and retain the existing terminal failure/sidecar recovery path.
- Run/Console projections visibly distinguish normal review/test repair rounds from same-plan recovery attempts.
- Tests cover successful same-plan recovery, budget exhaustion, manual-gate refusal, unsafe-worktree refusal, cross-plan/upstream refusal if the classifier supports it, and unchanged existing terminal failure behavior when recovery is not eligible.

## Code Impact

Likely changed surfaces:
- `packages/engine/src`: review/test convergence handling, build-stage orchestration, recovery eligibility/classification helpers, recovery fixer prompt assembly, state/event emission, and rerun-check integration.
- `packages/client/src/events*` and related API/projection types: add the typed same-plan recovery lifecycle events and ensure event validation derives wire types from the client schemas.
- `packages/monitor/src` and shared projection helpers: persist/project recovery attempts separately from normal review rounds without re-declaring client-owned wire shapes.
- `packages/console-ui/src`: show same-plan recovery status/attempts in run/session surfaces where review/test progress is already surfaced.
- `test/`: add focused real-code tests around classifier/orchestration behavior using existing harness patterns, plus projection/event schema coverage as needed.

Documentation impact should be limited to recovery/build lifecycle docs and generated event/API references that enumerate event schemas or run states. Implementation should respect repository guardrails: engine commits/events use existing helpers, daemon routes/wire shapes stay client-owned, and state mutation/decision emission remain behind their single-entry helpers.

## Design Decisions

- Model same-plan recovery as a new phase, not as an increased review/test `maxRounds`, so operators can audit why extra work happened.
- Keep eligibility conservative: require all blocking outcomes to be local to the active plan, require no manual gate, require safe preflights, and refuse when classification is incomplete.
- Use a small bounded attempt budget with explicit exhausted/declined events; budget exhaustion should converge to the same failure outcome that would have happened without the feature.
- Reuse existing repair/fixer harness boundaries where possible, but provide a recovery-specific prompt contract that includes verifier outcomes, failed issue disposition, changed files, retry guidance, and repair history.
- Treat event schema and projections as first-class API work: engine emits typed events, client owns schemas/wire types, monitor persists/projects them, and Console renders them.
- Prefer narrow helpers for eligibility, prompt context, and event payload construction to keep orchestration code readable and maintainable.
- Keep richer workflow scheduling or human UX policy outside the kernel; this feature should remain a bounded engine recovery phase with typed observability.

## Assumptions And Validation

Assumptions:
- Current review/test verdict records can either identify issue locality to a plan or can be narrowly extended to do so.
- One same-plan recovery attempt is enough for the initial implementation unless existing configuration patterns make a small configurable budget cheaper and safer.
- Existing sidecar/manual recovery remains the fallback and should not be removed or weakened.

Validation plan:
- Add tests for eligibility decisions: all-local eligible, manual gate refused, unsafe worktree refused, exhausted budget refused, and upstream/cross-plan blockers refused.
- Add orchestration tests showing successful same-plan recovery reruns checks and continues only after blockers clear.
- Add regression coverage proving ineligible/exhausted cases still produce the prior terminal failure behavior.
- Add event/schema/projection tests so same-plan recovery attempts are visible separately from review rounds.
- Run `pnpm test`, `pnpm type-check`, `pnpm build`, and `pnpm maintainability:check` before handoff.

Key risks to watch during validation: over-recovery masking real design failures, observability drift from hidden retry semantics, event/API drift if wire types are added outside `@eforge-build/client`, and scope creep into dependency-aware upstream repair.