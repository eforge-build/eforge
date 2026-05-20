---
title: Improve Adaptive Reviewer Selection and Follow-Up
created: 2026-05-20
profile: gpt-claude-combo
---

# Improve Adaptive Reviewer Selection and Follow-Up

## Problem / Motivation

The review-cycle orchestration is spending too much agent budget by spawning broad parallel reviewer sets and then repeating the same sets in follow-up rounds.

Evidence from local monitor history since adaptive subset selection shipped:

- 15/15 multi-round review-cycle pairs repeated the exact round-1 perspective list in round 2.
- 0 had non-empty `dropped` arrays.
- Cycle termination was overwhelmingly `max-rounds`:
  - 23 `cycle-terminated` decisions used `reason: max-rounds`.
  - Only 1 used `reason: no-issues`.
- A recent run, `generate-public-web-docs-and-audit-for-user-facing-gaps`, repeated `docs`, `verify`, and `code` in round 2 with rationale: `Retained 3 perspective(s) and dropped 0 after prior issues and evaluator file verdicts`.

This suggests the adaptive reviewer-subset feature is complete in a narrow test sense but overly conservative in practical use.

User-facing impact:

- Unnecessary cost.
- Increased latency.
- Noisy pipelines.

Safety remains important: reduce waste without dropping security or integration coverage when it is genuinely warranted.

### Current implementation facts

- `packages/engine/src/review-heuristics.ts` owns initial file-category-to-perspective inference.
  - It currently maps any code file to both `code` and `security` (`code-files → code+security`), which is likely too broad for routine code changes.
- `packages/engine/src/agents/parallel-reviewer.ts` runs either explicit configured perspectives or auto-inferred perspectives.
  - Explicit planner-selected lists bypass most narrowing beyond extension applicability.
- `packages/engine/src/review-cycle-perspectives.ts` owns round-to-round selection.
  - It keeps a perspective when it reported any prior issue.
  - It keeps a perspective when evaluator verdict files overlap that perspective's concern area.
  - It keeps `verify` when `verify` should remain after accepted non-doc changes.
  - It falls back to the full previous set when evidence is incomplete or any perspective errored.
- `packages/engine/src/pipeline/stages/build-stages.ts` owns the `review-cycle` loop.
  - It runs `review -> review-fix -> evaluate` up to `maxRounds`.
  - It terminates early only when a review finds no issues or when the selector returns no remaining perspectives.
- `packages/engine/src/sharded-plan-guard.ts` correctly treats `verify` as mandatory for sharded builds by injecting `review-cycle` and `verify` when shard builders are configured.
- Existing tests prove:
  - A synthetic adaptive success case in `test/review-cycle-adaptive.test.ts`.
  - Selector unit rules in `test/review-cycle-perspectives.test.ts`.
- Existing tests do not reflect the observed production-like pattern where broad initial selection plus conservative retention leads to no drops.

### Roadmap alignment

- `docs/roadmap.md` no longer lists adaptive reviewer subset selection as future work.
- This is a shipped-feature quality improvement / behavior correction rather than a new roadmap feature.

### Working framing

This is a **feature / focused** change:

- It changes engine orchestration behavior and review-decision observability.
- A single cohesive plan should cover the affected modules without delegated module planning.

## Goal

Reduce wasted reviewer-agent budget and repeated broad follow-up review rounds while preserving safety for genuinely security-sensitive, integration-sensitive, and sharded builds.

The desired outcome is that initial reviewer perspective selection becomes risk-based and budgeted, and follow-up rounds become targeted confirmation passes or terminate early when evaluator evidence shows no unresolved risk remains.

## Approach

Implement deterministic, engine-owned policies for initial reviewer selection, follow-up perspective retention, and post-evaluation early termination.

### Key design decisions

1. Keep selection deterministic and engine-owned.

   Use TypeScript policy functions, not a new LLM call, to select initial perspectives and follow-up perspectives.

   Rationale: the goal is budget/control-flow optimization; deterministic rules are testable and observable.

2. Split selection into two related policies.

   - Initial selection answers: `Which perspectives are warranted by this changeset and plan risk?`
   - Follow-up selection answers: `Which perspectives still have unresolved risk after review-fix/evaluate?`

   Do not solve both with the current simple category overlap rule.

3. Tighten security inference.

   Replace `code -> code + security` with narrower security signals.

   Candidate signals:

   - Dependency/lockfile/package manager changes.
   - Auth/session/token/secret/credential/encryption/permission/sandbox terms in path or diff file names.
   - Network/request/webhook/external-service/client/server boundary code.
   - Subprocess/shell/file-system/path traversal/runtime execution code.
   - Security-sensitive config.

   For ordinary code files without these signals, infer `code` but not `security`.

4. Treat `verify` as a gate.

   - Keep `verify` mandatory for sharded builds via `sharded-plan-guard`.
   - Outside sharding, infer or retain `verify` when accepted changes or initial changed files affect runtime/build/test/package/config behavior where commands are the safety net.
   - Do not retain `verify` after docs-only accepted fixes.

