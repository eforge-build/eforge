---
name: eforge-playbook
description: Create, edit, run, list, and promote eforge playbooks — reusable recurring-workflow templates
---

# /eforge:playbook

Manage eforge playbooks — reusable templates for recurring workflows that eforge can invoke on demand. Playbooks live in one of three storage tiers:

- `~/.config/eforge/playbooks/` — **user** scope (cross-project, personal)
- `eforge/playbooks/` — **project-team** scope (committed, shared with the team)
- `.eforge/playbooks/` — **project-local** scope (gitignored, personal draft)

A lower-tier playbook with the same name **shadows** a higher-tier one. eforge always resolves the most-specific tier.

## Tool boundary

Playbook management and run behavior is owned by the `eforge-playbooks` extension. The `eforge_playbook` compatibility tool is safe to use for normal playbook workflows, but it delegates to `eforge-playbooks:*` generic extension contributions rather than direct daemon playbook routes.

Use the compatibility tool first when it is available, for example:

- `eforge_playbook { action: "list" }`
- `eforge_playbook { action: "run", name: "docs-sync" }`
- `eforge_playbook { action: "copy", name: "docs-sync", targetScope: "project-local" }`

If the compatibility tool is unavailable or you need to inspect the extension boundary directly, use generic contribution invocation with integration commands:

- `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:list-playbooks", input: {} }`
- `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:run-playbook", input: { name: "docs-sync" } }`
- `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:copy-playbook", input: { name: "docs-sync", targetScope: "project-local" } }`

If a playbook contribution cannot be resolved, tell the user: `eforge-playbooks extension is unavailable. Install, trust, and reload eforge-playbooks, then retry.` Include any original contribution error text after that guidance.

## Playbook Modes

Every playbook has a `mode` field in its frontmatter:

- **`mode: autonomous`** — eforge builds the playbook end-to-end without further prompting. Hand-off-and-forget: the daemon enqueues it and runs it. Suitable for mechanical, repeatable workflows where the build agent does not need to consult the user mid-run.
- **`mode: planning`** — running the playbook checks the `eforge.plan.planning-workstation` capability from eforge-plan and returns generic planning entry metadata. Continue through `eforge_extension_contribution` list/show/invoke or the eforge-plan workstation deep link; the workstation owns the investigation-first flow, session-plan drafting, revision, and handoff. The daemon does not create the session plan directly or enqueue a PRD.

The `mode` field governs what happens when you run a playbook: `autonomous` enqueues a build; `planning` resolves generic eforge-plan planning entry metadata or unavailable capability diagnostics.

## Step 1: Branch on Arguments

Inspect `$ARGUMENTS`:

- **Empty / whitespace** — show the **no-args menu** (Step 2).
- **`create [description]`** — jump to **Branch: Create** (Step 3).
- **`edit [name]`** — jump to **Branch: Edit** (Step 4).
- **`run [name]`** — jump to **Branch: Run** (Step 5).
- **`list`** — jump to **Branch: List** (Step 6).
- **`promote [name]`** — jump to **Branch: Promote** (Step 7).
- **`demote [name]`** — jump to **Branch: Demote** (Step 8).

## Step 2: No-Args Menu

Call `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:list-playbooks", input: {} }` to fetch the current playbook inventory. Use the result to determine which branches to show:

**Always shown:**
- **1. Create** — draft and save a new playbook
- **4. List** — read-only formatted listing

**Shown only when playbooks exist:**
- **2. Edit** — walk through a playbook section-by-section
- **3. Run** — run a playbook (enqueue an autonomous playbook, or resolve the generic eforge-plan planning entry for a planning-mode playbook)

**Shown only when project-local playbooks exist (`.eforge/playbooks/`):**
- **5. Promote** — move a `.eforge/playbooks/<name>.md` to `eforge/playbooks/<name>.md`

**Shown only when project-team playbooks exist (`eforge/playbooks/`):**
- **6. Demote** — move a `eforge/playbooks/<name>.md` back to `.eforge/playbooks/<name>.md`

Present the available branches as a numbered list and ask the user to pick. Then jump to the corresponding branch.

---

## Branch: Create (Step 3)

Gather the recurring workflow the user wants to capture as a playbook, classify its scope automatically, draft the playbook, validate it, and save.

### 3.1: Gather the workflow description

