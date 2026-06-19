---
title: Strengthen Kernel Boundary, Plan Annotations, Recovery UX, and Trust Cleanup
created: 2026-06-19
---

# Strengthen Kernel Boundary, Plan Annotations, Recovery UX, and Trust Cleanup

## Problem / Motivation

Eforge public docs blur the boundary between the core build-engine kernel and optional workflow/extension surfaces such as playbooks, session plans, `/eforge:plan`, backlog workflows, workstations, and authoring UX. This makes it harder to understand that core eforge accepts normalized build source and produces reviewed code, while extensions and hosts may own authoring workflows.

The eforge-plan workstation also lacks annotation-driven plan revision UX, stale dependency and stacking-dispatch recovery UX does not surface pre-session dispatch blockers clearly enough, and the deprecated no-op extension trust compatibility field continues to create trust-model confusion.

## Goal

Implement four independent but coordinated tracks: clarify the kernel/extension boundary in docs, add annotation-driven Revise with AI UX to eforge-plan, improve stale dependency and stacking-dispatch recovery, and remove the extension trust compatibility field. The work should strengthen existing architecture without adding workflow ownership to the kernel.

## Approach

- Treat this as a coordinated set of independent tracks, not one coupled feature.
- Land the work as multiple bounded commits or PRs if implementation becomes too large.
- Keep public core docs focused on eforge as a build-engine kernel: normalized build source in, reviewed code out.
- Describe playbooks, session plans, `/eforge:plan`, backlog workflows, workstations, and authoring UX as optional extension-owned surfaces.
- Keep eforge-plan annotation state and revision UX in extension-owned private storage and workstation behavior.
- Pass read-only source context to the daemon-owned planning task for revision turns.
- Do not let plan revision flows mark plans ready, hand off plans, enqueue builds, mutate backlog items, or become a kernel planning product.
- Make recovery state typed and durable across engine, daemon, client, and Console.
- Use shared `@eforge-build/client` event types, daemon wire shapes, API routes, and response contracts.
- Do not redeclare recovery wire shapes in daemon or Console code.
- Keep engine responsibility to emitting typed events and leave rendering to consumers.
- Remove extension trust compatibility plumbing and docs.
- Treat local hash trust records as the only project/team extension trust authority.
- Let existing config validation surface stale removed extension trust fields as unsupported unless implementation discovers a stronger compatibility requirement.
- Use an allowlist-based docs boundary test so core docs can link to optional extension pages without embedding eforge-plan product semantics.
- Make source doc and navigation changes first, then regenerate generated docs artifacts near the end.
- Bound or summarize annotation context if many annotations risk exceeding existing no-output or oversized-output safeguards.
- Preserve enough quote/context metadata for human usefulness without pretending DOM offsets are durable.
- Require explicit operator action for dependency removal or `stack_parent` selection.
- Do not silently repair queue metadata.
- Do not silently requeue PRDs that are already known to fail dispatch validation.

Expected implementation areas:

- `README.md`
- `web/content/docs/getting-started.md`
- `web/content/docs/concepts.md`
- `web/content/docs/configuration.md`
- `web/content/docs/integrations.md`
- `web/content/docs/extensions.md`
- `web/content/docs/extensions-api.md`
- `web/lib/nav.ts`
- `packages/docs-gen/src/manifest.ts`
- Generated reference artifacts
- Relevant docs boundary test suite
- Extension-owned eforge-plan documentation
- Eforge-plan workstation Plans detail UI
- Plan revision private storage/index migration or normalization
- Annotation actions and selectors
- `buildPlanRevisionSourceText` or equivalent source-context builder
- Revision turn snapshotting
- Auto-apply success handling
- UI tests for selection, block, and sticky-control behavior
- Engine dispatch validation
- Durable failure events for pre-session failures
- Shared `@eforge-build/client` recovery event, route, and wire contracts
- Daemon projections and routes for failed queue items
- Daemon recovery preflight and repair actions
- Console recovery and Needs attention UI
- `packages/engine/src/config.ts`
- Related config schema, types, tests, and docs that currently mention or accept the removed extension trust flag

