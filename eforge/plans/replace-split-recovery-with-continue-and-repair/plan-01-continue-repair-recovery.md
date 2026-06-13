---
id: plan-01-continue-repair-recovery
name: Continue-and-Repair Recovery Refactor
branch: replace-split-recovery-with-continue-and-repair/plan-01-continue-repair-recovery
agents:
  builder:
    effort: xhigh
    rationale: Large breaking recovery refactor spanning shared client contracts,
      engine recovery semantics, daemon routes, Console UI, CLI/MCP, Pi/Claude
      integrations, docs, generated references, and tests.
    shards:
      - id: client-monitor
        roots:
          - packages/client/
          - packages/monitor/
      - id: engine
        roots:
          - packages/engine/
      - id: cli-integrations
        roots:
          - packages/eforge/
          - packages/pi-eforge/
          - eforge-plugin/
      - id: console
        roots:
          - packages/console-ui/
      - id: tests-docs
        roots:
          - test/
          - docs/
          - web/
  reviewer:
    effort: high
    rationale: Public wire-contract and user-facing integration changes need
      cross-surface review.
  tester:
    effort: high
    rationale: The refactor requires contract, route, engine, Console, integration
      parity, docs, and grep-style validation.
---

# Continue-and-Repair Recovery Refactor

## Architecture Context

Recovery wire contracts are owned by `@eforge-build/client`; route constants, event schemas, daemon response types, browser helpers, and generated references must derive from that shared surface. The engine already has compiled-build resume internals under `packages/engine/src/resume/` and queue transitions under `packages/engine/src/queue/resume-cascade.ts`; those internals may retain private `resume` names and `resume_mode: compiled` frontmatter, but public routes, sidecars, commands, tools, docs, and operator-facing copy must use `continue-repair` / “Continue and repair build”.

This is an intentional breaking daemon API change. Increment `DAEMON_API_VERSION` from the current value and do not register compatibility aliases for `/api/recover/resume-build`, `API_ROUTES.resumeBuild`, `apiResumeBuild`, `eforge resume`, or `eforge_resume_build`.

Use bounded exact edits for oversized legacy files, especially `packages/engine/src/eforge.ts`, `packages/eforge/src/cli/index.ts`, `packages/pi-eforge/extensions/eforge/index.ts`, and large root test files.

## Implementation

### Overview

Replace the recovery verdict/action vocabulary with exactly `retry`, `continue-repair`, `abandon`, and `manual`. Continue-and-repair must reuse the existing compiled-artifact queue path, surface one primary action for eligible preserved-artifact failures, remove generated split successor PRDs, and synchronize every public integration and reference artifact.

### Key Decisions

1. The canonical wire/action literal is `continue-repair`; TypeScript identifiers use `continueRepair`, and host tool identifiers use `eforge_continue_repair` where snake_case is required.
2. Public “resume-build” surfaces are removed, not aliased. Existing compiled-resume implementation modules and private `resume_mode: compiled` queue frontmatter may remain because they are internal mechanics.
3. Sidecars are greenfield for this refactor: no legacy split rendering, hidden notices, compatibility parsing, or successor PRD fallback paths.
4. The new daemon route `API_ROUTES.continueRepair` at `/api/recover/continue-repair` delegates to the compiled resume queue mechanism and preserves existing `queued` / `already-queued` idempotency.
5. If a read-only preflight endpoint remains for Console, rename its public route/types/helpers to continue-repair terminology, for example `API_ROUTES.continueRepairEligibility` at `/api/recover/continue-repair/eligibility`; otherwise derive eligibility from the sidecar and the mutating route’s 409 response. Do not leave public `resumeEligibility` wire names.

## Scope

### In Scope

- Replace recovery verdict/action schemas with `retry | continue-repair | abandon | manual`.
- Remove `split` as generated, surfaced, or applyable recovery behavior.
- Remove `suggestedSuccessorPrd` from schemas, parser output, sidecars, Markdown, fixtures, and tests.
- Make deterministic recovery select `continue-repair` whenever compiled artifacts are eligible.
- Compute continue-and-repair eligibility before deterministic recommendation, analyst prompt construction, and sidecar rendering.
- Remove split successor enqueue/idempotency/frontmatter paths from engine apply logic and PRD queue parsing.
- Add `continueRepair` daemon route/client/browser helpers/CLI command/MCP/Pi/Claude tool names.
- Update Console recovery UX so eligible failed items show one primary continue-and-repair action.
- Update Pi and Claude recover skills in sync; bump `eforge-plugin/.claude-plugin/plugin.json`.
- Update docs and regenerate references/schemas so active public surfaces no longer document split recovery or resume-build.
- Update route, contract, engine, Console, integration, docs, and grep-style tests.

