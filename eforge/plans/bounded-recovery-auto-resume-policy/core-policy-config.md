---
id: core-policy-config
name: Recovery core policy/config
branch: bounded-recovery-auto-resume-policy/core-policy-config
---

# Recovery core policy/config

Implement the daemon/controller-owned auto-resume policy surface after `client-contracts-routes` defines the shared event/projection contracts: failed queued builds remain paused by default; config and existing docs/reference stay synchronized; enabled auto-resume queues repair only after policy, confidence, artifact, preflight, and budget checks pass; all unsafe/manual paths stop with visible reasons; durable attempt accounting and repeated-failure signatures prevent loops.

## Traceability

Criteria: ac-001, ac-002, ac-003, ac-004, ac-008
Aspects: ac-001:interface:configuration, ac-002:subsystem:apply, ac-002:subsystem:resume, ac-002:subsystem:resumes, ac-002:subsystem:wakes, ac-003:evidence:gates-holds-approvals, ac-003:evidence:manual-retry-abandon, ac-004:general:general, ac-008:interface:config, ac-008:interface:configuration, ac-008:interface:docs, ac-008:interface:test, ac-008:subsystem:config, ac-008:subsystem:docs, ac-008:subsystem:integration, ac-008:subsystem:reference, ac-008:subsystem:test, ac-008:subsystem:unit

## Validation

Author tests for default-off config, config validation, positive handoff, all stop blockers, attempt budget, durable restart accounting, progress-making retries, and repeated-identical failure stops. Required validation: `pnpm type-check`, `pnpm test`, `pnpm maintainability:check`, and `pnpm docs:check` whenever generated config/reference docs are changed.

## Fragment: Config and docs/reference surface alignment

Inspect `packages/engine/src/config.ts` before changing any config contract. Add a disabled-by-default bounded recovery auto-resume policy with a configurable maximum attempt budget. If config keys, defaults, examples, or generated reference fields change, sync `eforge/config.yaml`, existing config docs, plugin/user-facing config/profile docs, docs-gen config output, and public/reference config markdown. Update `packages/pi-eforge/skills/eforge-recover/SKILL.md` and `eforge-plugin/skills/recover/recover.md` to explain the opt-in automation exception; bump `eforge-plugin/.claude-plugin/plugin.json` when plugin content changes.

## Fragment: Daemon policy evaluator and watcher integration

Implement the daemon/controller policy in monitor-owned code, not in the engine kernel. Add or extend a focused monitor service such as `packages/monitor/src/recovery-auto-resume-policy.ts`, and integrate it at the failed queued-build watcher point in `packages/monitor/src/server-main.ts` before preserving the existing pause behavior. Evaluate failed `queue:prd:complete` / recovery-sidecar evidence idempotently so the policy can decide, emit audit intent, and either queue a resume through existing helpers or stop and leave auto-build paused.

## Fragment: Guarded continue-repair handoff

For AC-002, allow auto-resume only when the policy is enabled, budget remains, the deterministic recommendation is `continue-repair`, confidence is `high`, and eligible compiled artifacts are available. Reuse the existing continue-and-repair preparation/apply service paths in `packages/monitor/src/routes/continue-repair-service.ts` and `packages/monitor/src/routes/recovery.ts`; do not write queue files directly or duplicate manual route mutation logic. Persist/derive the attempt count at the same boundary as the queue decision, then invoke the existing scheduling wake/resume path. Emit audit events through the client-owned event schema surface before mutation and after success/failure/stop.

## Fragment: Terminal stop blockers and visible reasons

Cover the full AC-003 stop matrix: exhausted budget; low/medium confidence; non-continue verdicts including manual, retry, and abandon; partial, missing, or malformed sidecars; missing or ineligible compiled artifacts; dirty/conflicting worktree or queue preflight blockers; existing conflicting applied markers; active manual gates, holds, or approvals; and repeated identical failures with no progress signal. Stop before any resume/apply action, keep state side effects minimal, and emit a user-visible reason that identifies the blocker class.

## Fragment: Durable budget, failure signature, and progress handling

Derive attempt counts from durable daemon events and/or add a small `.eforge/` runtime ledger so daemon restarts cannot reset an exhausted budget silently. Define a conservative failure signature from PRD/set identity, failing plan, terminal failure scope/stage/subtype, normalized terminal message, artifact commit/availability, and relevant landed-commit/progress indicators. Treat progress as explicit evidence: allow another attempt only when the new failure differs materially or preserved work advanced; otherwise stop with `repeated-identical-failure` (or equivalent) until a user acts manually.

## Fragment: Targeted tests and required gates

Add focused unit tests for the policy evaluator and budget/signature helpers, plus integration coverage around failed `queue:prd:complete` / `recovery:complete` ordering so default-disabled failures still pause and enabled eligible failures queue through the existing helper. Exercise manual `applyRecovery` and `continueRepair` route tests to confirm compatibility. Ensure tests cover dirty/preflight blockers, conflicting markers, active gates/holds/approvals, restart-durable budget, progress-making retries, and repeated-identical stops.