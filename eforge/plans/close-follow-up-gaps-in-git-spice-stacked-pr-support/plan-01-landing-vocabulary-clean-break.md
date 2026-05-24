---
id: plan-01-landing-vocabulary-clean-break
name: Landing Vocabulary Clean Break
branch: close-follow-up-gaps-in-git-spice-stacked-pr-support/plan-01-landing-vocabulary-clean-break
agents:
  builder:
    effort: xhigh
    rationale: Breaking rename spans engine types, daemon/client API, CLI, Pi
      integration, and tests; sharding keeps mechanical updates within turn
      budget while one plan preserves type-change atomicity.
    shards:
      - id: engine-client-daemon
        roots:
          - packages/engine/src/
          - packages/client/src/
          - packages/monitor/src/
      - id: cli
        roots:
          - packages/eforge/src/cli/
      - id: pi-extension
        roots:
          - packages/pi-eforge/extensions/eforge/
      - id: tests
        roots:
          - test/
---

# Landing Vocabulary Clean Break

## Architecture Context

The codebase still accepts legacy `onSuccess`/`build.onSuccess` and maps between full-string actions and `landing.action`. This plan performs the active-code breaking migration in one atomic type/API change so later plans can depend on canonical landing actions only.

## Implementation

### Overview

Replace active `onSuccess` surfaces with canonical `landing.action` / `landingAction` values (`pr`, `merge`, `leave`) across engine config, PRD frontmatter, engine runtime options, client/daemon request contracts, CLI flags, MCP proxy schemas, Pi extension tool schemas, and tests. Preserve only explicit migration-error text/tests that instruct users to use `landing.action` or `landingAction`.

### Key Decisions

1. Canonical action values are exactly `pr`, `merge`, and `leave` across engine internals and public request bodies.
2. Old inputs fail validation with migration guidance rather than mapping silently.
3. `DAEMON_API_VERSION` is bumped because request bodies and landing event action values are breaking.
4. The type change and all active consumers land in one plan to keep the workspace type-checkable after merge.

## Scope

### In Scope
- Remove `build.onSuccess` from accepted resolved config and active config schema.
- Add explicit config/profile migration errors for `build.onSuccess` that name `landing.action: pr|merge|leave`.
- Remove PRD frontmatter `onSuccess`; persist only canonical landing frontmatter.
- Change `BuildOptions`, `EnqueuePrdOptions`, `PhaseContext`, `LandingAction`, landing events, client route request types, daemon handlers, CLI commands, MCP proxy tools, and Pi extension tools to use `landingAction?: 'pr'|'merge'|'leave'`.
- Remove `--on-success` from command definitions and child-process spawning; keep `--landing-action pr|merge|leave`.
- Update trunk-landing policy helpers and landing gate naming in Pi extension code.
- Update tests from legacy precedence/mapping assertions to canonical propagation and rejection assertions.

### Out of Scope
- User-facing docs, skill text, and generated references; plan-04 handles those.
- Artifact registry semantics; plan-02 handles those.
- Stack landing status and cleanup ordering; plan-03 handles those.
- Compatibility aliases for old request keys, config fields, frontmatter fields, or CLI flags.

## Files

### Create
- None expected.

### Modify
- `packages/engine/src/config.ts` — remove resolved `build.onSuccess`, remove `landingActionToOnSuccess` / `onSuccessToLandingAction`, make `landing.action` the sole resolved value, and detect `build.onSuccess` before nested schema parsing can strip it.
- `packages/engine/src/events.ts` — rename build/enqueue option fields to `landingAction` and use canonical action literals.
- `packages/engine/src/landing.ts` — change `LandingAction` and `executeLandingAction()` branching to `pr|merge|leave`.
- `packages/engine/src/orchestrator.ts` and `packages/engine/src/orchestrator/phases.ts` — pass/use canonical `landingAction` in phase context.
- `packages/engine/src/eforge.ts` — replace `options.onSuccess`, PRD frontmatter precedence, child `--on-success` spawning, and init override bridging with canonical `landingAction`.
- `packages/engine/src/prd-queue.ts` — remove `onSuccess` frontmatter/serialization and persist canonical landing only.
- `packages/client/src/events.schemas.ts`, `packages/client/src/events.ts`, `packages/client/src/routes.ts`, `packages/client/src/api-version.ts`, `packages/client/src/api/*.ts` — canonicalize landing schemas/routes/helpers and bump daemon API version.
- `packages/monitor/src/server.ts` — validate `landingAction`, reject `onSuccess` with a migration error, and spawn workers with `--landing-action`.
- `packages/eforge/src/cli/landing-options.ts`, `packages/eforge/src/cli/index.ts`, `packages/eforge/src/cli/run-or-delegate.ts`, `packages/eforge/src/cli/mcp-proxy.ts` — remove `--on-success` / `onSuccess` and wire `landingAction` only.
- `packages/pi-eforge/extensions/eforge/index.ts`, `landing-gate.ts`, `landing-policy.ts`, `trunk-landing.ts`, `build-command.ts`, `playbook-commands.ts` — use canonical `landingAction` in schemas, prompts, request bodies, and policy checks.
- `test/cli-landing-options.test.ts`, `test/onsuccess-override-precedence.test.ts`, `test/pi-trunk-landing-policy.test.ts`, `test/pi-build-command.test.ts`, `test/pi-playbook-commands.test.ts`, `test/playbook-api.test.ts`, `test/lifecycle-event-emission.test.ts`, `test/validate-phase-timeout.test.ts` — update or rename tests for canonical landing and migration errors.
- Additional active-code hits from `rg -n "onSuccess|--on-success|build\.onSuccess|merge-to-base-branch|issue-pr|leave-branch" packages test --glob '!dist/**' --glob '!**/*.md' --glob '!**/tsup.config.ts'` that are not intentional migration guidance.

## Verification

- [ ] `pnpm type-check` completes with zero TypeScript errors.
- [ ] CLI parsing rejects `--on-success` and accepts `--landing-action pr`, `--landing-action merge`, and `--landing-action leave`.
- [ ] Config parsing rejects `build.onSuccess` with a message containing `landing.action` and `pr|merge|leave`.
- [ ] PRD frontmatter validation rejects `onSuccess` with a message containing `landing` or `landingAction`.
- [ ] Daemon `/api/enqueue` and `/api/playbook/run` reject request bodies containing `onSuccess` and accept `landingAction`.
- [ ] MCP and Pi tool schemas contain `landingAction` and no active `onSuccess` parameter.
- [ ] `rg -n "onSuccess|--on-success|build\.onSuccess" packages test --glob '!dist/**' --glob '!**/*.md' --glob '!**/tsup.config.ts'` returns only migration-error text or migration-error tests.
