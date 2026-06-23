import { useEffect } from 'react';

interface ConsoleShortcutOptions {
  enabled?: boolean;
  onCommandPalette: () => void;
}

export function useConsoleShortcut({ enabled = true, onCommandPalette }: ConsoleShortcutOptions) {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.repeat) return;
      if (event.key.toLowerCase() !== 'k') return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      onCommandPalette();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, onCommandPalette]);
}
