---
title: Replace Split Recovery with Continue-and-Repair
created: 2026-06-13
---

# Replace Split Recovery with Continue-and-Repair

## Problem / Motivation

Current recovery behavior has overlapping concepts that can disagree:

- `packages/engine/src/recovery/recommendation.ts` can deterministically choose `split` and synthesize `suggestedSuccessorPrd` when preserved work exists.
- `packages/engine/src/prompts/recovery-analyst.md` teaches the analyst to choose `split` and produce a successor PRD.
- `packages/engine/src/recovery/sidecar-payload.ts` can recommend `eforge_resume_build` when compiled artifacts are eligible while still rendering the apply-recovery verdict as `split` / `manual` / etc.
- Compiled-build resume primitives already exist in `packages/engine/src/resume/`, `packages/engine/src/queue/resume-cascade.ts`, and client/daemon routes for resume eligibility and resume-build.
- `split` is part of shared client schemas, queue projections, daemon apply routes, Console recovery UI, CLI/MCP tools, Pi extension skills, Claude plugin skills, docs, and tests.

Operators should see one primary action for eligible preserved-artifact failures: continue the failed build from compiled artifacts and repair pending/failed work.

Cases that require semantic replanning should become explicit manual guidance, not an automatically generated successor PRD.

The roadmap direction is aligned: keep typed recovery inspectable and repeatable while preserving the engine/wrapper-app boundary.

## Goal

Replace automated recovery `split` with a first-class continue-and-repair flow for failed builds that have usable compiled artifacts. Standardize recovery on `continue-repair` and remove generated split successor PRD behavior.

## Approach

### Recovery model

- Recovery verdict/action vocabulary becomes exactly `retry`, `continue-repair`, `abandon`, and `manual`.
- The canonical wire/action literal is `continue-repair`.
- Use `continue-repair` in sidecar verdicts/options, build decisions, queue snapshots, recovery applied metadata, route payloads, and tests.
- Public surface naming derives from the canonical literal.
- Daemon route: `API_ROUTES.continueRepair` at `/api/recover/continue-repair`.
- Client helpers: `apiContinueRepair` and `apiContinueRepairIfRunning`.
- CLI command: `eforge continue-repair <prdId>`.
- MCP/Pi tool identifier: `eforge_continue_repair` where tool identifiers require snake_case.
- Do not keep `/api/recover/resume-build`, `API_ROUTES.resumeBuild`, `apiResumeBuild`, `eforge resume`, or `eforge_resume_build` as compatibility aliases.
- User-facing `continue-repair` labels should be “Continue and repair build” or compact “Continue build”.
- User-facing `retry` label should be “Retry from scratch”.
- User-facing `manual` label should be “Manual review / manual replanning required”.
- Continue-and-repair uses the existing compiled-build resume mechanism internally: preserved feature branch, compiled plan artifacts, seeded merged/completed plan state, and re-run/repair of failed or pending work.
- Deterministic selection should prefer `continue-repair` whenever compiled artifacts are eligible.
- Deterministic selection should choose `retry` only for safe fresh retry cases with no meaningful preserved work/artifacts.
- Deterministic selection should choose `abandon` only with strong evidence.
- Deterministic selection should choose `manual` when artifacts are missing/stale, context is partial, or semantic replanning is required.
- Sidecars should present one primary recommended action.
- For eligible artifacts, the primary sidecar action is continue-and-repair even if the failure evidence would previously have produced `split`.
- Manual replanning guidance should be bounded text in the report/sidecar, not a generated successor PRD.

### Implementation plan

