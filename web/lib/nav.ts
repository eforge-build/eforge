export interface DocNavItem {
  slug: string;
  title: string;
  group: string;
}

export interface ReferenceNavItem {
  slug: string;
  title: string;
  raw: string;
  schema?: string;
}

export const DOCS_NAV: DocNavItem[] = [
  { slug: 'getting-started', title: 'Getting Started', group: 'Core kernel' },
  { slug: 'concepts', title: 'Core Concepts', group: 'Core kernel' },
  { slug: 'configuration', title: 'Configuration', group: 'Core kernel' },
  { slug: 'profiles', title: 'Profiles', group: 'Core kernel' },
  { slug: 'playbooks', title: 'Playbooks', group: 'Optional workflows' },
  { slug: 'stacking', title: 'Stacked PRs', group: 'Optional workflows' },
  { slug: 'extensions', title: 'Extensions', group: 'Extension platform' },
  { slug: 'extensions-api', title: 'Extensions API Reference', group: 'Extension platform' },
  { slug: 'eforge-plan', title: 'eforge-plan', group: 'First-party extensions' },
  { slug: 'integrations', title: 'Integrations', group: 'Integrations' },
  { slug: 'troubleshooting', title: 'Troubleshooting', group: 'Operations' },
  { slug: 'glossary', title: 'Glossary', group: 'Reference' },
];

export const REFERENCE_NAV: ReferenceNavItem[] = [
  {
    slug: 'cli',
    title: 'CLI Reference',
    raw: '/reference/cli.md',
  },
  {
    slug: 'api',
    title: 'HTTP API Reference',
    raw: '/reference/api.md',
  },
  {
    slug: 'events',
    title: 'Events Reference',
    raw: '/reference/events.md',
    schema: '/schemas/events.schema.json',
  },
  {
    slug: 'config',
    title: 'Config Reference',
    raw: '/reference/config.md',
    schema: '/schemas/config.schema.json',
  },
  {
    slug: 'tools',
    title: 'MCP Tools Reference',
    raw: '/reference/tools.md',
  },
];
