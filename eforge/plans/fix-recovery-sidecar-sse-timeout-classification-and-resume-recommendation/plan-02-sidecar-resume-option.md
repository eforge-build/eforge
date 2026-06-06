---
id: plan-02-sidecar-resume-option
name: Add Sidecar Compiled-Build Resume Option
branch: fix-recovery-sidecar-sse-timeout-classification-and-resume-recommendation/plan-02-sidecar-resume-option
agents:
  builder:
    effort: high
    rationale: This plan touches the sidecar wire contract, engine sidecar
      generation paths, and two integration skill documents while preserving
      apply-recovery semantics.
  reviewer:
    effort: high
    rationale: The review needs to verify read-only resume eligibility,
      backward-compatible sidecar parsing, and Pi/Claude skill parity.
---

# Add Sidecar Compiled-Build Resume Option

## Architecture Context

Recovery sidecars currently expose a verdict for `eforge_apply_recovery`, while compiled-build resume is a separate daemon/client route. This plan keeps that separation: `verdict.verdict` remains `retry | split | abandon | manual`, and sidecars gain optional typed resume eligibility and recovery-option facts that point operators to `eforge_resume_build` when artifacts are eligible.

## Implementation

### Overview

Enrich sidecar generation with read-only compiled-build resume eligibility, render a compiled-build resume section in Markdown, and update Pi/Claude recovery skills to prefer sidecar-provided resume recommendations.

### Key Decisions

1. Keep `schemaVersion: 3` and add optional fields only. Existing sidecars without resume fields remain parseable.
2. Reuse the daemon route semantics: the sidecar recommendation points to `eforge_resume_build` / `/eforge:recover resume`, not `eforge_apply_recovery`.
3. Use `projectResumeEligibility()` for sidecar enrichment. Do not call `checkResumeEligibility()`, `prepareFailedPrdForQueuedCompiledResume()`, or any queue/worktree mutation helper from sidecar generation.
4. When eligibility inspection throws or cannot inspect the branch, convert the failure into bounded ineligible evidence and still write the sidecar.
5. A `manual` verdict can coexist with a resume recommended operator action because the verdict applies only to the apply-recovery route.

## Scope

### In Scope

- Optional typed sidecar fields for read-only resume eligibility and compiled-build resume recovery options.
- JSON and Markdown sidecar rendering for eligible, ineligible, and inspection-failed resume evidence.
- Engine wiring in standalone recovery, inline failed-queue recovery, and failed queued-resume sidecar finalization.
- Manual verdict behavior in `eforge_apply_recovery` with sidecar resume fields.
- Pi and Claude recovery skill instructions, plus the required Claude plugin patch version bump.

### Out of Scope

- Adding `resume` to `RecoveryVerdict`.
- Changing `eforge_apply_recovery` to queue compiled-build resume.
- Weakening the `toolUseCount > 0` guard for blind retry.
- Mutating queue state, materializing artifacts, creating worktrees, or spawning workers during sidecar generation.
- Bumping the Pi package version.

## Files

### Create

- `packages/engine/src/recovery/resume-sidecar.ts` — read-only sidecar resume projection helper that calls `projectResumeEligibility()`, catches/normalizes inspection failures, truncates reasons, and returns the optional sidecar fields consumed by `writeRecoverySidecar()`.

### Modify

