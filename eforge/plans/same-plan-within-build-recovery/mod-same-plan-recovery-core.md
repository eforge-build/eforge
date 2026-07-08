---
id: mod-same-plan-recovery-core
name: Same-plan recovery core
branch: same-plan-within-build-recovery/mod-same-plan-recovery-core
---

# Same-plan recovery core

Implement the central same-plan recovery classifier, attempt orchestrator, and fixer context. Scope includes active-plan-only review/test exhaustion eligibility; exclusions for manual, human-review, cross-plan, upstream/base-owned, low-confidence or incomplete classifier output, and unsupported blockers; typed start/attempt/result/skip/exhausted lifecycle evidence; explicit budget accounting; post-attempt blocking-check reruns; continuation only after blockers clear; no review-counter reuse; separate rejected/unresolved verifier issue groups in recovery context; and preserved terminal/sidecar/worktree fallback behavior.

## Traceability

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005, ac-006, ac-008
Aspects: ac-001:interface:test, ac-001:subsystem:human-review, ac-001:subsystem:manual, ac-001:subsystem:review, ac-001:subsystem:test, ac-002:evidence:start-attempt-result-skip-or-exhausted, ac-003:general:general, ac-004:subsystem:rejected, ac-004:subsystem:unresolved, ac-005:general:general, ac-006:subsystem:cross-plan, ac-006:subsystem:failure, ac-006:subsystem:preflight, ac-006:subsystem:sidecar, ac-006:subsystem:upstream, ac-006:subsystem:worktree, ac-008:interface:test, ac-008:subsystem:test

## Validation

Author targeted Vitest for successful same-plan recovery that reruns required checks and resumes only after blockers clear; active-plan eligibility; other-plan/manual/human-review exclusions; unsafe worktree or preflight refusal; low-confidence or incomplete classification refusal; lifecycle events; budget exhaustion; rerun gating; stale pass data refusal; rejected/unresolved context rendering; no review-counter reuse; and terminal/sidecar fallback. Run pnpm type-check and focused tests.

## Fragment: Same-plan recovery core flow

Implement one recovery gate/orchestrator. It must allow same-plan recovery only for active-plan review/test blockers, reject manual or human-review gates, refuse low-confidence or incomplete classifier output, refuse cross-plan/upstream/base-owned blockers, emit typed start/attempt/result/skip/exhausted lifecycle evidence, consume an explicit attempt budget, rerun blocking checks after attempts, continue only when blockers clear, avoid reusing review counters, and preserve terminal/sidecar fallback behavior.
## Fragment: Rejected/unresolved fixer context

Extend recovery fixer context/task rendering with separate rejected and unresolved verifier issue groups. Include stable labels, identifiers, summaries, reasons, deterministic ordering, and defined empty-state behavior.