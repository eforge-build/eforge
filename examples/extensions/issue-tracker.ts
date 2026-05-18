/**
 * Issue-tracker input source adapters for GitHub, Linear, and Jira.
 *
 * This extension registers three `registerInputSource` adapters so eforge can
 * fetch PRD/build-source artifacts directly from issue-tracker systems without
 * manual file placement. Adapter selection is by `name` — the adapter whose
 * `name` matches the `<adapter>` segment of an `eforge://input/<adapter>/<id>`
 * URI is invoked with the remaining `<id>` path.
 *
 * URI dispatch shapes:
 *   eforge://input/github/<owner>/<repo>#<n>   adapter "github", id "<owner>/<repo>#<n>"
 *   eforge://input/linear/<issue-id>            adapter "linear", id "<issue-id>"
 *   eforge://input/jira/<KEY-123>               adapter "jira",   id "<KEY-123>"
 *
 * For full URI syntax, failure policy, and provenance event names, see:
 *   docs/extensions.md      - "Input sources and PRD enrichers" section
 *   docs/extensions-api.md  - `registerInputSource` and `registerPrdEnricher` sections
 *
 * Safe-by-default: each adapter checks its required env var(s) before any
 * network call. When credentials are absent the adapter returns a structured
 * `InputSourceResult` with instructional markdown. It never throws and never
 * calls `globalThis.fetch` while unconfigured.
 *
 * Failure policy (enforced by the eforge runtime, not this file):
 *   - Input-source failures are fatal to enqueue (FatalPreprocessingError).
 *     Return `null` only for genuine not-found (404) responses from the
 *     upstream API. Throw for everything else (parse errors, HTTP errors,
 *     unexpected payloads); throwing is also fatal but yields the more
 *     accurate `extension:input-source:failed` reason: 'error'.
 *   - PRD enricher failures are fail-open (`extension:prd-enricher:failed`).
 */

import type {
  EforgeExtensionAPI,
  InputSourceResult,
  InputTransformContext,
} from '@eforge-build/extension-sdk';

// ---------------------------------------------------------------------------
// GitHub adapter
// ---------------------------------------------------------------------------

/**
 * Fetch a GitHub issue as a build-source artifact.
 *
 * Required env var: GITHUB_TOKEN (classic or fine-grained PAT with repo read scope)
 *
 * URI: eforge://input/github/<owner>/<repo>#<n>
 * Example: eforge://input/github/acme/backend#42
 *
 * The id segment after "github/" is "<owner>/<repo>#<n>". The adapter parses it
 * to derive the REST endpoint:
 *   GET /repos/{owner}/{repo}/issues/{number}
 *   https://docs.github.com/en/rest/issues/issues#get-an-issue
 *
 * Customize: set GITHUB_API_BASE to override the base URL (e.g. for GitHub
 * Enterprise Server). Add query params or request headers as needed.
 */
