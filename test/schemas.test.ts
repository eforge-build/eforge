import { describe, it, expect } from 'vitest';
import {
  reviewIssueSchema,
  evaluationEvidenceSchema,
  evaluationVerdictSchema,
  clarificationQuestionSchema,
  stalenessVerdictSchema,
  expeditionModuleSchema,
  planFileFrontmatterSchema,
  getSchemaYaml,
  getReviewIssueSchemaYaml,
  getCodeReviewIssueSchemaYaml,
  getSecurityReviewIssueSchemaYaml,
  getApiReviewIssueSchemaYaml,
  getDocsReviewIssueSchemaYaml,
  getPlanReviewIssueSchemaYaml,
} from '../src/engine/schemas.js';

describe('getSchemaYaml', () => {
  it('returns YAML string containing expected fields', () => {
    const yaml = getSchemaYaml('test-review-issue', reviewIssueSchema);
    expect(yaml).toContain('severity');
    expect(yaml).toContain('category');
    expect(yaml).toContain('file');
    expect(yaml).toContain('description');
    expect(yaml).toContain('line');
    expect(yaml).toContain('fix');
  });

  it('caches and returns the same reference on second call', () => {
    const first = getSchemaYaml('cache-test', reviewIssueSchema);
    const second = getSchemaYaml('cache-test', reviewIssueSchema);
    // Same string reference (not just equal content) proves caching
    expect(first).toBe(second);
  });

  it('strips $schema and ~standard keys', () => {
    const yaml = getSchemaYaml('strip-test', reviewIssueSchema);
    expect(yaml).not.toContain('$schema');
    expect(yaml).not.toContain('~standard');
  });
});

describe('perspective-specific schema YAML getters', () => {
  it('getReviewIssueSchemaYaml contains general categories', () => {
    const yaml = getReviewIssueSchemaYaml();
    expect(yaml).toContain('bugs');
    expect(yaml).toContain('security');
    expect(yaml).toContain('maintainability');
  });

  it('getCodeReviewIssueSchemaYaml contains code categories', () => {
    const yaml = getCodeReviewIssueSchemaYaml();
    expect(yaml).toContain('bugs');
    expect(yaml).toContain('performance');
    // Code perspective excludes security
    expect(yaml).not.toContain('injection');
  });

  it('getSecurityReviewIssueSchemaYaml contains security categories', () => {
    const yaml = getSecurityReviewIssueSchemaYaml();
    expect(yaml).toContain('injection');
    expect(yaml).toContain('secrets');
    expect(yaml).toContain('data-exposure');
  });

  it('getApiReviewIssueSchemaYaml contains API categories', () => {
    const yaml = getApiReviewIssueSchemaYaml();
    expect(yaml).toContain('rest-conventions');
    expect(yaml).toContain('contracts');
    expect(yaml).toContain('breaking-changes');
  });

  it('getDocsReviewIssueSchemaYaml contains docs categories', () => {
    const yaml = getDocsReviewIssueSchemaYaml();
    expect(yaml).toContain('code-examples');
    expect(yaml).toContain('stale-docs');
    expect(yaml).toContain('readme');
  });

  it('getPlanReviewIssueSchemaYaml contains plan-review categories', () => {
    const yaml = getPlanReviewIssueSchemaYaml();
    expect(yaml).toContain('cohesion');
    expect(yaml).toContain('completeness');
    expect(yaml).toContain('feasibility');
    expect(yaml).toContain('dependency');
  });
});

describe('reviewIssueSchema safeParse', () => {
  it('accepts a valid ReviewIssue', () => {
    const result = reviewIssueSchema.safeParse({
      severity: 'critical',
      category: 'bugs',
      file: 'src/index.ts',
      line: 42,
      description: 'Off-by-one error in loop',
      fix: 'Changed < to <=',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a ReviewIssue without optional fields', () => {
    const result = reviewIssueSchema.safeParse({
      severity: 'suggestion',
      category: 'performance',
      file: 'src/utils.ts',
      description: 'Consider memoizing this computation',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid severity', () => {
    const result = reviewIssueSchema.safeParse({
      severity: 'blocker',
      category: 'bugs',
      file: 'src/index.ts',
      description: 'Something bad',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing description', () => {
    const result = reviewIssueSchema.safeParse({
      severity: 'warning',
      category: 'bugs',
      file: 'src/index.ts',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty description', () => {
    const result = reviewIssueSchema.safeParse({
      severity: 'warning',
      category: 'bugs',
      file: 'src/index.ts',
      description: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('other schemas export and validate', () => {
  it('evaluationVerdictSchema accepts valid verdict', () => {
    const result = evaluationVerdictSchema.safeParse({
      file: 'src/foo.ts',
      action: 'accept',
      reason: 'Fix is correct',
    });
    expect(result.success).toBe(true);
  });

  it('evaluationEvidenceSchema accepts valid evidence', () => {
    const result = evaluationEvidenceSchema.safeParse({
      staged: 'Original code does X',
      fix: 'Fix changes X to Y',
      rationale: 'Y is correct',
      ifAccepted: 'Bug is fixed',
      ifRejected: 'Bug persists',
    });
    expect(result.success).toBe(true);
  });

  it('clarificationQuestionSchema accepts valid question', () => {
    const result = clarificationQuestionSchema.safeParse({
      id: 'q1',
      question: 'Which database?',
      options: ['Postgres', 'MySQL'],
      default: 'Postgres',
    });
    expect(result.success).toBe(true);
  });

  it('stalenessVerdictSchema accepts valid verdict', () => {
    const result = stalenessVerdictSchema.safeParse({
      verdict: 'proceed',
      justification: 'No changes since last plan',
    });
    expect(result.success).toBe(true);
  });

  it('expeditionModuleSchema accepts valid module', () => {
    const result = expeditionModuleSchema.safeParse({
      id: 'auth',
      description: 'Authentication module',
      dependsOn: ['foundation'],
    });
    expect(result.success).toBe(true);
  });

  it('planFileFrontmatterSchema accepts valid frontmatter', () => {
    const result = planFileFrontmatterSchema.safeParse({
      id: 'plan-01-auth',
      name: 'Auth Setup',
      dependsOn: [],
      branch: 'feat/auth',
    });
    expect(result.success).toBe(true);
  });
});
