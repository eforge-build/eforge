import * as React from 'react';
import { invokeExtensionAction } from '@eforge-build/client/browser';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useConsoleShortcut } from '@/hooks/use-console-shortcut';
import { useExtensionContributionManifest } from '@/hooks/use-extension-contribution-manifest';
import {
  type CommandDescriptor,
  type CommandPaletteModel,
  type ExtensionCommandDescriptor,
  type WorkstationCommandDescriptor,
  buildCommandPaletteModel,
} from './command-model';

interface CommandPaletteProps {
  onNavigate: (href: string) => void;
}

type PalettePage = 'root' | 'workstations';

type InvocationState =
  | { status: 'idle' }
  | { status: 'running'; label: string }
  | { status: 'success'; label: string; invocationId: string }
  | { status: 'failure'; label: string; message: string };

export function CommandPalette({ onNavigate }: CommandPaletteProps) {
  const [open, setOpen] = React.useState(false);
  const [page, setPage] = React.useState<PalettePage>('root');
  const [pendingCommand, setPendingCommand] = React.useState<ExtensionCommandDescriptor | null>(null);
  const [invocation, setInvocation] = React.useState<InvocationState>({ status: 'idle' });
  const manifest = useExtensionContributionManifest();
  const model = React.useMemo(() => buildCommandPaletteModel(manifest.data), [manifest.data]);

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      manifest.refresh();
    } else {
      setPage('root');
      setPendingCommand(null);
    }
  }, [manifest.refresh]);

  const toggleOpen = React.useCallback(() => {
    handleOpenChange(!open);
  }, [handleOpenChange, open]);

  useConsoleShortcut({
    onCommandPalette: toggleOpen,
  });

  const navigate = (href: string) => {
    onNavigate(href);
    handleOpenChange(false);
  };

  const runExtensionCommand = async (command: ExtensionCommandDescriptor) => {
    setPendingCommand(null);
    setInvocation({ status: 'running', label: command.label });
    try {
      const response = await invokeExtensionAction({
        actionId: command.actionId,
        input: command.input,
        requestedBy: { host: 'console', surface: 'command-palette', commandId: command.id },
      });
      if (response.ok) {
        setInvocation({ status: 'success', label: command.label, invocationId: response.invocationId });
      } else {
        setInvocation({ status: 'failure', label: command.label, message: response.error.message });
      }
    } catch (err) {
      setInvocation({ status: 'failure', label: command.label, message: err instanceof Error ? err.message : String(err) });
    }
  };

  const selectCommand = (command: CommandDescriptor) => {
    if (command.kind === 'navigation' || command.kind === 'workstation' || command.kind === 'workstation-subview') {
      navigate(command.href);
      return;
    }
    if (command.kind === 'open-workstation') {
      if (model.workstationCommands.length === 1) {
        navigate(model.workstationCommands[0].href);
      } else if (model.workstationCommands.length > 1) {
        setPage('workstations');
      }
      return;
    }
    if (command.requiresConfirmation) {
      setPendingCommand(command);
      return;
    }
    void runExtensionCommand(command);
  };

  return (
    <>
      <CommandDialog open={open} onOpenChange={handleOpenChange}>
        <CommandInput placeholder={page === 'workstations' ? 'Search workstations...' : 'Search Console commands...'} />
        <CommandList>
          <CommandEmpty>No commands found.</CommandEmpty>
          {page === 'workstations' ? (
            <WorkstationSelector commands={model.workstationCommands} onBack={() => setPage('root')} onSelect={selectCommand} />
          ) : (
            <RootCommands
              model={model}
              manifestStatus={manifest.status}
              manifestError={manifest.error}
              onRefreshManifest={manifest.refresh}
              onSelect={selectCommand}
            />
          )}
        </CommandList>
        <InvocationStatus invocation={invocation} />
      </CommandDialog>

      <AlertDialog open={pendingCommand !== null} onOpenChange={(nextOpen) => { if (!nextOpen) setPendingCommand(null); }}>
        {pendingCommand && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Run extension command?</AlertDialogTitle>
              <AlertDialogDescription>
                Run {pendingCommand.label} from {pendingCommand.extensionName}. Side effects: {pendingCommand.sideEffectClasses.join(', ')}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void runExtensionCommand(pendingCommand)}>Run command</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </>
  );
}

