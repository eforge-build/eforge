# Strengthen Kernel Boundary, Plan Annotations, Recovery UX, and Trust Cleanup — Architecture

## Vision and goals

This plan set finishes a coordinated cleanup across documentation boundaries, extension-owned planning UX, typed queue recovery, and extension trust configuration. The durable boundary is:

- Core eforge is a build-engine kernel: normalized build source in, reviewed/validated code out.
- Playbooks, session plans, `/eforge:plan`-style planning entry points, backlog workflows, workstations, authoring UX, and revision UX are producer/extension/host surfaces around the kernel.
- The engine emits typed events and performs build/queue state transitions; consumers render recovery and guidance.
- Daemon HTTP routes, SSE snapshots, queue wire shapes, recovery contracts, and event schemas are owned by `@eforge-build/client`.
- Project/team extension trust is controlled only by local hash trust records under `.eforge/extension-trust.json`; the deprecated no-op `extensions.trustProjectExtensions` field is removed.

## Exploration findings and delta assessment

### Not fully implemented

- `extensions.trustProjectExtensions` is still accepted and documented. It appears in `packages/engine/src/config.ts`, extension loader/discovery option types, monitor extension routes, Pi config rendering, generated config schema, docs, and many tests.
- Public docs still blur core and optional surfaces:
  - `web/content/docs/getting-started.md` leads the first-build path with eforge-plan/session-plan UX rather than direct prompt/PRD/file builds.
  - `web/content/docs/concepts.md` has a core section named `Build Sources and Session Plans` and presents session plans/playbooks as prominent concepts.
  - `web/content/docs/extensions.md` and `web/content/docs/extensions-api.md` include eforge-plan product semantics (`backlogCurationDraft`, `planRevisionTurn`, Revise with AI/application details) that belong in first-party extension docs.
  - `web/lib/nav.ts` and `packages/docs-gen/src/manifest.ts` do not distinguish kernel/core, extension platform, and optional first-party extension pages.
- Queue recovery is still a simple retry/reactivate cascade in `packages/client/src/queue-recovery.ts`, `packages/engine/src/queue/recovery-cascade.ts`, `packages/monitor/src/routes/queue-recovery.ts`, and `packages/console-ui/src/components/recovery/advanced-cascade-section.tsx`. It does not classify dependencies for operators, require explicit stack-parent selection, or preflight the same dispatch validation that blocks stacked builds.
- Pre-session dispatch failures (for example stacked builds with multiple `depends_on` and no `stack_parent`) currently emit `plan:error:set` plus `queue:prd:complete`, but there is no durable queue-specific dispatch failure event or queue projection field that survives into Console recovery UX.

### Already substantially implemented

- Annotation-driven plan revision storage/actions/UI are already present in `eforge/extensions/eforge-plan/plan-revision-*`, workstation Plans components, and tests such as `plan-revision-annotations.test.ts` and `plan-detail-annotations.test.tsx`.
- Existing implementation already includes private storage normalization, target metadata with quote context, selection handling via `window.getSelection`, fallback block/section/whole-plan annotation controls, sticky annotation Revise with AI control, one-running-turn lock reuse, source-context snapshots, bounded context fallback, idempotent apply, and referenced-annotation resolution for patch-bearing applies.
- The annotation module in this architecture is therefore a gap-audit/hardening module: it must not rewrite working flows; it only closes any deltas found while preserving the existing extension-owned design.

## Core architectural principles

1. **Kernel boundary stays narrow.** Documentation and generated artifacts describe the kernel as consuming normalized build source and producing reviewed code. Optional authoring and workflow surfaces are named as producers/extensions/hosts.
2. **Extension-owned planning state.** eforge-plan annotations, turns, transcript/index state, preview/apply semantics, and workstation UI remain in the eforge-plan extension and `.eforge/storage/extensions/eforge-plan/` private storage.
3. **Read-only daemon planning tasks.** Revision turns pass read-only source context to daemon-owned `ctx.agentTasks`; revision flows do not mark plans ready, hand off plans, enqueue builds, or mutate backlog records.
4. **Client-owned wire contracts.** Recovery events, queue item fields, route request/response types, SSE snapshot schemas, and browser helpers are defined in `@eforge-build/client`. Daemon and Console import them; they do not redeclare local wire interfaces.
5. **Dispatch validation is reusable.** Queue recovery preflight reuses or mirrors the same dispatch validation path that the scheduler uses before `session:start`, especially stacked-build `stack_parent` rules.
6. **Explicit operator repair.** Removing satisfied dependencies and selecting `stack_parent` require explicit operator action and confirmation. Recovery never silently edits queue metadata or requeues a PRD known to fail dispatch validation.
7. **Generated artifacts last.** Source docs, nav, config schemas, event schemas, and route contracts land before generated docs are refreshed.