### Out of Scope

- Renaming unrelated “split” concepts such as plan-set decomposition or evaluator `split_to_followup` issue outcomes.
- Adding an auto-resume scheduler policy.
- Building semantic PRD authoring inside recovery.
- Renaming private compiled-resume implementation modules when their names do not leak into public wire contracts, generated docs, skills, or operator-facing copy.

## Files

### Create / Rename

- `packages/client/src/api/continue-repair.ts` — replace the public `resume-build` API helper with `apiContinueRepair` and `apiContinueRepairIfRunning`.
- `test/continue-repair-route.test.ts` — rename/update `test/resume-build-route.test.ts` so public route assertions use `/api/recover/continue-repair`.
- `test/continue-repair-cli-mcp.test.ts` — rename/update `test/resume-build-cli-mcp.test.ts` so CLI/MCP assertions use `continue-repair` and `eforge_continue_repair`.
- `test/continue-repair-public-surface.test.ts` — source-level guard for removed public aliases and greenfield sidecar fields.

### Modify — Client Contracts (`packages/client/`)

- `packages/client/src/events/shared/schemas.ts` — change `RecoveryVerdictSchema` to `retry | continue-repair | abandon | manual`; remove `suggestedSuccessorPrd`; keep unrelated `split_to_followup` untouched.
- `packages/client/src/events/snapshots.ts` — update queue recovery verdict/applied schemas for `continue-repair`; remove split applied metadata requiring `successorPrdId`.
- `packages/client/src/events/decisions.ts` — update `recovery-verdict` build decision schema to include `continue-repair` and exclude `split`.
- `packages/client/src/events/variants/validation-recovery.ts` — update `recovery:apply:complete` verdict union and remove successor-only split semantics.
- `packages/client/src/routes/recovery.ts` — replace `ResumeBuildRequest/Response` with `ContinueRepairRequest/Response`; rename sidecar resume fields to continue-repair terminology; set recovery option kind/action to canonical `continue-repair`; update `ApplyRecoveryResponse` verdict union and durable applied metadata.
- `packages/client/src/routes/route-map.ts` — remove `resumeBuild`; add `continueRepair: '/api/recover/continue-repair'`; rename/remove public eligibility route names if retained; never inline route literals outside this map.
- `packages/client/src/routes.ts`, `packages/client/src/index.ts`, `packages/client/src/browser.ts`, `packages/client/src/types.ts` — export continue-repair types/helpers and remove public resume-build exports.
- `packages/client/src/browser-recovery.ts` — replace `startResumeBuild` with `startContinueRepair`; update any public preflight helper naming if retained.
- `packages/client/src/api-version-const.ts` — bump `DAEMON_API_VERSION` by one and add a comment describing the breaking continue-repair wire change.
- `packages/client/src/__tests__/*recovery*`, `events-schemas-*`, and route/browser helper tests — update schema validation, snapshots, and helper assertions for `continue-repair` and removed aliases.

### Modify — Engine Recovery (`packages/engine/`)

