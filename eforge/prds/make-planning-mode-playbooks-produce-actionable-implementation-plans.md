---
title: Make Planning-Mode Playbooks Produce Actionable Implementation Plans
created: 2026-05-28
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Make Planning-Mode Playbooks Produce Actionable Implementation Plans

## Problem / Motivation

Planning-mode playbooks can currently lead agents to create session plans that restate or continue the investigation, rather than converting investigation findings into an implementation-ready plan.

A planning-mode playbook was run for test thinning. The agent performed the investigation correctly, but the first resulting session plan was framed as an audit plan rather than an implementation-ready plan based on the audit findings. The user had to clarify that the investigation was already done and that the plan should identify concrete changes to build.

User-visible symptom:

- Running the `test-thinning-audit` planning playbook produced useful audit evidence, including duplicate `monitor-ui` / `console-ui` test targets.
- The resulting session plan initially described doing an audit / thinning discovery again.
- The user expected the playbook to do planning work up front and produce a concrete actionable plan for `/eforge:build`.

Why it matters:

- Planning-mode playbooks are meant to front-load recurring investigation so the resulting session plan can be reviewed and built.
- If the session plan repeats the playbook investigation objective, eforge wastes human / agent time and risks enqueueing vague or non-actionable work.
- The ambiguity affects both Pi and Claude Code skill flows because both contain similar planning-mode instructions.

Observed reproduction:

1. Run `/skill:eforge-playbook run test-thinning-audit`.
2. The agent performs the intended audit investigation and reports concrete findings, including duplicate `monitor-ui` / `console-ui` test targets.
3. The user asks to create the session plan.
4. The initial session plan is created around a test-thinning audit / broad candidate review, not around implementing a concrete target list from the audit.
5. The user clarifies: “I want this plan to be for the actual test thinning, not for an audit.”
6. After another refinement, the user further clarifies that the playbook should have helped produce a concrete actionable plan rather than a plan that assumes the audit will happen again during build.

Expected behavior:

- After investigation, the agent synthesizes findings into a specific implementation-ready plan: chosen targets, scope boundaries, files to change, out-of-scope follow-ups, and build-ready acceptance criteria.

Actual behavior:

- Existing instructions allowed the agent to write investigation findings and continue generic planning, without an explicit transformation step from findings to actionable build plan.

Confirmed root cause:

- The planning-mode playbook instructions emphasize investigation and writing findings, but do not explicitly state that the created session plan must be an actionable implementation plan derived from those findings.

Evidence:

- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` Step 5.5 says to identify targets, investigate, summarize findings, ask for a topic, create the session plan, and write concrete sections.
- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` Step 6 says “At minimum write a scope or goal section reflecting the playbook intent plus investigation results.”
- This wording leaves room for the scope to mirror the playbook’s investigation goal rather than the implementation outcome.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` Path (c) says to write investigation findings as concrete section content and then proceed to Step 2.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` does not require selecting concrete implementation targets or re-scoping the plan from “investigate X” to “change Y based on the investigation.”
- `eforge-plugin/skills/playbook/playbook.md` and `eforge-plugin/skills/plan/plan.md` contain parallel wording, so fixing only Pi would create behavior drift.

Likely contributing factor:

- UI / help wording such as “investigate, and seed a session plan” can imply the output is a seeded investigation artifact rather than a build-ready implementation plan.

Root cause category:

- Instruction-contract bug in first-party skill documentation and possibly related UI / help copy, not a daemon / session-plan data model defect.

Roadmap alignment:

- This supports the Console Workbench planning workspace direction and thin integration strategy by improving the session-plan artifact handoff semantics.

## Goal

Planning-mode playbooks should produce implementation-ready session plans derived from investigation findings, rather than plans that repeat or continue the investigation.

The resulting plan should identify concrete changes to build, including chosen targets, scope boundaries, code impact, open questions or follow-ups, and build-ready acceptance criteria.

## Approach

Update first-party skill instructions and related user-facing copy so planning-mode playbook flows explicitly transform investigation findings into actionable implementation plans.

Primary skill instruction files to update:

- `packages/pi-eforge/skills/eforge-playbook/SKILL.md`
- `packages/pi-eforge/skills/eforge-plan/SKILL.md`
- `eforge-plugin/skills/playbook/playbook.md`
- `eforge-plugin/skills/plan/plan.md`

Likely wording updates:

- Add an explicit “synthesize implementation plan” step after investigation and before session creation in the planning-mode playbook run flow.
- Require the session topic and scope to describe the change to build, not the investigation itself.
- Require choosing concrete targets / actions from the findings when evidence supports them.
- Require splitting unresolved judgment-heavy findings into follow-up / open questions instead of leaving the whole plan as another investigation.
- Clarify that investigation findings belong in Context / assumptions / evidence sections.
- Clarify that Scope / Code Impact / Acceptance Criteria must describe the actionable implementation handoff.

Secondary user-facing copy to review / update if needed:

