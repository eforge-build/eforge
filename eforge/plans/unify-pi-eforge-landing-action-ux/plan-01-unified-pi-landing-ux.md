---
id: plan-01-unified-pi-landing-ux
name: Unified Pi Landing-Action UX
branch: unify-pi-eforge-landing-action-ux/plan-01-unified-pi-landing-ux
agents:
  builder:
    effort: high
    rationale: Coordinates a shared pure policy model, Pi command flows, typed
      client helpers, tests, and parity-sensitive skill docs across multiple
      packages.
  reviewer:
    effort: high
    rationale: The UX policy must preserve trunk-safety backstops and avoid
      regressions in build/playbook enqueue paths.
  test-writer:
    effort: high
    rationale: Acceptance requires coverage for feature branches, protected trunk,
      opt-in trunk, default inheritance, explicit overrides, and native command
      integration.
---

# Unified Pi Landing-Action UX

## Architecture Context

The Pi integration currently splits landing behavior between `landing-gate.ts`, `trunk-landing.ts`, native command handlers, direct tool handlers in `index.ts`, and skill docs. The daemon and engine already accept `onSuccess` overrides and retain runtime trunk protection in `packages/engine/src/landing.ts`; this plan keeps engine landing semantics unchanged and adds a Pi-facing shared selection model on top.

The shared model belongs in `packages/pi-eforge/extensions/eforge/` because it is UI-policy specific to Pi workflows. Typed verbose config access belongs in `@eforge-build/client` so Pi code no longer constructs `GET /api/config/show?verbose=true` itself.

## Implementation

### Overview

Add a pure landing policy/menu helper that computes branch-aware choices for both `/eforge:build` and autonomous `/eforge:playbook run`. Refactor Pi UI prompts to render those choices, including a “Use project default” option when safe. Update playbook enqueue calls to omit `onSuccess` for project-default inheritance. Update build command routing to offer the same landing selector before delegation to the build skill when the user has not already supplied an explicit landing override. Keep the direct `eforge_build` tool guard for unsafe trunk local merges.

### Key Decisions

1. **Separate pure policy from UI execution.** The new helper returns choice objects, warning text, omitted/unsafe choice metadata, and remediation choices. UI code only renders the model and performs side effects such as config mutation.
2. **Use project default means no override.** The helper selection result distinguishes `project-default` from explicit `issue-pr`, `merge-to-base-branch`, and `leave-branch`; enqueue bodies include `onSuccess` only for explicit selections.
3. **Protected trunk omits unsafe merge as a normal selectable action.** When `currentBranch === trunkBranch`, effective/default landing is `merge-to-base-branch`, and `allowLocalMergeToTrunk !== true`, the normal menu excludes direct merge/default-as-merge and presents warning/remediation choices: explicit PR, leave branch, update config when a project config path exists, and cancel.
4. **Client owns verbose config URL construction.** Add typed `apiShowConfigVerbose*` helpers using `API_ROUTES.configShow` inside `packages/client`; Pi landing code imports those helpers instead of appending query strings locally.
5. **Skill parity remains enforced.** Update both Pi skill markdown and Claude Code plugin skill markdown for build/playbook behavior, and bump `eforge-plugin/.claude-plugin/plugin.json` because plugin files change. Do not bump `packages/pi-eforge/package.json`.

## Scope

### In Scope

- New pure Pi landing policy/menu helper and tests.
- Refactor `landing-gate.ts` to load typed verbose config and render shared policy choices.
- Use shared selector from autonomous playbook native command flow.
- Use shared selector from native `/eforge:build` flow when UI is available and no explicit landing override is already present.
- Preserve profile override handling and active-build dependency handling.
- Add typed verbose config client helpers and exports.
- Update Pi and Claude Code plugin build/playbook skill docs plus plugin version.

### Out of Scope

- Engine landing semantics changes.
- Removal of engine/runtime trunk guard behavior.
- Non-Pi CLI UX changes beyond using shared client helper types where necessary.
- Branch creation workflows.
- Pi package version changes.

## Files

### Create

- `packages/pi-eforge/extensions/eforge/landing-policy.ts` — Pure landing selection model. Export wire-value types or import `BuildOnSuccess`, choice/result interfaces, label/description helpers, unsafe/default detection, and a `buildLandingMenuModel(input)` function.
- `test/pi-landing-policy.test.ts` — Focused tests for the pure policy model covering feature branch, protected trunk, local-trunk opt-in, default inheritance, explicit override, omitted unsafe merge, and remediation choice metadata.
- `test/pi-build-command.test.ts` — Native `/eforge:build` command tests for project-default omission, explicit override argument forwarding, existing profile override preservation, explicit landing argument bypass, and headless fallback.

### Modify

