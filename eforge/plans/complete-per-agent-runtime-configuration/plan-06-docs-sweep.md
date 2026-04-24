---
id: plan-06-docs-sweep
name: Documentation Terminology Sweep
depends_on:
  - plan-05-http-route-client
branch: complete-per-agent-runtime-configuration/docs-sweep
---

# Documentation Terminology Sweep

## Architecture Context

With source, profile loader, skills, plugin version, HTTP routes, and clients all renamed, user-facing documentation must follow. This plan completes the terminology sweep across READMEs and AGENTS.md so that every code example, command reference, and convention note uses `agentRuntimes:` config shape, `eforge/profiles/` directory, `/eforge:profile` slash command, and `harness` (not `backend`) terminology.

CHANGELOG.md is untouched per project convention (release-flow-owned).

## Implementation

### Overview

1. Sweep `README.md` at the repo root: update terminology and any config examples to the `agentRuntimes:` shape.
2. Sweep `AGENTS.md`: the `eforge/backends/` reference in conventions was already noted to need an update; align it with `eforge/profiles/` and the new terminology. The `harnesses/` directory reference from plan-03 is already landed and stays.
3. Sweep `packages/pi-eforge/README.md` and `eforge-plugin/README.md` (if present) - same terminology sweep.
4. Sweep any additional README files within packages that reference the old terms.

### Key Decisions

1. **Terminology-only sweep.** No behavior or code changes here; all behavior landed in prior plans.
2. **CHANGELOG.md is untouched.** Release-flow-owned per AGENTS.md convention.
3. **Code examples in docs must be valid.** Any YAML config example uses `agentRuntimes:` + `defaultAgentRuntime:` at the top level; any shell example uses `/eforge:profile` and `/eforge:profile-new`.

## Scope

### In Scope

- `README.md` terminology and config example sweep.
- `AGENTS.md` convention note update for `eforge/profiles/` directory reference.
- `packages/pi-eforge/README.md` sweep.
- `eforge-plugin/README.md` sweep (if file exists).
- Any other README within `packages/` that references `backend`, `/eforge:backend`, `eforge/backends/`, or `.active-backend`.

### Out of Scope

- `CHANGELOG.md` (release-flow-owned).
- Code / skill / test changes (landed in prior plans).
- `docs/roadmap.md` updates unrelated to this rename (per repo convention, roadmap is future-only).

## Files

### Modify

- `README.md` - update every `backend` -> `profile` or `harness` as contextually appropriate; rewrite config YAML examples to `agentRuntimes:` + `defaultAgentRuntime:`; replace `/eforge:backend` -> `/eforge:profile` and `/eforge:backend-new` -> `/eforge:profile-new`.
- `AGENTS.md` - update the `eforge/backends/` reference in conventions to `eforge/profiles/`. Leave the `harnesses/` reference from plan-03 alone.
- `packages/pi-eforge/README.md` - same terminology sweep as repo README.
- `eforge-plugin/README.md` - same sweep (skip if file does not exist).
- Any other README files within `packages/` that grep finds referencing old terms.

## Verification

- [ ] `grep -rn "/eforge:backend\\|eforge/backends\\|\\.active-backend\\|eforge_backend" README.md AGENTS.md packages/*/README.md eforge-plugin/README.md 2>/dev/null` returns zero matches (excluding any path that does not exist).
- [ ] Every YAML config example in `README.md` and `packages/pi-eforge/README.md` that declares runtime configuration uses `agentRuntimes:` at the top level and includes a `defaultAgentRuntime:` key.
- [ ] `CHANGELOG.md` shows no changes in this plan's commits (`git diff plan-05-http-route-client..HEAD -- CHANGELOG.md` is empty).
- [ ] `pnpm test` exits 0 (no regressions from docs-only changes).
