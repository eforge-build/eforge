---
title: Session plan agent profile select
created: 2026-07-01
depends_on: ["per-invocation-runtime-choice-routing"]
stack_parent: per-invocation-runtime-choice-routing
---

# Session plan agent profile select

## Executive Summary

Plan a focused eforge-plan workstation UX improvement: replace the session-plan metadata editor's free-text build agent profile field with a select populated from kernel-owned eforge agent runtime profile data. The important architectural direction is that profile discovery/list semantics stay in the core eforge kernel/daemon profile registry and shared client contract; eforge-plan only consumes a read-only projection through the standard extension-to-kernel access mechanism, with any extension action acting as a thin bridge adapter for the sandboxed workstation.

The work touches the Plans metadata editor, profile-list loading state, workstation bridge/mock/types, and tests. It may also touch the extension SDK/action-runtime surface if the standard read-only profile-list hook/service is not already exposed to extension actions. Out of scope: profile creation/switching, changing build queue/profile precedence, changing profile router behavior, or making eforge-plan own profile discovery. Confidence is good because the metadata save path already exists; validation should focus on kernel ownership boundaries, bridge/schema wiring, missing-profile handling, and type/build/test gates.

## Problem Statement

The eforge-plan Plans metadata editor currently distinguishes planning profile only partially: `Planning profile` is a select for `errand`/`excursion`/`expedition`, while `Agent profile` is a free-text input. That makes valid build agent runtime profiles undiscoverable, invites typos, and can confuse the planning profile with the build profile carried in session-plan `agent_profile` frontmatter.

`agent_profile` already matters at handoff/enqueue time: when present on a session plan, it is used as the inherited eforge build profile unless an explicit build/enqueue override is supplied. The UI should make this safer and clearer without changing that runtime behavior.

The architectural risk is accidentally moving profile-list ownership into the eforge-plan extension. Agent runtime profiles are core kernel/daemon data with shared client route/types and existing resolution semantics. eforge-plan should not scan profile directories, duplicate profile wire shapes, import private engine config internals, or hard-code daemon routes from the workstation iframe just to populate a select.

## Scope

Implement a focused UX change in the eforge-plan planning workstation Plans tab:

- Replace the Agent profile free-text input in `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/metadata-editor.tsx` with a select/dropdown.
- Populate the select from the kernel-owned eforge agent runtime profile list, reusing shared `@eforge-build/client` profile response/types where a wire shape is needed.
- Access profile data through the standard extension-to-kernel interface. Preferred direction: expose or use a read-only profile-list service/hook on the extension action context, analogous to other daemon-owned extension context APIs, and have any eforge-plan action delegate to that service rather than implementing discovery itself. If an equivalent standardized workstation host-data bridge already exists, use it instead.
- Keep the sandboxed workstation on `window.eforge.invokeAction`/allowed-action boundaries. The iframe should not fetch `/api/profile/list` directly, hard-code route literals, import private Console internals, or read profile files.
- Include an explicit no-selection/default option labeled along the lines of `Default/active eforge profile (leave agent_profile unset)`.
- Preserve the current save path through `update-session-plan-metadata` with `agentProfile` so existing frontmatter and handoff behavior remain unchanged.
- Distinguish labels/help text: planning profile controls eforge-plan planning depth/profile (`errand`/`excursion`/`expedition`), while agent profile controls the build runtime profile stored as `agent_profile`.
- Gracefully handle existing plans whose `agent_profile` is not in the current profile list by showing a synthetic/current-value option and allowing the user to save, change, or clear it.

Out of scope:

- Creating, deleting, activating, or switching eforge profiles.
- Changing build queue profile precedence, enqueue validation timing, profile router behavior, or session-plan normalization.
- Making eforge-plan the source of truth for profile discovery or profile-list wire shapes.
- Replacing the planning profile selector or changing readiness dimensions.

## Acceptance Criteria

- Session plan metadata editing presents Agent profile as a select/dropdown, not a free-text input.
- The select is populated from kernel-owned eforge agent runtime profile data and displays enough context to avoid ambiguity where practical (for example name plus scope/harness/description/active or shadowed status when available).
- eforge-plan does not implement profile discovery by scanning profile directories, importing engine config internals, duplicating profile-list wire shapes, or hard-coding `/api/...` route literals.
- Any new eforge-plan read action for profile options is a thin, read-only adapter over the standard kernel-provided extension interface for profile lists; it does not own profile list semantics.
- Shared client profile types/route helpers remain the source of truth for daemon wire shapes where a wire shape is needed.
- A no-selection/default option is always present; saving it sends `agentProfile: null` (or equivalent) through `update-session-plan-metadata`, causing `agent_profile` to be omitted/cleared.
- Selecting a listed profile saves via `update-session-plan-metadata` using the existing `agentProfile` field; open questions are preserved on save.
- The UI copy clearly separates `Planning profile` from `Build agent profile`/`Agent runtime profile`.
- Existing plans with a known `agent_profile` show that profile selected.
- Existing plans with a missing/deleted `agent_profile` remain editable: the current value is visible, can be kept or cleared, and does not block saving unrelated metadata.
- Profile-list loading, empty, and error states do not prevent clearing `agent_profile` or editing planning profile metadata.
- Tests cover the default clearing path, selecting a known profile, preserving a missing profile, copy/label distinction, kernel/extension boundary enforcement, and registration/allowed-action wiring for any new read action.

