---
title: Glossary
description: Definitions for eforge-specific terms used across the docs and agent-readable reference.
---

# Glossary

## Agent runtime profile

A named YAML file that selects the harness, model, and effort settings for eforge tiers. Profiles live at user, project, or project-local scope and can be switched without editing `eforge/config.yaml`. See [Profiles](/docs/profiles).

## Auto-build

The desired daemon mode that automatically processes queued PRDs when `prdQueue.autoBuild` is enabled. Disabling auto-build prevents automatic dispatch until it is enabled again. Scheduler pause is separate: it can stop new launches while leaving desired auto-build enabled.

## Build source

The normalized input handed to the engine. It may originate from a CLI prompt, rough notes, a session plan, a playbook, a wrapper app, an input-source URI, or a PRD file.

## Builder

The agent stage that implements a plan in an isolated worktree and commits the result.

## Compile phase

The once-per-build phase where eforge formats input, assesses complexity, chooses Errand/Excursion/Expedition, and writes the plan set and dependency graph.

## Daemon

The long-running background process that watches the queue, runs builds, exposes the HTTP API, and streams live events to the monitor and integrations.

## Errand, Excursion, Expedition

Workflow profiles selected by the planner. Errand handles small changes, Excursion handles multi-file work with plan review, and Expedition handles large decomposed work with architecture and cohesion review.

## Evaluator

The agent stage that judges proposed fixes against the original intent and accepts only strict improvements.

## Failed enqueue

A durable daemon attention item for an enqueue attempt that failed before producing a runnable queue file. Console shows the source label, reason, timestamp, fallback next command, disabled reason when re-enqueue is unavailable, and a confirmed re-enqueue action when source data still exists.

## Fixer

The agent stage that applies reviewer suggestions as candidate changes before evaluation.

## Harness

The agent execution backend used by a stage. eforge recommends `pi` for provider-flexible execution through pi-agent-core, and also supports `claude-sdk` as an Anthropic-specific secondary path through the Claude Agent SDK.

## Hooks