1. Update shared contracts first in `@eforge-build/client`.
2. Update recovery verdict schemas to `retry | continue-repair | abandon | manual`.
3. Update route response types, queue item projections, snapshot/event schemas, recovery applied metadata, and API helpers.
4. Replace `resumeBuild` route/helper exports with `continueRepair` equivalents.
5. Bump `DAEMON_API_VERSION` for the breaking wire change.
6. Update engine recovery selection in `packages/engine/src/recovery/recommendation.ts`, `packages/engine/src/agents/common.ts`, `packages/engine/src/prompts/recovery-analyst.md`, and `packages/engine/src/schemas.ts`.
7. Remove `split` generation.
8. Remove `suggestedSuccessorPrd` generation and validation.
9. Ensure continue-and-repair eligibility is computed early enough for deterministic recommendation, analyst prompt context, and sidecar rendering.
10. Reuse `projectRecoverySidecarResumeEvidence`, `projectResumeEligibility`, and queued compiled resume helpers rather than adding a parallel engine path.
11. Update sidecar JSON, sidecar read logic, and sidecar Markdown rendering.
12. Emit `verdict: "continue-repair"` for eligible compiled artifacts.
13. Replace `eforge_resume_build` recovery options with the new continue-repair action literal/surface.
14. Remove split successor fields from schemas and fixtures.
15. Remove split successor enqueue behavior from `EforgeEngine.applyRecovery`, `packages/engine/src/recovery/apply.ts`, and `prd-queue` recovery-split frontmatter/idempotency paths.
16. Route `continue-repair` to the compiled resume queue path.
17. Preserve idempotent queue behavior.
18. Remove `/api/recover/resume-build` registration.
19. Add `/api/recover/continue-repair` through route constants in `@eforge-build/client`.
20. Do not inline `/api/...` literals.
21. Do not register a compatibility alias.
22. Update Console recovery chips, report panel, completion panel, Now attention selectors, dialogs, stories, and tests.
23. Ensure eligible failed Console items prompt continue-and-repair rather than split successor enqueue or resume-build.
24. Remove `eforge resume` and `eforge_resume_build` from CLI/MCP, Claude plugin, and Pi extension.
25. Add continue-repair equivalents to CLI/MCP, Claude plugin, and Pi extension.
26. Rename user-facing command/help text.
27. Keep Pi and Claude integration packages in sync.
28. Bump `eforge-plugin/.claude-plugin/plugin.json` if plugin files change.
29. Update recovery docs, skills, and generated references.
30. Regenerate reference docs so no active public surface documents split recovery or resume-build.
31. Update contract, route, engine, Console, integration parity, docs, and grep-style tests around the new literal and removed aliases.
32. Use bounded exact edits for oversized legacy files.
33. Keep route constants and wire shapes owned by `@eforge-build/client`.

### Code impact

High-probability client contract touch points:

- `packages/client/src/events/shared/schemas.ts`
- `packages/client/src/events/snapshots.ts`
- `packages/client/src/events/decisions.ts`
- `packages/client/src/events/variants/validation-recovery.ts`
- `packages/client/src/routes/recovery.ts`
- `packages/client/src/routes/route-map.ts`
- `packages/client/src/types.ts`
- `packages/client/src/api-version-const.ts`
- API helper currently under `packages/client/src/api/resume-build.ts`

High-probability engine touch points:

- `packages/engine/src/recovery/recommendation.ts`
- `packages/engine/src/recovery/sidecar-payload.ts`
- `packages/engine/src/recovery/resume-sidecar.ts`
- `packages/engine/src/recovery/sidecar-read.ts`
- `packages/engine/src/recovery/sidecar-markdown.ts`
- `packages/engine/src/recovery/apply.ts`
- `packages/engine/src/recovery/failed-resume-sidecar-finalization.ts`
- `packages/engine/src/agents/recovery-analyst.ts`
- `packages/engine/src/agents/common.ts`
- `packages/engine/src/prompts/recovery-analyst.md`
- `packages/engine/src/schemas.ts`
- `packages/engine/src/eforge.ts`
- `packages/engine/src/prd-queue.ts`
- Compiled resume internals under `packages/engine/src/resume/`
- Compiled resume internals under `packages/engine/src/queue/resume-cascade.ts`

High-probability daemon/monitor touch points:

- `packages/monitor/src/routes/recovery.ts`
- Queue projections
- Route registration
- Daemon stream snapshot tests

High-probability Console touch points:

- `packages/console-ui/src/components/recovery/*`
- `packages/console-ui/src/components/now/*`
- `packages/console-ui/src/lib/selectors/now.ts`
- Recovery stories/tests
- Copy that currently says split or resume-build

High-probability CLI/MCP touch points:

- `packages/eforge/src/cli/index.ts`
- `packages/eforge/src/cli/mcp-proxy.ts`
- CLI help/reference generation
- Tests currently named around resume-build

High-probability integrations/docs touch points:

- `packages/pi-eforge/`
- `eforge-plugin/`
- `docs/`
- `web/content/reference/*`
- Generated `web/public/reference/*`
- Recover skills
- Tests/fixtures mentioning `eforge_resume_build`, `/api/recover/resume-build`, or recovery `split`

### Compatibility policy

