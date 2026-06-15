---
id: plan-02-first-party-planning-contract-adoption
name: First-Party Planning Contract Adoption
branch: add-extension-dependency-contracts-and-remove-eforge-plan-surfaces/plan-02-first-party-planning-contract-adoption
agents:
  builder:
    effort: high
    rationale: This plan wires the new platform contract into first-party
      eforge-plan and playbook surfaces without moving product workflow
      ownership into the kernel.
  reviewer:
    effort: high
    rationale: Review must verify no host-specific planning shim is introduced while
      playbook planning-mode behavior gates on eforge-plan capability state.
  tester:
    effort: high
    rationale: Tests must cover first-party capability declarations, planning entry
      contribution routing, and playbook behavior with and without eforge-plan.
---

# First-Party Planning Contract Adoption

## Architecture Context

After dependency/capability contracts exist, first-party planning surfaces can advertise stable capabilities and playbook planning mode can depend on those capabilities. The kernel still provides generic extension discovery, capability state, daemon/client APIs, and contribution invocation; eforge-plan owns the planning workstation/deep-link product surface.

## Implementation

### Overview

Declare eforge-plan capabilities in extension metadata, add generic contribution/deep-link/workstation planning entry surfaces owned by eforge-plan, and update playbook planning-mode behavior to check the eforge-plan capability contract while autonomous playbooks continue to enqueue without that dependency.

### Key Decisions

1. eforge-plan declares stable capabilities in manifest metadata, including a planning workstation capability and a planning-mode playbook support capability.
2. Planning entry is exposed through generic extension contribution discovery: an action-backed integration command/deep link returns or points to the eforge-plan workstation URL, and the workstation remains the rich UI route.
3. Playbook daemon/client/host behavior checks the named eforge-plan capability only for `mode: planning`. `mode: autonomous` retains existing enqueue behavior and session-plan/build-source compatibility.
4. Host skills use generic contribution/workstation language and do not call or advertise `/eforge:plan`.

## Scope

### In Scope

- eforge-plan manifest capability declarations.
- eforge-plan generic planning entry contribution and deep-link/workstation routing.
- Playbook planning-mode capability check against eforge-plan.
- Client route types and renderers for a planning-mode playbook response that names the required capability and generic planning entry.
- Pi and Claude playbook skill guidance that routes planning-mode continuation through generic extension contribution discovery/invocation and the eforge-plan workstation/deep link.
- Tests for eforge-plan capabilities, contribution routing, and playbook planning-mode behavior with and without eforge-plan.

### Out of Scope

- Full eforge-playbook extraction into a native extension.
- Removing `/eforge:plan` files or command registrations; the deletion happens in the next plan.
- Cross-extension action invocation.

## Files

### Create

- `eforge/extensions/eforge-plan/package.json` — directory extension manifest with `eforge.extension.name`, `entrypoint`, version, and capability declarations.
- `test/eforge-playbook-planning-contract.test.ts` — tests for planning-mode playbook capability gating and autonomous playbook independence.

### Modify

- `eforge/extensions/eforge-plan/index.ts` — register a generic planning entry action, integration command, and action-backed deep link; add URL/workstation output that points to `/console/workstations/eforge-plan%3Aplanning-workstation`.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — assert eforge-plan registers the planning entry contribution/deep link and preserves existing backlog/session-plan actions.
- `test/eforge-plan-workstation.test.ts` — assert the planning workstation remains registered and its effective ID matches the deep-link/workstation route.
- `eforge/extensions/eforge-plan/README.md` — document declared capabilities and generic planning entry through contribution/workstation/deep-link surfaces.
- `packages/client/src/routes/playbook.ts` — add typed fields or a typed response variant for planning-mode playbooks that require `eforge.plan.planning-mode-playbook`, including unavailable dependency diagnostics and generic planning entry metadata.
- `packages/monitor/src/routes/playbook-service.ts` — for `mode: planning`, load extension capability state, return an unavailable response when eforge-plan capability is absent, and include contribution/workstation metadata when available; leave autonomous enqueue path unchanged.
- `packages/eforge/src/cli/playbook.ts` — render planning-mode playbook responses with generic extension contribution/workstation instructions instead of host-specific planning command text.
- `packages/eforge/src/cli/mcp-proxy.ts` — update playbook tool descriptions and any planning-mode response guidance to reference `eforge_extension_contribution` and eforge-plan workstation/deep-link surfaces.
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts` — when a planning playbook is selected in native Pi UI, preserve eforge-playbook workflow ownership but surface unavailable capability diagnostics or generic planning entry guidance instead of forwarding to a plan command.
- `packages/pi-eforge/extensions/eforge/index.ts` — update `eforge_playbook` and `eforge_session_plan` tool descriptions that mention full interactive planning so they reference generic eforge-plan contribution/workstation entry.
- `eforge-plugin/skills/playbook/playbook.md` — update planning-mode run flow to check/list/invoke generic eforge-plan contribution/deep-link entry and continue in the eforge-plan workstation; keep autonomous run flow unchanged.
- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` — mirror the Claude playbook guidance with Pi tool names.
- `test/cli-playbook.test.ts` and `test/daemon-session-plan-routes-playbook.test.ts` — adjust expected planning-mode messages/response shapes.
- `test/extension-contribution-client-helpers.test.ts` — add planning entry contribution resolution coverage if existing helpers expose the new action-backed deep link.
- `test/skills-docs-wiring.test.ts` — replace `/eforge:plan` playbook assertions with generic planning-entry and eforge-plan capability assertions.
- `eforge-plugin/.claude-plugin/plugin.json` — bump the Claude plugin patch version because plugin skill files change.

## Verification

- [ ] eforge-plan manifest metadata declares `eforge.plan.planning-workstation` and `eforge.plan.planning-mode-playbook` capabilities with version strings.
- [ ] eforge-plan registers an action-backed planning entry contribution whose effective ID is namespaced under `eforge-plan:`.
- [ ] eforge-plan registers a planning workstation deep link whose route points at `/console/workstations/eforge-plan%3Aplanning-workstation`.
- [ ] `eforge playbook run <planning-playbook>` returns typed planning-entry metadata when eforge-plan is loaded with the required capability.
- [ ] `eforge playbook run <planning-playbook>` returns an unavailable dependency response when eforge-plan is disabled, missing, untrusted, changed, errored, or capability-incompatible.
- [ ] `eforge playbook run <autonomous-playbook>` enqueues through the existing build queue path when eforge-plan is unavailable.
- [ ] Pi and Claude playbook skill text names generic extension contribution discovery/invocation and eforge-plan workstation/deep-link entry for planning-mode continuation.
- [ ] Pi and Claude playbook skill text contains no instruction to continue via `/eforge:plan`.
- [ ] The Claude plugin version is greater than the version at the start of this plan.
- [ ] `packages/pi-eforge/package.json` version remains `0.7.21`.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- eforge-playbook-planning-contract eforge-plan-workstation extension-contribution-client-helpers` exits 0.
