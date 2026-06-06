function buildWorkstationHelperScript(bridgeToken: string): string {
  const tokenLiteral = JSON.stringify(bridgeToken);
  return `
(function () {
  var bridgeToken = ${tokenLiteral};
  var pending = new Map();
  function nextRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  window.addEventListener('message', function (event) {
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
  window.eforge = Object.freeze({
    version: 1,
    invokeAction: function (actionId, input) {
      return new Promise(function (resolve, reject) {
        if (typeof actionId !== 'string' || actionId.length === 0) {
          reject(new Error('actionId must be a non-empty string'));
          return;
        }
        var requestId = nextRequestId();
        var safeInput = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
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
  });
}());
`;
}

function helperTag(bridgeToken: string): string {
  return `<script>${buildWorkstationHelperScript(bridgeToken)}</script>`;
}

export function buildWorkstationSrcDoc(srcDoc: string, bridgeToken: string): string {
  const tag = helperTag(bridgeToken);
  const earlyAnchors = [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<body\b[^>]*>/i, /<!doctype\b[^>]*>/i];
  for (const anchor of earlyAnchors) {
    const match = anchor.exec(srcDoc);
    if (match?.index !== undefined) {
      const insertAt = match.index + match[0].length;
      return `${srcDoc.slice(0, insertAt)}${tag}${srcDoc.slice(insertAt)}`;
    }
  }
  return `${tag}${srcDoc}`;
}

export function workstationHelperScriptForTest(bridgeToken = 'test-token'): string {
  return buildWorkstationHelperScript(bridgeToken);
}
