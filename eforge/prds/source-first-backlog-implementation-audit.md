---
title: Source-First Backlog Implementation Audit
created: 2026-06-20
---

# Source-First Backlog Implementation Audit

## Problem / Motivation

Backlog curation currently remains conservative: current repository matches can orient analysis, but closure decisions still lean on lifecycle, git, PR, or session evidence. The desired behavior is a source-first implementation audit where current source code is the ground truth for whether an open backlog item's outcome has been implemented and wired into the relevant product surface.

This feature should let `eforge-plan` periodically reduce backlog noise without asking the user about every ambiguous item. Git history, lifecycle traces, PR metadata, and session plans may help find relevant files, but they must not by themselves justify shipped or superseded status in this source-first path.

## Goal

Implement a source-first backlog curation path for `eforge-plan` open backlog items. The path should automatically produce curation-ready outcomes based on current-source evidence while failing closed for uncertain, ambiguous, or insufficiently cited cases.

## Approach

- Audit every open item in the selected curation scope against current repository source.
- Use each item's claim and acceptance criteria to orient the expected implementation, not to perform exhaustive validation.
- Use git history, PR metadata, lifecycle traces, branch hints, and changed paths only as navigation hints for locating likely source files.
- Produce curation-ready outcomes automatically: shipped/superseded only with concrete current-source citations, otherwise partial, not-found, no-change, skipped, or recheck-note style outcomes.
- Run per-item audits through a bounded worker pool with a configurable concurrency limit and default no greater than 4.
- Surface the mode and preview evidence in the `eforge-plan` workstation.
- Prefer evolving the existing `full-implementation-audit` path into the source-first trust model if compatibility permits.
- Add a clear source-first scan-mode alias if evolving `full-implementation-audit` is not compatible, while preserving existing stored workflow entries.
- Treat current source as the only closure authority in this mode.
- Allow historical signals to raise candidate paths and context, but do not allow historical signals to close an item without current-source citations.
- Model per-item audit output with explicit intents such as source-shipped, source-superseded, partial, not-found, no-change, skipped, and diagnostic/recheck notes so prompt output can be deterministic and reviewable.
- Keep item auditors bounded by providing item metadata, acceptance criteria, source/git/PR hints, and compact excerpts rather than full-repo context.
- Fail closed: if an item audit is uncertain, times out, or lacks wired product-surface evidence, leave the item open with a useful recheck/partial rationale instead of asking the user or inferring closure.
- Normalize concurrency with a default no greater than 4 and a sane maximum cap so large backlogs remain safe for local developer machines.
- Preserve existing secret/path exclusions and redaction before passing current-source excerpts into item auditors.
- Keep this implementation in the `eforge-plan` extension/workstation layer.
- Include source-first inputs and results in source fingerprints.
- Preserve server-authoritative preview/apply validation.
- Update user-facing help text for the mode and its concurrency/caps behavior.
- Assume the existing `eforge-plan` backlog curation infrastructure is the right foundation.
- Assume the backlog remains small/manageable, while still bounding the implementation for larger open-item sets.
- Avoid adding a new daemon route unless current extension action plumbing cannot carry scan-mode/concurrency inputs.

Likely implementation areas:

- `eforge/extensions/eforge-plan/backlog-curation-full-audit.ts`: extend or replace the current full audit behavior so source evidence can drive source-first item outcomes instead of remaining only partial/ambiguous implementation evidence.
- `eforge/extensions/eforge-plan/backlog-curation-source.ts`: include source-first audit results, caps/concurrency settings, source fingerprints, diagnostics, and preview metadata.
- `eforge/extensions/eforge-plan/backlog-curation-source-provider.ts`: include source-first audit results, caps/concurrency settings, source fingerprints, diagnostics, and preview metadata.
- `eforge/extensions/eforge-plan/backlog-curation-schemas.ts`: add/normalize scan-mode and concurrency inputs, preserving existing task workflow behavior.
- `eforge/extensions/eforge-plan/backlog-curation-actions.ts`: add/normalize scan-mode and concurrency inputs, preserving existing task workflow behavior.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md`: update backlog curation guidance so source-first current-source citations can safely justify closure while git/PR/lifecycle remain navigation hints.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/*`: update scan-mode labels, warning/help text, preview rendering, and fixtures for source-first audit evidence.
- `eforge/extensions/eforge-plan/__tests__/*`: add targeted tests for prompt contract, source assembly, full/source-first audit behavior, action schemas, preview metadata, and UI view-model behavior.

## Scope

In scope:

- Implementing a source-first backlog curation path for `eforge-plan` open backlog items.
- Auditing every open item in the selected curation scope against current repository source.
- Using each item's claim and acceptance criteria to orient the expected implementation.
- Using git history, PR metadata, lifecycle traces, branch hints, and changed paths only as navigation hints for locating likely source files.
- Producing curation-ready outcomes automatically.
- Requiring concrete current-source citations for shipped or superseded outcomes.
- Producing partial, not-found, no-change, skipped, or recheck-note style outcomes when current-source evidence does not justify shipped or superseded status.
- Running per-item audits through a bounded worker pool.
- Supporting a configurable concurrency limit with a default no greater than 4.
- Surfacing the scan mode and preview evidence in the `eforge-plan` workstation.
- Including source-first inputs and results in source fingerprints.
- Preserving server-authoritative preview/apply validation.
- Updating user-facing help text for the mode and its concurrency/caps behavior.
- Preserving existing secret/path exclusions and redaction before passing current-source excerpts into item auditors.

