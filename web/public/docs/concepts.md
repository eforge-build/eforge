---
title: Concepts
description: How the eforge build engine, inputs, and extension surfaces fit together.
---

# Concepts

## Core engine and extension surfaces

eforge is a build-engine kernel with extensible workflow surfaces around it. The core engine consumes normalized build source, compiles it into plans, orchestrates dependency-aware worktrees, runs implementation/review/validation loops, records conservative gates, and emits typed events for consumers.

Input authoring and workflow UX live outside that core. CLI prompts, rough notes, PRD files, `eforge-playbooks` playbook workflows, session plans, wrapper-app artifacts, host integrations, toolbelts, shell hooks, and native extensions can shape how work is prepared or governed before it reaches the engine. They are extension surfaces, not separate engines.

That boundary is why different hosts can feel different while the build semantics remain consistent: every input surface eventually normalizes into build source, and the engine handles the same compile/build/landing lifecycle.

## What eforge builds

Traditional build systems transform source code into artifacts. eforge transforms *build source* into source-code changes - then verifies its own output.

The key quality insight: a single AI agent writing and reviewing its own code will almost always approve it. Quality requires **separation of concerns** - distinct agents for planning, building, reviewing, and evaluating. eforge applies build-system thinking to this multi-agent pipeline.

## The Pipeline

Every eforge build runs two phases:

**Compile phase** - Runs once per build. A deterministic preflight measures source risk and may compact generated or machine-readable bulk for pipeline-composer, planner, and module-planner prompts while preserving the full source for artifacts and validation. Planner-family agents enforce prompt and live context-budget guardrails before provider context-window failures. For Pi-backed agents, live context guard token limits use ModelRegistry context metadata and effective output reserves when available; prompt byte defaults remain static byte guards. The pipeline-composer assesses complexity and selects the initial workflow profile, with bounded context recovery able to escalate errand or excursion compiles to expedition once when eligible. The planner then produces plan files and an orchestration manifest, and eforge validates those persisted artifacts before reporting compile success. Large work is decomposed into modules that can build in parallel.

**Build phase** - Runs once per plan. Builder agents implement the plan in an isolated git worktree. When the build stage completes, a blind review cycle runs, then the result merges back.

The compile phase produces `orchestration.yaml` - a dependency graph over the plans. Non-skipped compiles fail closed if `orchestration.yaml` or its referenced plan files are missing, invalid, mismatched, or empty. The orchestrator launches plans as soon as their dependencies have merged, not in fixed waves. Since agent execution is IO-bound, all ready plans run immediately in parallel.

## Normalized build-source boundary

A **build source** is the normalized input eforge hands to the compile phase after an outside input surface has been resolved. It can start as a CLI prompt, rough notes, a PRD file, a wrapper-app artifact, an autonomous workflow artifact, or another host-provided file, but the build-engine kernel sees normalized build source rather than the original authoring surface.

That boundary keeps producer UX optional. Hosts, wrapper apps, playbooks owned by the first-party `eforge-playbooks` extension, session-plan compatibility tools, and first-party extensions such as [eforge-plan](/docs/eforge-plan) may help collect intent, investigate scope, or format a handoff. They are producers around the kernel. Once a build is enqueued, the engine consumes the normalized source through the same compile/build/landing lifecycle.

## Build Artifact Provenance

When a build runs, eforge commits source artifacts into the artifact branch before building:

- A canonical PRD copy is written to `eforge/prds/{prdId}.md` at dispatch time.
- Compiled plan files and `orchestration.yaml` are written to `eforge/plans/{planSet}/` during compile.

These committed files are the shared, team-visible provenance record linking a build session to its originating requirements and plan.

