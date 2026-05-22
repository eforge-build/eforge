---
title: Harden Pi harness headless tool execution for GPT-5.5 planning failures
created: 2026-05-22
profile: claude-sdk-4-7
onSuccess: issue-pr
---

# Harden Pi harness headless tool execution for GPT-5.5 planning failures

## Problem / Motivation

Eforge compile runs using Pi-backed planning profiles (`gpt-claude-combo`, planning model `gpt-5.5`) are intermittently failing before a plan set is successfully submitted. The latest observed failure is not that GPT-5.5 failed to reason about the task; the planner generated a `submit_plan_set` payload, but required tool calls returned `Theme not initialized. Call initTheme() first.` and the compile phase ended as if no submission tool had been called.

Affected users: anyone using Pi-backed eforge profiles for planning/review/evaluation, especially GPT-5.5 via `openai-codex`. The issue undermines provider flexibility and makes the Pi harness less reliable than the Claude SDK harness for the same PRDs.

Why it matters now: this failure has occurred repeatedly with `gpt-claude-combo`. A recent fix addressed empty streamed result text (`Pipeline composer did not return any text`), but this latest failure is a different Pi SDK/headless tool execution weakness.

### Evidence from recent failed compile

- Monitor DB shows failed compile run `78c35830-1810-443b-b625-071aae0baab7` using profile `gpt-claude-combo`, planning harness `pi`, model `gpt-5.5`.
- The immediately re-enqueued compile run `4007cf6d-7177-401e-88b1-6808f7fb4dfa` used profile `claude-sdk-4-7`, planning harness `claude-sdk`, model `claude-opus-4-7`, and completed.
- The failed GPT/Pi run was not a pure planning-quality failure: the planner produced a large `submit_plan_set` payload, but Pi tool results repeatedly returned `Theme not initialized. Call initTheme() first.`
- The theme error occurred for multiple tools in that run: `bash` x4, `read` x1, `submit_plan_set` x1, and `mcp_eval_eval_profiles` x1. The phase failed with `Planner agent completed without calling a submission tool (submit_plan_set) or emitting <skip>` because the required custom tool call did not succeed.
- Recent prior GPT/Pi compile failures for `parameterize-eforge-on-success-landing-actions` had a different symptom: `Pipeline composer did not return any text`. Commit `1f2d03bf fix(pi): preserve streamed assistant result text (#5)` added extraction tests and code for that class of failure, but the latest failure is a tool-execution/resource-runtime issue.

### Relevant code paths

- `packages/engine/src/harnesses/pi.ts` constructs Pi SDK sessions with `DefaultResourceLoader`, filters out resources from `@eforge-build/pi-eforge`, then calls `createAgentSession(...)` with built-in, bridged MCP, and eforge custom tool names included in the Pi tool allowlist.
- `PiHarness` has a `bare` option, but current evidence shows it only skips separate `discoverPiExtensions(...)` extension-path binding for coding agents. It does not clearly prevent `DefaultResourceLoader` from auto-discovering global/user Pi resources, skills, prompts, or themes.
- `packages/engine/src/agent-runtime-registry.ts` passes `config.agents.bare` into both Pi and Claude SDK harnesses. For Pi tiers, `buildPiConfig(...)` defaults `pi.extensions.autoDiscover` to `true`.
- `packages/engine/src/harnesses/pi-extensions.ts` auto-discovers `.pi/extensions` and `~/.pi/extensions`, filtering only a basename of `eforge`. Separately, `DefaultResourceLoader` also discovers package/user resources from Pi settings and global locations.
- `packages/engine/src/config.ts` exposes tier-local `pi.extensions.autoDiscover/include/exclude/paths` and global `agents.bare`; there is no clearly documented eforge-level distinction between "load ambient Pi resources" and "run deterministic/headless Pi SDK session".
- Existing tests include `test/pi-harness-result-extraction.test.ts` for streamed result text extraction and `test/pi-extension-discovery.test.ts` for the eforge-specific extension discovery helper, but search did not find tests covering Pi headless `DefaultResourceLoader` isolation, theme initialization, tool-result `isError`, or bare-mode resource suppression.

### Project constraints and roadmap alignment

- Project instruction: provider SDK imports must remain restricted to `packages/engine/src/harnesses/`.
- Project instruction: engine emits events and consumers render; engine should not rely on terminal/TUI state for agent execution.
- Testing convention: group by logical unit, avoid mocks where possible, use real code. Agent wiring tests can use `StubHarness`; SDK objects may be hand-crafted and cast through `unknown`.
- Roadmap includes integration/maturity and provider flexibility. Hardening the Pi harness aligns with provider flexibility and reliable multi-profile operation; it is not a roadmap conflict.

