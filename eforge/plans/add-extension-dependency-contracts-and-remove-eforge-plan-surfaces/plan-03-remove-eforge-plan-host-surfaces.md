---
id: plan-03-remove-eforge-plan-host-surfaces
name: Remove Hardcoded /eforge:plan Host Surfaces
branch: add-extension-dependency-contracts-and-remove-eforge-plan-surfaces/plan-03-remove-eforge-plan-host-surfaces
agents:
  builder:
    effort: high
    rationale: This is a broad deletion and documentation cleanup across Pi, Claude
      plugin, skill parity, generated references, and host-surface tests.
  reviewer:
    effort: high
    rationale: Review must verify deletion rather than compatibility shims and
      confirm Pi/Claude consumer-facing parity.
  tester:
    effort: high
    rationale: Many existing tests reference the old plan skill/command and need
      replacement with grep gates and generic planning-entry assertions.
---

# Remove Hardcoded /eforge:plan Host Surfaces

## Architecture Context

With extension contracts adopted and eforge-plan exposing generic contribution/workstation planning entry, Pi and Claude Code no longer own `/eforge:plan` command or skill surfaces. Planning entry must be discovered through generic extension contributions, deep links, and eforge-plan workstation routing. Build enqueue and session-plan compatibility APIs remain because they are intentional daemon/client/input plumbing.

## Implementation

### Overview

Delete the packaged plan skill and native plan command surfaces, remove parity references, update user-facing docs and skills to route planning through generic contribution/workstation surfaces, add regression gates proving no plan shim remains, and regenerate reference docs when docs output changes.

### Key Decisions

1. Treat `/eforge:plan` as deleted, not deprecated. Do not leave forwarding aliases, compatibility commands, or hidden skills.
2. Keep generic `eforge_session_plan`, playbook, enqueue, and client/daemon session-plan APIs because they are compatibility plumbing rather than host-specific `/eforge:plan` surfaces.
3. Keep Pi and Claude behavior aligned: remove the plan skill from both packaged surfaces and update shared skill parity for the remaining skills.
4. Bump the Claude plugin patch version for plugin manifest/skill changes. Do not bump the Pi package version.

## Scope

### In Scope

- Delete Pi native `eforge:plan` registration, handler import, and handler file.
- Delete Pi packaged `eforge-plan` skill directory.
- Remove Claude plugin plan command entry and packaged plan skill directory.
- Update skill parity script and tests to remove the plan pair.
- Update docs, skills, generated reference content, and tests that advertise `/eforge:plan` as planning entry.
- Add grep-style tests that prove Pi and Claude no longer register, package, or advertise `/eforge:plan`.
- Preserve generic extension contribution discovery/invocation, eforge-plan workstation routing, and eforge-plan deep-link routing.

### Out of Scope

- Removing session-plan daemon/client/input APIs.
- Removing autonomous playbook support.
- Adding a `/eforge:plan` compatibility shim.

## Files

### Delete