If `$ARGUMENTS` contains a description after `create`, use it as the starting point. Otherwise ask:

> "What recurring workflow do you want to capture as a playbook? Describe what it does and when you'd run it."

If the user is entering Create from an eforge-plan workstation planning continuation and has an in-progress session plan, offer to use that plan as the draft starting point:

> "I see you have an active planning session for `{topic}`. Would you like to use that as the playbook draft?"

If yes, pre-fill the goal, out-of-scope, acceptance criteria, and planner notes from the session plan content.

### 3.2: Intelligent scope classification

Apply the following decision flow **without asking the user** unless the signals are mixed (see step 3.2.5). The target is ≥80% no-prompt rate for first-author cases.

**Step 3.2.1: Project-bound vs cross-project**

Evidence of **project-bound**:
- Explicit file paths or directory names specific to this repo
- Package names, script names, or tooling that only exist in this project
- Domain language or identifiers unique to this codebase
- References to project-specific CI/CD targets, environment configs, or services

Evidence of **cross-project**:
- Generic vocabulary that applies to any project (e.g. "update dependencies", "run lint", "generate changelogs")
- Convention-based references without project-specific names
- No project-specific identifiers anywhere in the description

**Step 3.2.2: Shared vs personal** (only if project-bound)

Evidence of **shared** (team default):
- Neutral phrasing ("the project", "the repo", "we")
- References to team conventions or shared CI workflows
- Nothing that suggests personal ownership

Evidence of **personal** (project-local):
- First-person ownership language ("my workflow", "I want", "for me")
- Explicit "don't share" / "private" / "draft" / "experimental" signals
- References to sensitive personal tokens, credentials, or local-only paths

**Step 3.2.3: Decision matrix**

| Project signal | Personal signal | Target scope |
|---|---|---|
| Cross-project | — | `user` (`~/.config/eforge/playbooks/`) |
| Project-bound | Neutral / absent | `project-team` (`eforge/playbooks/`) |
| Project-bound | Personal / private | `project-local` (`.eforge/playbooks/`) |
| Mixed / weak | — | Ask the user (Step 3.2.4) |

**Step 3.2.4: Ask only when signals are mixed**

When the evidence is genuinely ambiguous, present the strongest evidence you found and offer a default:

> "This looks like it could go either way. The description mentions `{evidence}`, which suggests `{scope-A}`, but it's generic enough to work cross-project. I'd default to **`{scope-B}`** — is that right, or would you prefer a different scope?"

Present three choices with plain-English labels and path hints. Never ask "where should I save this?" as an open-ended question.

**Step 3.2.5: Confirm scope with the user** (informative, not interrogative)

When classification is confident, state the inferred scope briefly:

> "I'll save this as a **{scope}** playbook (`{path}`). You can override the scope if you'd like."

### 3.3: Determine playbook mode

Ask the user which mode this playbook should use:

> "Should this be an **autonomous** playbook (eforge builds it end-to-end without further prompting — hand-off-and-forget) or a **planning** playbook (the agent investigates first, synthesizes findings into an implementation-ready session plan, and continues in the eforge-plan workstation through the generic planning entry before building)?"

**Default heuristic** — pre-select a suggestion before asking, based on the workflow description:

- Suggest **`planning`** when the description contains judgment-heavy language: "audit", "choose", "decide", "pick the best", "refactor decision", "per-target", "review and select", or similar phrases that imply human evaluation of options.
- Suggest **`autonomous`** when the description reads mechanical and deterministic: "update", "sync", "generate", "keep … in sync", "run … and commit", or similar phrases where the outcome is predictable without mid-run human judgment.

Present the suggestion explicitly so the user can confirm or override:

> "Based on the description, I'd suggest **`{mode}`** — [{reason}]. Does that fit, or would you prefer the other?"

Write the confirmed mode into the playbook frontmatter.

### 3.3b: Optional runtime profile

Ask whether this playbook should be tied to a specific agent runtime profile:

> "Should this playbook use a specific agent runtime profile when it runs? If yes, enter the profile name (e.g. `docs-heavy`, `fast-review`). Leave blank to allow the profile router to select one, or fall back to the project's active profile/defaults."