When `build.cleanupPlanFiles: true` (the default), eforge removes these artifacts from `HEAD` during the `pr` or `merge` landing flows after a successful build. Cleanup also strips temporary plan-ID eforge region marker comment lines from tracked JavaScript/TypeScript-family source files while preserving durable semantic markers and marked code. `landing.action: leave` does not run cleanup and leaves the artifact branch in place for inspection. Build artifacts are not permanently lost — when the artifact branch is landed with a merge commit (eforge's local `merge` action, or a GitHub PR merged via "Create a merge commit"), the commits that added the artifacts remain reachable in Git history. Use `git show <sha>:<path>` with a commit-pinned reference to recover any artifact. PR bodies include an **Eforge provenance** section with these references when artifact commits are found. When `landing.action: pr` is used, provenance durability depends on the repository's chosen merge strategy.

The durable provenance guarantee is Git history, not the final tree. Squash or rebase merge strategies applied after a PR is opened (for example, GitHub's "Squash and merge") can collapse intermediate commits and make artifact references unreachable. Use merge commits when preserving build provenance history matters to your team.

## Workflow Profiles

The pipeline-composer selects one of three workflow profiles based on scope complexity:

**Errand** - Small, self-contained changes. The planner generates a single simple plan or skips if nothing needs doing. Fast path with minimal overhead.

**Excursion** - Multi-file feature work. The planner writes a full plan covering all files and dependencies, then a blind plan-review cycle validates it before building begins.

**Expedition** - Large cross-cutting work. The planner writes an architecture document, decomposes work into modules with independent plans, runs cohesion review across the full plan set, then builds plans in parallel in dependency order.

You can suggest a profile in your build prompt, but the composer makes the final initial selection based on what it sees in the codebase. Elevated preflight/context evidence can then trigger one bounded retry-as-expedition escalation before planning continues.

## Separation of Concerns

Each pipeline stage uses a different agent with different context:

- **Builder** - Has the plan, the codebase, and all tools. Writes code and commits changes.
- **Reviewer** - Has only the code diff, not the builder's reasoning. Flags issues without being anchored to the builder's intent.
- **Fixer** - Applies reviewer suggestions as unstaged changes.
- **Evaluator** - Judges each fix against the original plan intent. Accepts strict improvements; rejects changes that alter intent.

This three-step pattern (blind review - fix - evaluate) applies to code review, plan review, architecture review, and cohesion review. The evaluator is the safety valve: it keeps the fixer from over-correcting.

## Harnesses

eforge is harness-agnostic. A **harness** is the agent execution backend - the thing that runs the LLM and tools for each agent stage. Two harnesses ship with eforge:

- **`pi`** - Recommended for new eforge setup. Uses pi-agent-core for provider-flexible execution across OpenAI, Anthropic, Google, Mistral, Groq, xAI, Bedrock, OpenRouter, local models, and more.
- **`claude-sdk`** - Supported secondary path for users who intentionally want the Anthropic Claude Agent SDK with Anthropic API credentials.

The harness you use to *drive* eforge (Claude Code or Pi) and the harness that *executes* builds are independent. You can plan in Claude Code and build with Pi, or plan in Pi and execute through the Anthropic-specific Claude Agent SDK. You can also switch harnesses mid-project by changing your active profile.

## Tiers

A **tier** is a named configuration slot: `planning`, `implementation`, `review`, and `evaluation`. Each tier specifies a harness, model, and effort level. Agent roles are assigned to tiers by default - the planner uses `planning`, the builder uses `implementation`, reviewers use `review`, and evaluators use `evaluation`.

This means you can say "use a fast cheap model for implementation, a thorough slow model for review" without listing every agent role individually.

## Agent Runtime Profiles

A **profile** is a named YAML file that bundles tier recipes into a reusable unit. Profiles live at three scopes:

- `~/.config/eforge/profiles/` - User scope, personal, cross-project
- `eforge/profiles/` - Project scope, committed, team-canonical
- `.eforge/profiles/` - Project-local scope, gitignored, personal override

The active profile is resolved highest-priority-first: project-local beats project beats user. You can swap profiles without touching `eforge/config.yaml` - useful for switching between harnesses or experimenting with different models. See [Profiles](/docs/profiles) for a full walkthrough.

**Playbooks** are an optional workflow surface owned by the first-party `eforge-playbooks` extension: reusable Markdown templates for recurring work that optionally pin a profile via their `profile` frontmatter field. Autonomous playbooks normalize to build source before enqueue; planning playbooks route to optional eforge-plan planning when that extension capability is available and return planning-entry metadata rather than enqueueing directly. See [Playbooks](/docs/playbooks).

## The Queue and Daemon

When you run `/eforge:build` or `eforge build`, eforge writes a normalized PRD file to the configured queue directory (`.eforge/queue/` by default - gitignored, runtime state only). During enqueue, eforge also extracts a canonical acceptance-criteria inventory with stable `ac-###` ids and stores it in an eforge-owned hidden Markdown block in that queued PRD. The inventory is validated for schema, source grounding, confidence, duplicates, and item quality before the queue file is written. If extraction is malformed or criteria are vague, grouping labels, bare commands, manual-only, visual-only, low-confidence, or ungrounded, enqueue fails and no queue Markdown file is created.

A long-running **daemon** watches the queue and, when `prdQueue.autoBuild` is enabled, processes PRDs automatically. The daemon runs in the background and survives terminal exit. `prdQueue.watchPollIntervalMs` controls how often the watcher polls for queued work. Queued PRD builds require the persisted inventory; if a queued file is missing the hidden block, has multiple blocks, or has malformed inventory JSON, the build fails before orchestration and the PRD must be re-enqueued.

At dispatch time, the daemon also writes a canonical copy of the PRD to `eforge/prds/{prdId}.md` - a committed provenance record that links the build session to its originating requirements independently of queue state. Queue files in `.eforge/queue/` are ephemeral; `eforge/prds/` files are committed to the artifact branch and survive queue cleanup. The hidden inventory is stripped from planner, validator, dependency, staleness, profile-router, and provenance prose, while the loaded stable IDs are passed to acceptance validation. When `build.cleanupPlanFiles: true` (the default), these artifacts are removed from `HEAD` during the `pr` or `merge` landing flows after a successful build, temporary plan-ID eforge region marker comment lines are stripped from tracked JavaScript/TypeScript-family source files, and artifacts remain recoverable from Git history via commit-pinned references. `landing.action: leave` preserves the artifact branch in place. See [Build Artifact Provenance](#build-artifact-provenance) above.

The queue supports dependencies, priority, hold state, and runtime controls. A PRD can declare `depends_on` to wait for upstream PRDs to complete before it starts; eforge validates that dependencies refer to pending, running, or waiting queue items, or to completed items with durable usable artifacts. Failed, skipped, unknown, or completed-without-artifact dependencies are rejected. Within each dependency wave, lower numeric `priority` values run first, PRDs without `priority` run last, and ties fall back to creation date. `eforge queue priority <prdId> <priority>` mutates pending or waiting PRD frontmatter, while failed and skipped items reject priority changes with a conflict until recovery or requeue makes them runnable. Queue hold state is runtime-only PRD frontmatter (`held`, `hold_reason`, `held_at`) on pending or waiting items; held items keep their file location and ordering metadata, but scheduler ticks do not dispatch them until they are unheld. Daemon projections expose hold state and queue-control capabilities, so Console can show hold/unhold, priority, remove, cascade, cancel, and disabled reasons from daemon-authored rules instead of inferring them locally. `eforge queue remove <prdId>` deletes non-running pending, waiting, failed, or skipped queue files and deletes matching failed-build recovery sidecars. The daemon API also supports targeted dependency overrides for pending or waiting PRDs: one `depends_on` id is removed, remaining blockers keep the PRD in `waiting/`, and clearing the last blocker moves a waiting PRD back to the queue root. Running items reject priority, hold, unhold, removal, and dependency override controls; daemon-owned cancellation requires live queue-lock and run/session ownership evidence. Legacy removal fails closed when live pending/waiting dependents exist and lists dependent ids. Cascade remove and cancel use a two-phase preview/apply flow that rechecks an expected affected token and requires explicit dependent confirmation before mutating dependents. These are runtime filesystem mutations under `.eforge/queue/`, are gitignored, produce no git commits, and notify the scheduler so it re-reads queue files before dispatch. Scheduler pause is distinct from disabling auto-build: pause keeps desired auto-build on but prevents new launches until resume, while already-running builds continue unless cancelled. If an upstream PRD fails or is cancelled, waiting dependents are skipped instead of cascading a broken build. The Console Now dashboard surfaces failed and skipped terminal rows in the Needs attention strip rather than the Queue card; the Queue card preview lists only forward pending and waiting rows, which expose set-priority, hold/unhold, and preview-first remove/cascade controls as capabilities allow. Failed enqueue attempts that never reached the queue appear as durable Needs attention rows with source label, reason, timestamp, fallback command, disabled reason when needed, and confirmed re-enqueue when source data is available. Failed upstreams with skipped descendants can be inspected before applying daemon-planned recovery, including projected pre-session dispatch blockers and explicit queue-cascade metadata repair choices when available.

The **Console dashboard** (`http://localhost:<port>/console/`) tracks cost, token usage, and pipeline progress in real time. Root UI requests redirect to Console, and the daemon keeps it available after the build completes so you can inspect results.

## Artifact Branches and Landing Actions

Every eforge build produces an **artifact branch** - a named Git branch (`eforge/<prd-id>`) that holds the committed output. After all plans merge into the artifact branch and post-merge validation passes, the **landing action** determines what happens next.

Configure the landing action via `landing.action` (values: `pr`, `merge`, `leave`).

| `landing.action` | Behavior |
|-----------------|----------|
| `pr` | Opens a PR from the artifact branch targeting the resolved base branch. For direct non-stacked builds, eforge fetches `origin/<baseBranch>`, rebases the artifact branch onto that fetched base before validation, and checks freshness again immediately before PR creation. For stacked builds, the root PR targets the resolved trunk branch and child PRs target their parent artifact branch unless eforge proves a missing parent base is already integrated into trunk and performs branch-scoped stale-parent landing repair; before submission, stacked landing runs provider repo sync, branch restack, and a remote-base freshness proof. |
| `merge` | Merges the artifact branch into the base branch directly. |
| `leave` | Leaves the artifact branch in place for manual inspection or cherry-picking. |

## Validation

During each plan build, extensions may contribute validation providers that run in the per-plan `validate` stage after implementation and before review. Structured provider failures can be repaired before review: narrow issues use the review-fixer path, while `repairClass: 'structural'` issues route to an in-build validation-fixer path with evaluator-gated checkpoints. After all plans merge, eforge runs your configured `postMergeCommands` plus any queued PRD `postMerge` commands (compile, test, lint, etc.). On post-merge failure, a validation-fixer agent attempts repairs up to a configurable retry limit. This is the last line of defense before a build is marked complete and the landing action executes.

## Stacked PRs

Stacked PR landing is optional. When `stacking.enabled: true` and `landing.action: pr` are set in `eforge/config.yaml`, builds form a **branch-per-PR stack**. The root artifact branch targets the resolved trunk branch, and each child artifact branch normally targets its parent artifact branch. If a parent branch was deleted after merge and the parent artifact commit is an ancestor of trunk, eforge can automatically land only the child artifact branch against trunk during landing. eforge currently uses git-spice to track branches and submit PRs into the stack.

PRD frontmatter controls the stack topology: `stack_id` is a logical stack name shared by all PRDs in the stack; `stack_parent` is the parent PRD id. For single-dependency builds, `stack_parent` is inferred automatically from `depends_on`. See the [Stacked PRs](/docs/stacking) guide for setup instructions.

## Agent-Readable Artifacts

eforge publishes machine-readable reference artifacts for use by AI coding assistants:

- `/llms.txt` - Structured index of available documentation, getting-started guides, reference docs, packages, schemas, and optional context
- `/llms-full.txt` - Full reference documentation bundle in a single file
- `/docs/getting-started.md`, `/docs/concepts.md`, `/docs/configuration.md`, `/docs/profiles.md`, `/docs/playbooks.md`, `/docs/eforge-plan.md`, `/docs/stacking.md`, `/docs/extensions.md`, `/docs/extensions-api.md`, `/docs/integrations.md`, `/docs/troubleshooting.md`, `/docs/glossary.md` - Raw Markdown guide pages useful for onboarding, operations, optional workflows, first-party extensions, and terminology
- `/reference/cli.md`, `/reference/api.md`, `/reference/events.md`, `/reference/config.md`, `/reference/tools.md` - Raw Markdown reference docs
- `/schemas/events.schema.json`, `/schemas/config.schema.json` - JSON Schemas for wire types and config

These are served byte-for-byte from the static `public/` directory and are regenerated from source on every release.