- `packages/client/src/types.ts` — Add typed verbose config response interfaces, e.g. `ConfigSourceInfo` and `ConfigShowVerboseResponse`, while keeping the existing non-verbose config response opaque if desired.
- `packages/client/src/api/config.ts` — Add `apiShowConfigVerbose` and `apiShowConfigVerboseIfRunning` helpers using `API_ROUTES.configShow` with a verbose query parameter.
- `packages/client/src/index.ts` and `packages/client/src/browser.ts` — Export the new verbose config helper(s) and response type(s) where existing config helpers are exported.
- `test/client-no-start-api-helpers.test.ts` — Add `apiShowConfigVerboseIfRunning` to the passive helper coverage and, if route assertions are present, assert the helper requests `configShow` with `verbose=true`.
- `packages/pi-eforge/extensions/eforge/trunk-landing.ts` — Keep config YAML mutation helpers and any low-level trunk predicates still needed by direct tool safety; remove duplicated menu/default logic after moving it to `landing-policy.ts`.
- `packages/pi-eforge/extensions/eforge/landing-gate.ts` — Replace hard-coded playbook items and ad-hoc verbose config fetch with the shared policy model and typed client helper. Provide shared UI functions such as `promptForLandingSelection(...)`, `promptForPlaybookLandingGate(...)`, and `promptForBuildLandingGate(...)` that map policy choices to `{ onSuccess?, cancelled?, configUpdated? }`.
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts` — Treat `project-default` selection as `undefined`, omit `onSuccess` from all immediate, delayed, and fallback `apiPlaybookRunIfRunning` bodies, and keep active-build dependency selection behavior unchanged.
- `packages/pi-eforge/extensions/eforge/build-command.ts` — After source/profile selection and before delegating to `/skill:eforge-build`, call the shared landing selector when UI is available and the existing args do not contain an explicit landing override. Append an unambiguous landing override argument only for explicit selections; do not append anything for project default. Preserve `--profile` handling.
- `packages/pi-eforge/extensions/eforge/index.ts` — Keep the direct `eforge_build` tool guard wired through the refactored build landing gate. Adjust imports if `BuildOnSuccess` moves or client config helpers replace local types. No change to engine/daemon semantics.
- `test/pi-trunk-landing-policy.test.ts` — Retain YAML mutation and direct backstop predicate coverage, or move relevant assertions to the new policy test if names change.
- `test/pi-playbook-commands.test.ts` — Update landing gate mocks for project-default selection and assert `apiPlaybookRunIfRunning` receives no `onSuccess` for default inheritance while still receiving explicit overrides for explicit selections and fallback enqueue calls.
- `packages/pi-eforge/skills/eforge-build/SKILL.md` — Document unified landing selection, project-default inheritance, protected-trunk omission of unsafe merge, and direct tool backstop behavior.
- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` — Document “Use project default”, no `onSuccess` when default is selected, and protected-trunk safe alternatives/remediation.
- `eforge-plugin/skills/build/build.md` — Mirror build skill doc changes, using plugin tool names and existing parity-skip conventions.
- `eforge-plugin/skills/playbook/playbook.md` — Mirror playbook skill doc changes, using plugin tool names and existing parity-skip conventions.
- `eforge-plugin/.claude-plugin/plugin.json` — Bump the plugin version by one patch because plugin contents changed.

## Detailed Behavior Requirements

### Pure policy/menu helper

The helper input must include:

- effective configured/default landing action as `BuildOnSuccess`
- `currentBranch: string | null | undefined`
- resolved `trunkBranch: string`
- `allowLocalMergeToTrunk: boolean`
- `offerProjectDefault: boolean`
- optional `projectConfigPath` or equivalent boolean for whether config opt-in can be offered

The helper output must include:

- normal selectable choices with stable values for project default, PR, merge, leave, and cancel where applicable
- label/description text that includes shorthand vocabulary (`pr`, `merge`, `leave`) and wire values
- a warning string when default/direct merge is unsafe on protected trunk
- metadata for omitted or disabled unsafe choices so tests can assert merge/default omission on protected trunk
- remediation choices including PR, leave, config opt-in when project config exists, and cancel

### Pi build flow

- Headless/no-UI behavior continues to delegate to `/skill:eforge-build` with original args.
- UI flow keeps current source and profile selection behavior.
- If args already specify a landing override (`onSuccess`, `--on-success`, `landingAction`, or equivalent documented forms), do not prompt again.
- Otherwise render the shared landing selector with “Use project default” enabled.
- Selecting project default sends the build skill command without an added landing override.
- Selecting an explicit action adds a parseable landing override to the delegated skill command.
- Protected trunk with unsafe default excludes merge/default-as-merge as normal options and displays the warning plus safe alternatives/remediation.

### Pi playbook flow

- Planning playbooks still delegate to the skill before landing or queue prompts.
- Autonomous playbooks render the shared landing selector before active-build dependency prompts.
- Selecting project default leaves `landingOnSuccess` undefined and all enqueue bodies omit `onSuccess`.
- Selecting an explicit action includes `onSuccess` in immediate, delayed, and fallback enqueue bodies.
- Protected trunk with unsafe default or unsafe explicit merge excludes direct merge from normal choices and presents PR, leave, config opt-in when possible, and cancel.

### Direct tool backstop

- Direct `eforge_build` tool calls with explicit/default `merge-to-base-branch` on protected trunk still trigger the build landing gate.
- In UI contexts, the user can choose PR or config opt-in/cancel.
- In headless contexts, the tool returns/throws an actionable error before enqueue.
- The engine guard in `packages/engine/src/landing.ts` remains unchanged.

## Verification

- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0, including skill parity.
- [ ] Pure policy tests assert feature-branch menus include project default, PR, merge, leave, and cancel when `offerProjectDefault` is true.
- [ ] Pure policy tests assert protected-trunk menus with `allowLocalMergeToTrunk: false` omit normal merge/default-as-merge choices, expose warning text, and expose PR/leave/config-opt-in/cancel remediation choices.
- [ ] Pure policy tests assert trunk menus with `allowLocalMergeToTrunk: true` include merge and project default when default is merge.
- [ ] Playbook command tests assert project-default selection results in enqueue body `{ name }` or `{ name, afterQueueId }` with no `onSuccess` key.
- [ ] Playbook command tests assert explicit `leave-branch` selection propagates to immediate, delayed, and fallback enqueue bodies.
- [ ] Build command tests assert profile override arguments survive landing selection and explicit landing selections are forwarded once.
- [ ] Build command tests assert existing explicit landing override args bypass the selector.
- [ ] Direct `eforge_build` guard tests still assert unsafe protected-trunk merge is blocked/remediated before enqueue in Pi code, with engine guard left intact.
- [ ] Pi and plugin build/playbook skill docs describe the same landing behavior after parity normalization.
