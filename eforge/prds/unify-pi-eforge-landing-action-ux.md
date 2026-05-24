---
title: Unify Pi eforge Landing-Action UX
created: 2026-05-24
profile: gpt-claude-combo
---

# Unify Pi eforge Landing-Action UX

## Problem / Motivation

The Pi extension currently presents landing options inconsistently between `/eforge:build` and `/eforge:playbook run`:

- `/eforge:build` prompts for source/profile, then delegates to the build skill. Landing action is mostly implicit and only prompts for unsafe trunk remediation inside `eforge_build`.
- `/eforge:playbook run` always prompts for an explicit landing action for autonomous playbooks, even when the user may want the project default.
- Playbook run shows `merge-to-base-branch` as a normal option even when the current branch is the configured trunk branch and `build.allowLocalMergeToTrunk` is not enabled, then remediates only after selection.
- Landing vocabulary/mapping and policy checks are split across `landing-gate.ts`, `trunk-landing.ts`, `index.ts`, CLI helpers, and skill docs.

This creates UX drift and makes branch-protection behavior harder to reason about.

## Goal

Create a clean, shared landing-selection model and Pi UI flow so build and autonomous playbook runs present landing choices consistently and safely.

The shared flow should be branch-aware, respect eforge config defaults, and avoid presenting unsafe options as normal choices.

## Approach

1. Add/refactor a shared pure landing policy/menu helper for Pi extension workflows.
   - Inputs should include effective configured/default landing action, current branch, resolved trunk branch, `allowLocalMergeToTrunk`, and whether “use project default” should be offered.
   - Outputs should describe selectable landing choices, disabled/omitted unsafe choices, default labels/descriptions, and any remediation choices.

2. Use the shared selector from both workflows:
   - `/eforge:build` confirmation/enqueue flow should offer the same landing choices as playbook runs when appropriate.
   - `/eforge:playbook run` for autonomous playbooks should use the same shared selector instead of owning a separate landing menu.

3. Let playbook runs inherit the project default.
   - Add a “Use project default” option.
   - If selected, enqueue without `onSuccess`.
   - Only pass `onSuccess` when the user chooses an explicit override.

4. Improve protected-trunk behavior.
   - If current branch is trunk and local trunk merge is not enabled, do not present `merge-to-base-branch` as a normal selectable landing action.
   - If the effective default is unsafe, show a clear warning and valid choices such as `pr`, `leave`, config opt-in, or cancel.
   - Keep the final `eforge_build`/engine guard as a safety backstop for direct tool calls and headless contexts.

5. Prefer typed shared client APIs for config access.
   - Avoid ad-hoc `/api/config/show?verbose=true` string construction in Pi extension code if possible.
   - Add or use a typed client helper for verbose config show responses.

6. Keep plugin/Pi docs and skills aligned where user-facing behavior changes.

## Scope

In scope:

- Pi extension build/playbook landing UX and shared helpers.
- Tests for pure policy/menu behavior and Pi playbook/build command integration where practical.
- User-facing docs/skill instruction updates for build and playbook flows.

Out of scope:

- Changing engine landing semantics.
- Removing engine/runtime trunk safety checks.
- Changing non-Pi CLI behavior unless a small shared helper extraction makes sense and is low-risk.
- Implementing new branch creation workflows.

## Acceptance Criteria

- Build and autonomous playbook workflows present landing actions using a shared implementation/model.
- Playbook autonomous runs can choose “Use project default” and omit `onSuccess` when selected.
- On protected trunk, local merge is not offered as a normal selectable action unless `build.allowLocalMergeToTrunk: true` is enabled.
- If the default action is unsafe on protected trunk, the UI clearly explains why and offers safe alternatives/remediation.
- Direct `eforge_build` tool calls still guard unsafe trunk local merges.
- Tests cover feature-branch, protected-trunk, opt-in trunk, default-inheritance, and explicit override cases.
- Pi build/playbook skill docs reflect the unified behavior.
- Existing build/playbook workflows continue to enqueue successfully with profile overrides and active-build dependency choices.