- `packages/pi-eforge/extensions/eforge/plan-command.ts` option description currently says “Load a planning playbook, investigate, and seed a session plan.”
- Consider wording like “investigate, then draft an implementation-ready session plan.”
- `docs/config.md` planning playbook description may need to clarify “implementation-ready session plan derived from findings.”

Parity and packaging requirements:

- Keep Pi and Claude plugin skill wording semantically aligned.
- Bump `eforge-plugin/.claude-plugin/plugin.json` because plugin-facing files change.
- Keep `eforge-plugin/` and `packages/pi-eforge/` consumer-facing behavior in sync.

Relevant tests / checks:

- `pnpm docs:check-parity` or `node scripts/check-skill-parity.mjs` should pass after skill updates.
- `pnpm test -- test/skills-docs-wiring.test.ts test/pi-playbook-commands.test.ts` may be useful if wording or command behavior changes.
- `pnpm maintainability:check` should pass.

Material assumptions:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---:|---:|---|---|
| This is best fixed in skill / playbook instructions rather than daemon APIs. | The daemon already returns `requires-agent` for planning playbooks; the failure was agent interpretation during interactive planning. | High | Low | Inspect implementation only if skill wording cannot enforce behavior. | Changing daemon APIs would add unnecessary scope. |
| Updating both Pi and Claude plugin skill files is sufficient for first-party agent behavior. | Both integration packages carry the same planning-mode flow text. | High | Low | Run docs / skill parity checks after edits. | One integration could keep producing non-actionable plans. |
| Native Pi menu copy may contribute to the ambiguity. | The plan command option says “investigate, and seed a session plan.” | Medium | Low | Review and update copy if it still implies template seeding rather than actionable handoff. | Users and agents may keep thinking the output is just an investigation seed. |
| The exact wording can be improved without adding new daemon / session-plan fields. | The session plan format already supports context, scope, code-impact, acceptance criteria, and open questions. | High | Low | Validate by ensuring the revised instructions mention where findings vs implementation plan content should go. | A data-model change would be larger than needed. |

Recommended profile: **Excursion**.

Rationale:

- This is a multi-file consumer-facing behavior / documentation fix across Pi and Claude plugin skills.
- The scope is cohesive and does not require delegated module planning.
- It is not an Errand because parity, wording, plugin versioning, and docs / checks must all be handled carefully.

## Scope

In scope:

- Update planning-mode run flow instructions in `packages/pi-eforge/skills/eforge-playbook/SKILL.md`.
- Update planning-playbook path instructions in `packages/pi-eforge/skills/eforge-plan/SKILL.md`.
- Update semantically equivalent Claude Code skill instructions in `eforge-plugin/skills/playbook/playbook.md`.
- Update semantically equivalent Claude Code skill instructions in `eforge-plugin/skills/plan/plan.md`.
- Review and update `packages/pi-eforge/extensions/eforge/plan-command.ts` if the option copy remains misleading.
- Review and update `docs/config.md` if the planning playbook description needs wording changes for the new user-facing behavior.
- Bump `eforge-plugin/.claude-plugin/plugin.json` if any file under `eforge-plugin/` changes.
- Preserve Pi and Claude plugin behavior parity.
- Validate skill parity and maintainability checks.

Out of scope:

- Daemon API changes.
- Session-plan data model changes.
- New daemon / session-plan fields.
- Re-running the `test-thinning-audit` implementation itself.

## Acceptance Criteria

- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` planning-mode run flow explicitly requires synthesizing investigation findings into an implementation-ready session plan before creating or updating the session.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` planning-playbook path explicitly requires the session topic to describe the change to build rather than the investigation that was already performed.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` planning-playbook path explicitly requires the scope to describe the change to build rather than the investigation that was already performed.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` planning-playbook path explicitly requires code impact to describe the change to build rather than the investigation that was already performed.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` planning-playbook path explicitly requires acceptance criteria to describe the change to build rather than the investigation that was already performed.
- `eforge-plugin/skills/playbook/playbook.md` contains semantically equivalent planning-mode run instructions to the Pi playbook skill.
- `eforge-plugin/skills/plan/plan.md` contains semantically equivalent planning-playbook path instructions to the Pi plan skill.
- Planning-mode instructions state that investigation findings should be recorded as evidence or context.
- Planning-mode instructions state that actionable sections should name concrete implementation targets.
- Planning-mode instructions state that actionable sections should name concrete actions.
- Planning-mode instructions state that actionable sections should name non-goals.
- Planning-mode instructions state that actionable sections should name validation criteria.
- Planning-mode instructions state that unresolved or judgment-heavy findings should become explicit open questions or follow-up scope.
- Planning-mode instructions do not allow unresolved or judgment-heavy findings to remain as a vague request to re-run the investigation during build.
- `packages/pi-eforge/extensions/eforge/plan-command.ts` planning playbook option copy no longer describes the output only as seeding a plan if that wording remains misleading.
- `eforge-plugin/.claude-plugin/plugin.json` version is bumped if any file under `eforge-plugin/` changes.
- `pnpm docs:check-parity` exits 0.
- `pnpm maintainability:check` exits 0.
