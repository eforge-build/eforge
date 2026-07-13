## Acceptance Coverage

Complete criteria: ac-001, ac-002, ac-003, ac-004, ac-005
Incomplete criteria: (none)

| Criterion | Covered by | Planned proof |
| --- | --- | --- |
| ac-001 | `eforge-plan-search-dirty-refresh` | Unchanged session-plan artifact synchronization, including read-only refresh loading `list-planning-artifacts`, does not add dirty search records. |
| ac-002 | `eforge-plan-search-dirty-refresh` | `syncSessionPlanArtifactRecord` gates dirty marking on search-relevant canonical content and linked backlog-item/epic relationship changes rather than unconditional sync activity. |
| ac-003 | `eforge-plan-search-dirty-refresh` | Regression sequence rebuilds the search index to `ready`, performs a no-op workstation refresh, and verifies the index remains `ready`. |
| ac-004 | `eforge-plan-search-dirty-refresh` | Tests preserve dirty marking for real session-plan, backlog-item, epic, and relationship changes, limited to the affected documents. |
| ac-005 | `eforge-plan-search-dirty-refresh` | Focused Vitest coverage covers unchanged synchronization, meaningful synchronization changes, and the workstation refresh sequence. |

### Represented residue/follow-up aspects

- (none)