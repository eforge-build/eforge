import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { SheetPanel } from '@/components/ui/sheet-panel';
import type { SessionProfile } from '@/lib/run-state';

interface ProfileBadgeProps {
  profile: SessionProfile;
}

function sourceScopeBadgeText(source: SessionProfile['source']): string {
  if (source === 'none' || source === 'missing') return '';
  if (source === 'local') return 'project-local';
  if (source === 'project') return 'project';
  if (source === 'user-local') return 'user';
  return source;
}

interface TierRecipeEntry {
  harness?: string;
  pi?: { provider?: string };
  model?: string;
  effort?: string;
  toolbelt?: string;
}

interface ProfileConfigShape {
  extends?: string;
  agents?: {
    tiers?: Record<string, TierRecipeEntry>;
    roles?: Record<string, unknown>;
  };
  tools?: {
    toolbelts?: Record<string, { description?: string; mcpServers: string[] }>;
  };
}

function ProfileSheetBody({ profile }: { profile: SessionProfile }) {
  if (profile.config === null || profile.config === undefined) {
    return (
      <div className="p-4 text-xs text-text-dim italic">
        No profile configuration available for this session.
      </div>
    );
  }

  const cfg = profile.config as ProfileConfigShape;
  const subBadgeText = sourceScopeBadgeText(profile.source);

  return (
    <div className="p-4 flex flex-col gap-5 text-xs">
      {/* Header */}
      <div className="flex flex-col gap-1.5">
        <span className="font-semibold text-sm text-foreground">{profile.profileName}</span>
        {subBadgeText && (
          <span className="text-[10px] text-text-dim">{subBadgeText}</span>
        )}
      </div>

      {/* Tier Recipes */}
      {cfg.agents?.tiers && Object.keys(cfg.agents.tiers).length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[10px] uppercase tracking-wider text-text-dim font-semibold">Tiers</h3>
          <div className="flex flex-col gap-2">
            {Object.entries(cfg.agents.tiers).map(([tier, entry]) => (
              <div key={tier} className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground text-xs">{tier}</span>
                <div className="flex items-center gap-2 text-[10px] text-text-dim pl-2">
                  {entry.harness && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{entry.harness}</Badge>
                  )}
                  {entry.pi?.provider && (
                    <span>provider: {entry.pi.provider}</span>
                  )}
                  {entry.model && (
                    <span>{entry.model}</span>
                  )}
                  {entry.effort && (
                    <span>effort: {entry.effort}</span>
                  )}
                </div>
                {entry.toolbelt !== undefined && (
                  <div className="flex items-center gap-1.5 text-[10px] text-text-dim pl-2">
                    <span>toolbelt:</span>
                    {entry.toolbelt === 'none'
                      ? <Badge variant="outline" className="text-[10px] px-1.5 py-0">none</Badge>
                      : (
                        <>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{entry.toolbelt}</Badge>
                          {(() => {
                            const servers = cfg.tools?.toolbelts?.[entry.toolbelt as string]?.mcpServers;
                            if (servers && servers.length > 0) {
                              return <span>({[...servers].sort().join(', ')})</span>;
                            }
                            return null;
                          })()}
                        </>
                      )
                    }
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Role overrides */}
      {cfg.agents?.roles && Object.keys(cfg.agents.roles).length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[10px] uppercase tracking-wider text-text-dim font-semibold">Roles</h3>
          <div className="flex flex-col gap-1">
            {Object.entries(cfg.agents.roles).map(([role, overrides]) => (
              <div key={role} className="flex items-start gap-2">
                <span className="text-text-dim w-28 shrink-0">{role}</span>
                <span className="text-foreground text-[11px] break-all">{JSON.stringify(overrides)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Extends */}
      {cfg.extends && (
        <section className="flex flex-col gap-1">
          <h3 className="text-[10px] uppercase tracking-wider text-text-dim font-semibold">Extends</h3>
          <span className="text-foreground">{cfg.extends}</span>
        </section>
      )}

      {/* Raw config */}
      <section className="flex flex-col gap-1">
        <h3 className="text-[10px] uppercase tracking-wider text-text-dim font-semibold">Raw Config</h3>
        <pre className="text-[10px] font-mono text-text-dim whitespace-pre-wrap break-words bg-bg-secondary rounded p-2 overflow-auto max-h-80">
          {JSON.stringify(profile.config, null, 2)}
        </pre>
      </section>
    </div>
  );
}

export function ProfileBadge({ profile }: ProfileBadgeProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus:outline-none"
      >
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 cursor-pointer hover:bg-secondary/60 transition-colors"
        >
          {profile.profileName}
        </Badge>
      </button>
      <SheetPanel
        open={open}
        onClose={() => setOpen(false)}
        title="Profile"
        description={profile.profileName ?? undefined}
      >
        <ProfileSheetBody profile={profile} />
      </SheetPanel>
    </>
  );
}
