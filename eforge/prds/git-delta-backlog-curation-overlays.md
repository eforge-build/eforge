---
title: Git-Delta Backlog Curation Overlays
created: 2026-06-18
---

# Git-Delta Backlog Curation Overlays

## Problem / Motivation

The analyze-all backlog curation flow is not trustworthy enough for dogfooding because it can recommend stale work after backlog mutations and does not explicitly reason from commits landed since the last accepted analysis pass.

The observed failure mode was that completed fast UX bugfix items stayed in the saved recommendation model. After manual status updates, a new curation run analyzed the current open snapshot but did not explain newly completed work, and stale submitted plan traces made work appear planned/active even though the Plans UI showed no active plans.

## Goal

When curation starts, it should identify the previous accepted curation/recommendation baseline, inspect git history from that baseline to `HEAD`, map new commits to affected backlog records, propose safe backlog updates or shipped/superseded closures when evidence is durable, and generate recommendations as if the proposed curation draft had already been accepted.

## Approach

- Add an explicit git-delta section to analyze-all curation source/output with baseline commit/time/source, current `HEAD`, scanned commits, caps, and diagnostics for missing, unreachable, shallow, and no-git baselines.
- Store analysis-baseline metadata in private eforge-plan storage with schema versioning.
- Do not encode analysis-baseline metadata in backlog item bodies or legacy recommendation files.
- Treat baseline absence as a safe fallback rather than success.
- When baseline coverage is incomplete, scan bounded recent history, emit diagnostics, and phrase curation as incomplete delta coverage.
- Match commits to existing backlog items using item ids, slugs/titles, changed paths, branch/PR metadata, merge subjects, and bounded evidence excerpts.
- Prefer deterministic commit matching and evidence ranking before the agent prompt.
- The agent receives explicit matched candidates and must not invent shipped evidence.
- Extend shipped/affected evidence classification so strong evidence can drive item patches.
- Route ambiguous evidence to skipped/needs-input rather than status changes.
- Strong git/PR/lifecycle evidence can produce shipped/superseded item changes only with required evidence prefixes.
- Make recommendations overlay-first by applying draft item/epic changes to an in-memory prospective backlog state before generated recommendations are previewed, validated, or written.
- Keep recommendation overlay pure and shared.
- Preview, apply, and any UI projection should call the same helper so the user sees exactly what apply will validate/write.
- Do not mutate task results just to overlay recommendations.
- Preserve raw generated output when useful, but expose an effective/prospective projection for preview/apply.
- Fix trace summarization used by curation so active editable plans, submitted/historical plans, stale trace rows, queued PRDs, build runs, PRs, and landed results are distinguishable.
- Keep lifecycle traces historical by default.
- A submitted plan trace without a current editable plan or live queue/run signal is not active work.
- Make stale recommendation freshness visible immediately after backlog mutation.
- Never label stale snapshots as fresh.
- Preserve existing safety rules: evidence sections are append-only, curation applies are explicit/two-step, curation-only apply remains available, and all writes stay private-extension-storage scoped.
- Keep this work inside the eforge-plan extension and shared client/schema surfaces as needed.
- The engine should continue to run daemon-owned planning tasks and validate output contracts.
- Source assembly, backlog curation semantics, recommendation freshness, and preview/apply behavior remain extension-owned.
- PR enrichment via `gh` can improve evidence but must never be required.
- No broad GitHub dependency should be introduced.
- Existing recommendation freshness remains useful but is not sufficient by itself to define git-delta coverage unless the accepted pass recorded a git baseline.

### Primary implementation areas