- `packages/engine/src/recovery/recommendation.ts` — accept continue-repair eligibility in deterministic selection; return `continue-repair` when eligible artifacts exist; remove split recommendation and successor PRD synthesis; validate analyst verdicts without split successor invariants; preserve manual fallback for partial/stale/missing context.
- `packages/engine/src/agents/recovery-analyst.ts` — pass precomputed deterministic recommendation and continue-repair eligibility context into the prompt instead of recomputing without eligibility.
- `packages/engine/src/agents/common.ts` — parse only `retry`, `continue-repair`, `abandon`, `manual`; stop extracting `suggestedSuccessorPrd`.
- `packages/engine/src/prompts/recovery-analyst.md` — remove split/successor instructions; teach continue-repair semantics, retry-from-scratch semantics, and bounded manual replanning guidance.
- `packages/engine/src/schemas.ts` — update recovery verdict schema/YAML and apply result types; remove `suggestedSuccessorPrd`.
- `packages/engine/src/recovery/resume-sidecar.ts` — keep using `projectResumeEligibility` internally but emit `continueRepairEligibility` and `recoveryOptions` with canonical `continue-repair` public values.
- `packages/engine/src/recovery/sidecar-payload.ts` — produce `verdict: 'continue-repair'` and one primary recommended action for eligible artifacts; labels: “Continue and repair build” / compact “Continue build”, “Retry from scratch”, and “Manual review / manual replanning required”.
- `packages/engine/src/recovery/sidecar-read.ts` — validate the greenfield sidecar contract, rejecting split verdicts, `suggestedSuccessorPrd`, and old `eforge_resume_build` options.
- `packages/engine/src/recovery/sidecar-markdown.ts` — render continue-repair eligibility and manual guidance; remove “Suggested Successor PRD” and resume-build instructions.
- `packages/engine/src/recovery/apply.ts` — delete split successor normalization, acceptance-inventory extraction, idempotency scan, and enqueue behavior; add/route continue-repair application through the compiled resume queue helper when applying a `continue-repair` sidecar verdict.
- `packages/engine/src/recovery/applied-sidecar.ts` — parse/write `continue-repair` applied markers; remove split successor marker validation.
- `packages/engine/src/eforge.ts` — compute continue-repair evidence before deterministic recommendation in inline and manual recovery flows; pass it to the analyst; remove split case from apply dispatch; delegate continue-repair to the compiled resume queue path; emit decisions/events with `continue-repair`.
- `packages/engine/src/prd-queue.ts` — remove public split continuation frontmatter (`recovery_from`, `recovery_set_name`, `recovery_feature_branch`, `recovery_base_branch`, `recovery_split_source`) and helper parsing; retain private compiled-resume frontmatter.
- `packages/engine/src/recovery/continuation.ts` — delete when unused after split removal, or leave unexported only if no public/tests reference it.
- `packages/engine/src/recovery/failed-resume-sidecar-finalization.ts` — update degraded manual text to mention continue-repair instead of split/resume public actions.
- `packages/engine/src/queue/build-single-prd.ts` and `packages/engine/src/resume/*` — keep internal compiled-resume mechanics, but prevent public copy/route/tool names from leaking.

### Modify — Daemon / Monitor (`packages/monitor/`)

- `packages/monitor/src/routes/resume.ts` and `packages/monitor/src/routes/resume-service.ts` — rename public route/service to continue-repair, use `API_ROUTES.continueRepair`, return `ContinueRepairResponse`, preserve `already-queued`, profile validation, moved descendant behavior, and 409 eligibility failures.
- `packages/monitor/src/routes/control-monitor.ts` and route registration tests — replace `resumeBuild` route key with `continueRepair`; remove `/api/recover/resume-build` registration.
- `packages/monitor/src/routes/recovery.ts` — update apply-recovery dispatch for verdict vocabulary and no split successor path.
- `packages/monitor/src/routes/recovery-sidecar-service.ts` and `packages/monitor/src/projections/queue-items.ts` — parse/project greenfield sidecars and `continue-repair` applied metadata.
- `packages/monitor/src/__tests__/routes-recovery.test.ts`, `routes-control-registration.test.ts`, `projections-queue-items.test.ts`, `stream-hello-parity.test.ts` — update route keys, queue snapshots, and sidecar fixtures.

### Modify — CLI, MCP, Pi, Claude Plugin

- `packages/eforge/src/cli/index.ts` — remove `eforge resume`; add `eforge continue-repair <prdId>` with `--set-name`, `--profile`, `--cwd`, and verbose metadata; user copy must say “Continue and repair build” / “Continue build” and not “resume”.
- `packages/eforge/src/cli/mcp-proxy.ts` — remove `eforge_resume_build`; add `eforge_continue_repair`; update `eforge_apply_recovery` description to no longer mention split successor enqueue.
- `packages/pi-eforge/extensions/eforge/index.ts` — remove `eforge_resume_build`; add `eforge_continue_repair`; import/use continue-repair request/route types; update labels and descriptions.
- `packages/pi-eforge/skills/eforge-recover/SKILL.md` and `eforge-plugin/skills/recover/recover.md` — synchronize workflow text around `continue-repair`, no split, no successor PRD, and explicit manual replanning guidance.
- `eforge-plugin/.claude-plugin/plugin.json` — bump the plugin version because plugin files change.
- `packages/pi-eforge/package.json` — do not bump the Pi package version.

