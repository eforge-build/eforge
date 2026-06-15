---
title: Getting Started
description: Install eforge and run your first delegated build.
---

# Getting Started

eforge turns described work into reviewed, validated code changes. You describe what you want to build through a prompt, PRD, playbook, or session plan; eforge plans, implements, reviews, and validates the work through a multi-stage pipeline across isolated worktrees.

## Prerequisites

- **Node.js 22+**
- One of: [Pi](https://github.com/earendil-works/pi-mono), [Claude Code](https://claude.ai/code), or an npm-capable shell
- An LLM credential for the runtime you choose: a provider-specific API key or OAuth token for the recommended `pi` harness, or an Anthropic API key for the supported secondary `claude-sdk` harness

## Install

### Pi package (recommended)

Pi is the recommended harness for new users: you choose the providers, pay API prices directly, and keep orchestration local and inspectable.

```bash
pi install npm:@eforge-build/pi-eforge
/eforge:init
```

Add `-l` to write to project settings (`.pi/settings.json`) instead of your global Pi settings:

```bash
pi install -l npm:@eforge-build/pi-eforge
```

### Claude Code plugin

Use the Claude Code plugin if Claude Code is already your daily environment. Claude Code can host the workflow while your active profile executes builds through the recommended Pi harness.

Run these three commands inside Claude Code:

```
/plugin marketplace add eforge-build/eforge
/plugin install eforge@eforge
/eforge:init
```

The `/eforge:init` command creates `eforge/config.yaml` with sensible defaults and adds runtime-state entries such as `.eforge/` and `eforge/.active-profile` to your `.gitignore`. It walks you through a Quick setup (one harness/provider with suggested tier models, including an optional separate implementation model) or a Mix-and-match flow (different harness, provider, or model per tier). Choose Pi for the recommended provider-flexible path; `claude-sdk` remains available as a supported Anthropic-specific secondary path for users with Anthropic Claude Agent SDK credentials. Check your provider's current account and pricing terms before running large builds.

After initialization, run `/eforge:workflow` to choose the workflow preset for this repository. It writes the landing action, pull-request auto-merge policy, and stacking setup to `eforge/config.yaml`, including optional automatic stack sync for git-spice stacks.

### CLI

```bash
npx @eforge-build/eforge build "Add rate limiting to the API"
```

Or install globally: `npm install -g @eforge-build/eforge`

The CLI has no init command yet: run `/eforge:init` once in Pi or Claude Code to create `eforge/config.yaml` and an agent runtime profile. After that one-time setup, the CLI drives builds without either host - suited to scripting and automation.

## Your First Build

Once eforge is installed and initialized, you can plan first through the generic eforge-plan planning entry when the eforge-plan extension is loaded/trusted. In Pi or Claude, discover and invoke the `eforge-plan:open-planning-entry` contribution with `eforge_extension_contribution`; from the standalone CLI, use `eforge extension contributions list` and `eforge extension contributions invoke eforge-plan:open-planning-entry --kind command`. You can also open the eforge-plan workstation deep link at `/console/workstations/eforge-plan%3Aplanning-workstation`. The workstation guides structured planning - exploring scope, architecture, risks, acceptance criteria, readiness, and assumptions - and writes a session-plan file under `.eforge/session-plans/` with planning type/depth, required/optional dimensions, skipped dimensions, open questions, and readiness status.

When the session plan is ready to build:

```
/eforge:build
```

With no arguments, `/eforge:build` looks for active session plans. Ready session-plan files are submitted by file path as build source; eforge's bundled session-planning adapter converts the session plan into normalized build source, the daemon enqueues it, and the session plan is marked `submitted` with the resulting session ID.

Or enqueue directly with a prompt:

```
/eforge:build Add a dark mode toggle to the settings page
```

The daemon picks up the queued plan and runs the full pipeline in the background. Console at `http://localhost:<port>/console/` (port deterministically assigned per project in the 4567-4667 range) tracks progress, cost, and token usage in real time.

From the standalone CLI:

```bash
eforge build "Add a dark mode toggle to the settings page"
eforge build plans/my-feature-prd.md
eforge build --landing-action pr plans/my-feature-prd.md
```

Use `--profile <name>` for a one-off agent runtime profile override, and `--landing-action pr|merge|leave` when one build should use a different landing action from `eforge/config.yaml`.

## What Happens Next

1. **Formatting** - eforge normalizes your input into a structured PRD.
2. **Acceptance criteria inventory** - enqueue canonicalizes acceptance criteria and rejects vague, unverifiable, or duplicate criteria before the build is queued. [Concepts](./concepts#the-queue-and-daemon) covers the full validation rules.
3. **Planning** - A planner agent assesses complexity and selects a workflow profile ([Errand, Excursion, or Expedition](./concepts#workflow-profiles)), then writes a detailed plan or set of plans.
4. **Building** - Builder agents implement each plan in isolated git worktrees, in parallel where the dependency graph allows.
5. **Review** - Blind reviewers evaluate each plan's output without builder context. A fixer applies suggestions; an evaluator accepts only strict improvements.
6. **Merge** - Completed plans merge back to your branch in topological order.
7. **Validation** - Post-merge validation runs your configured commands. On failure, a validation-fixer agent attempts repairs.

## Where to Look Next

- [Concepts](./concepts) - How the pipeline works, what blind review means, and what harnesses do
- [Configuration](./configuration) - The most important config options and how to tune them
- [Profiles](./profiles) - Create and switch agent runtime profiles that control harness, model, and effort
- [Playbooks](./playbooks) - Build reusable workflow templates for recurring work
- [Integrations](./integrations) - How to use eforge from Claude Code, Pi, the CLI, and external issue trackers
- [Troubleshooting](./troubleshooting) - Daemon startup, failed builds, and common error remedies
- [Glossary](./glossary) - Definitions for eforge-specific terms such as profiles, worktrees, and playbooks
- [CLI Reference](/reference/cli) - All CLI commands and flags
- [Configuration Reference](/reference/config) - Full `eforge/config.yaml` schema