5. Add budgeted ranking for inferred sets.

   - For normal inferred review, cap initial built-in perspectives to a small default budget, likely 2.
   - Allow a larger budget for:
     - Explicit planner configuration.
     - Sharded builds.
     - Security-critical signals.
     - Large/high-risk plans.
   - Ranking should prefer the highest-risk domain rather than accumulating every matching category.
   - Explicit planner-specified perspectives should still be honored.
   - Planner prompt guidance should discourage broad lists without rationale.

6. Make round 2 a targeted confirmation pass.

   A perspective should not be retained merely because it found any issue. Retention should depend on unresolved risk:

   - Keep if the perspective had critical/high issues, rejected fixes, review-needed verdicts, or accepted fixes touching that perspective's domain in a way that warrants confirmation.
   - Drop if all related fixes were accepted and no relevant risk remains.
   - Drop zero-issue perspectives unless accepted fixer changes touched their domain.
   - Keep `verify` only when command/integration confidence is needed.

7. Add early termination after evaluation.

   Before starting another round, terminate the cycle when:

   - All reviewer fixes were accepted.
   - No rejected/review-needed verdicts remain.
   - No critical/high unresolved issues exist.
   - Validation/test/verify coverage is adequate for the touched files.

   Emit a `cycle-terminated` decision with rationale explaining why another confirmation round was skipped.

8. Prefer existing event shapes initially.

   - Use existing `perspectives-respawned.dropped` and rationale strings if sufficient.
   - Only add structured reason fields if tests/UI needs show that free-form rationale is inadequate.
   - Avoid daemon API version bump unless the wire contract changes.

9. Improve observability.

   Decision rationale should name why perspectives were kept/dropped, for example:

   - `Dropped security: no security-sensitive files or unresolved security issues`
   - `Kept verify: accepted non-doc config change`
   - `Terminated: all fixes accepted and no unresolved high-risk concerns`

### Code impact

Primary engine files:

- `packages/engine/src/review-heuristics.ts`
  - Initial built-in auto inference.
  - Current evidence: any code file adds both `code` and `security`; this is the first likely over-selection source.
  - Add risk-signal helpers and potentially a ranked/budgeted perspective selection API.
- `packages/engine/src/agents/parallel-reviewer.ts`
  - Consumes inferred/explicit perspective lists and emits `perspectives-inferred`.
  - May need richer rules/rationale metadata and perhaps a normalized selection result from `review-heuristics.ts`.
- `packages/engine/src/review-cycle-perspectives.ts`
  - Follow-up selector.
  - Current evidence: prior issue count alone pins a perspective.
  - Needs unresolved-risk semantics, accepted/rejected/review verdict interpretation, and possibly severity-aware retention.
- `packages/engine/src/pipeline/stages/build-stages.ts`
  - `review-cycle` loop.
  - Needs early-termination policy after evaluate and decision emission for targeted confirmation / no-follow-up-needed.
- `packages/engine/src/sharded-plan-guard.ts`
  - Must remain intact.
  - Tests should assert sharded plans still inject/retain `verify` appropriately.

Likely schema/UI files:

- `packages/client/src/events.schemas.ts`
  - Likely does not need a breaking change if existing `perspectives-respawned` and `cycle-terminated` rationale fields are enough.
  - If structured keep/drop reasons are added, this becomes a client schema/API decision.
- `packages/monitor-ui/src/lib/decision-format.ts`
  - May need formatting improvements if richer rationale or dropped reasons are surfaced.

Tests to add/update:

- `test/review-cycle-perspectives.test.ts`
  - Unit tests for stricter retention/drop rules, severity-aware unresolved risk, `verify` policy, and early-termination selector signals if represented there.
- `test/review-cycle-adaptive.test.ts`
  - Integration tests where round 2 is narrower or skipped entirely after accepted fixes.
- `test/sharded-build-via-review-cycle.test.ts`
  - Guard against dropping mandatory sharded `verify`.
- New or existing tests around `review-heuristics.ts`
  - Security/verify signals and budgeted inference.
