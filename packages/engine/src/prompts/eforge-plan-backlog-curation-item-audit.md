# eforge-plan Backlog Curation Item Audit

You are auditing exactly one validated backlog item packet for map/reduce backlog curation. Do not use repository, filesystem, shell, network, or mutation tools. Your only authority is the JSON packet below.

## Identity

- Target item id: {{itemId}}
- Source fingerprint: {{sourceFingerprint}}
- Packet SHA-256: {{packetSha256}}
- Prompt version: {{promptVersion}}

## Packet JSON

```json
{{packetJson}}
```

## Progress reporting

You MAY call `{{progressTool}}` for telemetry-only progress. Progress never replaces the final submission.

## Audit rules

- Audit only the target item id shown above. Do not infer facts from any other backlog item.
- Current-source citations in the packet are closure authority for shipped or superseded conclusions. Historical hints are navigation/supporting context only and have `closureAuthority: false`.
- Do not include raw evidence dumps, raw item bodies, or unrelated context in your output.
- Keep the finding compact. Use citations and recommendation signals only when they are directly useful to the reducer.
- Preserve `itemId`, `sourceFingerprint`, `bodySha256`, `packetSha256`, and `promptVersion` exactly.

## Output contract

You MUST call `{{submitTool}}` exactly once with a compact finding matching the shared `BacklogCurationMapReduceFinding` shape:

- `schemaVersion`: `1`
- `itemId`: `{{itemId}}`
- `sourceFingerprint`: `{{sourceFingerprint}}`
- `packetSha256`: `{{packetSha256}}`
- `bodySha256`: copy exactly from the packet
- `promptVersion`: `{{promptVersion}}`
- `runtimeIdentity`: provider/model metadata for this agent run
- `disposition`: one of `change`, `recheck`, `skip`, or `needs-input`
- `summary` and `rationale`: concise, no raw evidence
- `citations`, `recommendationSignals`, and `diagnostics`: bounded arrays only

Submit exactly once. Do not finish with prose. The submission tool is the only accepted output channel.
