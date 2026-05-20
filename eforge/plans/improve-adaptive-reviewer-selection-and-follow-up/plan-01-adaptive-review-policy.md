---
id: plan-01-adaptive-review-policy
name: Risk-Budgeted Adaptive Review Selection
branch: improve-adaptive-reviewer-selection-and-follow-up/plan-01-adaptive-review-policy
agents:
  builder:
    effort: high
    rationale: Cross-cutting engine orchestration behavior changes require careful
      coordination between inference, review-cycle continuation policy, and
      existing sharded verify safety guarantees.
  tester:
    effort: high
    rationale: The plan depends on multiple selector and integration scenarios,
      including regression coverage for sharded verify behavior and event
      rationale output.
---

# Risk-Budgeted Adaptive Review Selection

## Architecture Context

Review-cycle orchestration currently uses deterministic engine code for initial reviewer inference and follow-up round selection. The current implementation over-selects `security` for ordinary code files and retains follow-up perspectives whenever a perspective reported any issue, which causes repeated broad round-2 reviewer sets. This plan keeps selection deterministic, uses the existing build-decision event shapes, and preserves the sharded-build `verify` guard.

## Implementation

### Overview

Implement risk-based initial perspective inference, severity/verdict-aware follow-up selection, post-evaluation early termination, and concrete tests for the observed repeated-broad-set failure mode.

### Key Decisions

1. Keep policy in TypeScript helpers under `packages/engine/src/review-heuristics.ts` and `packages/engine/src/review-cycle-perspectives.ts`; do not add an LLM selector.
2. Preserve existing build-decision wire shapes (`perspectives-inferred`, `perspectives-respawned`, `cycle-terminated`) unless a test exposes an unavoidable schema gap.
3. Treat explicit planner-configured perspectives as authoritative after existing extension applicability filtering; apply budget/ranking only to auto-inferred built-in perspectives.
4. Keep `verify` mandatory for sharded builds by passing a mandatory-perspective signal into follow-up selection or enforcing it in the review-cycle stage before the next round is scheduled.
5. Use conservative early termination: skip a confirmation round only when evaluator verdicts accepted all fixer changes, there are no rejected/review verdicts, no critical/high prior issues requiring confirmation, no perspective errors, and command/integration confidence is already represented by docs-only scope, test-cycle coverage, or a completed verify pass.

## Scope

### In Scope

- Tighten built-in initial reviewer inference so ordinary code changes infer `code` without automatic `security`.
- Add path/category risk signals for `security`, including dependency files, auth/session/token/secret/credential/encryption/permission/sandbox names, network/webhook/external-service boundary names, subprocess/shell/runtime execution names, file-system/path traversal names, and security-sensitive config names.
- Add initial `verify` inference for dependency, config, test/build-command, package, and runtime integration risk while avoiding docs-only verify inference.
- Add default budget/ranking for auto-inferred built-in perspectives, with high-risk exceptions for security-sensitive and large changes.
- Retain explicit configured perspectives without applying the inferred budget.
- Replace prior-issue-only follow-up retention with unresolved-risk logic based on severity, evaluator rejected/review verdicts, accepted fixer file domains, and mandatory `verify`.
- Add early termination after evaluation when another confirmation round is skipped by deterministic evidence.
- Improve rationale strings for inferred, respawned, dropped, and terminated decisions.
- Update planner guidance so broad explicit perspective lists require a risk rationale.
- Add unit and integration tests for the required scenarios.

### Out of Scope

- Removing parallel review.
- Adding new built-in perspective names.
- Adding an LLM-based selector.
- Changing daemon API version or event schema unless a failing test requires it.
- Planning-phase review-cycle behavior except prompt wording that affects build review configuration guidance.

## Files

### Create

- `test/review-heuristics-budget.test.ts` — Focused tests for risk signals, ranking, budget caps, and rationale/rule output if the existing `test/review-heuristics.test.ts` becomes too large.

### Modify