### Modify — Console UI (`packages/console-ui/`)

- `packages/console-ui/src/components/recovery/verdict-chip.tsx` — verdict value list and styling for `continue-repair`; reject `split`.
- `packages/console-ui/src/components/now/queue-recovery-dialog.tsx` — replace resume action state/helper with continue-repair; show exactly one primary action for eligible artifacts; use sidecar eligibility and route failures.
- `packages/console-ui/src/components/recovery/recovery-report-panel.tsx` — remove split successor action; add continue-repair action copy; retry label “Retry from scratch”; manual label “Manual review / manual replanning required”.
- `packages/console-ui/src/components/recovery/recovery-completion-panel.tsx` — replace resume/split completion text with continue-repair and applied-marker display.
- `packages/console-ui/src/lib/selectors/now.ts`, `components/now/*`, `components/timeline/*`, recovery stories/tests — update chips, attention copy, completion panels, report panel stories, and Now selector expectations.
- `packages/console-ui/README.md` — update the recovery dialog behavior description.

### Modify — Docs, Generated References, and Root Tests

- `docs/architecture.md`, `docs/roadmap.md`, `web/content/docs/glossary.md`, `web/content/docs/troubleshooting.md` — remove active split recovery and resume-build guidance; describe continue-and-repair from compiled artifacts and bounded manual replanning guidance.
- `web/content/reference/*`, `web/public/reference/*`, `web/public/docs/*`, `web/public/schemas/events.schema.json`, `web/public/llms*.txt` — regenerate via `pnpm docs:generate` after code and docs source updates.
- `test/recovery-verdict-schema.test.ts` — assert schema/parser accepts `continue-repair`, rejects recovery `split`, and has no `suggestedSuccessorPrd`.
- `test/recovery-recommendation.test.ts` — assert eligible artifacts produce deterministic `continue-repair`; update manual/retry/abandon cases.
- `test/recovery-sidecars.test.ts`, `test/daemon-recovery-sidecars.test.ts`, `test/recovery-sidecar-analyst-network-fallback.test.ts` — assert generated sidecars use continue-repair, contain no split verdicts, contain no `suggestedSuccessorPrd`, and contain no `eforge_resume_build` option.
- `test/recovery-analyst-wiring.test.ts`, `test/recovery-engine.test.ts`, `test/daemon-recovery-engine-fallback.test.ts` — update analyst prompt/schema/output expectations.
- `test/apply-recovery.test.ts`, `test/apply-recovery-route.test.ts` — remove split successor apply assertions; assert split sidecars are invalid/unavailable and continue-repair delegates to compiled queue behavior.
- `test/resume-eligibility-route.test.ts`, `test/resume-compiled-build-engine.test.ts`, queued compiled resume tests, and auto-build resume tests — retain internal compiled-resume coverage while changing public route/tool/copy assertions to continue-repair naming.
- `test/browser-recovery-helpers.test.ts`, `test/decisions.test.ts`, `test/recovery-helpers.ts`, and integration source-level tests — update helper names, decision literals, and public surface guards.

## Verification

- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm docs:check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `API_ROUTES.continueRepair` equals `/api/recover/continue-repair`, and no registered route handles `/api/recover/resume-build`.
- [ ] `apiContinueRepair` and `apiContinueRepairIfRunning` are exported; `apiResumeBuild` and `API_ROUTES.resumeBuild` are not exported.
- [ ] `eforge continue-repair <prdId>` is in CLI help; `eforge resume` is absent from CLI help.
- [ ] MCP/Pi/Claude tools expose `eforge_continue_repair`; source-level tests find no active `eforge_resume_build` registration.
- [ ] Recovery schema tests accept `continue-repair` and reject recovery `split`.
- [ ] Generated recovery sidecars for eligible compiled artifacts contain `verdict: "continue-repair"`, no `verdict: "split"`, no `suggestedSuccessorPrd`, and no `recoveryOptions.action: "eforge_resume_build"`.
- [ ] Console recovery dialog tests show one primary “Continue and repair build” / “Continue build” action for eligible artifacts and no split successor prompt.
- [ ] Grep-style tests exclude unrelated plan decomposition and evaluator `split_to_followup`, while failing on active public recovery `split`, `/api/recover/resume-build`, `eforge_resume_build`, and `suggestedSuccessorPrd` occurrences.
