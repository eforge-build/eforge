/**
 * Transient backend-transport error classification.
 *
 * These are *agent backend* transport hiccups (the LLM-provider websocket or
 * SDK socket dropping mid-turn), NOT failures of the eforge daemon itself. The
 * engine treats them as retryable (`error_transient_transport`) rather than
 * terminal build failures, so consumers should render them as a transient
 * "reconnecting/retrying" state rather than a hard error.
 *
 * Lives in the client package so the engine, daemon, and browser monitors all
 * classify the same wire strings identically.
 */

/**
 * Matches `Backend error: WebSocket closed <code>` messages from the backend SDK,
 * where <code> is any numeric WebSocket close code (e.g. 1000, 1012).
 * Requires the `backend error:` prefix so unrelated messages containing
 * a close code number are not misclassified as transient transport failures.
 */
const BACKEND_WS_CLOSE_RE = /backend error:\s*websocket closed\s+\d+\b/i;

/**
 * Matches the Claude Code SDK socket-close message, which takes the form:
 *   API Error: The socket connection was closed unexpectedly. ...
 *
 * Requires both the `API Error:` prefix and the exact phrase
 * `socket connection was closed unexpectedly`. This covers:
 *   - the raw SDK text, and
 *   - the eforge-wrapper text (`Claude Code returned an error result: API Error: ...`)
 *
 * The `.*` between the two anchors accommodates any minor SDK wording between
 * the prefix and the phrase. Deliberately does NOT match generic `API Error:`
 * messages (auth, model, budget, HTTP) that omit the socket-close phrase.
 */
const CLAUDE_SDK_SOCKET_CLOSE_RE = /api error:.*socket connection was closed unexpectedly/i;

/**
 * Matches Codex SSE response-header timeouts emitted by the backend transport:
 *   Backend error: Codex SSE response headers timed out after <N>ms
 *
 * Requires the `backend error:` and `codex` prefixes so generic shell command,
 * daemon request, or non-backend SSE timeout text is not classified as transient.
 */
const BACKEND_CODEX_SSE_HEADERS_TIMEOUT_RE = /backend error:\s*codex sse response headers timed out after \d+ms\b/i;

/**
 * Matches upstream idle timeouts emitted by the backend transport (observed from
 * OpenRouter-routed providers during planner-compiler agent turns):
 *   Backend error: Upstream idle timeout exceeded
 *
 * Requires the `backend error:` prefix so generic shell command or daemon request
 * timeout text is not classified as transient.
 */
const BACKEND_UPSTREAM_IDLE_TIMEOUT_RE = /backend error:\s*upstream idle timeout\b/i;

/** True when an error message matches a known transient backend transport close. */
export function isTransientTransportError(message: string): boolean {
  if (BACKEND_WS_CLOSE_RE.test(message)) return true;
  if (CLAUDE_SDK_SOCKET_CLOSE_RE.test(message)) return true;
  if (BACKEND_CODEX_SSE_HEADERS_TIMEOUT_RE.test(message)) return true;
  if (BACKEND_UPSTREAM_IDLE_TIMEOUT_RE.test(message)) return true;
  const normalized = message.toLowerCase();
  return normalized.includes('backend error: websocket error');
}