- `packages/engine/src/review-heuristics.ts` — Add risk-signal helpers and a normalized initial selection API, for example `selectInitialReviewPerspectives({ changedFiles, changedLines, explicitPerspectives? })`, returning perspectives, categories, fired rules, risk signals, budget information, and rationale fragments. Update `determineApplicableReviews`/`determineApplicableReviewsWithRules` to use the new policy or remain compatibility wrappers with the new behavior.
- `packages/engine/src/agents/parallel-reviewer.ts` — Consume the new initial selection result for auto-inferred built-in perspectives, include budget/risk rationale in the existing `perspectives-inferred` decision, and preserve explicit perspective overrides without budget trimming.
- `packages/engine/src/review-cycle-perspectives.ts` — Replace `hasPriorIssues` retention with helpers for critical/high prior issues, rejected/review verdict files, accepted file domains, `verify` gate retention, mandatory perspectives, and detailed keep/drop rationale. Export a post-evaluation continuation/termination helper if that keeps `build-stages.ts` small.
- `packages/engine/src/pipeline/stages/build-stages.ts` — After `evaluate`, call the continuation/early-termination policy before scheduling the next review round. Emit `cycle-terminated` with `reason: 'no-issues'`, `issuesRemaining: 0`, and a rationale naming the accepted verdicts and skipped confirmation reason. Pass sharded mandatory-verify context into selection.
- `packages/engine/src/sharded-plan-guard.ts` — Keep current injection logic intact; update comments only if needed for new mandatory-verify selector plumbing.
- `packages/engine/src/prompts/planner.md` — Add guidance that explicit parallel perspective lists must be risk-based and small by default; list concrete reasons for adding `security` or `verify`.
- `packages/engine/src/prompts/module-planner.md` — Mirror the build review perspective guidance for expedition module plans.
- `packages/engine/src/prompts/pipeline-composer.md` — Mirror default review guidance so generated orchestration avoids broad lists without risk rationale.
- `test/review-heuristics.test.ts` — Update existing expectations so ordinary code no longer implies `security`; add routine code, dependency, auth/secret/network/subprocess, docs, API, tests, config, verify, ranking, and budget assertions.
- `test/review-cycle-perspectives.test.ts` — Add selector tests for accepted low-risk fixes dropping prior-issue perspectives, critical/high issues retaining confirmation, rejected/review verdicts retaining relevant perspectives, zero-issue perspectives dropping, `verify` dropping after docs-only accepted fixes, `verify` retaining for command/config/package/runtime risk, and mandatory sharded `verify` retention.
- `test/review-cycle-adaptive.test.ts` — Add integration flows where one accepted low-risk fix terminates before round 2 and another high-risk/rejected case runs a narrower round 2 with non-empty `dropped`.
- `test/sharded-build-via-review-cycle.test.ts` — Update or add assertions that sharded `verify` remains present in follow-up rounds after accepted non-doc fixes and that the guard still injects `review-cycle`/`verify`.
- `test/decisions.test.ts` — Add schema/decision helper coverage for the early-termination rationale if any optional metadata is added; otherwise add a no-schema-change assertion for the existing `cycle-terminated` shape.
- `packages/monitor-ui/src/lib/decision-format.ts` and `packages/monitor-ui/src/lib/reducer/__tests__/handle-decisions.test.ts` — Modify only if richer structured fields are added. If no schema fields are added, leave formatting unchanged and rely on displayed rationale plus active/dropped lists.
- `packages/client/src/events.schemas.ts` and `packages/client/src/__tests__/events-schemas.test.ts` — Modify only if tests prove free-form rationale and current arrays cannot represent required observability. Avoid a daemon API version bump when the schema remains unchanged.

## Detailed Requirements

### Initial inference policy

- Ordinary source files such as `src/app.ts` infer `code` and do not infer `security` without a matching security risk signal.
- Dependency and lockfiles infer `security` and `verify`.
- Security-sensitive path/name matches infer `security`; examples include `auth`, `session`, `token`, `secret`, `credential`, `crypto`, `encrypt`, `permission`, `sandbox`, `webhook`, `request`, `http`, `client`, `server`, `shell`, `exec`, `spawn`, `filesystem`, `fs`, `path-traversal`, `cors`, `csrf`, `jwt`, and `oauth`.
- Docs-only changes infer `docs` only.
- Test-only changes infer `test` and `verify` when commands are the confidence mechanism.
- Config/build/package changes infer `verify`; security-sensitive config also infers `security`.
- Auto-inferred built-in perspectives use a default budget of 2 for normal-risk changes. Raise the budget for security-critical or large changes, and record the budget/risk rule in the decision rationale/rules.
- Ranking favors the highest-risk domain instead of adding every matching perspective. Use stable deterministic ordering so tests can assert exact arrays.

### Follow-up and early termination policy

- A perspective with only accepted warning/suggestion fixes is not retained solely because it reported an issue.
- A perspective is retained when it has a critical or high prior issue that warrants confirmation, a rejected/review-needed evaluator verdict on a relevant file, an accepted high-risk file-domain change that warrants confirmation, or a mandatory perspective marker.
- Zero-issue perspectives drop unless accepted fixer changes touched a domain that requires their confirmation.
- `verify` drops after docs-only accepted fixes outside sharded builds.
- `verify` remains for package/config/test/build/runtime command risk and for sharded builds.
- Early termination runs after evaluation and before selecting round 2. It emits `cycle-terminated` when all fixer changes are accepted, rejected/review counts are zero, there are no critical/high unresolved concerns, and command/integration confidence has already been satisfied by docs-only scope, test-cycle coverage, or a completed verify pass.
- Rationale strings name concrete keep/drop/terminate reasons, for example `Dropped security: no security-sensitive files or unresolved security issues`, `Kept verify: accepted non-doc config change`, and `Terminated: all fixes accepted and no unresolved high-risk concerns`.

## Verification

- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm vitest run test/review-heuristics.test.ts test/review-cycle-perspectives.test.ts test/review-cycle-adaptive.test.ts test/sharded-build-via-review-cycle.test.ts test/decisions.test.ts packages/monitor-ui/src/lib/reducer/__tests__/handle-decisions.test.ts` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] A unit test asserts `determineApplicableReviews` or the new selection API returns `['code']` for ordinary `src/app.ts` changes.
- [ ] Unit tests assert dependency, auth/secret/network/subprocess-sensitive paths include `security`.
- [ ] Unit tests assert API/interface/route/schema paths include `api` when API review is the highest-risk matching domain.
- [ ] Unit tests assert config/package/test/runtime integration paths include `verify` and docs-only paths exclude `verify`.
- [ ] A selector test asserts a prior warning issue with all related fixes accepted can drop that perspective.
- [ ] A selector test asserts a critical/high prior issue or rejected/review verdict retains the relevant perspective.
- [ ] An integration test emits one `plan:build:review:parallel:start` event when post-evaluation early termination skips round 2.
- [ ] An integration test emits a round-2 `perspectives-respawned` decision with a non-empty `dropped` array.
- [ ] A test asserts `cycle-terminated` rationale names accepted verdicts and no unresolved high-risk concerns.
- [ ] Sharded review-cycle tests assert `verify` is present in the follow-up round for sharded plans.