- If the user provides a name, set `profile: {name}` in the frontmatter.
- If the user leaves it blank or says "default" / "none", omit the `profile` field entirely.
- Explain the fallback: leaving `profile` empty means eforge may use a registered profile router; if no router selects a profile, it uses the project's active-profile marker or built-in defaults. An explicit profile overrides both router and active-profile selection.
- Profile existence is validated at execution time, not when the playbook is saved.

### 3.4: Draft the playbook

Compose the playbook content based on the workflow description. Structure:

**Frontmatter (YAML):**
```yaml
---
name: {slug-kebab-case}
description: {one-line description}
scope: {user|project-team|project-local}
mode: {autonomous|planning}
# profile: {name}   # Optional — omit to allow router/active-profile/default resolution
---
```

**Body sections:**
- `## Goal` — what the workflow achieves
- `## Out of scope` — what this playbook should NOT do (prevents scope creep in the build)
- `## Acceptance criteria` — specific, testable conditions for a successful run
- `## Notes for the planner` — hints, constraints, or context for the build agent (optional but encouraged)

Present the draft to the user for review. If entries were pre-filled from an eforge-plan workstation session, note which sections came from the session.

### 3.5: Validate and save

1. Call `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:validate-playbook", input: { raw: "<draft-markdown>" } }` before saving.
   - If `ok: false`, surface the errors **verbatim** and ask the user to fix them. Loop back to Step 3.4 with the errors highlighted. Do NOT write the file.
   - If `ok: true`, proceed.

2. Call `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:save-playbook", input: { scope: "<scope>", playbook: { frontmatter: {...}, body: {...} } } }`.

3. Report the path returned by the extension action:
   > "Playbook saved to `{path}`."

4. Offer next steps: run it with `/eforge:playbook run {name}`, or promote it with `/eforge:playbook promote {name}` if it was saved as project-local.

---

## Branch: Edit (Step 4)

Walk through an existing playbook section-by-section and save the updated version.

### 4.1: Pick a playbook

Call `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:list-playbooks", input: {} }`. Print a numbered list:

```
  1. docs-sync           [project-team]
  2. dependency-update   [user]
  3. release-prep        [project-local]  ← shadows project-team version
```

- Include `[source]` labels.
- Mark shadowed entries with `← shadows {tier} version`.
- If no playbooks exist, tell the user and offer to Create one.

Ask the user to pick by number. Never ask for a name.

### 4.2: Shadow notice

If the selected playbook is **shadowed by** a more-specific tier (e.g., the user picked a `project-team` entry that has a `project-local` shadow), show:

> "⚠ This playbook is shadowed by a `project-local` version at `.eforge/playbooks/{name}.md`. eforge resolves the shadow when the playbook is invoked. Would you like to:
> 1. Edit the **shadow** (project-local — what eforge will invoke)
> 2. Edit the **original** (project-team — shadowed, not active)
> 3. Copy the original to project-local and edit (creates a new shadow)"

If the user picks option 3, call `eforge_playbook { action: "copy", name: "<name>", targetScope: "project-local" }` before entering the section-by-section edit loop. This atomically copies the playbook to the project-local tier so future invocations resolve to the new shadow. Then proceed with the edit loop using the copied version.

### 4.3: Load the playbook

Call `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:show-playbook", input: { name: "<name>" } }` (resolved to the tier the user chose).

### 4.4: Section-by-section walkthrough

Present each section with its current content and ask if the user wants to update it. Work through in order: **mode** → **profile** → **Goal** → **Out of scope** → **Acceptance criteria** → **Notes for the planner**.

Note: `mode` and `profile` are frontmatter fields (not body headings); present them as `mode (current): <value>` and `profile (current): <value or "none">` rather than using the `## {Section}` heading format below.

**Profile editing**: when the user changes the `profile` field, remind them:

> "Profile existence is validated at execution time, not when the playbook is saved. Leaving it blank allows profile-router, active-profile, or default resolution."

For each section:
1. Show: `**## {Section}** (current): {current content}`
2. Ask: "Does this look right, or would you like to update it?"
3. If the user provides new content, update the draft. If they say "fine" / "keep it" / "no change", preserve the current content.

**Mode editing**: when the user switches `mode` from `autonomous` to `planning` or vice versa, emit a one-line warning before saving:

> "⚠ Changing the mode does NOT alter any session plans or queued builds created from previous runs of this playbook. Only future runs will use the new mode."

