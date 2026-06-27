---
title: Extract Playbook Domain Ownership to eforge-playbooks
created: 2026-06-26
---

# Extract Playbook Domain Ownership to eforge-playbooks

## Problem / Motivation

Playbook domain behavior is currently spread across core and host packages through shims, facades, schemas, draft fields, commands, MCP/Pi/Claude tools, CLI subcommands, and direct helper imports. This creates domain leakage where hosts know about playbooks instead of only knowing about generic extensions.

## Goal

Make `eforge/extensions/eforge-playbooks` the canonical and exclusive owner of playbook parsing, serialization, validation, storage, compilation, planning seed extraction, and user-facing playbook tools. Core and host packages should retain only generic extension hosting, contribution discovery, action invocation, build intake, queueing, and daemon/client transport.

## Approach

- Use a clean-break extraction rather than preserving backwards compatibility.
- Move playbook parse, serialize, validate, storage, compile, and planning-seed behavior into `eforge/extensions/eforge-playbooks`.
- Remove host-owned playbook shims, facades, schemas, draft fields, commands, MCP/Pi/Claude tools, CLI subcommands, and direct helper imports instead of delegating old entry points.
- Ensure CLI, Pi, Claude plugin, daemon/client, monitor, Console, and engine code call generic contribution APIs and may render extension-provided metadata.
- Prevent core and host packages from hard-coding playbook imports, route helpers, schema fields, validators, command names, model helpers, or storage semantics.
- Keep `@eforge-build/input` domain-neutral by removing playbook-specific helpers and exports, including `packages/input/src/playbook.ts`, `packages/input/src/playbook-plan-seed.ts`, and related exports.
- Remove `playbookDraft` from core contracts or migrate it fully behind an extension-owned contribution path.
- If a planning artifact envelope is still needed, make it generic.
- Allow non-extension tests and docs to mention playbooks only when documenting or enforcing the ownership boundary.
- Treat any non-extension implementation import, type, validator, command, tool, route, schema field, or storage helper with playbook-specific semantics as a domain leak.
- Validate using source-wide boundary tests, package type-check/build, targeted extension-enabled tests, and targeted extension-disabled tests.

## Scope

In scope:

- Move the playbook domain boundary so `eforge/extensions/eforge-playbooks` owns the canonical playbook model and all playbook behavior.
- Cover parse, serialize, validate, storage, compile, and planning seed extraction helpers.
- Cover extension contribution actions.
- Cover extension-owned commands and tools.
- Remove `@eforge-build/input` playbook helpers.
- Remove or replace generic `playbookDraft` contracts with a domain-neutral artifact contract.
- Clean up client and monitor planning contracts.
- Clean up Console and core references.
- Add boundary tests.
- Update architecture documentation.
- Update docs to describe `eforge-playbooks` as the sole playbook domain owner.
- Keep generic extension hosting, build intake, queueing, daemon/client plumbing, and host contribution rendering in core.

Out of scope:

- Preserving deprecated host-owned playbook UX.
- Adding kernel-owned playbook workflow behavior.
- Adding compatibility shims.
- Keeping host-owned playbook facades.
- Keeping new kernel-owned playbook workflow behavior.

## Acceptance Criteria

