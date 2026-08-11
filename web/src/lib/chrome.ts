/** Workspace chrome visibility prefs (collapsible menus). */

export type ChromePanel = "modules" | "list" | "inspector" | "tools";

export type ChromeState = Record<ChromePanel, boolean>;

export const CHROME_STORAGE_KEY = "tavern.workspace.chrome";

export const DEFAULT_DESKTOP_CHROME: ChromeState = {
  modules: true,
  list: true,
  inspector: true,
  tools: true,
};

export const DEFAULT_COMPACT_CHROME: ChromeState = {
  modules: false,
  list: false,
  inspector: false,
  tools: false,
};

export function defaultChromeForViewport(width: number): ChromeState {
  if (width <= 1100) return { ...DEFAULT_COMPACT_CHROME };
  return { ...DEFAULT_DESKTOP_CHROME };
}

export function loadChrome(width = typeof window !== "undefined" ? window.innerWidth : 1280): ChromeState {
  try {
    const raw = localStorage.getItem(CHROME_STORAGE_KEY);
    if (!raw) return defaultChromeForViewport(width);
    const parsed = JSON.parse(raw) as Partial<ChromeState>;
    return {
      modules: parsed.modules ?? true,
      list: parsed.list ?? true,
      inspector: parsed.inspector ?? true,
      tools: parsed.tools ?? true,
    };
  } catch {
    return defaultChromeForViewport(width);
  }
}

export function saveChrome(state: ChromeState) {
  try {
    localStorage.setItem(CHROME_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

export function chromeClassNames(state: ChromeState): string {
  return [
    state.modules ? "chrome-modules-on" : "chrome-modules-off",
    state.list ? "chrome-list-on" : "chrome-list-off",
    state.inspector ? "chrome-inspector-on" : "chrome-inspector-off",
    state.tools ? "chrome-tools-on" : "chrome-tools-off",
  ].join(" ");
}

export function anyDrawerOpen(state: ChromeState): boolean {
  return state.modules || state.list || state.inspector;
}