### Assumptions and unknowns from context gathering

- Evidence-backed conclusion: the latest failed compile involved Pi tool calls returning a theme-initialization error, and the Claude SDK rerun avoided that failure.
- Assumption: the `Theme not initialized` error is caused by ambient Pi resources or Pi built-in tool rendering code touching the global `theme` proxy in a non-interactive SDK context. This is high confidence from error text and Pi docs, but the exact throw site has not been proven with a debugger or minimal reproduction.
- Assumption: disabling or isolating Pi `DefaultResourceLoader` resource discovery for eforge agent runs will prevent this class of failure without removing required eforge custom tools and bridged MCP tools. This is medium/high confidence from code structure, but should be verified by tests.
- Unknown: whether eforge intentionally wants any user-installed Pi extensions/skills/prompts available inside eforge-run agents. Current comments in `PiHarness` say non-eforge user packages are left available, implying intentional behavior; the plan needs a design decision about default isolation vs opt-in ambient resources.

### Reproduction Steps

Evidence-backed reproduction from monitor DB:

1. Enqueue or run compile for `branch-aware-landing-and-queue-provenance-split-for-eforge-builds` with profile `gpt-claude-combo`.
2. Observe compile run `78c35830-1810-443b-b625-071aae0baab7` starts planning agents via Pi: `pipeline-composer` and `planner`, model `gpt-5.5`.
3. Observe planner tool calls for `bash`, `read`, `submit_plan_set`, and `mcp_eval_eval_profiles` return text containing `Theme not initialized. Call initTheme() first.`.
4. Observe compile fails with summary: `Planner agent completed without calling a submission tool (submit_plan_set) or emitting <skip>`.
5. Re-enqueue same build with profile `claude-sdk-4-7`.
6. Observe compile run `4007cf6d-7177-401e-88b1-6808f7fb4dfa` completes with `claude-opus-4-7` via Claude SDK.

Expected behavior: Pi-backed compile agents can execute built-in tools, bridged MCP tools, and eforge custom tools in a non-interactive/headless SDK session without requiring global TUI theme initialization.

Actual behavior: required tool calls can return a theme-initialization failure, causing the model to believe the submission tool failed and causing compile failure.

Proposed deterministic test reproduction: create a test or diagnostic harness that runs a Pi SDK session in eforge's headless configuration with a custom tool and an ambient/resource-loaded extension or built-in renderer path that touches `theme`; assert tool execution either succeeds or fails fast as harness infrastructure, never as normal tool text returned to the model.

### Root Cause

Validated root cause from code and monitor evidence:

- Latest failed compile involved Pi tool-result text `Theme not initialized. Call initTheme() first.` across multiple tools, including eforge's required custom `submit_plan_set` tool.
- A no-modification `DefaultResourceLoader` probe from this repo showed Pi would discover six extensions in this project/user environment, including project-local `.pi/extensions/eforge-dev/index.ts`, global usage/Schaake OS extensions, the user-installed `packages/pi-eforge` extension, and `pi-dotfiles` session tracker.
- `PiHarness` filters resources only when `isEforgePiResource(...)` detects the `@eforge-build/pi-eforge` package or a `/pi-eforge/` path segment. That filter removes the packaged eforge Pi integration, but it does not remove project-local `.pi/extensions/eforge-dev`.
- `.pi/extensions/eforge-dev/index.ts` registers `session_start`, `turn_end`, `before_agent_start`, and `tool_call` handlers. Its `refresh(ctx)` path reads `ctx.ui.theme` and styles status/widget content without checking for a headless/non-TUI SDK context first.
- On `tool_call`, eforge-dev does `if (!state) await refresh(ctx);` before policy checks. If the earlier `session_start` refresh failed because no theme was initialized, `state` remains unset; every subsequent tool call can retry `refresh(ctx)`, hit `ctx.ui.theme`, throw `Theme not initialized`, and cause Pi's tool-call preflight to return an error tool result instead of executing the requested tool.
- This matches the monitor pattern exactly: unrelated tools (`bash`, `read`, `submit_plan_set`, `mcp_eval_eval_profiles`) all returned the same theme-initialization text.

Root cause:

Eforge's Pi harness permits ambient project/user Pi extensions inside automated headless agent sessions. In this repo, the project-local `eforge-dev` Pi extension is interactive/TUI-oriented and touches `ctx.ui.theme` from lifecycle/tool-call handlers without guarding against non-interactive SDK execution. Because Pi reports tool-call hook failures as tool errors, every planner tool call can be replaced by `Theme not initialized. Call initTheme() first.`, causing compile to fail before plan submission.

Why the Claude SDK harness does not fail:

The Claude SDK harness does not use Pi's `DefaultResourceLoader`, global theme proxy, or project-local Pi extension runtime, so it avoids this class of headless TUI/resource coupling.

## Goal

Make the Pi harness reliable for headless eforge agent runs by isolating Pi-backed eforge sessions from ambient project/user/global Pi resources by default, while preserving required eforge custom tools and bridged MCP tools and surfacing Pi infrastructure failures as harness errors rather than silent tool-text failures.

## Approach

Resolved product/design decisions:

- Pi-backed eforge runs should be deterministic by default: no ambient project/user/global Pi extensions, skills, prompts, or themes unless explicitly opted in.
- Add an explicit opt-in shape for ambient Pi resources, preferably tier-local (for example `pi.resources: "isolated" | "ambient"` or `pi.ambientResources: true`). Default remains isolated/deterministic.
- `agents.bare` should remain or become "maximum isolation"; Pi must obey it and it must not be weaker than the deterministic default.
- Defensive theme initialization may be used as a belt-and-suspenders only when ambient resources are explicitly enabled; it should not be the primary fix.
- Pi infrastructure failures such as `Theme not initialized` during tool-call/tool-result handling should fail fast with a clear harness/build error rather than being left as normal tool text for the model to recover from.

Relevant code paths to touch:

- `packages/engine/src/harnesses/pi.ts` — adjust `DefaultResourceLoader` construction/filtering so ambient resources are suppressed by default; keep eforge custom tools and bridged MCP tools in the Pi tool allowlist.
- `packages/engine/src/harnesses/pi-extensions.ts` — align extension auto-discovery with the deterministic default and opt-in behavior.
- `packages/engine/src/agent-runtime-registry.ts` and `packages/engine/src/config.ts` — surface the new opt-in shape, ensure `agents.bare` semantics, and update `buildPiConfig(...)` defaults.
- Add classification for Pi tool-call/tool-result infrastructure failures so they become harness/build errors instead of normal tool text.

### Profile Signal

Recommendation: **Excursion**.

Rationale: this is a focused but non-trivial harness reliability bug. A single cohesive plan can cover the work: reproduce/classify the Pi headless tool failure, harden resource/theme handling, improve error classification, and add regression tests/docs for config semantics. It does not require delegated module planning across independent subsystems, so **Expedition** would be overkill. It is not an **Errand** because the change touches provider harness semantics, SDK resource loading, and automated reliability tests.

### Assumptions And Validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Latest failure is a Pi harness/headless resource problem, not GPT-5.5 planning incompetence. | Monitor DB shows planner generated `submit_plan_set` payload; failures were tool results with `Theme not initialized`; Claude SDK rerun completed. Additional static validation found a project-local Pi extension that can throw that exact error from tool-call/lifecycle hooks. | High | Low | Optional: reproduce with a local non-network Pi SDK/unit harness that loads `.pi/extensions/eforge-dev` and exercises its `tool_call` path. | If wrong, isolation changes may not fix GPT/Pi compile reliability. |
| Ambient Pi resource loading is involved. | Validated with a `DefaultResourceLoader` probe: it discovers `.pi/extensions/eforge-dev`, global user extensions, packaged `pi-eforge`, and `pi-dotfiles`. `PiHarness` only filters `pi-eforge`; it would not filter `.pi/extensions/eforge-dev`. | High | Low | Add a regression test around PiHarness/loader construction or a helper that maps default/bare/resource options to `DefaultResourceLoader` suppression flags. | If wrong, the fix should target a different Pi runtime path, but evidence now strongly points to ambient resource loading. |
| The project-local `.pi/extensions/eforge-dev` extension is a plausible exact throw source. | Validated by reading `.pi/extensions/eforge-dev/index.ts`: `session_start` and `tool_call` paths call `refresh(ctx)`, which reads `ctx.ui.theme`; the extension does not guard this path for headless SDK use. Pi agent-core catches tool-call hook errors and returns them as error tool results. | High | Low/Medium | Minimal reproduction with this extension loaded and a dummy tool call, ideally without a live model. | If wrong, another ambient resource may be the throw source, but isolation still addresses the class. |
| Initializing a default theme is insufficient as the sole fix. | Headless eforge builds should not depend on TUI global state; project principle says engine emits/consumers render. Validated exact extension also performs UI status/widget behavior and branch-policy intervention, which is undesirable ambient behavior for automated eforge planner agents. | High | Low | Compare theme-init-only mitigation with full resource isolation in tests. | If wrong, a smaller fix might stop the observed exception, but ambient extension side effects would remain. |
| Deterministic-by-default is the intended product behavior for Pi-backed eforge runs. | User explicitly confirmed deterministic-by-default. This resolves the prior open product choice about ambient non-eforge Pi resources. | High | Low | Implement default isolation and provide explicit opt-in for ambient Pi resources. | If not implemented clearly, users may see surprising behavior or ambient extensions may continue to destabilize automated builds. |
| Tests can cover this without invoking live GPT-5.5. | Existing tests hand-craft SDK-shaped objects; project testing guidance allows hand-crafted SDK objects cast through `unknown`; exact failure source can be represented with local resource-loader/helper tests or a synthetic extension that touches `ctx.ui.theme`. | High | Low/Medium | Add unit tests for helper/resource-loader option selection and failure classification; add SDK integration only if stable and network-free. | If wrong, only live diagnostics will catch regressions, making CI protection weaker. |

