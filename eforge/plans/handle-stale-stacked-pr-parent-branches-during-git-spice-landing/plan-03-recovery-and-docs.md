---
id: plan-03-recovery-and-docs
name: Recovery Guidance and Stacking Documentation
branch: handle-stale-stacked-pr-parent-branches-during-git-spice-landing/plan-03-recovery-and-docs
agents:
  builder:
    effort: medium
    rationale: Focused recovery text and docs work depending on the new landing
      metadata from prior plans.
  reviewer:
    effort: medium
    rationale: Review should verify the recovery guidance is scoped to git-spice
      missing-base failures and docs match implemented behavior.
---

# Recovery Guidance and Stacking Documentation

## Architecture Context

The primary fix prevents safe stale-parent failures before git-spice submit. Recovery still needs a stack-base-specific diagnosis for historical failures and unexpected provider failures that contain git-spice missing-base messages. Documentation also needs to describe automatic branch-scoped stale-parent collapse and the fail-closed fallback.

## Implementation

### Overview

Teach deterministic recovery recommendation logic to recognize git-spice missing-base landing failures and produce stack-base-specific manual guidance instead of a generic manual rationale. Update stacking docs and generated event references to reflect the new optional landing metadata.

### Key Decisions

1. Keep recovery advisory only; it must not mutate branches or auto-submit parents after a build is already failed.
2. Match only git-spice missing-base submit signatures, including `base branch ... does not exist in the remote` and `base branch ... has not been submitted yet`.
3. Preserve the existing verdict vocabulary by returning `manual` with stack-specific rationale and remediation steps.
4. Use `eforge stack sync` documentation for normal whole-stack maintenance while documenting that stale-parent landing repair is automatic and branch-scoped.

## Scope

### In Scope

- Deterministic recovery classification/rationale for git-spice missing-base landing failures.
- Recovery tests for both missing-base patterns.
- `docs/stacking.md` update for automatic stale-parent collapse and fail-closed behavior.
- Generated event/schema reference updates if plan 02 extends the event schema.

### Out of Scope

- Recovery code that retargets or submits branches after a failed build.
- New daemon routes, console controls, Pi extension commands, or Claude plugin commands.
- Changes to GitHub branch deletion behavior.

## Files

### Modify

- `packages/engine/src/recovery/recommendation.ts` — Add a helper that detects stack landing missing-base failures from `summary.terminalFailure.message`, `summary.terminalFailure.landing.reason`, and `summary.landing.reason`, then returns a stack-base-specific `manual` recommendation before the generic no-`failingPlans` path.
- `test/recovery-recommendation.test.ts` — Add tests for both git-spice missing-base phrases and ensure the deterministic recommendation mentions stack base repair, trunk integration proof, and `eforge stack sync` or parent branch restoration guidance.
- `docs/stacking.md` — Expand “Pre-landing reconciliation” with remote-base preflight, automatic trunk collapse when parent artifact ancestry proves integration, fail-closed behavior when proof is unavailable, and the distinction from whole-stack sync.
- `web/content/reference/events.md` — Regenerate if optional stack landing fields are added.
- `web/public/reference/events.md` — Regenerate if optional stack landing fields are added.
- `web/public/llms-full.txt` — Regenerate if optional stack landing fields are added.
- `web/public/schemas/events.schema.json` — Regenerate if optional stack landing fields are added.

## Detailed Requirements

### Recovery guidance

- Detect landing failures when any available landing/terminal message matches either:
  - `base branch ... does not exist in the remote`
  - `base branch ... has not been submitted yet`
- Return `manual` with rationale that identifies a stack base failure rather than a code/build failure.
- The rationale must instruct the user to verify whether the parent artifact commit is an ancestor of trunk, rerun with the new automatic landing repair when it is integrated, or restore/submit/repair the parent branch when it is not integrated.
- Preserve existing transient retry/split behavior for plan-scoped failures.
- Preserve generic manual behavior for landing failures that do not match the missing-base signatures.

### Documentation

- Update `docs/stacking.md` under “Pre-landing reconciliation”. Include:
  - eforge checks whether a child stacked base exists on the remote before git-spice submission.
  - If the parent remote branch is missing and the parent artifact commit is an ancestor of trunk, eforge retargets/restacks only the child artifact branch onto trunk and submits against trunk.
  - If eforge cannot prove ancestry, landing fails with an actionable error.
  - `eforge stack sync` remains the command for normal whole-stack maintenance, while stale-parent landing repair is automatic and branch-scoped.
- If plan 02 adds optional event fields, run `pnpm docs:generate` so generated reference artifacts list `originalBaseBranch`, `effectiveBaseBranch`, and `baseRepairReason`.

## Verification

- [ ] `determineRecoveryRecommendation` returns `manual` with a rationale containing `stack base` for a landing reason containing `base branch eforge/parent does not exist in the remote`.
- [ ] `determineRecoveryRecommendation` returns `manual` with a rationale containing `stack base` for a landing reason containing `base branch has not been submitted yet`.
- [ ] The missing-base rationale mentions verifying parent artifact ancestry against trunk and distinguishes integrated-parent rerun from parent branch restoration/submission.
- [ ] A non-missing-base landing failure without `failingPlans` still follows the existing generic manual path.
- [ ] `docs/stacking.md` contains `automatic`, `branch-scoped`, `ancestor`, and `fails closed` in the pre-landing reconciliation section.
- [ ] Generated event references include `originalBaseBranch`, `effectiveBaseBranch`, and `baseRepairReason` when the event schema includes those fields.
- [ ] Targeted tests pass: `pnpm vitest run test/recovery-recommendation.test.ts`.
- [ ] `pnpm docs:check` exits 0 after generated references are updated.