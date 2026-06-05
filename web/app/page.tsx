import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'eforge - extensible build engine',
  description: 'eforge is an extensible build-engine kernel for delegated planning, implementation, review, and validation.',
};

export default function HomePage() {
  return (
    <main style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: 'var(--spacing-2xl) var(--spacing-xl)' }}>
      {/* Hero */}
      <section style={{ textAlign: 'center', paddingBottom: 'var(--spacing-2xl)' }}>
        <h1
          style={{
            fontSize: '3rem',
            fontWeight: 800,
            marginBottom: 'var(--spacing-md)',
            background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          eforge
        </h1>
        <p
          style={{
            fontSize: '1.35rem',
            color: 'var(--color-text-muted)',
            maxWidth: '50ch',
            margin: '0 auto var(--spacing-xl)',
          }}
        >
          Plan through any surface. Hand off to the build-engine kernel. Extend the workflow around it.
        </p>
        <div style={{ display: 'flex', gap: 'var(--spacing-md)', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            href="/docs/getting-started"
            style={{
              display: 'inline-block',
              padding: '0.75rem 1.5rem',
              background: 'var(--color-accent)',
              color: '#0a0a0a',
              borderRadius: 'var(--border-radius)',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Get Started
          </a>
          <a
            href="/why"
            style={{
              display: 'inline-block',
              padding: '0.75rem 1.5rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--border-radius)',
              fontWeight: 600,
              textDecoration: 'none',
              color: 'var(--color-text)',
            }}
          >
            Why eforge
          </a>
          <a
            href="https://github.com/eforge-build/eforge"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              padding: '0.75rem 1.5rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--border-radius)',
              fontWeight: 600,
              textDecoration: 'none',
              color: 'var(--color-text)',
            }}
          >
            View on GitHub
          </a>
        </div>
      </section>

      {/* Product screenshot */}
      <section style={{ marginBottom: 'var(--spacing-2xl)' }}>
        <figure style={{ maxWidth: '980px', margin: '0 auto' }}>
          <div
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: '12px',
              background: 'var(--color-bg-secondary)',
              boxShadow: '0 0 48px rgba(74, 222, 128, 0.08)',
              overflow: 'hidden',
            }}
          >
            <img
              src="/screenshots/monitor-dashboard.png"
              alt="eforge Console showing a recovery build running, a dependent plan waiting, spend by model, and build health"
              style={{ display: 'block', width: '100%', height: 'auto' }}
            />
          </div>
          <figcaption
            style={{
              color: 'var(--color-text-muted)',
              fontSize: '0.9rem',
              marginTop: 'var(--spacing-sm)',
              textAlign: 'center',
            }}
          >
            Track recovery builds, dependent plans, model spend, and build health while eforge runs engineering work in the background.
          </figcaption>
        </figure>
      </section>

      {/* Product positioning */}
      <section style={{ marginBottom: 'var(--spacing-2xl)' }}>
        <div style={{ textAlign: 'center', maxWidth: '760px', margin: '0 auto var(--spacing-xl)' }}>
          <h2 style={{ marginBottom: 'var(--spacing-md)' }}>An extensible forge for planned work</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '1.1rem', margin: 0 }}>
            eforge keeps the kernel small: normalized build-source intake, dependency-aware worktree orchestration, conservative gates,
            typed recovery, and evented observability. Prompts, PRDs, playbooks, session plans, wrapper apps, and extensions shape the
            workflow around it.
          </p>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
            gap: 'var(--spacing-lg)',
          }}
        >
          {[
            {
              title: 'Plan the change',
              description:
                'Use a PRD, issue, rough prompt, playbook, wrapper app, or structured session plan to normalize intent before implementation starts.',
            },
            {
              title: 'Hand off execution',
              description:
                'The build-engine kernel decomposes work, schedules build plans, and runs implementation in isolated git worktrees.',
            },
            {
              title: 'Automate the engineering loop',
              description:
                'Implementation, blind review, retries, conflict handling, typed recovery, merge flow, and validation are managed without constant babysitting.',
            },
            {
              title: 'Review real outputs',
              description:
                'You stay focused on direction and final judgment with traceable commits, logs, costs, and build decisions.',
            },
          ].map((item) => (
            <div
              key={item.title}
              style={{
                padding: 'var(--spacing-lg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--border-radius)',
                background: 'var(--color-bg-secondary)',
              }}
            >
              <div
                style={{
                  width: '2rem',
                  height: '0.25rem',
                  background: 'var(--color-accent)',
                  borderRadius: '999px',
                  marginBottom: 'var(--spacing-md)',
                }}
              />
              <h3 style={{ margin: '0 0 var(--spacing-sm)' }}>{item.title}</h3>
              <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Configurable handoffs */}
      <section style={{ marginBottom: 'var(--spacing-2xl)' }}>
        <div style={{ textAlign: 'center', maxWidth: '760px', margin: '0 auto var(--spacing-xl)' }}>
          <h2 style={{ marginBottom: 'var(--spacing-md)' }}>Built for repeatable, extensible handoffs</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '1.1rem', margin: 0 }}>
            Standardize how work is delegated, which agent runtimes run it, which extension surfaces shape it, and what cost/performance
            tradeoffs you want.
          </p>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
            gap: 'var(--spacing-lg)',
          }}
        >
          {[
            {
              title: 'Build profiles',
              description:
                'Choose agent runtimes, model tiers, and execution defaults for planning, building, review, and validation.',
            },
            {
              title: 'Playbooks',
              description:
                'Capture recurring workflows as reusable input templates outside the engine kernel so common engineering tasks start with the right structure.',
            },
            {
              title: 'Toolbelts',
              description:
                'Scope each agent to the MCP servers and tools it needs, while native extensions, shell hooks, and host integrations add trusted behavior around the kernel.',
            },
            {
              title: 'Bring your own credentials',
              description:
                'Run against your chosen providers directly. No subscription wrapper, no hidden inference markup, and no single-runtime lock-in.',
            },
          ].map((item) => (
            <div
              key={item.title}
              style={{
                padding: 'var(--spacing-lg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--border-radius)',
                background: 'var(--color-bg-secondary)',
              }}
            >
              <h3 style={{ margin: '0 0 var(--spacing-sm)' }}>{item.title}</h3>
              <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Install paths */}
      <section style={{ marginBottom: 'var(--spacing-2xl)' }}>
        <div style={{ textAlign: 'center', maxWidth: '760px', margin: '0 auto var(--spacing-xl)' }}>
          <h2 style={{ marginBottom: 'var(--spacing-md)' }}>Choose your surface</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '1.1rem', margin: 0 }}>
            eforge is one build-engine kernel with multiple host and extension surfaces. Start with Pi for the direction eforge is heading; use Claude Code
            or the CLI when those fit your workflow better.
          </p>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 'var(--spacing-lg)',
          }}
        >
          <div
            style={{
              padding: 'var(--spacing-lg)',
              border: '1px solid var(--color-accent)',
              borderRadius: 'var(--border-radius)',
              background: 'var(--color-bg-secondary)',
              boxShadow: '0 0 32px rgba(103, 245, 83, 0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)' }}>
              <h3 style={{ margin: 0 }}>Pi extension</h3>
              <span
                style={{
                  border: '1px solid var(--color-accent)',
                  borderRadius: '999px',
                  color: 'var(--color-accent)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.7rem',
                  padding: '0.1rem 0.4rem',
                }}
              >
                Recommended
              </span>
            </div>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
              Use eforge as a Pi extension for provider-flexible, local, inspectable agent orchestration with Pi&apos;s native UX.
            </p>
            <pre
              style={{
                background: 'var(--color-code-bg)',
                padding: 'var(--spacing-sm)',
                borderRadius: '4px',
                fontSize: '0.8rem',
                overflow: 'auto',
              }}
            >
              <code>pi install npm:@eforge-build/pi-eforge</code>
            </pre>
            <a href="/docs/getting-started" style={{ fontSize: '0.9rem' }}>
              Pi setup guide
            </a>
          </div>

          <div
            style={{
              padding: 'var(--spacing-lg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--border-radius)',
              background: 'var(--color-bg-secondary)',
            }}
          >
            <h3 style={{ marginTop: 0 }}>Claude Code plugin</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
              Use eforge from Claude Code when that is already your daily environment. The engine and execution profile remain separate.
            </p>
            <pre
              style={{
                background: 'var(--color-code-bg)',
                padding: 'var(--spacing-sm)',
                borderRadius: '4px',
                fontSize: '0.8rem',
                overflow: 'auto',
              }}
            >
              <code>{`/plugin marketplace add eforge-build/eforge\n/plugin install eforge@eforge`}</code>
            </pre>
            <a href="/docs/getting-started" style={{ fontSize: '0.9rem' }}>
              Claude Code setup guide
            </a>
          </div>

          <div
            style={{
              padding: 'var(--spacing-lg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--border-radius)',
              background: 'var(--color-bg-secondary)',
            }}
          >
            <h3 style={{ marginTop: 0 }}>Standalone CLI</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
              Use eforge as a standalone CLI tool for scripting, automation, and direct engine usage.
            </p>
            <pre
              style={{
                background: 'var(--color-code-bg)',
                padding: 'var(--spacing-sm)',
                borderRadius: '4px',
                fontSize: '0.8rem',
                overflow: 'auto',
              }}
            >
              <code>npm install -g @eforge-build/eforge</code>
            </pre>
            <a href="/docs/getting-started" style={{ fontSize: '0.9rem' }}>
              CLI setup guide
            </a>
          </div>
        </div>
      </section>

      {/* Links */}
      <section style={{ textAlign: 'center', padding: 'var(--spacing-xl) 0' }}>
        <p style={{ color: 'var(--color-text-muted)' }}>
          <a href="/why">Read why eforge exists</a> &nbsp;|&nbsp; <a href="/docs">Read the docs</a> &nbsp;|&nbsp;{' '}
          <a href="/reference">Browse the reference</a> &nbsp;|&nbsp;
          <a href="https://github.com/eforge-build/eforge" target="_blank" rel="noopener noreferrer">
            Contribute on GitHub
          </a>
        </p>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          Built by{' '}
          <a href="https://schaake.solutions" target="_blank" rel="noopener noreferrer">
            Mark Schaake
          </a>
          .
        </p>
      </section>
    </main>
  );
}
