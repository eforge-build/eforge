import * as React from 'react';
import { invokeExtensionAction } from '@eforge-build/client/browser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SafeMarkdown } from '@/components/recovery/safe-markdown';
import type {
  ConsoleContributionBlock,
  ConsoleContributionManifestEntry,
  ExtensionActionManifestEntry,
  ExtensionJsonObject,
} from './system-types';
import { ExtensionActionForm, InvocationResult } from './extension-action-form';
import {
  actionKey,
  buildRequestedBy,
  sanitizeContributionHref,
  statusToneToBadgeVariant,
  type InvocationState,
} from './extension-contribution-rendering';

interface ExtensionContributionCardProps {
  contribution: ConsoleContributionManifestEntry;
  actionLookup: Map<string, ExtensionActionManifestEntry>;
}

export function ExtensionContributionCard({ contribution, actionLookup }: ExtensionContributionCardProps) {
  const [invocations, setInvocations] = React.useState<Record<string, InvocationState>>({});

  async function invoke(key: string, actionId: string, input: ExtensionJsonObject) {
    setInvocations((prev) => ({ ...prev, [key]: { status: 'running' } }));
    try {
      const response = await invokeExtensionAction({
        actionId,
        input,
        requestedBy: buildRequestedBy(contribution.id),
      });
      if (response.ok) {
        setInvocations((prev) => ({
          ...prev,
          [key]: {
            status: 'success',
            invocationId: response.invocationId,
            output: response.output,
            outputProfile: actionLookup.get(actionId)?.outputProfile,
          },
        }));
      } else {
        setInvocations((prev) => ({
          ...prev,
          [key]: {
            status: 'failure',
            invocationId: response.invocationId,
            code: response.error.code,
            message: response.error.message,
          },
        }));
      }
    } catch (err) {
      setInvocations((prev) => ({ ...prev, [key]: { status: 'failure', message: err instanceof Error ? err.message : String(err) } }));
    }
  }

  return (
    <article className="rounded-md border bg-background p-3 space-y-3">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{contribution.title}</h3>
          <Badge variant="outline" className="text-xs">{contribution.extensionName}</Badge>
        </div>
        {contribution.description && <p className="mt-1 text-xs text-muted-foreground">{contribution.description}</p>}
      </header>
      <div className="space-y-3">
        {contribution.blocks.map((block, index) => (
          <ContributionBlock
            key={`${block.rendererId}:${index}`}
            contributionId={contribution.id}
            block={block}
            index={index}
            actionLookup={actionLookup}
            invocation={invocations[actionKey(contribution.id, block, index)] ?? { status: 'idle' }}
            onInvoke={invoke}
          />
        ))}
      </div>
    </article>
  );
}

interface ContributionBlockProps {
  contributionId: string;
  block: ConsoleContributionBlock;
  index: number;
  actionLookup: Map<string, ExtensionActionManifestEntry>;
  invocation: InvocationState;
  onInvoke: (key: string, actionId: string, input: ExtensionJsonObject) => Promise<void>;
}

function ContributionBlock({ contributionId, block, index, actionLookup, invocation, onInvoke }: ContributionBlockProps) {
  const title = block.title ? <p className="text-xs font-medium text-muted-foreground">{block.title}</p> : null;

  switch (block.rendererId) {
    case 'text':
      return <div className="space-y-1 text-xs">{title}<p>{block.content}</p></div>;
    case 'markdown':
      return <div className="space-y-1 text-xs">{title}<SafeMarkdown markdown={block.content} className="text-xs" forbidResourceLoading /></div>;
    case 'status-badge':
      return (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {title}
          <Badge variant={statusToneToBadgeVariant(block.status)}>{block.content}</Badge>
        </div>
      );
    case 'link': {
      const href = sanitizeContributionHref(block.href);
      return (
        <div className="space-y-1 text-xs">
          {title}
          {href ? (
            <a href={href} className="text-primary underline" target={href.startsWith('/console/') ? undefined : '_blank'} rel="noreferrer">
              {block.content}
            </a>
          ) : (
            <span className="text-muted-foreground">Blocked unsafe link: {block.content}</span>
          )}
        </div>
      );
    }
    case 'action-button': {
      const key = actionKey(contributionId, block, index);
      return (
        <div className="space-y-1 text-xs">
          {title}
          <Button
            size="sm"
            variant="outline"
            disabled={invocation.status === 'running'}
            onClick={() => onInvoke(key, block.action.actionId, block.action.inputDefaults ?? {})}
          >
            {invocation.status === 'running' ? 'Running…' : block.content}
          </Button>
          <InvocationResult invocation={invocation} />
        </div>
      );
    }
    case 'action-form': {
      const key = actionKey(contributionId, block, index);
      return (
        <div className="space-y-2 text-xs">
          {title}
          <p>{block.content}</p>
          <ExtensionActionForm
            action={actionLookup.get(block.action.actionId)}
            binding={block.action}
            invocation={invocation}
            onInvoke={(input) => onInvoke(key, block.action.actionId, input)}
          />
        </div>
      );
    }
    default: {
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}
