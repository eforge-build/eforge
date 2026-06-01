# Eforge Roadmap

## Kernel Resilience and Typed Recovery

**Goal**: Make the build-engine kernel more resilient without expanding it into input authoring or host workflow UX.

- **Typed recovery paths** - Continue moving failure analysis, retry, split, abandon, queue-cascade recovery, and validation repair behind typed events and daemon/client routes so recovery decisions are inspectable and repeatable.
- **Honest gates** - Strengthen fail-closed validation, acceptance evidence, waiver visibility, dirty-worktree invariants, and no-output safeguards so completed builds mean verified work rather than optimistic success.
- **Engine boundary discipline** - Keep normalized build-source intake, dependency-aware branch/worktree orchestration, build execution, conservative gates, and typed failure/recovery dispatch in the kernel while leaving input authoring and richer workflow UX to extension surfaces.

---

## Console Observability and Control

**Goal**: Make console-ui the canonical local-first control surface for observing, configuring, and steering eforge builds while keeping the engine headless and harness integrations thin.

- **Actionable build control** - Queue management, retry/recovery, validation waivers, stack sync, and build lifecycle actions from the console.
- **Planning visibility** - Session-plan browsing, readiness display, and handoff-visibility links centered on the session-plan artifact without moving planning UX into the engine.
- **Configuration and library surfaces** - Manage profiles, playbooks, scoped config, extensions, and model/runtime preferences through typed daemon/client APIs.
- **Thin integration strategy** - Reduce Pi and Claude Code integrations to launch, deep-link, status, and build entry points that reuse daemon/client primitives instead of duplicating rich workflow UX.

---

## Extension Platform

**Goal**: Make eforge an extensible forge: a small build-engine kernel surrounded by trusted, typed extension mechanisms and reusable input surfaces.

- **Native TypeScript extensions (deferred phases)** - `beforeEnqueue` and `beforeValidation` policy gates, approval workflow/state/UI, and `modify` policy decisions remain deferred. Shipped capabilities are documented in `docs/extensions.md` and `docs/extensions-api.md`.
- **Broader extension surface** - Continue clarifying how native extensions relate to playbooks, session plans, toolbelts, shell hooks, host integrations, and wrapper apps without treating every surface as engine functionality.

---

## Optional Stacked PR Expansion

**Goal**: Polish the opt-in stacked PR workflow while keeping git-spice as the current supported provider.

- **Stack workflow polish** - Improve setup guidance, sync visibility, and recovery affordances for `stacking.enabled: true` plus `landing.action: pr` workflows backed by git-spice.
- **Future provider evaluation** - Other stack providers may be evaluated later, but current support remains git-spice only.

---

## Integration & Maturity

**Goal**: Full lifecycle coverage, CI support, provider flexibility, and cross-project visibility without weakening the kernel/extension boundary.

- **Daemon & MCP controls** - Add MCP tool and web UI controls for changing priority on queued PRDs at runtime; the priority field exists in frontmatter and affects execution order, but there is no way to modify it after enqueue.
- **Overseer / multi-project observability** - Provide a durable unified view across many eforge projects and daemons without moving orchestration out of project-local daemons. Schaake OS epic: `cf245870-90f4-48db-b5e7-b7a0f17a458b`.
- **Low-fidelity input handling** - When the user provides a high-level prompt with minimal detail, launch an exploration agent (or parallel exploratory agents) that performs thorough codebase exploration before compiling plans. Bypassed for detailed PRDs. Scope levels (expedition/errand/excursion) classify intended depth but don't perform exploration; this fills that gap.
- **Schema library unification on TypeBox** - TypeBox is canonical for eforge-owned domain schemas; Zod is isolated to third-party SDK compatibility adapters. The first migration slice (client wire schemas, engine structured output, and custom-tool contracts) is complete. Config, input artifact, and MCP proxy schemas remain Zod until a follow-up PRD lands.
- **TypeScript project references** - Adopt `tsconfig.json` `references` across workspace members for automatic topological ordering.
