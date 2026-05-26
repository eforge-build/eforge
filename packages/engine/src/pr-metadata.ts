/**
 * PR metadata renderer — shared between direct and stacked PR creation/editing.
 *
 * Generates a deterministic PR title and body from OrchestrationConfig,
 * artifact branch, base branch, and optional ModelTracker.
 *
 * The rendered body does not include raw `Models-Used:` or `Co-Authored-By:`
 * trailers — those remain in git commit messages only.
 */

import type { OrchestrationConfig } from './events.js';
import type { ModelTracker } from './model-tracker.js';

export interface PullRequestMetadata {
  /** Single-line PR title (newlines stripped). */
  title: string;
  /** Markdown PR body (no raw commit trailers). */
  body: string;
}

export interface PullRequestMetadataInput {
  config: OrchestrationConfig;
  featureBranch: string;
  baseBranch: string;
  modelTracker?: ModelTracker;
}

/**
 * Render deterministic PR title and body from orchestration config and context.
 *
 * Title: config.description when non-empty, else config.name. Newlines stripped.
 * Body: markdown summary with build metadata, plan list, and optional models section.
 *
 * Raw commit trailers (`Models-Used:`, `Co-Authored-By:`) are never included
 * in the body — those remain in git commit messages only.
 */
export function renderPullRequestMetadata(input: PullRequestMetadataInput): PullRequestMetadata {
  const { config, featureBranch, baseBranch, modelTracker } = input;

  // Title: use description when non-empty, else name; strip newlines
  const titleBase = config.description.trim() || config.name;
  const title = titleBase.replace(/[\n\r]/g, ' ').trim();

  const lines: string[] = [];

  // Summary
  lines.push('## Summary');
  lines.push(config.description.trim() || config.name);
  lines.push('');

  // Build metadata
  lines.push('## Build metadata');
  lines.push(`- Plan set: \`${config.name}\``);
  lines.push(`- Mode: \`${config.mode}\``);
  lines.push(`- Base branch: \`${baseBranch}\``);
  lines.push(`- Artifact branch: \`${featureBranch}\``);
  lines.push('');

  // Plans
  lines.push('## Plans');
  for (const plan of config.plans) {
    lines.push(`- \`${plan.id}\` — ${plan.name}`);
  }
  lines.push('');

  // Models used (only when tracker has models; no raw trailer labels)
  if (modelTracker && modelTracker.size > 0) {
    const trailer = modelTracker.toTrailer();
    // Strip "Models-Used: " prefix to get comma-separated model IDs
    const modelIds = trailer.replace(/^Models-Used:\s*/, '');
    if (modelIds) {
      lines.push('## Models used');
      lines.push(modelIds);
      lines.push('');
    }
  }

  const body = lines.join('\n').trimEnd();

  return { title, body };
}