async function fetchGitHubIssue(
  id: string,
  ctx?: InputTransformContext,
): Promise<string | InputSourceResult | null> {
  const token = process.env['GITHUB_TOKEN'];

  if (!token) {
    ctx?.logger.warn('GITHUB_TOKEN is not set; returning configuration instructions');
    return {
      title: `GitHub issue: ${id} (unconfigured)`,
      content: [
        `# GitHub issue: \`${id}\` (adapter not configured)`,
        '',
        'The `github` input source adapter requires a GitHub personal access token.',
        '',
        '## Configuration',
        '',
        '```sh',
        '# Set a classic or fine-grained PAT with repo read scope:',
        'export GITHUB_TOKEN=ghp_...',
        '```',
        '',
        '## URI format',
        '',
        '```',
        'eforge://input/github/<owner>/<repo>#<n>',
        '```',
        '',
        'Example: `eforge://input/github/acme/backend#42`',
        '',
        '## REST endpoint',
        '',
        'The adapter calls: `GET https://api.github.com/repos/{owner}/{repo}/issues/{number}`',
        '',
        'Customize: set `GITHUB_API_BASE` to override the base URL (e.g. for GitHub Enterprise).',
      ].join('\n'),
    };
  }

  // Parse "<owner>/<repo>#<n>" into repo path and issue number.
  // Parse errors throw so the runtime emits reason: 'error' (not 'not-found'),
  // which preserves the invariant in this file's header comment that null is
  // reserved for genuine upstream not-found responses.
  const hashIdx = id.lastIndexOf('#');
  if (hashIdx === -1) {
    throw new Error(
      `GitHub adapter: id "${id}" is missing the issue number (expected "<owner>/<repo>#<n>")`,
    );
  }
  const repoPath = id.slice(0, hashIdx);
  const issueNumber = id.slice(hashIdx + 1);
  if (!/^[^/]+\/[^/]+$/.test(repoPath) || !/^\d+$/.test(issueNumber)) {
    throw new Error(
      `GitHub adapter: could not parse id "${id}" as "<owner>/<repo>#<n>"`,
    );
  }

  const apiBase = process.env['GITHUB_API_BASE'] ?? 'https://api.github.com';
  const url = `${apiBase}/repos/${repoPath}/issues/${issueNumber}`;

  ctx?.logger.info(`GitHub adapter: fetching ${url}`);

  const response = await globalThis.fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (response.status === 404) {
    ctx?.logger.warn(`GitHub adapter: issue ${id} not found (404)`);
    return null; // genuine not-found is fatal to enqueue
  }

  if (!response.ok) {
    throw new Error(`GitHub API returned HTTP ${response.status} for ${url}`);
  }

  const issue = (await response.json()) as {
    title: string;
    body?: string | null;
    number: number;
    state: string;
    html_url: string;
    user?: { login: string };
    labels?: Array<{ name: string }>;
  };

  const labels = issue.labels?.map((l) => l.name).join(', ') ?? '';
  const author = issue.user?.login ?? 'unknown';
  const body = issue.body?.trim() ?? '_(no description)_';

  const content = [
    `# ${issue.title}`,
    '',
    `**Issue:** [${repoPath}#${issue.number}](${issue.html_url})`,
    `**State:** ${issue.state}`,
    `**Author:** ${author}`,
    ...(labels ? [`**Labels:** ${labels}`] : []),
    '',
    '---',
    '',
    body,
  ].join('\n');

  return { content, title: issue.title };
}

// ---------------------------------------------------------------------------
// Linear adapter
// ---------------------------------------------------------------------------

/**
 * Fetch a Linear issue as a build-source artifact.
 *
 * Required env var: LINEAR_API_KEY
 *
 * URI: eforge://input/linear/<issue-id>
 * Example: eforge://input/linear/ENG-42
 *
 * The id is a Linear issue identifier (e.g. ENG-42). The adapter calls the
 * Linear GraphQL API:
 *   POST https://api.linear.app/graphql
 *   Query: { issue(id: "<id>") { title description state { name } assignee { name } url } }
 *   https://developers.linear.app/docs/graphql/working-with-the-graphql-api
 *
 * Customize: extend the GraphQL query to include priority, comments, labels,
 * or other fields your build source needs.
 */