interface RootCommandsProps {
  model: CommandPaletteModel;
  manifestStatus: string;
  manifestError?: string;
  onRefreshManifest: () => void;
  onSelect: (command: CommandDescriptor) => void;
}

function RootCommands({ model, manifestStatus, manifestError, onRefreshManifest, onSelect }: RootCommandsProps) {
  return (
    <>
      <CommandGroup heading="Navigation">
        {model.navigationCommands.map((command) => <PaletteCommandItem key={command.id} command={command} onSelect={onSelect} />)}
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Workstations">
        <PaletteCommandItem
          command={model.openWorkstationCommand}
          disabled={model.workstationCommands.length === 0}
          detail={model.workstationCommands.length === 0 ? noWorkstationDetail(manifestStatus, manifestError) : undefined}
          onSelect={onSelect}
        />
        {model.workstationCommands.map((command) => <PaletteCommandItem key={command.id} command={command} onSelect={onSelect} />)}
      </CommandGroup>
      {model.workstationSubviewCommands.length > 0 && (
        <>
          <CommandSeparator />
          <CommandGroup heading="Workstation subviews">
            {model.workstationSubviewCommands.map((command) => <PaletteCommandItem key={command.id} command={command} onSelect={onSelect} />)}
          </CommandGroup>
        </>
      )}
      {manifestStatus === 'error' && (
        <>
          <CommandSeparator />
          <CommandGroup heading="Extension status">
            <CommandItem value="Retry loading extension manifest" onSelect={onRefreshManifest}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">Retry loading extensions</div>
                <div className="truncate text-xs text-muted-foreground">{manifestError ?? 'Extension manifest failed to load.'}</div>
              </div>
            </CommandItem>
          </CommandGroup>
        </>
      )}
      {model.extensionCommands.length > 0 && (
        <>
          <CommandSeparator />
          <CommandGroup heading="Extension commands">
            {model.extensionCommands.map((command) => <PaletteCommandItem key={command.id} command={command} onSelect={onSelect} />)}
          </CommandGroup>
        </>
      )}
    </>
  );
}

interface WorkstationSelectorProps {
  commands: WorkstationCommandDescriptor[];
  onBack: () => void;
  onSelect: (command: CommandDescriptor) => void;
}

function WorkstationSelector({ commands, onBack, onSelect }: WorkstationSelectorProps) {
  return (
    <>
      <CommandGroup heading="Open Workstation">
        <CommandItem value="Back to commands" onSelect={onBack}>← Back to commands</CommandItem>
        {commands.map((command) => <PaletteCommandItem key={command.id} command={command} onSelect={onSelect} />)}
      </CommandGroup>
    </>
  );
}

interface PaletteCommandItemProps {
  command: CommandDescriptor;
  disabled?: boolean;
  detail?: string;
  onSelect: (command: CommandDescriptor) => void;
}

function PaletteCommandItem({ command, disabled = false, detail, onSelect }: PaletteCommandItemProps) {
  return (
    <CommandItem
      value={[command.label, command.description, command.group, ...(command.keywords ?? [])].filter(Boolean).join(' ')}
      disabled={disabled}
      onSelect={() => { if (!disabled) onSelect(command); }}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{command.label}</div>
        {(detail || command.description) && <div className="truncate text-xs text-muted-foreground">{detail ?? command.description}</div>}
      </div>
    </CommandItem>
  );
}

function InvocationStatus({ invocation }: { invocation: InvocationState }) {
  if (invocation.status === 'idle') return null;
  const text = invocation.status === 'running'
    ? `Running ${invocation.label}…`
    : invocation.status === 'success'
      ? `${invocation.label} completed (${invocation.invocationId}).`
      : `${invocation.label} failed: ${invocation.message}`;
  return <div className="border-t px-3 py-2 text-xs text-muted-foreground" aria-live="polite">{text}</div>;
}

function noWorkstationDetail(status: string, error?: string): string {
  if (status === 'loading') return 'Loading workstations…';
  if (status === 'error') return `Unable to load workstations${error ? `: ${error}` : '.'}`;
  return 'No Console workstations are registered.';
}