## Shared data model and contracts

### Eforge-plan annotation revision contract

The eforge-plan extension owns the durable annotation and revision-turn records in private storage. Existing names may be retained, but the storage/index contract must preserve equivalent fields:

```ts
type PlanRevisionAnnotation = {
  id: string;
  sessionId: string;
  target: {
    kind: 'selection' | 'block' | 'section' | 'whole-plan';
    blockId?: string;
    sectionId?: string;
    dimension?: string;
  };
  selectedText?: string;
  blockText?: string;
  quote: string;
  prefix?: string;
  suffix?: string;
  note?: string;
  createdAt: string;
  updatedAt?: string;
  resolvedAt?: string;
  resolvedByTurnId?: string;
};

type PlanRevisionTurnAnnotationSnapshot = {
  annotationIds: string[];
  annotations: PlanRevisionAnnotation[];
  steeringText?: string;
};
```

The workstation produces annotations using `window.getSelection` inside the workstation frame for text selections and fallback controls for block, section, and whole-plan targets. The revision source-context builder (`buildPlanRevisionSourceText` or equivalent) serializes the snapshot as bounded, structured, read-only source context for the daemon-owned planning task. Patch-bearing successful auto-apply resolves only annotations referenced by the applied patch/turn metadata; answer-only, needs-input, failed, and cancelled turns leave annotations unresolved.

### Queue dispatch failure event

Add a client-owned event variant equivalent to:

```ts
type QueuePrdDispatchFailedEvent = {
  type: 'queue:prd:dispatch-failed';
  prdId: string;
  title: string;
  reason: string;
  stage: 'stacking-validation' | 'policy-gate' | 'profile-routing' | 'dispatch';
  timestamp: string;
};
```

The exact stage union may be refined by the module planner, but the discriminant and durable queue-item correlation must live in the client event schema modules and be registered in `event-registry.ts` with `scope: 'daemon'` and `persist: true` so it appears in daemon SSE replay and recent activity. The producer is the engine/scheduler dispatch path owned by `recovery-contracts-and-engine`; the consumers are daemon projections and Console views owned by `recovery-daemon-console`.

### Queue item dispatch failure projection

Extend the client-owned `QueueItem` / `DaemonQueueItemSchema` with an optional field equivalent to:

```ts
type QueueDispatchFailureProjection = {
  reason: string;
  stage: QueuePrdDispatchFailedEvent['stage'];
  timestamp: string;
};
```

Monitor projections overlay the latest persisted `queue:prd:dispatch-failed` event for the matching failed queue item. The field must not be shown for healthy/requeued items solely because an old event exists. Console renders this imported field; monitor code does not invent a parallel interface.

### Queue recovery preflight and repairs

Extend the existing client-owned queue recovery contract rather than adding ad-hoc daemon shapes. The public route surface remains the existing queue recovery analyze/apply routes unless implementation discovers a breaking change that requires `DAEMON_API_VERSION` to be bumped.

The client package owns exported equivalents of these additions:

```ts
type QueueRecoveryDependencyStatus =
  | 'blocking'
  | 'satisfied'
  | 'terminal'
  | 'stale-historical';

type QueueRecoveryDependencyInfo = {
  prdId: string;
  status: QueueRecoveryDependencyStatus;
  reason: string;
  terminalKind?: 'failed' | 'skipped';
  queueStatus?: string;
  artifactStatus?: string;
  completedAt?: string;
};

type QueueRecoveryPreflight = {
  canApply: boolean;
  blockers: string[];
  warnings: string[];
  stacking: {
    enabled: boolean;
    currentStackParent?: string;
    meaningfulDependencyIds: string[];
    requiresStackParentChoice: boolean;
  };
};

type QueueRecoveryRepairAction =
  | { type: 'remove-depends-on'; dependencyIds: string[] }
  | { type: 'set-stack-parent'; stackParentPrdId: string }
  // plus existing move/reactivation sidecar operations retained by the current contract
  ;
```

`QueueRecoveryAnalyzeResponse` (or the existing exported analyze-response type) includes `dependencyClassifications`, `dispatchPreflight`, and `availableRepairActions`. `QueueRecoveryApplyRequest` includes selected `repairActions`, and `QueueRecoveryApplyResponse` returns the final preflight/repair summary used by Console copy.