async function fetchLinearIssue(
  id: string,
  ctx?: InputTransformContext,
): Promise<string | InputSourceResult | null> {
  const apiKey = process.env['LINEAR_API_KEY'];

  if (!apiKey) {
    ctx?.logger.warn('LINEAR_API_KEY is not set; returning configuration instructions');
    return {
      title: `Linear issue: ${id} (unconfigured)`,
      content: [
        `# Linear issue: \`${id}\` (adapter not configured)`,
        '',
        'The `linear` input source adapter requires a Linear API key.',
        '',
        '## Configuration',
        '',
        '```sh',
        '# Generate a personal API key at https://linear.app/settings/api:',
        'export LINEAR_API_KEY=lin_api_...',
        '```',
        '',
        '## URI format',
        '',
        '```',
        'eforge://input/linear/<issue-id>',
        '```',
        '',
        'Example: `eforge://input/linear/ENG-42`',
        '',
        '## GraphQL endpoint',
        '',
        'The adapter calls: `POST https://api.linear.app/graphql`',
        '',
        'Customize: extend the query to include priority, comments, labels, or other fields.',
      ].join('\n'),
    };
  }

  ctx?.logger.info(`Linear adapter: fetching issue ${id}`);

  // Customize: extend the query fields to include priority, labels, comments, etc.
  const query = `
    query GetIssue($id: String!) {
      issue(id: $id) {
        title
        description
        state { name }
        assignee { name }
        url
      }
    }
  `;

  const response = await globalThis.fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { id } }),
  });

  if (!response.ok) {
    throw new Error(`Linear API returned HTTP ${response.status}`);
  }

  const json = (await response.json()) as {
    data?: {
      issue?: {
        title: string;
        description?: string | null;
        state?: { name: string };
        assignee?: { name: string } | null;
        url: string;
      } | null;
    };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors[0]?.message}`);
  }

  const issue = json.data?.issue;
  if (!issue) {
    ctx?.logger.warn(`Linear adapter: issue ${id} not found`);
    return null; // genuine not-found is fatal to enqueue
  }

  const state = issue.state?.name ?? 'unknown';
  const assignee = issue.assignee?.name ?? 'unassigned';
  const description = issue.description?.trim() ?? '_(no description)_';

  const content = [
    `# ${issue.title}`,
    '',
    `**Issue:** [${id}](${issue.url})`,
    `**State:** ${state}`,
    `**Assignee:** ${assignee}`,
    '',
    '---',
    '',
    description,
  ].join('\n');

  return { content, title: issue.title };
}

// ---------------------------------------------------------------------------
// Jira adapter
// ---------------------------------------------------------------------------

/**
 * Fetch a Jira issue as a build-source artifact.
 *
 * Required env vars: JIRA_BASE_URL and JIRA_TOKEN
 *
 * URI: eforge://input/jira/<KEY-123>
 * Example: eforge://input/jira/ENG-42
 *
 * The id is a Jira issue key (e.g. ENG-42). The adapter calls the Jira REST API:
 *   GET {JIRA_BASE_URL}/rest/api/3/issue/{key}
 *   https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-get
 *
 * Configure JIRA_BASE_URL to your Jira instance base URL (no trailing slash):
 *   https://yourorg.atlassian.net
 *
 * Configure JIRA_TOKEN as "<email>:<api-token>" (base64-encoded for Basic auth).
 * Generate an API token at: https://id.atlassian.com/manage-profile/security/api-tokens
 *
 * Customize: add `?fields=summary,description,status,assignee,...` to limit
 * returned fields. Use a proper ADF-to-markdown library for richer formatting.
 */
