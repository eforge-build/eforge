---
id: plan-01-actionable-planning-playbooks
name: Make Planning Playbooks Produce Actionable Session Plans
branch: make-planning-mode-playbooks-produce-actionable-implementation-plans/plan-01-actionable-planning-playbooks
---

# Make Planning Playbooks Produce Actionable Session Plans

## Architecture Context

Planning-mode playbooks are consumer-facing instruction contracts in both Pi (`packages/pi-eforge/`) and the Claude Code plugin (`eforge-plugin/`). The daemon already returns `requires-agent` for planning playbooks; the bug is that first-party skill instructions allow agents to create plans that continue the audit instead of synthesizing an implementation handoff. Keep runtime behavior and data models unchanged.

Key constraints:

- Keep Pi and Claude Code skill narratives semantically aligned. `scripts/check-skill-parity.mjs` normalizes plugin MCP tool names and `/eforge:` command references, so mirrored wording outside parity-skip blocks must match after normalization.
- Bump `eforge-plugin/.claude-plugin/plugin.json` because plugin-facing skill files change.
- Do not bump `packages/pi-eforge/package.json`.
- Do not add daemon APIs, session-plan fields, or playbook schema fields.

## Implementation

### Overview

Revise the planning-mode playbook flow so it has an explicit investigation-to-implementation synthesis step. The revised instructions must direct agents to record investigation results as evidence/context while writing Scope, Code Impact, Acceptance Criteria, topic, and open questions as an actionable build handoff with concrete targets, actions, non-goals, and validation criteria.

### Key Decisions

1. Fix the behavior through skill documentation and user-facing copy, not daemon code, because the observed failure happened in agent interpretation after investigation.
2. Mirror the same flow in Pi and Claude plugin skills to prevent integration drift.
3. Add static documentation wiring tests so the core wording does not regress during future skill edits.
4. Keep the Pi native command handler change to label/description copy only; no selection or daemon request behavior changes are needed.

## Scope

### In Scope

- Add an explicit “synthesize implementation handoff” step to the planning-mode run flow in both playbook skills before session creation or update.
- Update planning-playbook Path (c) in both plan skills so topic, scope, code impact, and acceptance criteria describe the change to build rather than the completed investigation.
- Clarify that investigation findings belong in context/evidence sections.
- Require actionable sections to name concrete implementation targets, concrete actions, non-goals, validation criteria, and unresolved/open follow-up scope.
- Clarify that unresolved or judgment-heavy findings become open questions or follow-up scope, not a vague request to repeat the investigation during build.
- Update Pi native `/eforge:plan` menu copy that currently says “seed a session plan”.
- Update `docs/config.md` playbook description where it says planning playbooks create a session plan with findings.
- Bump the Claude plugin version.
- Add or update static tests that assert the actionable-handoff contract appears in the relevant skill/copy files.

### Out of Scope

- Daemon API changes.
- Session-plan data model changes.
- Playbook schema changes.
- Implementing any specific test-thinning changes discovered by a playbook.
- Changing autonomous playbook enqueue behavior.

## Files

### Create

- None.

### Modify

- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` — Update Playbook Modes wording, Branch Run summary, and Step 5.5 to require synthesis into an implementation-ready session plan before session creation or update. Include concrete targets/actions, non-goals, validation criteria, evidence/context placement, and unresolved findings handling.
- `eforge-plugin/skills/playbook/playbook.md` — Apply semantically equivalent playbook-skill changes with plugin MCP tool naming preserved.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` — Update the start menu and Path (c) to say a planning playbook investigates, synthesizes findings, then creates an implementation-ready session plan. Require the topic and actionable sections to describe the change to build.
- `eforge-plugin/skills/plan/plan.md` — Apply semantically equivalent plan-skill changes with plugin MCP tool naming preserved.
- `packages/pi-eforge/extensions/eforge/plan-command.ts` — Change the planning playbook option description from “investigate, and seed a session plan” to wording such as “investigate, then draft an implementation-ready session plan”. Do not change command dispatch behavior.
- `docs/config.md` — Update planning playbook prose to describe synthesizing investigation findings into an implementation-ready session plan, not merely creating a session plan with findings.
- `eforge-plugin/.claude-plugin/plugin.json` — Bump the patch version from `0.25.34` to `0.25.35` unless the current version has changed; in that case increment the current patch version by one.
- `test/skills-docs-wiring.test.ts` — Add static assertions for the actionable planning-playbook contract across Pi skills, plugin skills, Pi command copy, and docs/config wording.