- This is an intentional breaking daemon API change.
- Bump `DAEMON_API_VERSION`.
- Rely on client/daemon version checks to fail fast for stale clients.
- New sidecars must never generate `verdict: "split"`.
- New sidecars must never generate `suggestedSuccessorPrd`.
- New sidecars must never generate `recoveryOptions.action: "eforge_resume_build"`.
- Do not retain `/api/recover/resume-build` as a deprecated alias.
- Do not retain `API_ROUTES.resumeBuild` as a deprecated alias.
- Do not retain `apiResumeBuild` as a deprecated alias.
- Do not retain `eforge resume` as a deprecated alias.
- Do not retain `eforge_resume_build` as a deprecated alias.
- Do not add legacy split-sidecar UX.
- Do not add hidden notices solely for old sidecars.
- Do not add manual fallback rendering solely for old sidecars.
- Update or delete old fixtures and docs as greenfield artifacts.
- Internal queue frontmatter such as `resume_mode: compiled` may remain only if intentionally private.
- Private internal queue frontmatter must not be exposed in operator flows, sidecar contracts, generated docs, or integration skills.
- Stale local sidecars or generated references that still mention split/resume-build should be regenerated or replaced during implementation, not supported as compatibility inputs.

### Design decisions and assumptions

- The canonical action literal is `continue-repair`.
- The project already uses hyphenated daemon route paths and hyphenated wire/action literals for comparable concepts.
- TypeScript identifiers may remain camelCase.
- Tool adapter names may use snake_case only where required by the host.
- The old `eforge_resume_build` tool/route should be removed immediately.
- The daemon API version bump guards the breaking change instead of a one-release alias.
- Recovery sidecars are treated as greenfield for this refactor.
- Existing split fixtures/docs should be updated or deleted.
- No legacy split-sidecar rendering, hiding, or compatibility alias behavior is required.
- Compiled resume internals may be reused to implement continue-and-repair.
- Public copy and wire contracts should say continue/repair rather than resume.
- Open questions: none.

### Risks

- Shared wire changes are broad and require a daemon API version bump to avoid stale client/daemon drift.
- Removing old route/tool aliases immediately will break stale external clients by design.
- Version checks, generated docs, and synchronized Pi/Claude/CLI updates mitigate stale external client breakage.
- Naming can drift because wire literals are hyphenated while TypeScript keys are camelCase and MCP/Pi tool identifiers are snake_case.
- Shared constants and contract tests around `continue-repair` mitigate naming drift.
- A mechanical grep replacement for `split` would damage unrelated concepts.
- Recovery verdict/action/successor behavior must be filtered separately from unrelated split concepts.
- Continue-and-repair must remain idempotent.
- Continue-and-repair must respect existing queue controls, pause/hold behavior, dependencies, and profile routing.
- Prompt/schema mismatch can silently push analysts back toward old split semantics.
- Prompt, parser, schema YAML, and invariant validation should be updated together.
- Docs/reference generation may preserve old resume-build text unless generated artifacts and source docs are updated in the same change.

## Scope

### In scope

- Remove `split` as a generated recovery path.
- Remove `split` as a surfaced recovery path.
- Remove `split` as an applyable recovery path.
- Standardize the canonical recovery action/verdict wire literal on `continue-repair`.
- Remove generated `suggestedSuccessorPrd`.
- Remove split successor enqueue/apply behavior rather than deprecating it.
- Make compiled-artifact continue/repair the primary recovery option when eligibility passes.
- Remove the public `eforge_resume_build` tool immediately.
- Remove the `/api/recover/resume-build` route immediately.
- Remove the `resumeBuild` client helper surface immediately.
- Bump the daemon API version for the breaking change.
- Replace public surfaces with continue/repair naming.
- Update deterministic recovery selection.
- Update analyst prompt semantics.
- Update sidecar JSON.
- Update sidecar Markdown.
- Update daemon/client route contracts.
- Update events.
- Update queue projections.
- Update Console UX.
- Update CLI/MCP.
- Update Pi extension.
- Update Claude plugin.
- Update docs.
- Update tests.
- Treat this as greenfield for recovery sidecars.
- Update or delete split/resume fixtures and docs instead of adding legacy rendering paths.

### Out of scope

- Broadly renaming unrelated uses of “split” such as plan-set decomposition.
- Broadly renaming unrelated uses of “split” such as evaluator issue outcome `split_to_followup`.
- Adding an auto-resume scheduler policy.
- Changing autonomous retry policy.
- Building a semantic PRD authoring workflow inside recovery.
- Renaming private engine implementation modules that still use “resume” internally, provided those names do not leak into wire contracts, docs, tools, or operator-facing copy.

