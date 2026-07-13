---
title: Make Planner Source Localization Repair Authoritative and New-File Aware
created: 2026-07-13
landing: pr
landing_auto_merge: true
---

# Make Planner Source Localization Repair Authoritative and New-File Aware

- **Created:** 2026-07-13
- **Dependencies:** None (`depends_on: []`)
- **Landing:** PR (`landing: pr`)
- **Automatic landing merge:** Enabled (`landing_auto_merge: true`)

## Problem / Motivation

A compile for `add-upstream-plan-root-cause-reporting` failed before implementation with `source localization repair exhausted:classifier-owner-path-unlocalized:no localized owner paths resolved`. The bounded planner accepted an atom id as a `sourceNeedId`, skipped repository exploration after only 5/8 literal needs resolved, treated intentionally new classifier code as requiring an existing authoritative file, and then exhausted evidence budgets with broad unrelated candidates. The PRD itself identified the intended recovery subsystem, so this was a planner/compiler correctness defect rather than unbuildable product ambiguity.

This work aligns with the roadmap's Kernel Resilience and Typed Recovery direction, especially honest fail-closed gates: the planner should reject malformed localization metadata, explore unresolved critical ownership, and produce bounded buildable ownership for intentional new files.

## Goal

Make source-localization planning and repair robust enough that invalid reducer references, unresolved critical ownership, and intentional new-file work cannot combine into an opaque compile failure. Preserve fail-closed behavior for genuinely ambiguous modifications while allowing bounded new implementation ownership.

## Approach

### Validate and normalize reducer localization metadata

- Update `packages/engine/src/planner-compiler/reduce-contracts.ts`, reducer task/prompt construction, and related focused contracts so reducers receive the bounded catalog of valid source-need ids and affected atom ids relevant to the node.
- Reject or deterministically quarantine unknown `sourceNeedIds` and unknown/out-of-node `affectedAtomIds` at structured submission validation. Keep `sourceIds` as provenance only; never reinterpret atom or reducer ids as source-need ids.
- In `packages/engine/src/planner-compiler/source-localization-repair.ts`, filter invalid explicit source-need ids before deciding whether an explicit set exists. If no valid ids remain, derive fallback needs from criterion/aspect linkage instead of suppressing fallback.

### Represent intentional new-file ownership

- Add a bounded, typed distinction between existing-owner localization and intentional new-file ownership. A module that explicitly creates focused code may use a proposed owner root/path under an existing repository directory without requiring a pre-existing file.
- Use explicit PRD paths and affected subsystem roots, including `packages/engine/src/recovery/`-style new-file scopes, as bounded ownership evidence.
- Continue failing closed when modifying existing behavior has multiple plausible owners or only a broad unbounded root.

### Make exploration and repair critical-need aware

- Update `packages/engine/src/planner-compiler/exploration-contracts.ts` and `adaptive-rescope.ts` so aggregate high-confidence share cannot skip exploration while a critical or representation-required implementation owner remains unresolved.
- Add bounded targeted repository exploration to missing-owner/source-localization repair. Search from affected criteria, aspects, interfaces, subsystem hints, and explicit source roots, then rematerialize evidence and rerun only affected planning work.
- Keep repair bounded by explicit attempt, tool-use, file, and byte limits. Do not merely increase retry counts.

### Prevent evidence budget starvation

- Tighten `packages/engine/src/planner-compiler/source-localization.ts`, `shared-brief.ts`, and `source-evidence-materialization.ts` ownership routing so criterion linkage and exact paths outrank generic subsystem/interface overlap.
- Literal path and directory needs must not broadcast through generic labels such as `general`.
- Reserve materialization priority for explicit PRD paths, affected-criterion candidates, and repair-priority paths before global lexical/shared evidence.
- Preserve deterministic ordering and existing budget ceilings.

### Regression coverage

- Add focused unit tests for reducer id validation, fallback need derivation, new-file ownership, critical exploration gating, targeted repair, and evidence prioritization.
- Add an integration fixture based on the failed upstream-root-cause PRD shape. It must compile to buildable planning artifacts rather than exhaust localization repair.
- Follow repository test policy: real pure functions and I/O fixtures only where needed; no mocks.

## Scope

### In scope

- Planner compiler contracts, reducer validation, source localization, exploration skip policy, source-localization repair, shared evidence ownership, materialization priority, diagnostics directly required by these changes, and regression tests.
- Additive client-owned planning decomposition shapes if a cross-process event or diagnostic contract must change.

### Out of scope

- Allowing parent reducers to reconcile incomplete sibling reducers.
- General reducer-tree redesign or compiler status-precedence changes.
- Queue finalization, recovery sidecar evidence preservation, or Console recovery UX.
- Changing build scheduling, landing behavior, or recovery actions.
- Weakening fail-closed behavior for genuinely ambiguous existing-code ownership.

## Acceptance Criteria

- Reducer tasks expose a bounded catalog of valid source-need and affected-atom ids, and structured submissions cannot silently accept an atom id as a source-need id.
- Unknown explicit source-need ids are diagnosed and cannot suppress criterion/aspect-based fallback localization.
- `sourceIds`, `sourceNeedIds`, and `affectedAtomIds` retain distinct validated semantics.
- Intentional focused new-file work can receive bounded proposed ownership under an existing repository root without requiring the target file to exist.
- Ambiguous modifications to existing behavior remain fail-closed.
- Repository exploration is not skipped when any critical or representation-required implementation owner is unresolved, regardless of aggregate literal-path confidence.
- Missing-owner repair performs bounded targeted exploration and reruns only affected planning work with newly materialized evidence.
- Exact PRD paths, criterion-linked candidates, and repair-priority paths are materialized ahead of broad lexical/shared candidates under contention.
- Generic subsystem labels do not broadcast unrelated literal paths or directories across planning atoms.
- Focused tests cover invalid reducer ids, fallback localization, new-file ownership, ambiguity suppression, critical exploration gating, targeted repair bounds, and evidence-budget contention.
- An integration fixture modeled on `add-upstream-plan-root-cause-reporting` completes compilation with buildable plan artifacts and does not produce `classifier-owner-path-unlocalized` or `no localized owner paths resolved`.
- Existing bounded planner compiler, adaptive rescope, source evidence, and compile-stage integration tests pass.
- `pnpm type-check`, `pnpm test`, and `pnpm maintainability:check` exit successfully.