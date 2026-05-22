---
title: Concepts
description: How the eforge agentic build pipeline works.
---

# Concepts

## What Is an Agentic Build System?

Traditional build systems transform source code into artifacts. An agentic build system transforms *specifications* into source code - then verifies its own output.

The key insight: a single AI agent writing and reviewing its own code will almost always approve it. Quality requires **separation of concerns** - distinct agents for planning, building, reviewing, and evaluating. eforge applies build-system thinking to this multi-agent pipeline.

## The Pipeline

Every eforge build runs two phases:

**Compile phase** - Runs once per build. A planner agent assesses complexity and selects a workflow profile, then produces plan files and an orchestration manifest. Large work is decomposed into modules that can build in parallel.

**Build phase** - Runs once per plan. Builder agents implement the plan in an isolated git worktree. When the build stage completes, a blind review cycle runs, then the result merges back.

The compile phase produces `orchestration.yaml` - a dependency graph over the plans. The orchestrator launches plans as soon as their dependencies have merged, not in fixed waves. Since agent execution is IO-bound, all ready plans run immediately in parallel.

## Build Sources and Session Plans

A **build source** is the input eforge hands to the compile phase after normalizing a user-facing artifact. It can start as a CLI prompt, rough notes, a PRD file, an autonomous playbook, a wrapper-app artifact, or a session-plan file.

`/eforge:plan` creates session plans under `.eforge/session-plans/`. A session plan is a driver-side planning artifact: it records the planning type and depth, required and optional dimensions, skipped dimensions with reasons, open questions, readiness, and any inherited `agent_profile` from a planning-mode playbook. When `/eforge:build` uses a ready session-plan file, eforge converts that file into ordinary build source before writing the normalized PRD to the queue.

## Workflow Profiles

The planner selects one of three profiles based on scope complexity:

**Errand** - Small, self-contained changes. The planner generates a single simple plan or skips if nothing needs doing. Fast path with minimal overhead.

**Excursion** - Multi-file feature work. The planner writes a full plan covering all files and dependencies, then a blind plan-review cycle validates it before building begins.

**Expedition** - Large cross-cutting work. The planner writes an architecture document, decomposes work into modules with independent plans, runs cohesion review across the full plan set, then builds plans in parallel in dependency order.

You can suggest a profile in your build prompt, but the planner makes the final call based on what it sees in the codebase.

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
- **`claude-sdk`** - Supported secondary path for users who intentionally want the Anthropic Claude Agent SDK with Anthropic API credentials; see the Getting Started caveat for Agent SDK credit/API pricing.

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

**Playbooks** are a separate but related surface: a playbook is a reusable Markdown template for recurring work that optionally pins a profile via its `profile` frontmatter field. Playbooks run in either `autonomous` mode (enqueues a build directly) or `planning` mode (triggers an investigation-first workflow before building). See [Playbooks](/docs/playbooks).

## The Queue and Daemon

When you run `/eforge:build` or `eforge build`, eforge writes a normalized PRD file to the configured queue directory (`.eforge/queue/` by default - gitignored, runtime state only). A long-running **daemon** watches the queue and, when `prdQueue.autoBuild` is enabled, processes PRDs automatically. The daemon runs in the background and survives terminal exit. `prdQueue.watchPollIntervalMs` controls how often the watcher polls for queued work.

At dispatch time, the daemon also writes a canonical copy of the PRD to `eforge/prds/{prdId}.md` - a committed provenance record that links the build session to its originating requirements independently of queue state. Queue files in `.eforge/queue/` are ephemeral; `eforge/prds/` files persist after builds complete and survive queue cleanup.

The queue supports dependencies and priority. A PRD can declare `depends_on` to wait for upstream PRDs to complete before it starts; eforge validates that dependencies refer to pending, running, or waiting queue items. Within each dependency wave, lower numeric `priority` values run first, PRDs without `priority` run last, and ties fall back to creation date. If an upstream PRD fails or is cancelled, waiting dependents are skipped instead of cascading a broken build.

The **web monitor** (`http://localhost:<port>`) tracks cost, token usage, and pipeline progress in real time. It keeps running after the build completes so you can inspect results.

## Post-Merge Validation

After all plans merge, eforge runs your configured `postMergeCommands` (compile, test, lint, etc.). On failure, a validation-fixer agent attempts repairs up to a configurable retry limit. This is the last line of defense before a build is marked complete. The `build.onSuccess` setting controls what happens after validation passes: by default the worktree merges to the base branch, but builds can also be configured to open a GitHub pull request (`issue-pr`) or leave the branch in place for manual handling (`leave-branch`) — meaning a successful build does not always result in an automatic merge.

## Agent-Readable Artifacts

eforge publishes machine-readable reference artifacts for use by AI coding assistants:

- `/llms.txt` - Structured index of available documentation, getting-started guides, reference docs, packages, schemas, and optional context
- `/llms-full.txt` - Full reference documentation bundle in a single file
- `/docs/getting-started.md`, `/docs/concepts.md`, `/docs/configuration.md`, `/docs/profiles.md`, `/docs/playbooks.md`, `/docs/extensions.md`, `/docs/extensions-api.md`, `/docs/integrations.md`, `/docs/troubleshooting.md`, `/docs/glossary.md` - Raw Markdown guide pages useful for onboarding, operations, and terminology
- `/reference/cli.md`, `/reference/api.md`, `/reference/events.md`, `/reference/config.md`, `/reference/tools.md` - Raw Markdown reference docs
- `/schemas/events.schema.json`, `/schemas/config.schema.json` - JSON Schemas for wire types and config

These are served byte-for-byte from the static `public/` directory and are regenerated from source on every release.