### 4.5: Validate and save

Same as Step 3.5. Validate before saving, surface errors verbatim, do NOT write on failure. On success, report the path.

---

## Branch: Run (Step 5)

Run a playbook. For autonomous playbooks this enqueues a build (with an optional wait for an in-flight build to finish first). For planning playbooks, first check the `eforge.plan.planning-workstation` capability and continue through generic extension contribution discovery/detail/invocation into the eforge-plan workstation/deep-link entry.

### 5.1: Pick a playbook

Same numbered-list approach as Step 4.1. If a name was provided via `$ARGUMENTS`, pre-select it but still confirm.

### 5.2: Load the playbook

Call `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:show-playbook", input: { name: "<name>" } }` to get the full playbook content including mode, Goal, Acceptance criteria, and Notes for the planner.

**Branch on `mode`:**

- **`mode: autonomous`** — proceed to Step 5.3 (choose landing action).
- **`mode: planning`** — proceed to Step 5.5 (generic eforge-plan planning entry flow).

### 5.3: Choose a landing action (autonomous only)

Before checking the queue, present the unified landing selector to ask how the playbook's branch should land when the build completes:

> "When this playbook finishes, what should happen to the branch?
> 1. **Use project default** — inherit the configured `landing.action` from `eforge/config.yaml`, or the engine default (`merge`) if unset. No `landingAction` override is sent to the daemon.
> 2. **pr** — open a pull request
> 3. **merge** — merge directly to the base branch
> 4. **leave** — leave the branch as-is (no PR, no merge)"

Await the user's selection. If the user cancels or dismisses, make no enqueue calls and exit.

Record the selection as `landingActionOverride`:
- **"Use project default" selected**: set `landingActionOverride = undefined`. **Do not include `landingAction` in any enqueue body.**
- **Explicit selection** (pr/merge/leave): set `landingActionOverride` to the chosen value. Include `landingAction: landingActionOverride` in all enqueue bodies.

**PR auto-merge sub-selector (only when `pr` is selected):** After the user selects `pr` as the landing action, present a follow-up selector to determine whether GitHub auto-merge should be enabled on the opened PR:

- **Use policy default** — Defers to `landing.pr.autoMerge` from `eforge/config.yaml`. **No `landingAutoMerge` key is sent in any enqueue body.**
- **Enable auto-merge** — Sets `landingAutoMergeOverride = true`. Include `landingAutoMerge: true` in all enqueue bodies.
- **Disable auto-merge** — Sets `landingAutoMergeOverride = false`. Include `landingAutoMerge: false` in all enqueue bodies.

Record the selection as `landingAutoMergeOverride` (`true | false | undefined`). When `landingActionOverride` is not `"pr"`, skip this sub-selector and set `landingAutoMergeOverride = undefined`. Carry `landingAutoMergeOverride` forward to all enqueue calls in Step 5.4.

**Protected trunk behavior**: When the current branch is the configured trunk branch and `build.allowLocalMergeToTrunk` is not `true` in `eforge/config.yaml`:
- Exclude the **merge** option and the **project default** option (when the effective project default is `merge`) from the normal selector.
- Display a warning that direct trunk merges are not permitted for this project.
- Offer remediation choices instead:
  1. **pr** for this run — set `landingActionOverride = "pr"` and continue to Step 5.4
  2. **leave branch** — set `landingActionOverride = "leave"` and continue to Step 5.4
  3. **Enable direct merges** — update `eforge/config.yaml` with `build.allowLocalMergeToTrunk: true`, reload best-effort, set `landingActionOverride = "merge"`, and continue to Step 5.4 (shown only when a project config path is known)
  4. **Cancel** — make no enqueue calls and exit

Carry `landingActionOverride` forward to all enqueue calls in Step 5.4.

### 5.4: Check for in-flight builds and enqueue (autonomous only)

Call `eforge_queue_list {}` to get current queue items.

Filter for items where `status` is `"running"` or `"pending"` (queued). Build a numbered list indexed starting at 1.

- **If no active items**: enqueue immediately.
- **If active items exist**: list them by **title** with index numbers (never show queue ids):

```
There are active builds in the queue:
  1. [running] Update documentation site
  2. [pending] Add dark mode support

Would you like to:
  a. Run now (enqueue immediately, no dependency)
  b. Wait for build 1 to finish, then run
  c. Wait for build 2 to finish, then run
```

