---
title: Move eforge-plan Prompts to Extension-Owned Tasks
created: 2026-06-24
depends_on: ["sqlite-backed-eforge-plan-store"]
stack_parent: sqlite-backed-eforge-plan-store
---

# Move eforge-plan Prompts to Extension-Owned Tasks

## Problem / Motivation

eforge-plan prompt ownership is currently mixed into engine prompt assets and engine agent-task code. This blurs the kernel/extension boundary by requiring the engine to know about eforge-plan prompt ids, selection rules, and recovery behavior.

This work separates product-specific prompt ownership from generic engine execution so eforge-plan owns its planning and backlog-curation prompt assets plus prompt-to-task mapping, while the daemon/extension layer resolves those owner-scoped contributions and the engine kernel only runs generic resolved agent tasks.

## Goal

Create a clean kernel/extension separation for eforge-plan prompt ownership while preserving current planning, revision, session-plan, recommendation refresh, and backlog-curation behavior.

Behavioral continuity should come from preserving prompt text, tool instructions, and result validation in the eforge-plan extension, not from engine-side eforge-plan fallbacks or prompt-prefix filtering.

## Approach

- Move all current eforge-plan prompt templates out of `packages/engine/src/prompts/`.
- Treat eforge-plan prompt files as extension package assets.
- Add build/package assertions around the eforge-plan asset surface rather than engine checks for eforge-plan names.
- Use a clean handoff where extension-facing requests identify an eforge-plan-owned prompt/task contribution.
- Have daemon/extension resolution produce a generic resolved prompt payload before engine invocation.
- Have the daemon/extension layer validate the requesting extension owner, resolve declared prompt assets or exports, and pass resolved prompt text plus generic task configuration into the engine.
- Distinguish extension-facing prompt references from engine-facing resolved prompt payloads in the public contract.
- Allow extension callers to name owner-scoped contributions.
- Ensure the engine receives plain resolved data and opaque provenance at most.
- Keep kernel prompt loading available only for true kernel prompts.
- Expose prompt/task contribution declarations from `@eforge-build/extension-sdk` so eforge-plan and future extensions can provide prompt-backed agent tasks without adding files or product rules to the engine.
- Constrain prompt asset resolution to declared owner-scoped assets rather than arbitrary paths.
- Preserve model-facing behavior by moving the existing prompt text, schema instructions, submit/progress tool instructions, and backlog-curation map/reduce constraints into eforge-plan contributions without semantic edits.
- Keep prompt interpolation fail-closed.
- Ensure unresolved `{{variable}}` tokens fail before model invocation.
- Ensure extension-resolved prompts use the same generic substitution path as kernel prompts.
- Do not preserve old `eforge-plan-*` engine prompt names as hidden engine fallbacks.
- If a public API transition is unavoidable, handle it with a generic, versioned daemon/client adapter outside engine task execution.
- Do not add engine runtime filters, scanners, or allow/deny lists keyed to eforge-plan, extension ids, or prompt prefixes.
- Represent the boundary through package ownership, contribution registration, typed contracts, and product-agnostic engine interfaces.
- Represent backlog-curation map/reduce no-tool and validation/repair constraints as eforge-plan task configuration and prompt content, not as eforge-plan-specific kernel logic.

Assumptions:

- eforge-plan prompts can be registered as extension-owned assets or exports and included in the built extension artifact without requiring engine filesystem access to extension internals.
- Completed task records do not need migration because results are already stored.
- New task starts can use the extension-owned contribution path.
- If a daemon/client API transition is needed, it can be handled outside engine task execution and should not reintroduce eforge-plan prompt names into the kernel.

Risks to watch:

- Extension/daemon resolution may accidentally leak product assumptions into the engine.
- Any eforge-plan-specific engine branch is a design failure and should be moved back to extension-owned contributions or daemon resolution.
- Prompt asset packaging can silently fail if markdown files move without build inclusion.
- Prompt variable drift can change model behavior.
- Backlog-curation map/reduce has stricter no-tool and validation/repair behavior than normal planning tasks.

## Scope

In scope:

- Move `eforge-plan-planning-draft.md` out of `packages/engine/src/prompts/`.
- Move `eforge-plan-backlog-curation-item-audit.md` out of `packages/engine/src/prompts/`.
- Move `eforge-plan-backlog-curation-reducer.md` out of `packages/engine/src/prompts/`.
- Move eforge-plan-specific prompt selection out of engine agent code.
- Move eforge-plan-specific task mapping out of engine agent code.
- Move eforge-plan-specific prompt selection and task mapping into eforge-plan-owned contributions plus daemon/extension resolution.
- Define the minimal contract split where extension-facing requests identify an owner-scoped prompt/task contribution.
- Define the minimal contract split where engine-facing calls carry resolved prompt content and generic task configuration.
- Limit engine changes to product-agnostic task execution concerns.
- Product-agnostic task execution concerns include harness invocation, interpolation safety, custom tool plumbing, cancellation, lifecycle events, and generic result handling.
- Update `packages/client/src/extension-agent-tasks.ts` only as needed to support extension-owned prompt declarations and resolution.
- Update the daemon extension agent-task service only as needed to support extension-owned prompt declarations and resolution.
- Update `@eforge-build/extension-sdk` only as needed to support extension-owned prompt declarations and resolution.
- Update eforge-plan actions only as needed to support extension-owned prompt declarations and resolution.
- Preserve the current planning draft behavior through eforge-plan-owned wiring.
- Preserve the current plan revision behavior through eforge-plan-owned wiring.
- Preserve the current session-plan creation behavior through eforge-plan-owned wiring.
- Preserve the current recommendation refresh behavior through eforge-plan-owned wiring.
- Preserve the current backlog-curation map/reduce behavior through eforge-plan-owned wiring.

