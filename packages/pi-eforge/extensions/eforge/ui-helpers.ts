/**
 * Shared TUI overlay utilities for native Pi command handlers.
 *
 * Provides reusable overlay patterns: select lists, info panels, and
 * loading indicators.
 */

import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Input, Markdown, type SelectItem, SelectList, Text, matchesKey, Key, fuzzyFilter, truncateToWidth } from "@earendil-works/pi-tui";

type OverlayAnchor =
  | "center"
  | "top-left"
  | "top-center"
  | "top-right"
  | "left-center"
  | "right-center"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

type OverlaySize = number | `${number}%`;

interface OverlayOptions {
  width?: OverlaySize;
  minWidth?: number;
  maxHeight?: OverlaySize;
  anchor?: OverlayAnchor;
  margin?: number | { top?: number; right?: number; bottom?: number; left?: number };
}

interface CustomUiOptions {
  overlay?: boolean;
  overlayOptions?: OverlayOptions;
}

interface CustomComponent {
  focused?: boolean;
  render(width: number): string[];
  invalidate(): void;
  handleInput(data: string): void;
}

/** Minimal UI context type for overlay helpers. */
export interface UIContext {
  cwd: string;
  hasUI: boolean;
  ui: {
    custom<T>(factory: (
      tui: { requestRender(): void },
      theme: { fg(color: string, text: string): string; bold(text: string): string },
      kb: unknown,
      done: (result: T) => void,
    ) => CustomComponent, options?: CustomUiOptions): Promise<T>;
    setStatus(key: string, text: string | undefined): void;
  };
}

const SELECT_OVERLAY_OPTIONS: CustomUiOptions = {
  overlay: true,
  overlayOptions: {
    anchor: "center",
    width: "70%",
    minWidth: 40,
    maxHeight: "80%",
    margin: 1,
  },
};

const INFO_OVERLAY_OPTIONS: CustomUiOptions = {
  overlay: true,
  overlayOptions: {
    anchor: "center",
    width: "80%",
    minWidth: 40,
    maxHeight: "85%",
    margin: 1,
  },
};

/**
 * Wrap rendered component lines in a full box border so floating overlays have
 * clear side boundaries. Uses ANSI-aware truncation/padding to preserve theme
 * styling while keeping every rendered line within the requested width.
 */
export function renderBorderedLines(
  lines: string[],
  width: number,
  color: (text: string) => string,
): string[] {
  if (width < 3) {
    return (lines.length > 0 ? lines : [""]).map((line) => truncateToWidth(line, width, "", true));
  }

  const innerWidth = width - 2;
  const contentLines = lines.length > 0 ? lines : [""];
  return [
    color(`╭${"─".repeat(innerWidth)}╮`),
    ...contentLines.map((line) =>
      color("│") + truncateToWidth(line, innerWidth, "", true) + color("│"),
    ),
    color(`╰${"─".repeat(innerWidth)}╯`),
  ];
}

/**
 * Show a select-list overlay and return the chosen item's value,
 * or null if the user cancelled.
 */
export async function showSelectOverlay(
  ctx: UIContext,
  title: string,
  items: SelectItem[],
): Promise<string | null> {
  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const container = new Container();

    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));

    const visibleCount = Math.min(items.length, 15);
    const selectList = new SelectList(items, visibleCount, {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });

    selectList.onSelect = (item) => done(item.value);
    selectList.onCancel = () => done(null);

    container.addChild(selectList);
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 1, 0));

    return {
      render: (width: number) => renderBorderedLines(
        container.render(Math.max(1, width - 2)),
        width,
        (s: string) => theme.fg("accent", s),
      ),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        selectList.handleInput(data);
        tui.requestRender();
      },
    };
  }, SELECT_OVERLAY_OPTIONS);
}

/**
 * Show a searchable select-list overlay with a filter input and return
 * the chosen item's value, or null if the user cancelled.
 */
export async function showSearchableSelectOverlay(
  ctx: UIContext,
  title: string,
  items: SelectItem[],
): Promise<string | null> {
  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const MAX_VISIBLE = 15;
    const container = new Container();

    const titleText = new Text(theme.fg("accent", theme.bold(title)), 1, 0);
    const helpText = new Text(
      theme.fg("dim", "type to filter • ↑↓ navigate • enter select • esc cancel"),
      1,
      0,
    );

    const listTheme = {
      selectedPrefix: (text: string) => theme.fg("accent", text),
      selectedText: (text: string) => theme.fg("accent", text),
      description: (text: string) => theme.fg("muted", text),
      scrollInfo: (text: string) => theme.fg("dim", text),
      noMatch: (text: string) => theme.fg("warning", text),
    };

    let selectList = new SelectList(items, Math.min(items.length, MAX_VISIBLE), listTheme);

    const input = new Input();
    input.onSubmit = () => {
      const item = selectList.getSelectedItem();
      if (item) done(item.value);
    };
    input.onEscape = () => done(null);

    selectList.onSelect = (item) => done(item.value);
    selectList.onCancel = () => done(null);

    function rebuildContainer(filteredItems: SelectItem[]) {
      container.clear();
      container.addChild(titleText);
      container.addChild(input);
      selectList = new SelectList(filteredItems, Math.min(filteredItems.length, MAX_VISIBLE), listTheme);
      selectList.onSelect = (item) => done(item.value);
      selectList.onCancel = () => done(null);
      container.addChild(selectList);
      container.addChild(helpText);
    }

    rebuildContainer(items);

    return {
      get focused() {
        return input.focused;
      },
      set focused(value: boolean) {
        input.focused = value;
      },
      render(width: number) {
        return renderBorderedLines(
          container.render(Math.max(1, width - 2)),
          width,
          (s: string) => theme.fg("accent", s),
        );
      },
      invalidate() {
        container.invalidate();
      },
      handleInput(data: string) {
        if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
          selectList.handleInput(data);
        } else if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
          input.handleInput(data);
        } else {
          const before = input.getValue();
          input.handleInput(data);
          const after = input.getValue();
          if (before !== after) {
            if (!after) {
              rebuildContainer(items);
            } else {
              const filtered = fuzzyFilter(items, after, (item) => item.label);
              rebuildContainer(filtered);
            }
          }
        }
        tui.requestRender();
      },
    };
  }, SELECT_OVERLAY_OPTIONS);
}

/**
 * Show a read-only info overlay with markdown content.
 * Resolves when the user presses enter or esc.
 */
export async function showInfoOverlay(
  ctx: UIContext,
  title: string,
  content: string,
): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    const container = new Container();
    const mdTheme = getMarkdownTheme();

    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
    container.addChild(new Markdown(content, 1, 1, mdTheme));

    container.addChild(new Text(theme.fg("dim", "esc/enter close"), 1, 0));

    return {
      render: (width: number) => renderBorderedLines(
        container.render(Math.max(1, width - 2)),
        width,
        (s: string) => theme.fg("accent", s),
      ),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        if (
          matchesKey(data, Key.escape) ||
          matchesKey(data, Key.enter) ||
          matchesKey(data, Key.ctrl("c"))
        ) {
          done(undefined);
        } else {
          tui.requestRender();
        }
      },
    };
  }, INFO_OVERLAY_OPTIONS);
}

/**
 * Run an async operation while showing a temporary loading status.
 */
export async function withLoader<T>(
  ctx: UIContext,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  ctx.ui.setStatus("eforge-loading", `⟳ ${label}`);
  try {
    return await fn();
  } finally {
    ctx.ui.setStatus("eforge-loading", undefined);
  }
}
