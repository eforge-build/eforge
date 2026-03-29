---
title: Add Third-Party License Notices to README
created: 2026-03-29
status: pending
---



# Add Third-Party License Notices to README

## Problem / Motivation

eforge is Apache 2.0 licensed, but its default backend (`@anthropic-ai/claude-agent-sdk`) is proprietary - "All rights reserved" by Anthropic, with use subject to their legal agreements. Users installing eforge inherit obligations beyond Apache 2.0, but the README doesn't mention this. A second backend (Pi, MIT-licensed) is on the roadmap, making backend choice a licensing decision users should be informed about.

## Goal

Expand the License section of `README.md` to clearly document eforge's own license, the proprietary terms of the Claude Agent SDK backend, and provide forward-looking language for the Pi backend once it ships.

## Approach

Expand the `## License` section in `README.md` (currently just "Apache-2.0" on line 106) to cover:

1. eforge's own Apache 2.0 license
2. That the Claude Agent SDK backend is subject to Anthropic's proprietary terms
3. Links to the relevant Anthropic legal agreements
4. A note about authentication requirements (API key vs OAuth for third-party use)
5. Forward-looking language for the Pi backend (MIT) once it ships

Replace the current License section:

```markdown
## License

Apache-2.0
```

With:

```markdown
## License

eforge is licensed under [Apache-2.0](LICENSE).

### Third-party backend licenses

eforge's backend abstraction allows different AI providers. Each backend carries its own license terms:

- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) - the default backend - is proprietary software owned by Anthropic PBC. By using eforge with this backend, you agree to Anthropic's [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) (API users) or [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) (Free/Pro/Max users), plus the [Acceptable Use Policy](https://www.anthropic.com/legal/aup). See [Anthropic's legal page](https://code.claude.com/docs/en/legal-and-compliance) for details.

  **Note:** If you are building a product or service on top of eforge, Anthropic requires API key authentication through [Claude Console](https://platform.claude.com/) - OAuth tokens from Free, Pro, or Max plans may not be used for third-party products.

eforge's Apache 2.0 license applies to eforge's own source code. It does not extend to or override the license terms of its dependencies.
```

When the Pi backend ships, add a bullet:

```markdown
- **Pi** (`@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`) - [MIT licensed](https://github.com/badlogic/pi-mono/blob/main/LICENSE). A fully permissive alternative backend with no additional license obligations beyond attribution.
```

## Scope

**In scope:**
- `README.md` - Expand the `## License` section

**Out of scope:**
- The `LICENSE` file itself stays as-is since it covers eforge's own code
- No other files need updates

## Acceptance Criteria

- The updated README License section accurately documents eforge's Apache 2.0 license and the Claude Agent SDK's proprietary terms
- Links are correct and functional: Commercial Terms, Consumer Terms, AUP, legal page, Claude Console
- The authentication note for third-party product builders is present
- The LICENSE file is unchanged
- No other files are modified
