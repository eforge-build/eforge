---
title: Add Read-Only Session Plan-Set Artifacts to @eforge-build/input
created: 2026-05-30
profile: gpt-claude-combo
landing: pr
---

# Add Read-Only Session Plan-Set Artifacts to @eforge-build/input

## Problem / Motivation

This work supersedes the first slice of `.eforge/session-plans/2026-05-27-umbrella-plan-set-workflow.md` by narrowing the initial build to the input artifact protocol only.

Evidence from the failed/resumed `support-umbrella-session-plan-sets` build showed that the previous `plan-01-artifact-protocol` attempted too much at once: schema definition, safe paths, creation/mutation helpers, validation/summarization, nested build-source handoff, docs, and tests. Strict review then found both maintainability problems and source-of-truth ambiguity.

Relevant facts:

- Existing flat session plans are modeled in `packages/input/src/session-plan.ts` under `.eforge/session-plans/<session>.md`.
- `resolveSessionPlanPath` intentionally rejects path separators for flat session IDs.
- `listActiveSessionPlans` scans immediate markdown files and does not discover directories.
- The session-plan frontmatter parser is permissive via `.passthrough()`, so future metadata can exist without breaking flat plans.
- Project policy requires new implementation files to stay under 600 lines and forbids growing legacy oversized files beyond their baseline.

Risks:

- **Scope creep risk**: adding mutations or enqueue behavior will recreate the previous failure mode. Mitigation: keep this slice read-only.
- **Source-of-truth risk**: manifest/frontmatter mirroring is unresolved. Mitigation: validate/read only; defer mutation policy.
- **Maintainability risk**: a single plan-set file can exceed 600 lines. Mitigation: split modules before implementation.
- **Compatibility risk**: modifying flat session-plan path handling could break existing builds. Mitigation: add separate plan-set resolvers and flat regression tests.

## Goal

Implement the core read-only session plan-set artifact protocol in `@eforge-build/input` as a stable library foundation for later daemon, client, Console UI, mutation, and build handoff work.

## Approach

Add the plan-set protocol as a sibling to flat session plans inside `@eforge-build/input`.

Plan sets should be represented as directories under `.eforge/session-plans/<plan-set-id>/`. Each plan set should contain a `plan-set.yaml` manifest, an umbrella markdown anchor, and child markdown plans.

Flat session-plan APIs remain the source of truth for flat files. Plan-set child resolution must use a separate resolver scoped to a validated plan-set directory, rather than weakening `resolveSessionPlanPath`.

Summary return values must avoid leaking `SessionPlan` internals such as `Map` into future daemon/client wire shapes. If parsed child content is useful internally, keep it in a load result and expose a separate JSON-safe summary type.

The expected module shape should be split before implementation to avoid another oversized file. A possible shape is:

- `packages/input/src/session-plan-set/schema.ts` or equivalent for constants, schemas, and exported types.
- `packages/input/src/session-plan-set/paths.ts` or equivalent for safe path resolution.
- `packages/input/src/session-plan-set/manifest.ts` or equivalent for parse/serialize.
- `packages/input/src/session-plan-set/read.ts` or equivalent for list/load.
- `packages/input/src/session-plan-set/validate.ts` or equivalent for diagnostics and summaries.
- `packages/input/src/session-plan-set.ts` may remain a small barrel if desired.

Likely affected areas:

- `packages/input/src/index.ts` to export the new public helpers and types.
- New focused files under `packages/input/src/` for plan-set schemas, paths, manifest parsing, read helpers, validation, and summaries.
- `packages/input/README.md` to mention the read-only artifact protocol if documentation is included in this slice.
- New tests for plan-set artifacts, grouped by logical behavior rather than source file.

Avoid or minimize changes to `packages/input/src/session-plan.ts`. If shared helpers are needed, extract small utilities instead of growing the legacy file.

Design decisions:

- Manifest is canonical for plan-set membership.
- The manifest owns plan-set id, title, status, strategy, anchor path, child ordering, child ids, child files, child kind, buildability, status, profile, dependencies, and optional external references.
- Child frontmatter may later mirror selected fields, but this plan only validates and summarizes existing files.
- This plan does not introduce mutation behavior that must keep two sources synchronized.
- This plan deliberately avoids create/add/update helpers.
- Mutation semantics belong in a later mutation plan because they raise collision handling, runtime validation, frontmatter mirroring, submitted-status, and source-of-truth questions.
- This plan does not change `normalizeBuildSource` to accept nested child plans.
- Later plans can decide whether nested child plans are directly buildable or must be promoted/copied to flat session plans first.
- Plan-set ids and child files should be slug/path constrained.
- Child paths must stay inside the plan-set directory.
- Child paths should reject traversal or ambiguous segments such as `.`, `..`, empty path segments, absolute paths, and backslash separators.
- The implementation should be decomposed into small modules up front.
- The implementation must not increase the no-growth ceiling for legacy oversized files.

Documentation impact:

- Minimal documentation is acceptable in this slice.
- Document the read-only artifact layout in `packages/input/README.md` or a focused input artifact section.
- Do not update user-facing Console or skill docs until routes/UI/mutations exist.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| A read-only artifact protocol is useful without daemon or UI changes. | Later daemon/client/console plans need stable list/load/validate/summarize helpers; the failed build showed coupling everything together was too large. | high | low | Implement helpers and tests, then consume them in the next plan. | If wrong, the first slice may feel invisible but still provides a safe foundation. |
| Plan-set directories should live under `.eforge/session-plans/<plan-set-id>/`. | Original plan, existing flat session-plan location, and Planning Workspace direction all point to this location. | high | low | Add path resolver tests and fixture directories. | Discovery may need migration if another location is chosen later. |
| Manifest membership can be validated without implementing mutation helpers. | Validation can compare existing files and manifest data deterministically. | high | low | Add fixtures for valid, missing, duplicated, and drifted artifacts. | Mutation plan may need additional diagnostics later. |
| JSON-safe summary shapes should be separated from rich internal load results. | Resume review identified `SessionPlan.sections` as a `Map`, which is not suitable for daemon/client wire responses. | high | low | Add a test that summary output serializes with `JSON.stringify`. | Later daemon routes may leak unstable internal shapes. |
| Avoiding nested build handoff in this slice reduces failure risk. | The failed resume showed nested handoff caused child identity, submitted-status, and buildability ambiguity. | high | low | Confirm no `normalizeBuildSource` behavior changes are required by this plan. | Later plan must still solve build handoff deliberately. |

Profile signal:

- Recommended profile: **Excursion**.
- Rationale: this is architecture-sensitive but intentionally limited to one package and a read-only artifact protocol.
- A single planner should be able to enumerate the module split, helper contracts, tests, and compatibility checks without Expedition-level delegated module planning.

## Scope

In scope:

- Add a read-only session plan-set artifact protocol in `@eforge-build/input`.
- Represent plan sets as directories under `.eforge/session-plans/<plan-set-id>/`.
- Represent each plan set with a `plan-set.yaml` manifest plus an umbrella markdown anchor and child markdown plans.
- Preserve existing flat session-plan behavior unchanged.
- Add runtime schemas and TypeScript types for plan-set manifests and child entries.
- Add deterministic manifest parse and serialize helpers.
- Add safe plan-set directory, manifest, anchor, and child path resolvers.
- Add list/load helpers for plan sets.
- Add validation helpers that report deterministic diagnostics.
- Add summary helpers that expose only JSON-safe/read-only data.
- Add tests for parsing, serialization, safe resolution, listing, loading, validation, summaries, and flat session-plan compatibility.

Out of scope:

- Daemon HTTP routes.
- Client route constants or API helpers.
- Console UI changes.
- Plan-set create/add/update mutation helpers.
- Scaffolding workflows.
- Nested child enqueue/build handoff.
- Marking plan-set children submitted.
- Updating Pi or Claude Code skills.
- External tracker synchronization.
- Raising maintainability baselines to make the implementation pass.

## Acceptance Criteria

- Existing flat session-plan helpers continue to support `.eforge/session-plans/<session>.md` files.
- Existing flat `resolveSessionPlanPath` continues to reject session ids containing path separators.
- `@eforge-build/input` exports a session plan-set manifest type.
- `@eforge-build/input` exports a session plan-set child type.
- `@eforge-build/input` exports a manifest parse helper.
- `@eforge-build/input` exports a manifest serialize helper.
- The manifest parse helper rejects invalid manifest status values.
- The manifest parse helper rejects invalid child kind values.
- The manifest parse helper rejects invalid child status values.
- The manifest parse helper wraps malformed YAML failures in a predictable error message.
- The plan-set id resolver rejects ids containing `/`.
- The plan-set id resolver rejects ids containing `\`.
- The child path resolver rejects absolute paths.
- The child path resolver rejects `..` segments.
- The child path resolver rejects `.` segments.
- The child path resolver rejects empty path segments.
- The child path resolver returns paths inside the selected plan-set directory.
- The list helper returns plan-set manifest entries from directories under `.eforge/session-plans/`.
- The list helper does not return flat session-plan markdown files as plan sets.
- The load helper returns the manifest, umbrella anchor content, and child file metadata for an existing plan set.
- The validation helper reports duplicate child ids.
- The validation helper reports duplicate child files.
- The validation helper reports unknown child dependencies.
- The validation helper reports a missing umbrella anchor file.
- The validation helper reports a missing child file.
- The validation helper reports child frontmatter parse failures.
- The summary helper returns a JSON-safe object that can be passed to `JSON.stringify` without losing required fields.
- No daemon routes are added by this plan.
- No Console UI files are changed by this plan.
- `normalizeBuildSource` does not accept nested plan-set child paths as build sources in this plan.
- New implementation files are each at most 600 lines.
- Existing oversized implementation files do not grow beyond their baseline ceilings.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
- Targeted tests for session plan-set artifacts exit 0.