Out of scope:

- Team-wide backlog management.
- Engine-owned scheduling or auto-drain orchestration.
- Exhaustive acceptance-test execution for every backlog item.
- Using git history, lifecycle traces, PR metadata, or session plans by themselves to justify shipped or superseded status in the source-first path.
- Adding a new daemon route unless current extension action plumbing cannot carry scan-mode/concurrency inputs.

## Acceptance Criteria

- A backlog curation task can run in a source-first implementation audit mode from the `eforge-plan` workstation/action path.
- The source-first implementation audit mode analyzes open backlog items against current repository source.
- The planning source packet includes per-item audit results produced by the source-first implementation audit mode.
- The preview metadata includes per-item audit results produced by the source-first implementation audit mode.
- A shipped curation patch in source-first mode requires compact current-source citations showing the core implementation is present and wired into the relevant product surface.
- A superseded curation patch in source-first mode requires compact current-source citations showing the superseding implementation is present and wired into the relevant product surface.
- Git evidence alone cannot produce a shipped curation patch in source-first mode.
- PR metadata alone cannot produce a shipped curation patch in source-first mode.
- Lifecycle evidence alone cannot produce a shipped curation patch in source-first mode.
- Session-plan evidence alone cannot produce a shipped curation patch in source-first mode.
- Per-item auditors may use backlog acceptance criteria as orientation.
- Per-item auditors do not claim exhaustive validation unless current-source evidence supports that claim.
- Ambiguous cases produce partial, not-found, skipped, no-change, or recheck-note updates instead of top-level user questions.
- A bounded worker pool enforces the configured concurrency limit for per-item audits.
- The default per-item audit concurrency is no greater than 4.
- Scan-mode and concurrency inputs are added or normalized in `eforge/extensions/eforge-plan/backlog-curation-schemas.ts`.
- Scan-mode and concurrency inputs are added or normalized in `eforge/extensions/eforge-plan/backlog-curation-actions.ts`.
- Existing task workflow behavior is preserved when scan-mode and concurrency inputs are added or normalized.
- Source-first audit results are included in `eforge/extensions/eforge-plan/backlog-curation-source.ts`.
- Source-first audit results are included in `eforge/extensions/eforge-plan/backlog-curation-source-provider.ts`.
- Caps and concurrency settings are included in `eforge/extensions/eforge-plan/backlog-curation-source.ts`.
- Caps and concurrency settings are included in `eforge/extensions/eforge-plan/backlog-curation-source-provider.ts`.
- Source fingerprints include source-first inputs.
- Source fingerprints include source-first results.
- Diagnostics are included in source-first backlog curation source assembly.
- Preview metadata includes source-first audit evidence.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md` states that source-first current-source citations can justify closure.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md` states that git, PR, and lifecycle evidence remain navigation hints in source-first mode.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/*` displays source-first scan-mode labels.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/*` displays warning/help text for source-first audit behavior.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/*` renders preview evidence for source-first audit results.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/*` includes fixture data for source-first audit evidence.
- A targeted test verifies source-first closure when current source implements and wires an item.
- A targeted test verifies git-only evidence does not close an item in source-first mode.
- A targeted test verifies ambiguous source-first outcomes are handled without `needsInput`.
- A targeted test verifies the worker pool never runs more than the configured number of item audits at once.
- A targeted test verifies the default worker pool concurrency is no greater than 4.
- A targeted test verifies source fingerprint changes include source-first inputs and results.
- A targeted test verifies preview metadata changes include source-first audit evidence.
- A targeted workstation or view-model test verifies source-first scan-mode display.
- A targeted prompt contract test prevents git-only closure under source-first mode.
- A targeted source assembly test covers source-first audit data.
- A targeted full/source-first audit behavior test covers source-first classification.
- A targeted action schema test covers scan-mode and concurrency inputs.
- A targeted UI view-model test covers source-first preview evidence.
- A fixture repository where current source implements and wires an item produces a closure-capable source citation.
- A fixture repository where git or PR history strongly suggests shipped but current source lacks the implementation does not produce a shipped patch.
- Partial fixtures produce open-item outcomes without `needsInput`.
- Ambiguous fixtures produce open-item outcomes without `needsInput`.
- Server-authoritative preview/apply validation is preserved for source-first backlog curation.
- Existing secret/path exclusions are preserved before current-source excerpts are passed into item auditors.
- Existing redaction is preserved before current-source excerpts are passed into item auditors.
- No new daemon route is added unless current extension action plumbing cannot carry scan-mode/concurrency inputs.
- Targeted vitest suites for the changed source-first backlog curation behavior exit 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.