- Monitor decision-format tests if user-facing decision detail changes.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Broad initial inference is a major contributor to waste. | Code inspection shows `review-heuristics.ts` maps all code files to `code + security`; local monitor history shows repeated broad sets, but exact source of each explicit perspective list may include planner choices. | medium | low | Inspect orchestration YAML for recent runs and compare explicit review configs against inferred decisions. | If wrong, most improvement must happen in planner prompt/config policy rather than inference. |
| Follow-up retention is too conservative because any prior issue pins a perspective. | `review-cycle-perspectives.ts` keeps `hasPriorIssues`; local history shows 15/15 round pairs retained all perspectives and 0 drops. | high | low | Add selector tests mirroring recent real verdict patterns. | If wrong, over-retention may instead be caused mostly by fallback paths or evaluator file overlap. |
| Existing event shapes can support the first improvement slice. | `perspectives-respawned` already has `perspectives` and `dropped`; `cycle-terminated` has rationale/reason fields. | high | low | Prototype decision payloads and run client schema tests. | If wrong, client schema/API version and monitor reducer work expand scope. |
| A default perspective budget of about 2 is safe for normal inferred reviews. | This is a design judgment, not proven by tests yet. Current defaults already use only `code` for `DEFAULT_REVIEW`, but planner-selected explicit lists can be broader. | medium | medium | Mine recent successful builds and simulate proposed selector against changed files; add tests for high-risk exceptions. | Too small a budget could miss useful specialist feedback; too large preserves waste. |
| Security-sensitive signals can be identified from file paths/categories well enough for initial selection. | Existing heuristics already classify file paths; no diff-content inspection has been validated. | medium | medium | Start path/category based, optionally add cheap `git diff --name-only`/path keyword tests; consider later diff-content signal if needed. | False negatives could drop security review for subtle security changes. |
| Early termination after accepted fixes is safe when no unresolved/high-risk evidence remains. | Current evaluator already accepts/rejects/review-marks fixes, but mapping verdicts back to originating perspective is approximate today. | medium | medium | Add conservative first slice: terminate only on clean accepted fixes with low-risk touched files and no critical/high issues; expand attribution later if needed. | Premature termination could skip useful confirmation; overly conservative termination preserves current max-round behavior. |
| Planner prompts contribute to broad explicit perspective lists. | Prompt inspection shows guidance allows multiple perspectives and 2 rounds for complex plans; recent runs likely include explicit lists, but this is not fully quantified. | medium | low | Inspect recent `eforge/plans/*/orchestration.yaml` artifacts or monitor orchestration snapshots. | If not addressed, engine auto inference improvements may not affect explicit planner-selected lists. |

No low-confidence/high-impact assumption is unresolved.

The riskiest assumptions are the exact perspective budget and security signal coverage; both should be implemented conservatively with explicit high-risk escape hatches and tests.

### Profile signal

Recommended profile: **Excursion**.

Rationale: this is a cohesive engine behavior change spanning review heuristics, review-cycle selection, and tests. It is cross-cutting but does not require delegated module planning or architecture/module decomposition. A single planner can enumerate the implementation, safety boundaries, and validation strategy.

## Scope

### In scope

- Tighten initial built-in reviewer perspective inference so broad parallel review is risk-based rather than checklist-like.
- Stop treating all code changes as automatically security-relevant.
- Add narrower security signals such as:
  - Auth.
  - Permissions.
  - Secrets.
  - Networking.
  - Subprocess/file-system risk.
  - Sandboxing.
  - Dependency/lockfile changes.
  - Security-sensitive path/name patterns.
- Treat `verify` as an integration gate rather than a standing perspective:
  - Keep mandatory injection for sharded builds.
  - Otherwise include it only when build/test/config/package/runtime command risk justifies it.
- Add a perspective budget/ranking policy for inferred perspective sets, so normal plans default to a small set, often `code` or `code + docs/api`, and high-risk plans can still use more.
- Make follow-up review rounds targeted confirmation passes:
  - Drop perspectives whose risks were resolved or were never implicated.
  - Keep perspectives with unresolved/rejected/review-needed concerns.
  - Terminate early when accepted fixes plus validation evidence make another review round unnecessary.
- Improve decision rationale/observability so emitted build decisions explain kept/dropped/terminated reasoning.
- Add tests using:
  - Real selector logic.
  - Review-cycle integration flows.
  - Monitor/history-style cases that previously retained everything.

### Out of scope

- Removing parallel review entirely.
- Weakening the sharded-build `verify` guard.
- New reviewer prompt families or new built-in perspective names.
- A new LLM decision-maker for perspective selection; this should remain deterministic engine policy.
- Planning-phase review cycles (`plan-review-cycle`, architecture/cohesion review cycles) unless touched incidentally by shared formatting.

## Acceptance Criteria

- Initial auto-inference no longer adds `security` for ordinary code changes without security-sensitive signals.
- Tests cover:
  - Routine code.
  - Dependency changes.
  - Auth/secret/network/subprocess-sensitive paths.
  - Docs.
  - API.
  - Tests.
  - Config.
- Initial inferred perspective selection is budgeted/ranked for normal changes.
- Tests prove common changes spawn smaller reviewer sets while high-risk/sharded/explicit cases can still use broader sets.
- `verify` remains mandatory for sharded builds.
- `verify` is retained/inferred for command/build/test/package/config/runtime integration risk.
- `verify` is not repeated after docs-only accepted fixes.
- Follow-up review-cycle selection can drop perspectives that had issues when evaluator accepted all related fixes and no unresolved/high-risk concern remains.
- Tests cover prior issue retention only for unresolved/rejected/review-needed/high-severity cases.
- Review-cycle can terminate before `maxRounds` after evaluation when another confirmation round is unnecessary.
- Emitted `cycle-terminated` rationale explains the evidence.
- Existing adaptive tests are updated or expanded so:
  - At least one integration flow skips round 2 entirely.
  - At least one integration flow runs a narrower targeted round 2.
- Sharded build review-cycle tests continue to pass and assert the safety policy for `verify`.
- Build decision output exposes active/dropped/terminated rationale clearly enough for monitor/UI diagnosis.
- `pnpm type-check` passes.
- Relevant vitest suites pass, including:
  - Review heuristics.
  - Adaptive review-cycle.
  - Sharded review-cycle.
  - Decision formatting tests.