`applyQueueRecovery` must simulate requested repair actions against current frontmatter, re-run dispatch preflight, and refuse to mutate if selected repairs still leave a known dispatch blocker. Only after that preflight succeeds may it persist metadata repairs and move files. Removing satisfied dependencies requires explicit operator confirmation, and choosing `stack_parent` is required when multiple meaningful stacked dependencies remain.

## Integration contracts between modules

### Module dependency graph

- `docs-boundary-and-eforge-plan-docs`, `eforge-plan-annotation-revisions`, `recovery-contracts-and-engine`, and `trust-cleanup` may run independently except for shared-file coordination declared below.
- `recovery-daemon-console` depends on the client contracts emitted by `recovery-contracts-and-engine`.
- `generated-reference-artifacts` runs after all source modules that affect docs, schemas, event contracts, or manifests.
- No module depends on outputs from `generated-reference-artifacts`, so the dependency graph is acyclic.

### docs-boundary-and-eforge-plan-docs

- Owns source documentation rewrites in `README.md`, `web/content/docs/getting-started.md`, `web/content/docs/concepts.md`, `web/content/docs/configuration.md`, `web/content/docs/integrations.md`, `web/content/docs/extensions.md`, and `web/content/docs/extensions-api.md`, subject to trust-cleanup regions declared in the Shared File Registry.
- Owns extension-owned eforge-plan documentation or summary/mirror pages and links from public docs to those pages as optional first-party extension documentation, not kernel concepts.
- Owns `web/lib/nav.ts`, `packages/docs-gen/src/manifest.ts`, and docs-boundary tests that allowlist links to optional extension pages while rejecting eforge-plan product semantics in core docs.
- Owns any generator-source or adjacent-guide-text changes needed so generated reference docs label playbook and session-plan tools/routes as optional workflow compatibility or extension surfaces, not kernel capabilities. The final generated-artifacts module refreshes the generated outputs.
- Does not regenerate `web/public/**` or reference docs; the final generated-artifacts module does that.

### eforge-plan-annotation-revisions

- Owns only eforge-plan runtime/workstation deltas for annotation-driven revisions.
- Begins with existing tests and implementation; patch only unmet requirements.
- Verifies private storage migration/normalization, annotation handlers, selection/block/section/whole-plan UI, sticky controls, source-context snapshotting, and annotation auto-resolution semantics described in the shared annotation contract.
- Does not move annotation state into daemon, kernel, backlog storage, or core docs.

### recovery-contracts-and-engine

- Owns shared client recovery/event/queue item contracts and engine-side dispatch validation/recovery-cascade semantics.
- Produces `QueuePrdDispatchFailedEvent`, `QueueDispatchFailureProjection`, queue recovery preflight types, and repair-action request/response types in `@eforge-build/client`.
- Extracts reusable dispatch validation for stack parent inference/failure and uses it from both scheduler paths and recovery preflight.
- Adds engine/client tests for durable dispatch failure events, dependency classification, satisfied dependency repair simulation, dispatch-preflight refusal, and explicit stack-parent choice.

### recovery-daemon-console

- Consumes client contracts from `@eforge-build/client`/`@eforge-build/client/browser`.
- Updates monitor projections/routes/SSE snapshots and Console recovery/Needs attention UI.
- Renders dispatch failure reasons, dependency classifications, selected repair actions, the repaired metadata, and the blocker that prevents requeue when preflight fails.
- Recovery copy explains that recovery requeues the existing PRD artifact and that frontmatter is preserved unless an explicit repair action changes it.
- Does not redeclare recovery or queue wire shapes locally.

### trust-cleanup

- Removes `extensions.trustProjectExtensions` from schema, resolved config, extension discovery/loader options, monitor/Pi consumers, tests, and active docs references assigned to this module.
- Configs containing that field become unsupported through existing config validation, unless implementation finds a stronger compatibility requirement.
- Keeps local hash trust records as the documented/tested authority.

### generated-reference-artifacts

- Runs after source modules and refreshes generated reference docs, public docs mirrors, schemas, and LLM bundles.
- Updates only generated artifacts unless a generator drift bug is discovered; generator source changes belong to earlier modules.

## Shared File Registry