Risks and guardrails:

- Scope size can exceed one reviewable change, so edits should stay bounded by track.
- Public docs, navigation, manifests, and generated artifacts can conflict if regenerated too early.
- Boundary tests can produce false positives because terms like `eforge-plan` may need to appear in links or extension-owned docs.
- Quote/context annotation targets may drift after edits.
- Many annotations can bloat revision source context.
- Recovery repair actions can change queue behavior.
- Removing a deprecated config field may break stale local configs.
- Contract drift can occur if server or UI changes inline shared client schemas, routes, or projections.

Assumptions to validate:

- The selected recommendation group is safe to plan together because dependencies are empty and the tracks touch mostly distinct areas.
- The annotation item has a planned lifecycle link but no active build, session, or queue trace.
- Roadmap priority favors Kernel Resilience and Typed Recovery, Console Observability and Control, and Extension Platform boundary discipline.
- Current file paths should be verified before implementation.

Validation approach:

- Start with bounded searches for eforge-plan product terms in core docs.
- Start with bounded searches for the removed trust flag references.
- Start with bounded searches for plan revision storage and source-text code.
- Start with bounded searches for queue-cascade and `stack_parent` recovery paths.
- Add or update tests close to each changed unit.

## Scope

In scope:

- Refocus public documentation on the kernel/extension boundary.
- Add or update extension-owned eforge-plan documentation and link to it from public docs as optional first-party extension documentation.
- Add annotation-driven plan revision UX in the eforge-plan workstation.
- Support annotations on selected text, rendered blocks, sections, and whole plans.
- Let users review unresolved annotations.
- Let users launch Revise with AI using annotations plus optional steering text.
- Improve stale dependency and stacking-dispatch recovery UX.
- Surface real dispatch blockers for failed queue items that fail before `session:start`.
- Preflight queue-cascade recovery.
- Classify dependencies as blocking, satisfied, terminal failed/skipped, or stale/historical.
- Offer explicit safe repair actions.
- Remove the deprecated/no-op extension trust compatibility field.
- Remove related extension trust compatibility docs and plumbing.

Out of scope:

- Adding new workflow ownership to the kernel.
- Mutating backlog state from plan revision flows.
- Silently repairing queue metadata without explicit operator action.
- Treating playbooks, session plans, `/eforge:plan`, backlog workflows, workstations, or authoring UX as core kernel capabilities.
- Making the daemon-owned planning task into a kernel planning product.

## Acceptance Criteria