Fire-and-forget shell commands triggered by eforge events. Configured in `eforge/config.yaml` under `hooks`. See [Configuration - Hooks](/docs/configuration#hooks) and [Configuration Reference - Hooks](/reference/config#hooks).

## Input source

A TypeScript extension adapter that resolves `eforge://input/<adapter>/<id>` URIs into PRD content. Adapters fetch issues or PRs from GitHub, Linear, Jira, or any custom source. See [Extensions - Input sources and PRD enrichers](/docs/extensions#input-sources-and-prd-enrichers).

## Console dashboard

The web UI running locally at `http://localhost:<port>/console/` (port range 4567-4667, deterministically assigned per project). Shows live build progress, token usage, cost, queue management, failed-enqueue attention, recovery guidance flows, scheduler pause/resume, and preview-first cascade controls. Root UI requests redirect to Console. See [Integrations - Console dashboard](/docs/integrations#console-dashboard).

## Playbook

A reusable Markdown workflow template for recurring work owned by the first-party `eforge-playbooks` extension. Has a `mode` of either `autonomous` (normalizes to build source and enqueues through generic extension action handoff) or `planning` (checks eforge-plan capability `eforge.plan.planning-mode-playbook` and returns `planningEntry` metadata for `eforge-plan:open-planning-entry` / `eforge-plan:planning-workstation`). Optionally pins an agent runtime profile via a `profile` frontmatter field. See [Playbooks](/docs/playbooks).

## Planner

The agent stage that sizes work, chooses the workflow profile, and writes implementation plans. This is separate from the driver-side planning conversation exposed by the generic eforge-plan planning entry.

## PRD

Product Requirements Document. A PRD file is one supported input surface, but eforge can also accept prompts, notes, session plans, playbooks, and wrapper-app input.

## PRD provenance

The `eforge/prds/` directory where the engine writes a canonical copy of each PRD at dispatch time. Each file is named `{prdId}.md` and serves as a committed artifact linking a build session to its originating requirements. Unlike queue state (`.eforge/queue/` — gitignored), PRD provenance files are committed to the artifact branch and survive queue cleanup. The hidden canonical acceptance-criteria inventory stored in the queued PRD is consumed for validation IDs and stripped from the committed prose artifact.

When `build.cleanupPlanFiles: true` (default), the PRD copy and compiled plan artifacts in `eforge/plans/{planSet}/` may be removed from `HEAD` when cleanup runs during `pr` or `merge` landing. Cleanup also strips temporary plan-ID eforge region marker comment lines from tracked JavaScript/TypeScript-family source files while preserving durable semantic markers and marked code. `landing.action: leave` does not run cleanup and leaves the artifact branch in place for inspection. Artifacts removed by cleanup remain recoverable from Git history: when the artifact branch is landed with a merge commit (eforge's local `merge` action, or a GitHub PR merged via "Create a merge commit"), the commits that added these files stay reachable. Use `git show <sha>:<path>` with a commit-pinned reference to recover any artifact. PR bodies include an **Eforge provenance** section with these references when artifact commits are found. When `landing.action: pr` is used, provenance durability depends on the repository's chosen merge strategy.

The durable provenance guarantee is Git history, not the final tree. Squash or rebase merge strategies applied after a PR is opened can collapse intermediate commits and make artifact references unreachable. Session plans (`.eforge/session-plans/`) are local and gitignored — they are not the shared provenance mechanism.

## Post-merge validation

The validation step after all plans merge. eforge runs `build.postMergeCommands` plus any queued PRD `postMerge` commands with `build.postMergeCommandTimeoutMs`; on failure it can invoke the validation-fixer up to `build.maxValidationRetries` times.

## Queue

The `.eforge/queue/` directory where normalized PRDs wait for daemon processing. Queue state is runtime-only (gitignored) — queue mutations are filesystem operations and do not produce git commits. Each queued PRD includes an eforge-owned hidden canonical acceptance-criteria inventory; queued builds with missing, duplicated, or malformed inventory fail before orchestration and must be re-enqueued. Queue items can depend on earlier items with `depends_on`, can use numeric `priority` so lower-priority-number items run earlier within the same dependency wave, and can carry runtime-only hold frontmatter (`held`, `hold_reason`, `held_at`) that prevents scheduler dispatch without moving the file. `eforge queue remove <prdId>` deletes non-running pending, waiting, failed, or skipped queue files; failed removal also deletes matching recovery sidecars and live-dependent conflicts list dependent ids. The daemon API can remove a single dependency from a pending or waiting queue item, moves a waiting item to the queue root when no dependencies remain, and uses preview/apply cascade controls for dependent remove or cancel flows.

## Queue hold

Runtime-only queue frontmatter (`held`, `hold_reason`, `held_at`) on pending or waiting PRDs. Held rows keep their queue order and file location but scheduler ticks skip them until unheld. Console renders hold/unhold availability from daemon-authored queue capabilities.

## Queue priority

An optional PRD frontmatter number. Lower numbers run before higher numbers within the same dependency wave; PRDs without `priority` run after prioritized items. `eforge queue priority <prdId> <priority>` mutates pending or waiting PRD frontmatter; failed and skipped items return conflict until recovery or requeue makes them runnable, and running items require daemon-owned cancellation instead of reprioritization.

## Recovery guidance

The canonical `## Recovery Guidance` section that eforge writes into failed root compiled plan artifacts before compiled-artifact continue/resume builders read them. Read-only recovery analysis does not mutate artifacts; explicit prepare/continue paths patch plan artifacts through engine git discipline.

## Recovery sidecar

A structured recovery analysis artifact written for a failed build plan. It records whether eforge should retry, continue and repair from preserved compiled artifacts, abandon, or require manual review / manual replanning, and may include read-only `continueRepairEligibility` plus recovery options for continue-repair or non-mutating compile scope/context guidance. For compiled-artifact continue/resume, it is also the durable source used to patch the failed root compiled plans with `## Recovery Guidance` before builders read them.

## Recovery verdict

The outcome of a recovery sidecar analysis: `retry`, `continue-repair`, `abandon`, or `manual`. Applied via `/eforge:recover`, `eforge_apply_recovery`, `eforge_continue_repair`, `eforge apply-recovery <prdId>`, or `eforge continue-repair <prdId>` depending on the action. See [Troubleshooting - Recover from a failed build](/docs/troubleshooting#recover-from-a-failed-build).

## Reviewer

The blind review agent stage that evaluates a diff without the builder's reasoning or conversation context.

## Scheduler pause

A runtime launch gate for the daemon scheduler. Pausing the scheduler leaves desired auto-build enabled but prevents new queued builds from launching until resume; already-running builds continue unless explicitly cancelled.

## Session plan

A driver-side planning artifact created by the generic eforge-plan planning entry under `.eforge/session-plans/`. It captures planning type/depth, an optional executive summary, scope, acceptance criteria, risks, assumptions, skipped dimensions, readiness, and other dimensions before `/eforge:build` converts a ready file into build source.

## Tier

A configuration slot such as `planning`, `implementation`, `review`, or `evaluation`. Tiers map agent roles to harness/model/effort settings.

## Toolbelt

A named declarative bundle of project MCP servers (from `.mcp.json`) that a tier can opt into via `toolbelt: <name>` in a profile. Filters project MCP access per tier without affecting engine tools or harness built-ins. See [Configuration - Guided Toolbelt Presets](/docs/configuration#guided-toolbelt-presets) and [Extensions API - Toolbelt-vs-extension boundary](/docs/extensions-api#toolbelt-vs-extension-boundary).

## Trunk branch policy

The pair of config fields (`build.trunkBranch` and `build.allowLocalMergeToTrunk`) that control how eforge handles landing when the current branch is the project trunk. By default, `landing.action: merge` is rejected on trunk to prevent accidental direct commits to a protected branch; the policy must be explicitly opted into for solo or unprotected projects. See [Configuration - Trunk Branch Policy](/docs/configuration#trunk-branch-policy).

## Worktree

An isolated git working tree used to build an individual plan without blocking or contaminating other concurrently running plans.