**Resolving selection:**
- Internally map the user's pick (letter b/c or number 1/2) to the corresponding queue item's internal id.
- The user never types or sees the queue id at any point.

**Handling ambiguity:**
- If the user provides a free-text name instead of a number (e.g. "wait for the docs build"), find all items whose title contains the mention.
- If exactly one match: proceed.
- If multiple matches: ask the user to pick by number from the numbered list above.

**Before enqueueing, confirm the mapping:**
> "Got it — `{playbook-name}` will run after **{selected-build-title}** finishes."

Await user confirmation (y/n or just Enter). Only proceed if confirmed.

**Enqueue:**

For **project default** (`landingActionOverride = undefined`), omit `landingAction` from the call body:
- **Run now**: Call `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:run-playbook", input: { name: "<name>" } }`.
- **Wait for build**: Call `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:run-playbook", input: { name: "<name>", afterQueueId: "<resolved-id>" } }`.

For **explicit selections** (`landingActionOverride` is set), include `landingAction`:
- **Run now**: Call `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:run-playbook", input: { name: "<name>", landingAction: "<landingActionOverride>" } }`.
- **Wait for build**: Call `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:run-playbook", input: { name: "<name>", afterQueueId: "<resolved-id>", landingAction: "<landingActionOverride>" } }`.

The `afterQueueId` is the internal queue id resolved above — never the title and never typed by the user.

When `landingAutoMergeOverride` is set (not `undefined`), append `landingAutoMerge: <landingAutoMergeOverride>` to the call body in all four cases above. Omit `landingAutoMerge` when `landingAutoMergeOverride` is `undefined` — omitting the key defers to the `landing.pr.autoMerge` policy.

On **`kind: 'enqueued'`** response: Report the enqueue confirmation and point at Console.
> "Playbook `{name}` enqueued as `{id}`. {If afterQueueId: 'It will start after `{build-title}` completes.'} Watch progress in Console."

If the enqueue fails because the upstream is no longer active (404 from daemon), tell the user:
> "The build you selected has already finished. Running `{name}` now instead."
Then re-enqueue without `afterQueueId`, preserving `landingActionOverride` from Step 5.3: include `landingAction: "<landingActionOverride>"` for explicit selections, or omit `landingAction` for project default. Also preserve `landingAutoMergeOverride` from Step 5.3: include `landingAutoMerge: <landingAutoMergeOverride>` when set, or omit `landingAutoMerge` when `undefined`.

### 5.5: Generic eforge-plan planning entry flow

Planning-mode playbook continuation is owned by eforge-plan. Do not create a session plan directly and do not enqueue. Instead:

1. **Check the capability through the playbook run response**: Call `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:run-playbook", input: { name: "<name>" } }`. This does not enqueue planning-mode playbooks. It checks the required `eforge.plan.planning-workstation` capability.
   - If the response is `{ kind: "planning-unavailable", requiredCapability, diagnostics }`, show the required capability and diagnostics verbatim. Tell the user to load, trust, and reload eforge-plan before continuing.
   - If the response is `{ kind: "requires-agent", planningEntry, requiredCapability }`, continue with the generic planning entry metadata.

2. **Discover the generic contribution**: Call `eforge_extension_contribution { action: "list", kind: "all", search: "planning" }` and confirm that `eforge-plan:open-planning-entry` and/or `eforge-plan:planning-workstation` are available. If an entry is unavailable, surface its availability message instead of continuing.

3. **Inspect or invoke the planning entry**: Use `eforge_extension_contribution { action: "show", kind: "command", id: "eforge-plan:open-planning-entry" }` when you need focused detail; prefer invoking the action-backed integration command with `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-plan:open-planning-entry", input: {} }`. If the host exposes deep-link opening, the equivalent deep link is `eforge-plan:planning-workstation`.

4. **Continue in the eforge-plan workstation**: Open the returned or declared workstation route `/console/workstations/eforge-plan%3Aplanning-workstation`. Carry the selected playbook name and the loaded playbook content as context for the workstation planning continuation. The workstation owns the investigation-first flow, session-plan drafting, revision, and handoff.