- `packages/pi-eforge/extensions/eforge/plan-command.ts` — native Pi plan command handler.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` and its parent skill directory — packaged Pi plan skill.
- `eforge-plugin/skills/plan/plan.md` and its parent skill directory — packaged Claude plan skill.

### Modify

- `packages/pi-eforge/extensions/eforge/index.ts` — remove `handlePlanCommand` import and `pi.registerCommand("eforge:plan", ...)`; update session-plan tool descriptions that referenced the old plan skill.
- `packages/pi-eforge/package.json` — remove no fields unless packaging config requires a narrower skills list; leave `version` unchanged.
- `packages/pi-eforge/README.md` — remove `/eforge:plan` skill advertising and point planning entry at eforge-plan workstation/deep-link/contribution surfaces.
- `eforge-plugin/.claude-plugin/plugin.json` — remove `./skills/plan/plan.md` from `commands` and bump patch version.
- `scripts/check-skill-parity.mjs` — remove the `plan` ↔ `eforge-plan` pair and update comments/count expectations.
- `eforge-plugin/skills/build/build.md` and `packages/pi-eforge/skills/eforge-build/SKILL.md` — replace advice to resume planning through `/eforge:plan --resume` with generic eforge-plan planning entry/workstation guidance.
- `eforge-plugin/skills/config/config.md` and `packages/pi-eforge/skills/eforge-config/SKILL.md` — remove route-table entries that advertise `/eforge:plan`.
- `eforge-plugin/skills/init/init.md` and `packages/pi-eforge/skills/eforge-init/SKILL.md` — update next-step command tables to generic planning entry.
- `eforge-plugin/skills/recover/recover.md` and `packages/pi-eforge/skills/eforge-recover/SKILL.md` — update replanning guidance to generic planning entry.
- `eforge-plugin/skills/restart/restart.md` — update any command table entries that advertise `/eforge:plan`.
- `eforge-plugin/skills/update/update.md` and `packages/pi-eforge/skills/eforge-update/SKILL.md` — remove plan command advertising.
- `eforge-plugin/skills/playbook/playbook.md` and `packages/pi-eforge/skills/eforge-playbook/SKILL.md` — remove remaining `/eforge:plan` references left after plan 2 and retain generic eforge-plan contribution/workstation wording.
- `packages/eforge/src/cli/mcp-proxy.ts` and `packages/pi-eforge/extensions/eforge/index.ts` — remove `/eforge:plan` references in `eforge_session_plan` descriptions while retaining session-plan tools.
- `packages/client/src/routes/playbook.ts`, `packages/monitor/src/routes/playbook-service.ts`, and `packages/eforge/src/cli/playbook.ts` — remove old response text that directs users to `/eforge:plan`.
- `docs/config.md`, `docs/architecture.md`, `docs/extensions-api.md`, `web/content/docs/getting-started.md`, `web/content/docs/integrations.md`, `web/content/docs/concepts.md`, `web/content/docs/glossary.md`, `web/content/docs/playbooks.md`, `web/content/docs/extensions-api.md`, and `web/content/reference/tools.md` — replace host-specific planning command documentation with contribution/workstation/deep-link planning entry. Regenerate `web/public/**` through the docs generator when reference artifacts change.
- `test/profile-wiring-mcp-native.test.ts` — replace the native plan handler assertion with an absence assertion.
- `test/skills-docs-wiring.test.ts` — remove plan-skill AC guidance suites or move AC guidance assertions to formatter/planner prompts that remain in the product.
- `test/extension-contribution-host-surfaces.test.ts` — extend host contribution tests to cover generic planning entry and absence of `/eforge:plan` shims.
- `test/reference-content.test.ts`, `test/build-profile-selection-skill.test.ts`, `test/profile-wiring-forwarding.test.ts`, `test/profile-wiring-plugin-pi.test.ts`, `test/extension-authoring-skill.test.ts`, `test/extension-framebundle-docs-contract.test.ts`, and any nearby version/skill-list tests — update expected plugin version, skill lists, and plan-skill assumptions.
- `test/eforge-resource-filter.test.ts` and `test/pi-harness-resource-isolation.test.ts` — replace fake `eforge-plan` skill paths only if assertions require an existing packaged skill.

### Create

- `test/eforge-plan-host-surface-removal.test.ts` — grep/fixture gate for absence of Pi command registration/handler, absence of packaged Pi skill, absence of Claude plan command/skill, absence of `/skill:eforge-plan`, and continued presence of generic `eforge_extension_contribution` plus eforge-plan workstation/deep-link entries.

## Verification

- [ ] `packages/pi-eforge/extensions/eforge/index.ts` contains no `pi.registerCommand("eforge:plan"` and no `handlePlanCommand` import.
- [ ] `packages/pi-eforge/extensions/eforge/plan-command.ts` is absent.
- [ ] `packages/pi-eforge/skills/eforge-plan/` is absent from the repository and package output.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` contains no `skills/plan/plan.md` command entry.
- [ ] `eforge-plugin/skills/plan/` is absent.
- [ ] No Pi or Claude file contains `/skill:eforge-plan`.
- [ ] New grep tests prove Pi and Claude no longer register, package, or advertise `/eforge:plan`.
- [ ] Generic `eforge_extension_contribution` and Pi `/eforge:extensions` remain registered.
- [ ] eforge-plan planning workstation routing remains present at `/console/workstations/eforge-plan%3Aplanning-workstation`.
- [ ] eforge-plan planning deep-link/contribution routing remains present in the contribution manifest tests.
- [ ] Docs under `docs/` and `web/content/docs/` do not describe planning entry through `/eforge:plan`.
- [ ] Session-plan daemon/client/input routes and tools remain available.
- [ ] The Claude plugin version is greater than the version produced by plan 2.
- [ ] `packages/pi-eforge/package.json` version remains `0.7.21`.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- eforge-plan-host-surface-removal extension-contribution-host-surfaces profile-wiring-mcp-native skills-docs-wiring` exits 0.
- [ ] `pnpm docs:check` exits 0 when docs/reference artifacts changed.
