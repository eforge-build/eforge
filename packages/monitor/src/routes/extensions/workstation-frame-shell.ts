import {
  CONSOLE_WORKSTATION_BROWSER_SDK_VERSION,
  type ConsoleWorkstationFrameBundleManifestEntry,
} from '@eforge-build/client';

export function buildWorkstationFrameShell(workstation: ConsoleWorkstationFrameBundleManifestEntry, nonce: string): string {
  const styles = workstation.frameBundle.styles
    .map((asset) => `<link rel="stylesheet" href="${escapeHtmlAttribute(asset.url)}">`)
    .join('\n');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtmlText(workstation.title)}</title>
${styles}
</head>
<body>
<div id="root"></div>
<script nonce="${escapeHtmlAttribute(nonce)}">${renderBridgeScript()}</script>
<script type="module" src="${escapeHtmlAttribute(workstation.frameBundle.entrypoint.url)}"></script>
</body>
</html>`;
}

export function buildWorkstationFrameCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'none'",
  ].join('; ');
}

export function renderBridgeScript(): string {
  return `(function(){
  var bridgeToken = new URLSearchParams(window.location.hash.slice(1)).get('bridgeToken') || '';
  var pending = new Map();
  function nextRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  window.addEventListener('message', function(event) {
    var message = event.data;
    if (!message || message.type !== 'eforge:workstation:action-result' || typeof message.requestId !== 'string') return;
    var entry = pending.get(message.requestId);
    if (!entry) return;
    pending.delete(message.requestId);
    if (message.error) {
      var error = new Error(message.error.message || 'Workstation action failed');
      error.code = message.error.code;
      entry.reject(error);
      return;
    }
    if (!message.response || message.response.ok !== true) {
      var responseError = message.response && message.response.error;
      var failure = new Error((responseError && responseError.message) || 'Workstation action failed');
      failure.code = responseError && responseError.code;
      entry.reject(failure);
      return;
    }
    entry.resolve(message.response.output);
  });
  function invokeAction(actionId, input) {
    return new Promise(function(resolve, reject) {
      if (typeof actionId !== 'string' || actionId.length === 0) {
        reject(new Error('actionId must be a non-empty string'));
        return;
      }
      var safeInput = input === undefined ? {} : input;
      if (!isRecord(safeInput)) {
        reject(new Error('input must be an object when provided'));
        return;
      }
      var requestId = nextRequestId();
      pending.set(requestId, { resolve: resolve, reject: reject });
      try {
        window.parent.postMessage({
          type: 'eforge:workstation:invoke-action',
          requestId: requestId,
          bridgeToken: bridgeToken,
          actionId: actionId,
          input: safeInput
        }, '*');
      } catch (err) {
        pending.delete(requestId);
        reject(err);
      }
    });
  }
  window.eforge = Object.freeze({ version: ${CONSOLE_WORKSTATION_BROWSER_SDK_VERSION}, invokeAction: invokeAction });
}());`;
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replace(/`/g, '&#96;');
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