**Defensive fallback**: If any planning-mode response is returned from another path, use the generic `planningEntry` metadata and eforge-plan workstation/deep-link entry above. Do not prompt for a landing action in this fallback path.

---

## Branch: List (Step 6)

Call `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:list-playbooks", input: {} }` and render a formatted read-only listing.

For each playbook, show:
- Name
- Description
- Source tier `[user]` / `[project-team]` / `[project-local]`
- Shadow chain (if any): `→ shadowed by project-local: .eforge/playbooks/{name}.md`

Group by scope tier for readability. If no playbooks exist, tell the user and offer to Create one.

---

## Branch: Promote (Step 7)

Move a project-local playbook to project-team so the whole team benefits from it.

### 7.1: Pick a project-local playbook

Call `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:list-playbooks", input: {} }` and filter for `source: "project-local"` entries. Present as a numbered list. If none exist, tell the user.

### 7.2: Shadow trade-off notice

Before promoting, note the trade-off:

> "Promoting `{name}` moves it from `.eforge/playbooks/` to `eforge/playbooks/` and commits it with the project. **Note:** once promoted, you will no longer automatically receive team-side improvements to a playbook of the same name — your promoted version will shadow the team default."

Ask: "Proceed with promotion?"

### 7.3: Promote

Call `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:promote-playbook", input: { name: "<name>" } }`.

Report the destination path returned by the extension action.

---

## Branch: Demote (Step 8)

Move a project-team playbook back to project-local (personal shadow, not shared).

### 8.1: Pick a project-team playbook

Call `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:list-playbooks", input: {} }` and filter for `source: "project-team"` entries. Present as a numbered list. If none exist, tell the user.

### 8.2: Shadow trade-off notice

> "Demoting `{name}` creates a project-local copy at `.eforge/playbooks/{name}.md` that will shadow the team version. The team version remains in `eforge/playbooks/` but future invocations resolve to your local copy instead."

Ask: "Proceed with demotion?"

### 8.3: Demote

Call `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:demote-playbook", input: { name: "<name>" } }`.

Report the destination path returned by the extension action.

---

## Power-User Shortcuts

Direct invocations with a name argument jump into the relevant branch with that item pre-selected and still confirm before acting:

- `/eforge:playbook run docs-sync` — Run branch, pre-selects `docs-sync`, still offers wait-for-build if applicable.
- `/eforge:playbook edit dependency-update` — Edit branch, pre-selects `dependency-update`.
- `/eforge:playbook promote release-prep` — Promote branch, pre-selects `release-prep`.
- `/eforge:playbook create` — Create branch, asks for the workflow description.

---

## Validation Rules

Every save path (Create and Edit) must pass `eforge_extension_contribution { action: "invoke", kind: "command", id: "eforge-playbooks:validate-playbook", input: { raw: "<markdown>" } }` before the extension action writes anything to disk. On failure:

1. Surface the extension action's error messages **verbatim** — do not paraphrase.
2. Show the user exactly which section or field caused the error.
3. Ask the user to fix the content.
4. Re-validate before trying to save again.
5. Never write to disk while `ok: false`.

---

## Error Handling

| Condition | Action |
|-----------|--------|
| No playbooks exist | Tell the user and offer Create |
| Playbook name not found | Surface extension action error, list available playbooks |
| Validation failure | Show errors verbatim, do not save |
| Queue list fails | Skip wait-for-build offer, enqueue immediately and note the queue check failed |
| `eforge-playbooks` unavailable | Tell the user to install, trust, and reload `eforge-playbooks`, then retry; include the original contribution error text. |

<!-- parity-skip-start -->
| Tool connection failure | The daemon is not running. Tell the user to start it with `eforge_daemon { action: "start" }`, `/eforge:restart`, or `eforge daemon start`. |
<!-- parity-skip-end -->
| No eforge config | Tell the user: "No eforge config found. Run `/eforge:init` to initialize eforge in this project." |

---

## Related Skills

| Skill | When to suggest |
|-------|----------------|
| eforge-plan planning workstation | User wants to plan a one-off change (not recurring); at plan completion, offer to save as a playbook via `/eforge:playbook create` |
| `/eforge:build` | User wants to enqueue a session plan (not a playbook) |
| `/eforge:status` | User wants to check current build progress |
| `/eforge:config` | User wants to view or edit `eforge/config.yaml` |