## Detailed Guidance

### Playbook skill Step 5.5

Insert a new synthesis step after investigation/finding summary and before asking for the topic. The step must instruct the agent to:

- Convert findings into a chosen implementation target list when evidence supports a choice.
- Pick concrete actions for each selected target.
- Put confirmed findings and assumptions in Context/evidence-oriented content.
- Put implementation targets, actions, non-goals, and validation criteria in actionable sections.
- Move unresolved or judgment-heavy findings into Open Questions, follow-up scope, or non-goals.
- Avoid leaving the build plan as “perform the audit/investigation again”.

Then adjust the topic and section-writing steps so the topic describes the implementation change and section content covers scope, code impact, acceptance criteria, and open questions when those dimensions are known.

### Plan skill Path (c)

After the investigation step, add a synthesis step with the same contract. Update subsequent steps so:

- The topic prompt says the topic must describe the change to build, not the investigation already performed.
- Section writing explicitly states Scope, Code Impact, and Acceptance Criteria describe the implementation handoff.
- Investigation findings are recorded as context/evidence.
- Step 2 resumes from the synthesized handoff without re-running covered investigation.

### Parity

For every Pi skill wording change, mirror the same narrative in the corresponding plugin skill. Preserve existing platform-specific tool names only where the files already differ (`eforge_*` in Pi, `mcp__eforge__eforge_*` in plugin). Do not add parity-skip blocks for these changes unless a platform-specific affordance truly requires one.

### Tests

Extend `test/skills-docs-wiring.test.ts` with assertions that fail if the actionable-handoff contract disappears. Suggested assertions:

- Pi and plugin playbook skills contain `implementation-ready session plan` and a synthesis step heading.
- Pi and plugin plan skills state the topic describes the change to build.
- Pi and plugin plan skills mention Scope, Code Impact, and Acceptance Criteria as implementation-handoff sections.
- The planning instructions mention evidence/context placement, concrete implementation targets, concrete actions, non-goals, validation criteria, and unresolved judgment-heavy findings becoming open questions or follow-up scope.
- `packages/pi-eforge/extensions/eforge/plan-command.ts` no longer contains `seed a session plan` for the planning playbook option and does contain `implementation-ready session plan`.
- `docs/config.md` planning playbook prose contains `implementation-ready session plan`.

## Database Migration

Not applicable.

## Verification

- [ ] `packages/pi-eforge/skills/eforge-playbook/SKILL.md` contains an explicit synthesis step before session creation or update in Step 5.5.
- [ ] `packages/pi-eforge/skills/eforge-plan/SKILL.md` Path (c) states the session topic describes the change to build, not the investigation already performed.
- [ ] `packages/pi-eforge/skills/eforge-plan/SKILL.md` Path (c) states Scope, Code Impact, and Acceptance Criteria describe the implementation handoff.
- [ ] Pi and plugin skill files remain in parity according to `pnpm docs:check-parity`.
- [ ] `packages/pi-eforge/extensions/eforge/plan-command.ts` planning playbook option text does not contain `seed a session plan`.
- [ ] `docs/config.md` planning playbook prose contains `implementation-ready session plan`.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version is incremented by one patch version.
- [ ] `pnpm docs:check-parity` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- test/skills-docs-wiring.test.ts test/pi-playbook-commands.test.ts` exits 0.