- `eforge/extensions/eforge-plan/backlog-curation-source.ts` and `backlog-curation-source-provider.ts`: add git-delta baseline lookup, commit projection, diagnostics, and source fingerprint coverage.
- A new focused helper module such as `backlog-curation-git-delta.ts`: baseline sidecar read/write, `HEAD`/baseline resolution, bounded `git log`/changed-path collection, and fallback diagnostics.
- `eforge/extensions/eforge-plan/shipped-evidence-git.ts`, `shipped-evidence.ts`, and `shipped-evidence-matching.ts`: accept baseline/range limits and expose affected-item evidence without weakening shipped-evidence confidence rules.
- `eforge/extensions/eforge-plan/backlog-curation-apply.ts` and `backlog-curation-recommendation-overlay.ts`: build one prospective backlog projection and use it for preview and apply validation.
- `eforge/extensions/eforge-plan/recommendation-status.ts` or a new baseline/status module: persist last accepted analysis baseline separately from, or carefully alongside, recommendation freshness status.
- `eforge/extensions/eforge-plan/trace-store.ts` and `lifecycle-projection.ts`: refine active/historical trace classification.
- Workstation UI files under `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/`: show git-delta diagnostics, effective recommendation overlay counts, stale freshness, and ambiguous needs-input evidence.
- Tests in `eforge/extensions/eforge-plan/__tests__/` plus shared planning-task/schema tests if output or action schemas change.

### Documentation updates

- Update `eforge/extensions/eforge-plan/README.md` for baseline storage, git-delta diagnostics, overlay-first apply behavior, baseline sidecar semantics, prospective recommendation projection behavior, and active-versus-historical trace evidence.
- Update workstation docs for baseline storage, git-delta diagnostics, and overlay-first apply behavior.

### Assumptions

- Local git is available for normal projects.
- No-git states must be supported with diagnostics.
- Shallow states must be supported with diagnostics.
- Unreachable-baseline states must be supported with diagnostics.
- Existing recommendation freshness remains useful but is not sufficient by itself to define git-delta coverage unless the accepted pass recorded a git baseline.
- PR enrichment via `gh` can improve evidence but must never be required.

### Key risks to validate

- Force-push or shallow-clone baseline loss.
- False positive commit matches.
- Preview/apply overlay drift.
- Slow git/PR scans.
- Confusing stale recommendation labels.
- Recommendation-only baseline semantics hiding commits.

## Scope

### In scope

- Add an explicit git-delta section to analyze-all curation source/output.
- Include baseline commit/time/source, current `HEAD`, scanned commits, caps, and diagnostics for missing/unreachable/no-git baselines in git-delta output.
- Match commits to existing backlog items using item ids, slugs/titles, changed paths, branch/PR metadata, merge subjects, and bounded evidence excerpts.
- Extend shipped/affected evidence classification so strong evidence can drive item patches.
- Route ambiguous evidence to skipped/needs-input rather than status changes.
- Make recommendations overlay-first by applying draft item/epic changes to an in-memory prospective backlog state before generated recommendations are previewed, validated, or written.
- Ensure the same prospective-state helper is used by preview and apply validation.
- Fix trace summarization used by curation so active editable plans, submitted/historical plans, stale trace rows, queued PRDs, build runs, PRs, and landed results are distinguishable.
- Make stale recommendation freshness visible immediately after backlog mutation.
- Never label stale snapshots as fresh.
- Update eforge-plan README/workstation docs for baseline storage, git-delta diagnostics, and overlay-first apply behavior.

### Out of scope

- No unattended curation apply.
- No auto-enqueue.
- No scheduling.
- No auto backlog draining.
- No broad GitHub dependency.
- PR enrichment remains bounded and optional.
- No writes to legacy `.backlog/recommendations.json`.

## Acceptance Criteria