## Code Impact

Expected implementation touch points:

- `packages/extension-sdk/src/contributions.ts` and `packages/engine/src/extensions/types.ts`: if no standard profile-list access exists for native extension actions, add a small read-only kernel profile service to the extension action context (for example `profiles.list(query?: ProfileListRequest): Promise<ProfileListResponse>`). Keep this as a kernel/daemon service, not an eforge-plan utility.
- Extension action runtime / contribution invocation code in `packages/engine/src/extensions/` and/or monitor contribution dispatch: wire the profile service into `ExtensionActionContext` alongside existing daemon-owned context APIs. Prefer sharing the same projection/contract used by the daemon profile-list route rather than creating a parallel object shape.
- `packages/monitor/src/routes/profiles.ts` and `packages/client/src/api/profile.ts` / `packages/client/src/types.ts`: reuse the existing profile-list route/types. Only refactor if needed so both the HTTP route and extension context service call the same core profile-list projection.
- `eforge/extensions/eforge-plan/session-plan-schemas.ts`, `session-plan-actions.ts`, and `index.ts`: add a small read-only action such as `list-agent-runtime-profiles` only if the workstation cannot consume the kernel profile service directly. Register it and add it to `allowedActions`; the handler should delegate to the kernel-provided context service and declare read-only side effects.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/metadata-editor.tsx`: replace `Input` for agent profile with `Select`; add option-building helpers, help text, default/null handling, and missing-current-value handling.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx` or a nearby Plans data hook: load profile options without blocking existing metadata editing, then pass profile-list state into `MetadataEditor`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts`: import/re-export compact profile option types from the client browser bundle when possible; avoid locally redeclaring daemon wire shapes.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` and fixtures: mock the profile-list action/bridge response for dev/tests without making the mock the product source of truth.
- Tests likely belong near extension context/contribution invocation tests, existing monitor profile-route tests if shared projection is refactored, eforge-plan registration/session-plan action tests, and workstation/component tests for metadata editor behavior.
- Existing metadata update code in `eforge/extensions/eforge-plan/session-plan-metadata.ts` should remain mostly unchanged because it already trims non-empty `agentProfile` and deletes `agent_profile` for null/blank input.

## Design Decisions

- The profile list is kernel/daemon-owned. eforge-plan consumes a projection; it must not become a profile registry, file scanner, or alternate route-shape owner.
- Use the standard extension access pattern for kernel data. For this feature, that likely means a read-only extension action context service/hook for profile listing; if a standardized host-data bridge already exists for workstations, use that instead. Do not use a profile router for this UI list: routers select profiles at queue/build dispatch time and are not the profile-list source of truth.
- Keep the workstation sandbox simple: the iframe talks through `window.eforge.invokeAction`; any local action is only an adapter over the kernel service and remains on the workstation `allowedActions` list.
- Represent the default choice as an empty UI value and persist it as `agentProfile: null`/unset; do not invent a persisted `default` or `active` profile name.
- Treat the profile list as a convenience/discovery aid, not final validation. The build/enqueue path remains responsible for validating an inherited `agent_profile` when a session plan is handed off.
- If a current `agent_profile` is absent from the available list, include a synthetic option such as `Current missing profile: <name>` so users can see what is stored and can save without accidental data loss.
- Preserve kernel-provided scope/shadowing/active metadata for display context. eforge-plan may format or de-emphasize entries, but should not reimplement precedence rules.
- Keep native/select UX simple for this item; richer combobox search or profile management links can be future work if profile lists become large.

## Assumptions And Validation

Assumptions:

- The standard extension-to-kernel data interface is, or can safely become, a read-only service/hook on extension action context for profile listing. If an equivalent standard bridge already exists, use that instead of inventing a new interface.
- Available profile data can be exposed as a read-only local/kernel-data capability without granting mutation rights.
- Profile names are still persisted by name only; scope/harness/description/active/shadowing metadata is display context.
- A missing current profile should be treated as recoverable metadata, not as a form error.

Validation plan:

- Add/update extension runtime tests proving the extension context profile-list service returns the same shared profile-list projection as the daemon profile-list route for local/project/user scope coverage.
- Add/update eforge-plan action/schema/registration tests if a read action is introduced, including workstation `allowedActions` coverage and read-only side-effect declaration.
- Add/update workstation tests for metadata editor option rendering, default clearing, known-profile save, missing-profile preservation, label/help text distinction, loading/empty/error states, and open-question preservation.
- Add boundary tests or static assertions that eforge-plan workstation code does not call `fetch`/`XMLHttpRequest` for profile data, hard-code `/api/profile/list`, import private Console internals, or import `@eforge-build/engine/config`/`listProfiles`.
- Verify existing session-plan metadata tests still pass for trimming and deletion of blank/null `agentProfile`.
- Run `pnpm type-check`, targeted `pnpm test` suites for extension context/profile routes and eforge-plan workstation behavior, `pnpm build` or the eforge-plan workstation build if assets/types changed, and `pnpm maintainability:check`.