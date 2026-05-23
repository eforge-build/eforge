/**
 * Shared TUI panel utilities for native Pi command handlers.
 *
 * Provides reusable non-floating panel patterns: select lists, info panels,
 * and loading indicators. Compatibility exports with the old Overlay suffix
 * delegate to these panel implementations.
 */

import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Input, Markdown, type SelectItem, SelectList, Text, matchesKey, Key, fuzzyFilter, truncateToWidth } from "@earendil-works/pi-tui";

interface CustomComponent {
  focused?: boolean;
  render(width: number): string[];
  invalidate(): void;
  handleInput(data: string): void;
}

interface PanelTui {
  requestRender(): void;
  terminal?: { rows?: number };
}

/** Minimal UI context type for panel helpers. */
export interface UIContext {
  cwd: string;
  hasUI: boolean;
  ui: {
    custom<T>(factory: (
      tui: PanelTui,
      theme: { fg(color: string, text: string): string; bold(text: string): string },
      kb: unknown,
      done: (result: T) => void,
    ) => CustomComponent): Promise<T>;
    editor(title: string, prefill?: string): Promise<string | undefined>;
    setStatus(key: string, text: string | undefined): void;
  };
}

const FALLBACK_TERMINAL_ROWS = 12;
const MAX_SELECT_VISIBLE = 15;
const MIN_SELECT_VISIBLE = 1;
const SELECT_RESERVED_ROWS = 6;
const INFO_RESERVED_ROWS = 7;

function terminalRows(tui: PanelTui): number {
  const rows = tui.terminal?.rows;
  return typeof rows === "number" && Number.isFinite(rows) && rows > 0
    ? rows
    : FALLBACK_TERMINAL_ROWS;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function visibleSelectCount(tui: PanelTui, itemCount: number): number {
  const available = clamp(terminalRows(tui) - SELECT_RESERVED_ROWS, MIN_SELECT_VISIBLE, MAX_SELECT_VISIBLE);
  return Math.max(1, Math.min(Math.max(1, itemCount), available));
}

function infoViewportRows(tui: PanelTui): number {
  return Math.max(1, terminalRows(tui) - INFO_RESERVED_ROWS);
}

function themedSelectList(
  items: SelectItem[],
  visibleCount: number,
  theme: { fg(color: string, text: string): string },
): SelectList {
  return new SelectList(items, visibleCount, {
    selectedPrefix: (text) => theme.fg("accent", text),
    selectedText: (text) => theme.fg("accent", text),
    description: (text) => theme.fg("muted", text),
    scrollInfo: (text) => theme.fg("dim", text),
    noMatch: (text) => theme.fg("warning", text),
  });
}

/**
 * Wrap rendered component lines in a full box border so panels have clear side
 * boundaries. Uses ANSI-aware truncation/padding to preserve theme styling
 * while keeping every rendered line within the requested width.
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
 * Show a compact select-list panel and return the chosen item's value,
 * or null if the user cancelled.
 */
export async function showSelectPanel(
  ctx: UIContext,
  title: string,
  items: SelectItem[],
): Promise<string | null> {
  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const container = new Container();

    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));

    const selectList = themedSelectList(items, visibleSelectCount(tui, items.length), theme);
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
  });
}

/**
 * Show a searchable select-list panel with a filter input and return
 * the chosen item's value, or null if the user cancelled.
 */
export async function showSearchableSelectPanel(
  ctx: UIContext,
  title: string,
  items: SelectItem[],
): Promise<string | null> {
  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const container = new Container();

    const titleText = new Text(theme.fg("accent", theme.bold(title)), 1, 0);
    const helpText = new Text(
      theme.fg("dim", "type to filter • ↑↓ navigate • enter select • esc cancel"),
      1,
      0,
    );

    let selectList = themedSelectList(items, visibleSelectCount(tui, items.length), theme);

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
      selectList = themedSelectList(filteredItems, visibleSelectCount(tui, filteredItems.length), theme);
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
  });
}

/**
 * Show a read-only, scrollable info panel with markdown content.
 * Resolves when the user presses enter or esc.
 */
export async function showInfoPanel(
  ctx: UIContext,
  title: string,
  content: string,
): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    const mdTheme = getMarkdownTheme();
    const markdown = new Markdown(content, 1, 1, mdTheme);
    let scrollOffset = 0;
    let lastRenderWidth = 80;

    function scrollBy(delta: number, maxScroll: number) {
      scrollOffset = clamp(scrollOffset + delta, 0, maxScroll);
    }

    return {
      render: (width: number) => {
        const innerWidth = Math.max(1, width - 2);
        lastRenderWidth = innerWidth;
        const renderedContent = markdown.render(innerWidth);
        const viewportRows = infoViewportRows(tui);
        const maxScroll = Math.max(0, renderedContent.length - viewportRows);
        scrollOffset = clamp(scrollOffset, 0, maxScroll);
        const visibleEnd = Math.min(renderedContent.length, scrollOffset + viewportRows);
        const scrollText = renderedContent.length > viewportRows
          ? ` • lines ${scrollOffset + 1}-${visibleEnd}/${renderedContent.length}`
          : "";
        const lines = [
          theme.fg("accent", theme.bold(title)),
          ...renderedContent.slice(scrollOffset, visibleEnd),
          theme.fg("dim", `↑↓/PgUp/PgDn scroll • esc/enter close${scrollText}`),
        ];

        return renderBorderedLines(lines, width, (s: string) => theme.fg("accent", s));
      },
      invalidate: () => markdown.invalidate(),
      handleInput: (data: string) => {
        const viewportRows = infoViewportRows(tui);
        const renderedContent = markdown.render(lastRenderWidth);
        const maxScroll = Math.max(0, renderedContent.length - viewportRows);
        if (
          matchesKey(data, Key.escape) ||
          matchesKey(data, Key.enter) ||
          matchesKey(data, Key.ctrl("c"))
        ) {
          done(undefined);
        } else if (matchesKey(data, Key.up)) {
          scrollBy(-1, maxScroll);
          tui.requestRender();
        } else if (matchesKey(data, Key.down)) {
          scrollBy(1, maxScroll);
          tui.requestRender();
        } else if (matchesKey(data, Key.pageUp)) {
          scrollBy(-viewportRows, maxScroll);
          tui.requestRender();
        } else if (matchesKey(data, Key.pageDown)) {
          scrollBy(viewportRows, maxScroll);
          tui.requestRender();
        } else if (matchesKey(data, Key.home)) {
          scrollOffset = 0;
          tui.requestRender();
        } else if (matchesKey(data, Key.end)) {
          scrollOffset = maxScroll;
          tui.requestRender();
        } else {
          tui.requestRender();
        }
      },
    };
  });
}

/** Compatibility alias for callers that still import the old helper name. */
export async function showSelectOverlay(
  ctx: UIContext,
  title: string,
  items: SelectItem[],
): Promise<string | null> {
  return showSelectPanel(ctx, title, items);
}

/** Compatibility alias for callers that still import the old helper name. */
export async function showSearchableSelectOverlay(
  ctx: UIContext,
  title: string,
  items: SelectItem[],
): Promise<string | null> {
  return showSearchableSelectPanel(ctx, title, items);
}

/** Compatibility alias for callers that still import the old helper name. */
export async function showInfoOverlay(
  ctx: UIContext,
  title: string,
  content: string,
): Promise<void> {
  return showInfoPanel(ctx, title, content);
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