- `analyze-all-backlog` source includes `gitDelta.baseline.commit`.
- `analyze-all-backlog` source includes `gitDelta.baseline.time`.
- `analyze-all-backlog` source includes `gitDelta.baseline.source`.
- `analyze-all-backlog` source includes `gitDelta.currentHead`.
- `analyze-all-backlog` source includes `gitDelta.scannedCommitCount`.
- `analyze-all-backlog` source includes a list of scanned commits.
- `analyze-all-backlog` source includes git-delta scan caps.
- `analyze-all-backlog` source includes diagnostics when the baseline is missing.
- `analyze-all-backlog` source includes diagnostics when the baseline is unreachable.
- `analyze-all-backlog` source includes diagnostics when the baseline is shallow.
- `analyze-all-backlog` source includes diagnostics when git is unavailable.
- A confirmed accepted analysis records accepted time for the next run.
- A confirmed accepted analysis records `HEAD` for the next run.
- A confirmed accepted analysis records source fingerprint for the next run.
- A confirmed accepted analysis records task id for the next run.
- A confirmed accepted analysis records pass kind for the next run.
- A confirmed accepted analysis records whether git-delta coverage was complete or fallback for the next run.
- Commit matching considers backlog item id.
- Commit matching considers backlog item title.
- Commit matching considers backlog item slug.
- Commit matching considers changed paths.
- Commit matching considers branch hints.
- Commit matching considers PR numbers when available.
- Commit matching considers PR titles when available.
- Commit matching considers PR bodies when available.
- Commit matching considers PR files when available.
- Commit matching considers merge subjects.
- Commit matching considers bounded excerpts.
- Strong git evidence can produce shipped item changes only with required evidence prefixes.
- Strong git evidence can produce superseded item changes only with required evidence prefixes.
- Strong PR evidence can produce shipped item changes only with required evidence prefixes.
- Strong PR evidence can produce superseded item changes only with required evidence prefixes.
- Strong lifecycle evidence can produce shipped item changes only with required evidence prefixes.
- Strong lifecycle evidence can produce superseded item changes only with required evidence prefixes.
- Ambiguous matches become skipped/needs-input with compact evidence.
- Generated recommendation preview is computed against the prospective post-curation backlog.
- Closed items are removed from generated recommendation preview.
- Closed epics are removed from generated recommendation preview.
- Proposed active items are excluded or repositioned according to recommendation rules before display.
- Proposed planned items are excluded or repositioned according to recommendation rules before display.
- Proposed status-changed items are excluded or repositioned according to recommendation rules before display.
- Apply validation uses the same prospective recommendation projection as preview.
- Apply validation rejects unknown recommendation references after overlay.
- Apply validation rejects closed recommendation references after overlay.
- Apply validation rejects wrongly placed recommendation references after overlay.
- Session-plan traces cannot mark an item active solely from a stale submitted trace.
- Session-plan traces cannot mark an item planned solely from a stale submitted trace.
- Active state requires a live editable plan, active queue/run/build evidence, or current landing/PR evidence.
- UI recommendation freshness shows missing truthfully after backlog mutation.
- UI recommendation freshness shows fresh truthfully after backlog mutation.
- UI recommendation freshness shows stale truthfully after backlog mutation.
- UI recommendation freshness shows missing truthfully after curation preview.
- UI recommendation freshness shows fresh truthfully after curation preview.
- UI recommendation freshness shows stale truthfully after curation preview.
- UI recommendation freshness shows missing truthfully after curation-only apply.
- UI recommendation freshness shows fresh truthfully after curation-only apply.
- UI recommendation freshness shows stale truthfully after curation-only apply.
- UI recommendation freshness shows missing truthfully after normal curation+recommendations apply.
- UI recommendation freshness shows fresh truthfully after normal curation+recommendations apply.
- UI recommendation freshness shows stale truthfully after normal curation+recommendations apply.
- Regression tests cover stale recommendations excluding proposed shipped items.
- Regression tests cover git-delta commit matching since baseline.
- Regression tests cover ambiguous commit matches.
- Regression tests cover no-baseline fallback diagnostics.
- Regression tests cover unreachable baseline diagnostics.
- Regression tests cover stale submitted session-plan trace handling.
- Regression tests cover preview/apply overlay parity.
- Unit tests cover baseline sidecar read/write.
- Unit tests cover baseline missing behavior.
- Unit tests cover baseline unreachable behavior.
- Unit tests cover bounded git range scanning.
- Unit tests cover commit-to-item matching.
- Curation source tests prove `gitDelta` appears with baseline metadata.
- Curation source tests prove `gitDelta` appears with current `HEAD` metadata.
- Curation source tests prove `gitDelta` appears with diagnostics.
- Overlay tests prove preview and apply use identical prospective recommendation filtering.
- Overlay tests prove preview and apply use identical prospective recommendation repositioning.
- Trace tests cover submitted/historical plan traces versus live plan evidence.
- Trace tests cover submitted/historical plan traces versus queue evidence.
- Trace tests cover submitted/historical plan traces versus build evidence.
- Workstation view-model/component tests cover stale freshness labels.
- Workstation view-model/component tests cover git-delta diagnostics.
- Workstation view-model/component tests cover effective recommendation counts.
- Targeted Vitest suites for eforge-plan exit 0.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- `pnpm maintainability:check` exits 0.