| File | Modules | Region Strategy |
|------|---------|-----------------|
| `eforge/extensions/eforge-plan/README.md` | docs-boundary-and-eforge-plan-docs, eforge-plan-annotation-revisions | Non-overlapping Markdown sections by heading. Docs module owns install/package/boundary/migrated-product-semantics sections. Annotation module owns only `## Annotation revision workflow` and adjacent action-table rows if code gaps require docs changes. |
| `web/content/docs/configuration.md` | docs-boundary-and-eforge-plan-docs, trust-cleanup | Docs module owns the core/optional configuration structure and kernel-boundary framing. Trust module owns only removal of `extensions.trustProjectExtensions` references and local-hash-trust wording in extension trust/configuration sections. |
| `web/content/docs/extensions.md` | docs-boundary-and-eforge-plan-docs, trust-cleanup | Docs module owns generic extension API/boundary framing and removal/migration of eforge-plan product semantics. Trust module owns only `extensions.trustProjectExtensions` removal and authoritative local hash trust wording. |
| `web/content/docs/extensions-api.md` | docs-boundary-and-eforge-plan-docs, trust-cleanup | Docs module owns generic API/boundary framing and product-semantics cleanup. Trust module owns only `extensions.trustProjectExtensions` removal and trust-model wording. |

### Region Declarations

**`eforge/extensions/eforge-plan/README.md`**:
- `docs-boundary-and-eforge-plan-docs`: Introduction, installation/package sections, action overview sections outside annotation-specific headings, and any link targets from public docs.
- `eforge-plan-annotation-revisions`: Existing `## Annotation revision workflow` section and direct annotation action descriptions only. If no annotation code gaps remain, do not edit this file from the annotation module.

**`web/content/docs/configuration.md`**:
- `docs-boundary-and-eforge-plan-docs`: Headings and prose that separate core daemon/build/profile configuration from optional workflow/extension configuration.
- `trust-cleanup`: Smallest edits that remove `extensions.trustProjectExtensions`, remove compatibility warnings/handling prose, and preserve local hash trust records as the only documented authority.

**`web/content/docs/extensions.md` and `web/content/docs/extensions-api.md`**:
- `docs-boundary-and-eforge-plan-docs`: Generic extension boundary/API text, eforge-plan product-semantics migration, and optional first-party extension links.
- `trust-cleanup`: Smallest edits that remove `extensions.trustProjectExtensions` references and update trust-model prose to local hash records only.

No other file is intentionally shared. If a module planner discovers a second shared file, it must declare non-overlapping heading/region ownership in that module's plan before building.

## Technical decisions and rationale

1. **Use an expedition split.** The work spans public docs/navigation/generated artifacts, eforge-plan workstation/private storage, engine/client recovery contracts, daemon/Console recovery projections, and config/trust schema cleanup. Each subsystem needs focused planning and tests.
2. **Extend existing queue recovery routes.** The existing `/api/queue/recovery/analyze` and `/api/queue/recovery/apply` routes are the right surface for cascade preflight and repair actions. Add optional contract fields where compatibility allows; bump `DAEMON_API_VERSION` only if the implementation makes a breaking API change.
3. **Persist dispatch blockers as events, not side effects.** Engine emits a typed durable event with the dispatch blocker reason. Monitor/Console render that event through client-owned projections.
4. **Overlay queue projections from event history.** The queue filesystem remains runtime state. The monitor joins failed queue items with persisted dispatch-failure events when projecting REST and `stream:hello` queue snapshots so reconnects show the same blocker reason.
5. **Keep generated docs last.** Source docs and generators are easier to review before generated public mirrors and schemas are updated.
6. **Remove, do not deprecate further.** `extensions.trustProjectExtensions` is already a no-op compatibility field. Removing it from schema/types makes stale configs fail validation and eliminates trust-model ambiguity.

## Quality attributes

- **Safety:** recovery repairs are explicit, confirmed, and preflighted before mutation.
- **Contract stability:** all queue/recovery/event/SSE shapes compile from `@eforge-build/client`.
- **Auditability:** pre-session dispatch blockers persist as daemon events and appear in recent activity and queue item projections.
- **Bounded context:** annotation revision source context remains bounded via existing `boundedSourceText`/fallback behavior.
- **Docs discipline:** boundary tests prevent eforge-plan product semantics from re-entering core docs outside allowlisted links.
- **Maintainability:** new large files use durable semantic region markers when over 300 lines; existing oversized files receive bounded edits.

## Validation commands

Run after all modules merge:

```bash
pnpm maintainability:check
pnpm type-check
pnpm docs:generate
pnpm docs:check
pnpm test
```
