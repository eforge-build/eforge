import * as React from 'react';
import { cn } from '@/lib/utils';
import { buildNavItems } from '@/lib/navigation';
import type { ConsoleRouteId } from '@/lib/navigation';
import type { ConnectionStatus } from '@/lib/types';
import { CONSOLE_NAME, EFORGE_LOGO_URL, EFORGE_LOGO_ALT } from '@/lib/brand';

interface SidebarProps {
  currentRoute: ConsoleRouteId;
  connectionStatus: ConnectionStatus;
  onNavigate?: (href: string) => void;
}

function ConnectionDot({ status }: { status: ConnectionStatus }) {
  return (
    <span
      className={cn(
        'inline-block w-2 h-2 rounded-full flex-shrink-0',
        status === 'connected' && 'bg-[#67f553]',
        status === 'connecting' && 'bg-yellow animate-pulse',
        status === 'disconnected' && 'bg-red',
      )}
      aria-label={`connection status: ${status}`}
    />
  );
}

export function Sidebar({ currentRoute, connectionStatus, onNavigate }: SidebarProps) {
  const navItems = buildNavItems();

  function handleNav(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (onNavigate) {
      e.preventDefault();
      onNavigate(href);
    }
  }

  return (
    <aside
      className="flex flex-col h-full bg-[color:var(--color-console-sidebar)] border-r border-border w-48 flex-shrink-0"
      aria-label="Console navigation"
    >
      {/* Logo + branding */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border">
        <img
          src={EFORGE_LOGO_URL}
          alt={EFORGE_LOGO_ALT}
          className="w-6 h-6 rounded"
          width={24}
          height={24}
        />
        <span className="text-sm font-semibold text-foreground truncate">
          {CONSOLE_NAME}
        </span>
      </div>

      {/* Navigation links */}
      <nav className="flex-1 px-2 py-2 flex flex-col gap-0.5">
        {navItems.map((item) => {
          const isActive = item.id === currentRoute;
          return (
            <a
              key={item.id}
              href={item.href}
              onClick={(e) => handleNav(e, item.href)}
              className={cn(
                'flex items-center px-2 py-1.5 rounded text-sm transition-colors',
                isActive
                  ? 'bg-[color:var(--color-console-accent-dim)] text-[#67f553] font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              {item.label}
            </a>
          );
        })}
      </nav>

      {/* Bottom: connection status + Monitor link */}
      <div className="px-3 py-2 border-t border-border flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ConnectionDot status={connectionStatus} />
          <span>
            {connectionStatus === 'connected'
              ? 'Connected'
              : connectionStatus === 'connecting'
                ? 'Connecting...'
                : 'Disconnected'}
          </span>
        </div>
        <a
          href="/"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Go to Monitor"
        >
          ← Monitor
        </a>
      </div>
    </aside>
  );
}