- `packages/client/src/routes/recovery.ts` — add optional sidecar types such as `RecoverySidecarResumeEligibility` and `RecoverySidecarRecoveryOption`, and add optional `resumeEligibility` / `recoveryOptions` fields to `RecoveryVerdictSidecar`.
- `packages/client/src/routes.ts`, `packages/client/src/index.ts`, `packages/client/src/browser.ts` — export the new sidecar option types.
- `packages/engine/src/recovery/sidecar.ts` — accept optional resume evidence and pass it to payload rendering.
- `packages/engine/src/recovery/sidecar-payload.ts` — include optional resume eligibility and recovery options in the JSON payload; override `report.recommendedAction` with a compiled-build resume action when eligibility is true.
- `packages/engine/src/recovery/sidecar-markdown.ts` — render a `Compiled-build resume` section with eligibility, source, reason, and `eforge_resume_build` guidance.
- `packages/engine/src/recovery/sidecar-read.ts` — validate and preserve the optional sidecar fields while keeping legacy v3 sidecars accepted.
- `packages/engine/src/prd-queue.ts` — allow `moveFailedWithSidecar()` to receive optional sidecar resume evidence and pass it through without changing existing callers.
- `packages/engine/src/eforge.ts` — compute read-only resume sidecar evidence in standalone recovery and inline failed-queue recovery using bounded edits in this oversized file.
- `packages/engine/src/recovery/failed-resume-sidecar-finalization.ts` — compute and pass read-only resume sidecar evidence for refreshed and degraded failed-resume sidecars.
- `test/recovery-sidecars.test.ts` — add JSON/Markdown sidecar coverage for eligible, ineligible, inspection-failed, analyst throw, analyst timeout, analyst abort, analyst unparsable output, and manual-with-resume cases.
- `test/daemon-recovery-sidecars.test.ts` — add coverage for sidecars written through `moveFailedWithSidecar()` when optional resume evidence is supplied.
- `test/apply-recovery.test.ts` — add a manual verdict sidecar with resume fields and assert `applyRecovery()` returns `noAction: true` with no queue mutation.
- `eforge-plugin/skills/recover/recover.md` — prefer sidecar-provided compiled-build resume recommendations when present, with live eligibility as fallback.
- `packages/pi-eforge/skills/eforge-recover/SKILL.md` — mirror the Claude skill behavior with Pi tool names.
- `eforge-plugin/.claude-plugin/plugin.json` — bump the plugin patch version because plugin skill behavior changes.

## Verification

- [ ] A JSON sidecar built with eligible resume evidence contains `resumeEligibility.eligible === true`.
- [ ] A JSON sidecar built with eligible resume evidence contains a `recoveryOptions` item with `kind: "compiled-build-resume"`, `action: "eforge_resume_build"`, and `recommended: true`.
- [ ] A JSON sidecar that recommends resume keeps `verdict.verdict` within `retry | split | abandon | manual`.
- [ ] A Markdown sidecar with eligible resume evidence contains `Compiled-build resume` and `eforge_resume_build`.
- [ ] A Markdown sidecar with eligible resume evidence states that `eforge_resume_build` is the recommended operator action when the verdict is `manual` due to transient failure plus failed-plan tool use.
- [ ] A sidecar built with ineligible resume evidence includes a non-empty ineligibility reason and has no recommended compiled-build resume option.
- [ ] Sidecar generation writes `.recovery.json` and `.recovery.md` when resume eligibility projection throws.
- [ ] The generated report records a bounded inspection reason when resume eligibility projection throws.
- [ ] The generated report records a bounded ineligibility reason when branch inspection cannot run.
- [ ] A recovery analyst network-style error plus eligible read-only resume evidence still produces a sidecar with the compiled-build resume option.
- [ ] A recovery analyst timeout plus eligible read-only resume evidence produces a sidecar with the compiled-build resume option.
- [ ] A recovery analyst abort plus eligible read-only resume evidence produces a sidecar with the compiled-build resume option.
- [ ] A recovery analyst unparsable output plus eligible read-only resume evidence produces a sidecar with the compiled-build resume option.
- [ ] A recovery analyst network-style error plus ineligible read-only resume evidence produces a manual sidecar with a non-empty ineligibility or inspection reason.
- [ ] `eforge_apply_recovery` returns `noAction: true` for a `manual` sidecar that contains a compiled-build resume recommendation.
- [ ] Sidecar-generation helpers contain no calls to `checkResumeEligibility()` or `prepareFailedPrdForQueuedCompiledResume()`.
- [ ] `packages/pi-eforge/skills/eforge-recover/SKILL.md` and `eforge-plugin/skills/recover/recover.md` tell operators to prefer sidecar-provided resume recommendations and to use live eligibility as fallback.
- [ ] Pi and Claude recovery skill instructions remain behaviorally in sync for `retry`, `split`, `abandon`, `manual`, and compiled-build resume paths.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` has its patch version incremented.