## Acceptance Criteria

- Recovery verdict/action vocabulary is exactly `retry`, `continue-repair`, `abandon`, and `manual`.
- Recovery schemas accept `continue-repair` as a recovery verdict/action.
- Recovery schemas reject `split` as a recovery verdict/action.
- `split` is no longer generated as a recovery path.
- `split` is no longer surfaced as a recovery path.
- `split` is no longer applyable as a recovery path.
- `continue-repair` is the canonical hyphenated wire/action literal across client schemas.
- `continue-repair` is the canonical hyphenated wire/action literal across events.
- `continue-repair` is the canonical hyphenated wire/action literal across sidecars.
- `continue-repair` is the canonical hyphenated wire/action literal across daemon routes.
- `continue-repair` is the canonical hyphenated wire/action literal across queue projections.
- `continue-repair` is the canonical hyphenated wire/action literal across engine logic.
- `continue-repair` is the canonical hyphenated wire/action literal across Console UI.
- `continue-repair` is the canonical hyphenated wire/action literal across CLI/MCP.
- `continue-repair` is the canonical hyphenated wire/action literal across Pi integration.
- `continue-repair` is the canonical hyphenated wire/action literal across Claude plugin integration.
- `continue-repair` is the canonical hyphenated wire/action literal across docs.
- `continue-repair` is the canonical hyphenated wire/action literal across tests.
- `suggestedSuccessorPrd` is removed from generated recovery sidecars.
- `suggestedSuccessorPrd` is removed from recovery validation schemas.
- Split successor enqueue behavior is removed.
- Split successor apply behavior is removed.
- Eligible preserved-artifact failures present exactly one primary action.
- Eligible preserved-artifact failures use continue/repair from compiled artifacts as the primary action.
- Sidecars for eligible compiled artifacts emit `verdict: "continue-repair"`.
- Sidecars for eligible compiled artifacts do not emit `verdict: "split"`.
- Sidecars for eligible compiled artifacts do not emit `recoveryOptions.action: "eforge_resume_build"`.
- Manual replanning guidance appears as bounded text in the report/sidecar.
- Manual replanning guidance is not emitted as a generated successor PRD.
- `API_ROUTES.continueRepair` exists.
- `API_ROUTES.continueRepair` maps to `/api/recover/continue-repair`.
- `/api/recover/continue-repair` is registered through route constants in `@eforge-build/client`.
- `/api/recover/continue-repair` queues the compiled resume path.
- `/api/recover/continue-repair` preserves idempotent already-queued behavior.
- `/api/recover/continue-repair` returns eligibility failures for ineligible builds.
- `/api/recover/resume-build` is not registered as a daemon route.
- `/api/recover/resume-build` is not registered as a compatibility alias.
- `API_ROUTES.resumeBuild` is not exported as an active public route constant.
- `apiResumeBuild` is not exported as an active public client helper.
- `apiContinueRepair` is exported as the public client helper.
- `apiContinueRepairIfRunning` is exported as the public client helper.
- `eforge continue-repair <prdId>` is registered as the CLI command.
- `eforge resume` is not registered as a CLI command.
- `eforge_resume_build` is not registered as an active public MCP/Pi/Claude plugin tool.
- `eforge_continue_repair` is registered where MCP/Pi tool identifiers require snake_case.
- User-facing recovery copy uses “Continue and repair build” or “Continue build” for `continue-repair`.
- User-facing recovery copy uses “Retry from scratch” for `retry`.
- User-facing recovery copy uses “Manual review / manual replanning required” for `manual`.
- User-facing recovery copy does not use ambiguous “resume” terminology for the public continue-and-repair action.
- Private implementation names containing “resume” do not leak into wire contracts.
- Private implementation names containing “resume” do not leak into generated docs.
- Private implementation names containing “resume” do not leak into integration skills.
- Private implementation names containing “resume” do not leak into operator-facing copy.
- Deterministic recommendation logic chooses `continue-repair` when compiled artifacts are eligible.
- Deterministic recommendation logic chooses `retry` only for safe fresh retry cases with no meaningful preserved work/artifacts.
- Deterministic recommendation logic chooses `abandon` only for cases with strong evidence.
- Deterministic recommendation logic chooses `manual` when artifacts are missing.
- Deterministic recommendation logic chooses `manual` when artifacts are stale.
- Deterministic recommendation logic chooses `manual` when context is partial.
- Deterministic recommendation logic chooses `manual` when semantic replanning is required.
- The recovery analyst prompt no longer instructs analysts to choose `split`.
- The recovery analyst prompt no longer instructs analysts to produce successor PRDs.
- The recovery analyst parser accepts `continue-repair`.
- The recovery analyst parser rejects recovery `split`.
- The recovery schema YAML accepts `continue-repair`.
- The recovery schema YAML rejects recovery `split`.
- Invariant validation accepts `continue-repair`.
- Invariant validation rejects recovery `split`.
- Continue-and-repair reuses the existing compiled-build resume mechanism internally.
- Continue-and-repair preserves the feature branch when using compiled artifacts.
- Continue-and-repair uses compiled plan artifacts when eligible.
- Continue-and-repair seeds merged/completed plan state from compiled artifacts.
- Continue-and-repair re-runs or repairs failed work.
- Continue-and-repair re-runs or repairs pending work.
- Continue-and-repair respects existing queue controls.
- Continue-and-repair respects pause/hold behavior.
- Continue-and-repair respects dependencies.
- Continue-and-repair respects profile routing.
- No auto-resume scheduler policy is added.
- No semantic PRD authoring workflow is added inside recovery.
- No legacy split-sidecar UI path is introduced.
- No hidden legacy split-sidecar notice path is introduced.
- No legacy split-sidecar manual fallback rendering path is introduced.
- Split/resume fixtures are updated or deleted as greenfield artifacts.
- Recovery docs no longer describe split recovery as an active public recovery action.
- Recovery docs no longer describe resume-build as an active public recovery action.
- Generated references no longer describe split recovery as an active public recovery action.
- Generated references no longer describe resume-build as an active public recovery action.
- Pi extension recover skills expose the continue-and-repair flow.
- Claude plugin recover skills expose the continue-and-repair flow.
- Pi extension and Claude plugin recover skills remain synchronized for this recovery flow.
- `eforge-plugin/.claude-plugin/plugin.json` version is bumped when plugin files change.
- `DAEMON_API_VERSION` is bumped for the breaking daemon API change.
- Route registration does not inline `/api/...` literals outside shared route constants.
- Daemon wire shapes remain owned by `@eforge-build/client`.
- `recovery-verdict-schema` tests assert `continue-repair`.
- `recovery-verdict-schema` tests assert recovery `split` is rejected.
- `recovery-recommendation` tests assert eligible compiled artifacts produce `continue-repair`.
- `recovery-sidecars` tests assert no generated `split` verdict.
- `recovery-sidecars` tests assert no generated `suggestedSuccessorPrd`.
- `recovery-analyst` tests assert the analyst flow uses `continue-repair`.
- `apply-recovery` tests assert split successor apply behavior is unavailable.
- `daemon-recovery-*` tests assert continue-and-repair route behavior.
- Existing `resume-build-*` tests are renamed or updated so public assertions use continue-repair naming.
- Existing `queued-compiled-resume-*` tests are renamed or updated so public assertions use continue-repair naming.
- Existing `resume-eligibility-*` tests are renamed or updated so public assertions use continue-repair naming.
- Existing `auto-build-resume-after-failure` tests are renamed or updated so public assertions use continue-repair naming.
- Internal compiled-resume mechanics remain covered by tests.
- Route/API tests assert `/api/recover/continue-repair` exists through `API_ROUTES`.
- Route/API tests assert `/api/recover/continue-repair` queues the compiled resume path.
- Route/API tests assert `/api/recover/resume-build` is not registered as an alias.
- Console recovery dialog tests no longer assert split prompts.
- Console recovery report tests no longer assert split prompts.
- Console recovery chip tests no longer assert split prompts.
- Console Now selector tests no longer assert resume-build wording.
- Integration source-level tests assert the new continue-repair tool/copy.
- Integration source-level tests assert `eforge_resume_build` is not registered as an active tool.
- Active public occurrences of `eforge_resume_build` are absent.
- Active public occurrences of `/api/recover/resume-build` are absent.
- Active public occurrences of `suggestedSuccessorPrd` are absent.
- Active public recovery-action occurrences of `verdict: "split"` are absent.
- Unrelated split concepts such as plan-set decomposition are excluded from recovery-action grep failures.
- Unrelated split concepts such as evaluator issue outcome `split_to_followup` are excluded from recovery-action grep failures.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- `pnpm docs:check` exits 0.
- `pnpm maintainability:check` exits 0.