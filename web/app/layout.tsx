import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

export const metadata: Metadata = {
  title: 'eforge - extensible build engine',
  description: 'eforge is an extensible build-engine kernel for delegated planning, implementation, review, and validation.',
  icons: {
    icon: '/favicon.ico?v=4',
    shortcut: '/favicon.ico?v=4',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="site-nav">
          <a href="/" className="nav-brand">
            <img src="/eforge-logo.svg" alt="eforge logo" width={28} height={28} className="nav-brand-logo" />
            eforge
          </a>
          <ul className="nav-links">
            <li>
              <a href="/why">Why eforge</a>
            </li>
            <li>
              <a href="/docs">Docs</a>
            </li>
            <li>
              <a href="/reference">Reference</a>
            </li>
            <li>
              <a href="https://github.com/eforge-build/eforge" target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
            </li>
            <li>
              <a href="https://www.npmjs.com/package/@eforge-build/eforge" target="_blank" rel="noopener noreferrer">
                npm
              </a>
            </li>
          </ul>
        </nav>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