## Scope

**In scope:**

- Harden the Pi harness so headless eforge agent sessions are deterministic by default (no ambient project/user/global Pi extensions, skills, prompts, or themes).
- Add an explicit opt-in shape (e.g. `pi.resources: "isolated" | "ambient"` or `pi.ambientResources: true`) for ambient Pi resources, tier-local.
- Ensure `agents.bare` semantics: at least as isolated as the deterministic default, never weaker.
- Preserve eforge custom tools (including `submit_plan_set`) and bridged MCP tools in the Pi tool allowlist under the deterministic default.
- Continue excluding recursive `pi-eforge` resources from eforge-run agent contexts.
- Classify Pi tool-call/tool-result infrastructure failures (such as `Theme not initialized`) as harness/build errors with clear remediation, rather than passing through as tool text.
- Optional belt-and-suspenders defensive theme initialization only when ambient resources are explicitly opted in.
- Regression tests covering: resource loader suppression under deterministic default; opt-in ambient resource loading still filters recursive `pi-eforge`; required custom tools remain callable; simulated theme-init failure classification; preservation of existing Pi result-text extraction behavior.
- Docs/config help explaining deterministic default behavior, opt-in ambient Pi resources, and `agents.bare` semantics.

**Out of scope (implied):**

- Changing the Claude SDK harness, which is unaffected by this class of failure.
- Fixing or redesigning the project-local `.pi/extensions/eforge-dev` extension itself (the fix isolates eforge runs from ambient extensions rather than rewriting them).
- Live GPT-5.5 integration tests (tests should avoid invoking live GPT-5.5; hand-crafted SDK objects and local resource-loader/helper tests are preferred).
- Roadmap-level changes beyond provider flexibility/reliability hardening.

## Acceptance Criteria

- Pi-backed eforge compile planning can call built-in tools (`read`, `bash`) and required custom tools (`submit_plan_set`) in a headless/non-interactive SDK session without `Theme not initialized` failures.
- Pi-backed eforge agent sessions are **deterministic by default**: ambient project/user/global Pi extensions, skills, prompts, and themes do not influence automated eforge runs unless explicitly opted in.
- `agents.bare: true` and/or any new Pi resource-loading config has a clearly tested meaning. Bare mode must be at least as isolated as the deterministic default, not weaker.
- Required eforge custom tools and bridged MCP tools remain available under the deterministic default.
- Recursive `pi-eforge` resources remain excluded from eforge-run agent contexts.
- There is an explicit opt-in path for users who intentionally want ambient Pi resources in eforge agent contexts, with documented risk/behavior.
- Tool execution infrastructure failures from Pi are surfaced as harness/build infrastructure errors with clear remediation, not treated as normal tool text that the model must reason around.
- Regression tests cover:
  - Pi resource loader construction suppresses ambient project/user/global extensions/skills/prompts/themes by default.
  - Opt-in ambient resource loading behaves intentionally and still filters recursive `pi-eforge` resources.
  - Required custom tools are still included in the Pi `tools` allowlist and remain callable.
  - A simulated tool-call/tool-result failure containing `Theme not initialized` is classified clearly rather than silently producing a no-submission compile failure.
  - Existing Pi result-text extraction tests continue to pass for the previous empty-result class of failure.
- Docs/config help are updated to explain deterministic default behavior, opt-in ambient Pi resources, and `agents.bare` semantics.