Out of scope:

- Engine allow/deny lists keyed to eforge-plan.
- Prompt-prefix scanners.
- eforge-plan-specific engine fallbacks.
- Redesigning the full planning result schema.
- Removing eforge-plan workflows.
- Migrating unrelated kernel built-ins.
- Engine runtime filters, scanners, or allow/deny lists keyed to eforge-plan, extension ids, or prompt prefixes.

## Acceptance Criteria

- A source audit documents `eforge-plan-planning-draft.md`.
- A source audit documents `eforge-plan-backlog-curation-item-audit.md`.
- A source audit documents `eforge-plan-backlog-curation-reducer.md`.
- A source audit documents every code path that currently selects an eforge-plan prompt template.
- A source audit documents every code path that currently loads an eforge-plan prompt template.
- The source audit is used solely to drive removal or relocation.
- `eforge-plan-planning-draft.md` is removed from `packages/engine/src/prompts/`.
- `eforge-plan-backlog-curation-item-audit.md` is removed from `packages/engine/src/prompts/`.
- `eforge-plan-backlog-curation-reducer.md` is removed from `packages/engine/src/prompts/`.
- `eforge-plan-planning-draft.md` exists in an eforge-plan-owned source/package asset location.
- `eforge-plan-backlog-curation-item-audit.md` exists in an eforge-plan-owned source/package asset location.
- `eforge-plan-backlog-curation-reducer.md` exists in an eforge-plan-owned source/package asset location.
- Engine agent-task execution accepts generic resolved prompt/task input for the moved eforge-plan flows.
- Engine agent-task execution has no branch tied to eforge-plan prompt ids.
- Engine agent-task execution has no fallback tied to eforge-plan prompt ids.
- Engine agent-task execution has no filter tied to eforge-plan prompt ids.
- Engine agent-task execution has no prompt-name selection tied to eforge-plan prompt ids.
- Engine agent-task execution has no branch tied to eforge-plan extension ids.
- Engine agent-task execution has no fallback tied to eforge-plan extension ids.
- Engine agent-task execution has no filter tied to eforge-plan extension ids.
- Engine agent-task execution has no prompt-name selection tied to eforge-plan extension ids.
- Engine agent-task execution has no branch tied to eforge-plan prompt prefixes.
- Engine agent-task execution has no fallback tied to eforge-plan prompt prefixes.
- Engine agent-task execution has no filter tied to eforge-plan prompt prefixes.
- Engine agent-task execution has no prompt-name selection tied to eforge-plan prompt prefixes.
- The eforge-plan extension declares a prompt-backed task contribution for planning draft.
- The eforge-plan extension declares a prompt-backed task contribution for plan revision.
- The eforge-plan extension declares a prompt-backed task contribution for session-plan creation.
- The eforge-plan extension declares a prompt-backed task contribution for recommendation refresh.
- The eforge-plan extension declares a prompt-backed task contribution for backlog item audit.
- The eforge-plan extension declares a prompt-backed task contribution for backlog reducer.
- The daemon/extension service resolves owner-scoped eforge-plan prompt contributions.
- The daemon/extension service passes resolved prompt text to the engine.
- The daemon/extension service passes generic task configuration to the engine.
- Arbitrary path strings are not accepted as engine inputs.
- Existing task result validation continues to behave the same after the move.
- Existing submit custom tools continue to behave the same after the move.
- Existing progress custom tools continue to behave the same after the move.
- Existing lifecycle events continue to behave the same after the move.
- Existing cancellation behavior continues to behave the same after the move.
- Existing backlog-curation validation behavior continues to behave the same after the move.
- Existing backlog-curation repair behavior continues to behave the same after the move.
- A targeted test covers the generic engine runner with neutral fixtures.
- A targeted test covers eforge-plan contribution resolution in the daemon/extension layer.
- A targeted test covers packaged prompt assets.
- A targeted test covers unresolved-variable failures.
- A targeted test covers backlog-curation map behavior.
- A targeted test covers backlog-curation reduce behavior.
- A targeted test covers extension contribution declaration.
- A targeted test covers daemon owner-scoped resolution.
- A targeted test covers client schema parsing if the wire shape changes.
- A targeted test covers generic engine invocation with resolved prompt content.
- A targeted test covers backlog-curation map/reduce prompt use.
- Package-level assertions verify the eforge-plan markdown assets are included after moving.
- `pnpm type-check` exits 0.
- Targeted tests exit 0.
- `pnpm test` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

- Manually start a planning agent task from eforge-plan.
- Manually start an analyze-all backlog-curation task from eforge-plan.
- Compare output shape against the current workflow.
- Compare tool behavior against the current workflow.
- Compare preview behavior against the current workflow.