async function fetchJiraIssue(
  id: string,
  ctx?: InputTransformContext,
): Promise<string | InputSourceResult | null> {
  const baseUrl = process.env['JIRA_BASE_URL'];
  const token = process.env['JIRA_TOKEN'];

  if (!baseUrl || !token) {
    const missing = [!baseUrl && 'JIRA_BASE_URL', !token && 'JIRA_TOKEN'].filter(Boolean).join(', ');
    ctx?.logger.warn(`${missing} is not set; returning configuration instructions`);
    return {
      title: `Jira issue: ${id} (unconfigured)`,
      content: [
        `# Jira issue: \`${id}\` (adapter not configured)`,
        '',
        'The `jira` input source adapter requires a Jira base URL and API token.',
        '',
        '## Configuration',
        '',
        '```sh',
        '# Your Jira Cloud base URL (no trailing slash):',
        'export JIRA_BASE_URL=https://yourorg.atlassian.net',
        '',
        '# A Jira API token formatted as "<email>:<api-token>":',
        '# Generate at https://id.atlassian.com/manage-profile/security/api-tokens',
        'export JIRA_TOKEN=you@example.com:your-api-token',
        '```',
        '',
        '## URI format',
        '',
        '```',
        'eforge://input/jira/<KEY-123>',
        '```',
        '',
        'Example: `eforge://input/jira/ENG-42`',
        '',
        '## REST endpoint',
        '',
        'The adapter calls: `GET {JIRA_BASE_URL}/rest/api/3/issue/{key}`',
        '',
        'Customize: add `?fields=summary,description,status,assignee,...` to limit fields.',
      ].join('\n'),
    };
  }

  // Strip a trailing slash so we never produce "https://.../rest/..." with `//`.
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const url = `${normalizedBaseUrl}/rest/api/3/issue/${id}`;
  ctx?.logger.info(`Jira adapter: fetching ${url}`);

  const response = await globalThis.fetch(url, {
    headers: {
      // JIRA_TOKEN is "<email>:<api-token>"; encode as Basic auth.
      Authorization: `Basic ${Buffer.from(token).toString('base64')}`,
      Accept: 'application/json',
    },
  });

  if (response.status === 404) {
    ctx?.logger.warn(`Jira adapter: issue ${id} not found (404)`);
    return null; // genuine not-found is fatal to enqueue
  }

  if (!response.ok) {
    throw new Error(`Jira API returned HTTP ${response.status} for ${url}`);
  }

  const issue = (await response.json()) as {
    key: string;
    fields: {
      summary: string;
      description?: {
        // Atlassian Document Format (ADF) - simplified extraction below.
        // Customize: use an ADF-to-markdown library for richer formatting.
        content?: Array<{
          content?: Array<{ text?: string; type?: string }>;
          type?: string;
        }>;
      } | null;
      status?: { name: string };
      assignee?: { displayName: string } | null;
    };
  };

  const summary = issue.fields.summary;
  const status = issue.fields.status?.name ?? 'unknown';
  const assignee = issue.fields.assignee?.displayName ?? 'unassigned';

  // Naive ADF plain-text extraction. Replace with a proper ADF converter for
  // richer markdown output (paragraphs, lists, code blocks, etc.).
  // Treat an empty extraction the same as a missing description so the output
  // is not a blank section.
  const rawDescription =
    issue.fields.description?.content
      ?.flatMap((block) => block.content ?? [])
      .filter((node) => node.type === 'text')
      .map((node) => node.text ?? '')
      .join('') ?? '';
  const descriptionText = rawDescription.trim() || '_(no description)_';

  const content = [
    `# ${summary}`,
    '',
    `**Issue:** [${issue.key}](${normalizedBaseUrl}/browse/${issue.key})`,
    `**Status:** ${status}`,
    `**Assignee:** ${assignee}`,
    '',
    '---',
    '',
    descriptionText,
  ].join('\n');

  return { content, title: summary };
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function issueTrackerExtension(eforge: EforgeExtensionAPI): void {
  eforge.registerInputSource({
    name: 'github',
    description:
      'Fetch GitHub issues as build-source artifacts via eforge://input/github/<owner>/<repo>#<n>. Requires GITHUB_TOKEN.',
    fetch: fetchGitHubIssue,
  });

  eforge.registerInputSource({
    name: 'linear',
    description:
      'Fetch Linear issues as build-source artifacts via eforge://input/linear/<issue-id>. Requires LINEAR_API_KEY.',
    fetch: fetchLinearIssue,
  });

  eforge.registerInputSource({
    name: 'jira',
    description:
      'Fetch Jira issues as build-source artifacts via eforge://input/jira/<KEY-123>. Requires JIRA_BASE_URL and JIRA_TOKEN.',
    fetch: fetchJiraIssue,
  });
}