- A source-wide audit classifies every playbook reference outside `eforge/extensions/eforge-playbooks` as either an allowed boundary test/doc reference or a domain leak.
- Every playbook domain leak outside `eforge/extensions/eforge-playbooks` is removed.
- `eforge/extensions/eforge-playbooks` owns all canonical playbook parsing behavior.
- `eforge/extensions/eforge-playbooks` owns all canonical playbook serialization behavior.
- `eforge/extensions/eforge-playbooks` owns all canonical playbook validation behavior.
- `eforge/extensions/eforge-playbooks` owns all canonical playbook storage behavior.
- `eforge/extensions/eforge-playbooks` owns all canonical playbook compilation behavior.
- `eforge/extensions/eforge-playbooks` owns all canonical playbook planning-seed extraction behavior.
- No transitional compatibility shim for playbook behavior remains outside `eforge/extensions/eforge-playbooks`.
- No deprecated playbook export remains outside `eforge/extensions/eforge-playbooks`.
- No host-owned playbook facade remains outside `eforge/extensions/eforge-playbooks`.
- CLI packages register no user-facing playbook commands or tools except those contributed by `eforge/extensions/eforge-playbooks`.
- Pi packages register no user-facing playbook commands or tools except those contributed by `eforge/extensions/eforge-playbooks`.
- Claude plugin packages register no user-facing playbook commands or tools except those contributed by `eforge/extensions/eforge-playbooks`.
- MCP surfaces register no user-facing playbook commands or tools except those contributed by `eforge/extensions/eforge-playbooks`.
- Console packages register no user-facing playbook commands or tools except those contributed by `eforge/extensions/eforge-playbooks`.
- Core CLI implementation code interacts with playbook functionality only through generic extension contribution discovery or action invocation.
- Pi implementation code interacts with playbook functionality only through generic extension contribution discovery or action invocation.
- Claude plugin implementation code interacts with playbook functionality only through generic extension contribution discovery or action invocation.
- Engine implementation code interacts with playbook functionality only through generic extension contribution discovery or action invocation.
- Daemon/client implementation code interacts with playbook functionality only through generic extension contribution discovery or action invocation.
- Monitor implementation code interacts with playbook functionality only through generic extension contribution discovery or action invocation.
- Console implementation code interacts with playbook functionality only through generic extension contribution discovery or action invocation.
- Non-extension implementation code contains no hard-coded playbook model helpers.
- Non-extension implementation code contains no hard-coded playbook validators.
- Non-extension implementation code contains no hard-coded playbook command names.
- Non-extension implementation code contains no hard-coded playbook route helpers.
- Non-extension implementation code contains no hard-coded playbook storage semantics.
- Non-extension implementation code contains no hard-coded playbook wire fields.
- `@eforge-build/input` exports only generic input artifact behavior.
- `packages/input/src/playbook.ts` is moved into `eforge/extensions/eforge-playbooks` or deleted.
- `packages/input/src/playbook-plan-seed.ts` is moved into `eforge/extensions/eforge-playbooks` or deleted.
- `playbookDraft` is removed from generic planning task contracts or replaced by a domain-neutral artifact mechanism.
- `playbookDraft` is removed from generic client contracts or replaced by a domain-neutral artifact mechanism.
- `playbookDraft` is removed from generic monitor contracts or replaced by a domain-neutral artifact mechanism.
- Any playbook-specific draft behavior is owned by `eforge/extensions/eforge-playbooks`.
- With `eforge/extensions/eforge-playbooks` disabled, core packages register no playbook commands or tools.
- With `eforge/extensions/eforge-playbooks` absent, core packages register no playbook commands or tools.
- With `eforge/extensions/eforge-playbooks` enabled, representative playbook list flows work through extension contributions.
- With `eforge/extensions/eforge-playbooks` enabled, representative playbook create flows work through extension contributions.
- With `eforge/extensions/eforge-playbooks` enabled, representative playbook run flows work through extension contributions.
- With `eforge/extensions/eforge-playbooks` enabled, representative playbook plan flows work through extension contributions.
- Boundary tests prevent reintroducing direct playbook ownership in engine packages.
- Boundary tests prevent reintroducing direct playbook ownership in daemon routes.
- Boundary tests prevent reintroducing direct playbook ownership in client API routes.
- Boundary tests prevent reintroducing direct playbook ownership in Console core.
- Boundary tests prevent reintroducing direct playbook ownership in CLI packages.
- Boundary tests prevent reintroducing direct playbook ownership in Pi packages.
- Boundary tests prevent reintroducing direct playbook ownership in Claude plugin packages.
- Boundary tests prevent reintroducing direct playbook ownership in shared input packages.
- Boundary tests whitelist `eforge/extensions/eforge-playbooks` plus explicit boundary docs/tests.
- Boundary tests fail on playbook-specific imports in non-extension implementation code.
- Boundary tests fail on playbook-specific exports in non-extension implementation code.
- Boundary tests fail on playbook-specific schemas in non-extension implementation code.
- Boundary tests fail on playbook-specific commands in non-extension implementation code.
- Boundary tests fail on playbook-specific tools in non-extension implementation code.
- Boundary tests fail on playbook-specific route helpers in non-extension implementation code.
- Boundary tests fail on `playbookDraft` in non-extension implementation code.
- Boundary tests fail on playbook-specific model helpers in non-extension implementation code.
- Targeted tests verify extension action registration.
- Targeted tests verify extension action invocation.
- Targeted tests verify generic host contribution rendering.
- Targeted tests verify the disabled-extension case where no playbook UX appears.
- Architecture docs describe `eforge/extensions/eforge-playbooks` as the sole playbook domain owner.
- Architecture docs distinguish generic extension hosting from playbook-specific behavior.
- `pnpm type-check` exits 0.
- `pnpm build` exits 0.
- `pnpm test` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

- Smoke-test representative playbook list, create, run, and plan flows only through `eforge/extensions/eforge-playbooks` contributions.
- Main risks are intentional removal of old host-owned entry points, hidden direct imports, planning wire-contract churn around `playbookDraft`, and accidental domain knowledge in generic hosts.
- Mitigate risks with audit-first sequencing, explicit allowlists, and extension-enabled/extension-disabled integration coverage.