- `README.md` frames eforge core as a build-engine kernel.
- `README.md` describes playbooks as optional extension-owned surfaces when mentioned.
- `README.md` describes session plans as optional extension-owned surfaces when mentioned.
- `README.md` describes planning workflows as optional extension-owned surfaces when mentioned.
- `README.md` describes backlog workflows as optional extension-owned surfaces when mentioned.
- `README.md` describes workstations as optional extension-owned surfaces when mentioned.
- `README.md` describes authoring UX as optional extension-owned surfaces when mentioned.
- `web/content/docs/getting-started.md` uses a direct prompt, PRD, or file-based build as the primary first-build path.
- `web/content/docs/getting-started.md` moves `/eforge:plan` workflows to optional extension sections or linked first-party extension docs.
- `web/content/docs/getting-started.md` moves playbook workflows to optional extension sections or linked first-party extension docs.
- `web/content/docs/getting-started.md` moves session-plan workflows to optional extension sections or linked first-party extension docs.
- `web/content/docs/concepts.md` explains the normalized build-source boundary.
- `web/content/docs/concepts.md` explains the extension/host producer model.
- `web/content/docs/concepts.md` no longer presents session plans as a core concept.
- `web/content/docs/concepts.md` no longer presents playbooks as a core concept.
- `web/content/docs/configuration.md` separates core daemon, build, and profile configuration from optional workflow and extension configuration.
- `web/content/docs/integrations.md` separates core daemon, build, and profile commands from optional workflow and extension commands.
- `web/content/docs/extensions.md` describes generic extension APIs and boundaries.
- `web/content/docs/extensions.md` does not embed eforge-plan-specific product semantics such as backlog curation, recommendation workflows, Revise with AI, `planRevisionTurn`, or `backlogCurationDraft`.
- `web/content/docs/extensions-api.md` describes generic extension APIs and boundaries.
- `web/content/docs/extensions-api.md` does not embed eforge-plan-specific product semantics such as backlog curation, recommendation workflows, Revise with AI, `planRevisionTurn`, or `backlogCurationDraft`.
- An extension-owned eforge-plan documentation surface documents planning-specific behavior removed from core docs.
- Public docs link to eforge-plan documentation as optional first-party extension documentation.
- Public docs do not make eforge-plan-specific behavior a core concept.
- `web/lib/nav.ts` categorizes core/kernel pages separately from extension platform pages.
- `web/lib/nav.ts` categorizes optional first-party extension pages distinctly from core/kernel pages.
- `packages/docs-gen/src/manifest.ts` categorizes core/kernel pages separately from extension platform pages.
- `packages/docs-gen/src/manifest.ts` categorizes optional first-party extension pages distinctly from core/kernel pages.
- Generated reference docs or adjacent guide text label playbook tools as optional workflow compatibility or extension surfaces.
- Generated reference docs or adjacent guide text label session-plan tools and routes as optional workflow compatibility or extension surfaces.
- Generated reference docs or adjacent guide text do not label playbook or session-plan tools as kernel capabilities.
- A docs boundary test or equivalent check uses an allowlist for permitted core-doc references to optional extension pages.
- A docs boundary test or equivalent check fails when eforge-plan-specific product terms appear in core public docs outside the allowlist.
- Active docs contain no removed extension trust flag references outside any intentionally preserved historical or changelog allowlist.
- `pnpm docs:generate` exits 0.
- `pnpm docs:check` exits 0.
- Users can create annotations from selected text inside rendered flat session plan sections.
- Users can create annotations from rendered block fallback controls.
- Users can create annotations from rendered section fallback controls.
- Users can create annotations from whole-plan fallback controls.
- Selection handling for annotations uses `window.getSelection` inside the workstation frame.
- Selection handling for annotations does not depend on parent Console selection APIs.
- Annotations persist in eforge-plan private revision storage.
- Annotations are scoped to the target session.
- Annotations survive reload.
- Annotations include target kind metadata.
- Annotations include dimension metadata when available.
- Annotations include selected or block text.
- Annotations include an exact quote.
- Annotations include optional prefix and suffix context when available.
- Annotations include timestamps.
- Annotations include resolution metadata.
- The plan view lists unresolved annotations with target context.
- The plan view lists unresolved annotations with timestamps.
- The plan view provides edit controls for unresolved annotations.
- The plan view provides delete controls for unresolved annotations.
- The plan view provides resolve controls for unresolved annotations.
- A sticky control appears when unresolved annotations exist.
- The sticky control shows the unresolved annotation count.
- The sticky control accepts optional steering text.
- The sticky control disables Revise with AI while a turn is queued or running.
- Annotation-driven Revise with AI reuses the existing one-running-turn lock.
- Annotation-driven Revise with AI reuses the existing manual prompt flow.
- Annotation-driven Revise with AI reuses existing auto-apply semantics.
- Annotation-driven Revise with AI reuses existing idempotent apply behavior.
- Starting an annotation-driven revision snapshots annotations onto the durable turn.
- Starting an annotation-driven revision snapshots steering text onto the durable turn.
- `buildPlanRevisionSourceText` or an equivalent source-context builder includes structured annotations in plan-revision source context.
- The daemon-owned planning task receives read-only source context for a revision turn.
- Successful patch-bearing auto-apply resolves referenced annotations.
- Successful patch-bearing auto-apply resolves only referenced annotations.
- Answer-only revision turns leave annotations unresolved.
- Needs-input revision turns leave annotations unresolved.
- Failed revision turns leave annotations unresolved.
- Cancelled revision turns leave annotations unresolved.
- Existing manual Revise with AI remains available.
- Existing manual Revise with AI does not mark plans ready.
- Existing manual Revise with AI does not hand off plans.
- Existing manual Revise with AI does not enqueue builds.
- Existing manual Revise with AI does not mutate backlog state.
- A test asserts plan revision private storage migration or normalization behavior for annotations.
- A test asserts annotation handler behavior.
- A test asserts revision source-context snapshotting.
- A test asserts selection annotation UI behavior.
- A test asserts block annotation UI behavior.
- A test asserts sticky control behavior.
- A test asserts auto-resolve behavior after successful patch-bearing apply.
- Failed queue items that fail before `session:start` preserve the dispatch failure reason in durable events.
- Failed queue items that fail before `session:start` surface the dispatch failure reason in daemon projections.
- Failed queue items that fail before `session:start` surface the dispatch failure reason in Console recovery views.
- Queue-cascade recovery preflights dispatch validation before offering repair actions.
- Queue-cascade recovery preflight reuses or mirrors actual dispatch validation.
- Queue-cascade recovery warns when multiple `depends_on` entries exist with stacking enabled and no `stack_parent`.
- Recovery UI distinguishes blocking dependencies.
- Recovery UI distinguishes satisfied dependencies.
- Recovery UI distinguishes terminal failed or skipped dependencies.
- Recovery UI distinguishes stale or historical dependencies.
- Operators can explicitly remove satisfied `depends_on` entries before requeueing.
- Removing satisfied dependencies requires operator confirmation.
- Operators can choose and persist an explicit `stack_parent` when multiple meaningful stacked dependencies remain.
- Applying queue-cascade recovery does not silently requeue a PRD that will immediately fail known dispatch validation.
- Queue-cascade recovery copy explains that recovery requeues the existing PRD artifact.
- Queue-cascade recovery copy explains that frontmatter is preserved unless repaired.
- Repair actions show the blocker clearly.
- Repair actions show the repaired metadata clearly.
- Recovery event contracts are defined in `@eforge-build/client`.
- Recovery route contracts are defined in `@eforge-build/client`.
- Recovery wire contracts are defined in `@eforge-build/client`.
- Daemon and Console recovery code do not redeclare shared recovery wire shapes.
- Daemon projections and routes support failed queue items.
- Daemon projections and routes support recovery preflight actions.
- Daemon projections and routes support recovery repair actions.
- Console exposes recovery UI for Needs attention cases.
- A test asserts satisfied-dependency removal behavior.
- A test asserts unresolved multiple-dependency explicit-choice behavior.
- The removed extension trust flag is removed from `packages/engine/src/config.ts`.
- The removed extension trust flag is removed from config schema definitions.
- The removed extension trust flag is removed from config type definitions.
- The removed extension trust flag is removed from compatibility warnings and handling.
- The removed extension trust flag is removed from active docs.
- Configs containing the removed extension trust flag surface the field as unsupported through config validation unless a stronger compatibility requirement is discovered during implementation.
- Local hash trust records remain documented as the authoritative project/team extension trust model.
- Local hash trust records remain tested as the authoritative project/team extension trust model.
- A targeted grep check finds no active removed extension trust flag references outside any intentionally preserved historical or changelog allowlist.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0, or the targeted vitest suites for changed areas exit 0 before handoff.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

- Manually exercise the workstation flow by creating text annotations.
- Manually exercise the workstation flow by creating block annotations.
- Manually reload the workstation and confirm annotations persist.
- Manually launch annotation-driven Revise with AI.
- Manually verify that successful auto-apply resolves only referenced annotations.
- Manually or with fixture-backed tests exercise recovery for a PRD with multiple satisfied dependencies and no `stack_parent` under `stacking.enabled`.
- Manually or with fixture-backed tests exercise recovery for a PRD with multiple unresolved dependencies requiring operator choice.