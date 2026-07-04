# Acceptance Coverage

Complete criteria: ac-001, ac-002, ac-003, ac-004, ac-005, ac-006, ac-007, ac-008, ac-009, ac-010, ac-011, ac-012
Incomplete criteria: (none)

| Criterion | Covering plan(s) | Coverage summary |
| --- | --- | --- |
| ac-001 | `session-plan-agent-profile-select` | Replaces the Agent profile free-text input with a select/dropdown in the metadata editor. |
| ac-002 | `eforge-plan-profile-options-action`, `session-plan-agent-profile-select` | Loads kernel-owned runtime profile data through the read-only adapter and renders disambiguating profile context when available. |
| ac-003 | `client-profile-contract`, `eforge-plan-profile-options-action` | Enforces the boundary against eforge-plan profile discovery, private config imports, local wire shapes, or hard-coded profile route literals. |
| ac-004 | `eforge-plan-profile-options-action` | Any new read action is a thin read-only adapter over the kernel-provided profile-list interface. |
| ac-005 | `client-profile-contract`, `eforge-plan-profile-options-action` | Shared client route/types remain the source of truth for profile-list wire shapes consumed by the action/UI. |
| ac-006 | `session-plan-agent-profile-select` | Always renders a default/no-selection option and persists it as `agentProfile: null`/unset. |
| ac-007 | `session-plan-agent-profile-select` | Saves selected known profiles through `update-session-plan-metadata` using the existing `agentProfile` field while preserving open questions. |
| ac-008 | `session-plan-agent-profile-select` | Updates copy/help text to distinguish planning profile depth from build agent/runtime profile. |
| ac-009 | `session-plan-agent-profile-select` | Existing known `agent_profile` values are shown selected. |
| ac-010 | `session-plan-agent-profile-select` | Missing/deleted current profile values render as synthetic keepable/clearable options and do not block unrelated edits. |
| ac-011 | `session-plan-agent-profile-select` | Loading, empty, and error profile-list states do not block clearing `agent_profile` or editing planning metadata. |
| ac-012 | `client-profile-contract`, `eforge-plan-profile-options-action`, `session-plan-agent-profile-select` | Tests cover default clearing, known selection, missing-profile preservation, copy distinction, kernel/extension boundary enforcement, and registration/allowed-action wiring. |

### Represented residue/follow-up aspects

- (none)
