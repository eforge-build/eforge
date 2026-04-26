---
title: Improve `/eforge:plan` adaptive planning workflow
created: 2026-04-26
---

# Improve `/eforge:plan` adaptive planning workflow

## Problem / Motivation

The current `/eforge:plan` skill is too close to a one-size-fits-all checklist. It always orients planning around the same fixed dimensions: scope, code impact, architecture impact, design decisions, documentation impact, and risks. It has a small/medium/large triage step, but most non-small changes still flow through the same dimensions regardless of whether the work is a bug fix, UI change, refactor, docs update, config/API change, or architectural change.

This can make planning feel heavier than needed for simple or specialized work, and it can miss the most important questions for some work types. For example:

- Bug fixes need reproduction and expected/actual behavior.
- Refactors need invariants and equivalence guarantees.
- Docs-only work needs audience/source-of-truth/accuracy criteria rather than architecture sections.

## Goal

Make `/eforge:plan` sensitive to the type and depth of work being planned, so it asks the right amount and kind of planning questions before handoff to eforge. The improved workflow should preserve the existing session-plan handoff model under `.eforge/session-plans/`, but replace the rigid fixed-dimension feel with an adaptive planning strategy.

## Approach

Update the planning skills in both integrations:

- `packages/pi-eforge/skills/eforge-plan/SKILL.md`
- `eforge-plugin/skills/plan/plan.md`

Because build handoff warns about incomplete planning dimensions, also update build skill behavior as needed in:

- `packages/pi-eforge/skills/eforge-build/SKILL.md`
- `eforge-plugin/skills/build/build.md`

Follow repository conventions:

- Keep Pi package and Claude Code plugin skill behavior in sync.
- Bump `eforge-plugin/.claude-plugin/plugin.json` because plugin files change.
- Do not bump `packages/pi-eforge/package.json`.

Recommended design:

1. **Add an explicit planning strategy phase before deep planning.**
   - Classify `planning_type`, such as `bugfix`, `feature`, `refactor`, `architecture`, `docs`, `maintenance`, or `unknown`.
   - Classify `planning_depth`, such as `quick`, `focused`, or `deep`.
   - Allow user override.

2. **Replace fixed required dimensions with adaptive work-type playbooks.**
   - **Bug fix**: problem/symptom, reproduction or trigger, expected vs actual behavior, suspected affected area, regression test, acceptance criteria, risk.
   - **Feature**: problem/motivation, user-visible goal, scope/non-goals, UX/API behavior, code impact, docs impact, acceptance criteria, risks.
   - **Refactor**: current pain, desired internal shape, behavioral invariants, migration strategy, affected modules, test safety, rollback risk.
   - **Architecture**: current architecture, proposed boundaries/contracts, data/control flow, compatibility/migration, rollout plan, cross-package impact, deep risks.
   - **Docs**: audience, source of truth, affected docs, accuracy criteria, explicit out-of-scope code changes.
   - **Maintenance**: mechanical scope, affected files, verification, risk of drift.

3. **Make acceptance criteria a first-class planning section**, because the build formatter expects acceptance criteria as one of its core PRD sections.

4. **Track skipped dimensions with reasons** instead of treating every missing dimension as incomplete.
   - Add frontmatter fields such as `planning_type`, `planning_depth`, `confidence`, `required_dimensions`, `optional_dimensions`, `skipped_dimensions`, and/or `open_questions`.
   - Keep compatibility with existing session files where possible.

5. **Make readiness depend on relevant dimensions** rather than the old fixed checklist.
   - A plan can be ready when required dimensions for its type/depth are covered and irrelevant dimensions are explicitly skipped with reasons.

6. **Update `/eforge:build` session-plan warning behavior.**
   - If a session is still `planning`, list truly missing required dimensions and distinguish intentionally skipped dimensions.
   - Avoid warning that a plan is incomplete just because an old fixed dimension was skipped intentionally.

7. **Strengthen conversation guidance.**
   - Ask the smallest number of high-leverage questions needed to reach build-ready confidence.
   - Prefer one or a small batch of relevant questions over walking every user through the same checklist.
   - Continue to bring codebase evidence and write decisions to the session file.

### Profile Signal

Recommended profile: `excursion`.

Rationale: This is mostly skill/documentation behavior across Pi and Claude Code plugin packages, with a small plugin metadata version bump. It touches multiple files and user-facing workflow behavior, but does not require engine or daemon architecture changes.

## Scope

### In Scope

- Revise the `/eforge:plan` skill instructions to use adaptive planning type/depth strategy.
- Add first-class acceptance criteria to planning output.
- Update session-plan frontmatter/template to support adaptive planning metadata.
- Update `/eforge:build` skill instructions so session-plan readiness/warnings understand skipped or type-specific dimensions.
- Keep Pi and Claude Code plugin versions of the skills aligned.
- Bump the Claude Code plugin version.

### Out of Scope

- Building a native Pi planning wizard or overlay UI.
- Changing the daemon's core PRD formatter or planning agents.
- Changing eforge workflow profile selection logic in the engine.
- Migrating or rewriting historical `.eforge/session-plans/` files beyond maintaining compatibility.
- Adding new MCP/Pi tools.

## Acceptance Criteria

- `/eforge:plan` documentation in both Pi and Claude Code plugin describes an adaptive planning workflow based on work type and planning depth.
- New session plans include adaptive planning metadata or clearly documented compatibility behavior.
- The skill defines work-type playbooks for at least bug fixes, features, refactors, architecture changes, docs-only changes, and maintenance/mechanical work.
- Acceptance criteria are explicitly captured as part of planning readiness.
- Readiness is based on relevant required dimensions, not blindly completing the old six-dimension checklist.
- `/eforge:build` skill instructions distinguish missing required information from intentionally skipped dimensions when warning about `planning` sessions.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` and `eforge-plugin/skills/plan/plan.md` remain semantically in sync.
- `packages/pi-eforge/skills/eforge-build/SKILL.md` and `eforge-plugin/skills/build/build.md` remain semantically in sync where changed.
- `eforge-plugin/.claude-plugin/plugin.json` version is bumped.

## Risks / Edge Cases

- The new frontmatter shape could break existing assumptions in build skill text if backward compatibility is not described.
- Too much classification could become another rigid workflow; the skill should allow user override and use `unknown`/fallback when classification is uncertain.
- The plan skill and build skill could drift between Pi and Claude Code plugin copies.
- Existing active session plans use the old `dimensions` boolean shape; the improved build/plan instructions should handle old and new session files gracefully.
