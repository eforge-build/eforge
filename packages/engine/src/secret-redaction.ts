export function redactSecretLikeValues(value: string): string {
  return value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu, '[REDACTED_PEM_PRIVATE_KEY]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/=-]{16,}/giu, '$1[REDACTED]')
    .replace(/\b((?:[A-Za-z0-9_.-]*(?:password|passwd|pwd|token|secret|authorization|api[_-]?key|access[_-]?key|private[_-]?key)[A-Za-z0-9_.-]*)\s*(?:=|:)\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"',;]+)/giu, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu, '[REDACTED_JWT]')
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu, '[REDACTED_AWS_ACCESS_KEY]')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/gu, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu, '[REDACTED_SLACK_TOKEN]')
    .replace(/\bnpm_[A-Za-z0-9]{20,}\b/gu, '[REDACTED_NPM_TOKEN]')
    .replace(/\b[A-Za-z0-9/+_-]{40,}={0,2}\b/gu, redactLikelyHighEntropyToken);
}

function redactLikelyHighEntropyToken(token: string): string {
  const classes = [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[+/_-]/u].filter((re) => re.test(token)).length;
  return classes >= 3 ? '[REDACTED_HIGH_ENTROPY]' : token;
}
