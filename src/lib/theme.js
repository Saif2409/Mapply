import { useEffect, useState } from "react";

const KEY = "mapply.theme";

/**
 * Four themes. Each defines the accent (used by the wordmark and every control)
 * plus the full surface palette, so the splash screen and every page share one
 * look from first paint.
 *
 * wordmark: "badge" renders the LinkedIn-style mark — accent "M" followed by
 * "apply" reversed out of an accent block. "plain" is the original treatment.
 */
export const THEMES = {
  pink: {
    label: "Pink",
    swatch: ["#DB4F8D", "#FFFFFF"],
    dark: false,
    wordmark: "badge",
    vars: {
      "--accent": "#DB4F8D",
      "--accent-light": "#E472A5",
      "--accent-dark": "#B83A71",
      "--accent-soft": "rgba(219,79,141,0.12)",
      "--wordmark-rest": "#241019",
      "--bg": "#FDF7FA",
      "--surface": "#FFFFFF",
      "--surface-solid": "#FFFFFF",
      "--sidebar": "#FFFFFF",
      "--border": "#EEDBE5",
      "--text": "#1B0F16",
      "--text-mid": "#4A3540",
      "--text-dim": "#8A7480",
      "--input-bg": "#FFFFFF",
      "--hover": "#FBEEF4",
    },
  },
  blue: {
    label: "Blue",
    swatch: ["#0A66C2", "#FFFFFF"],
    dark: false,
    wordmark: "badge",
    vars: {
      "--accent": "#0A66C2",
      "--accent-light": "#2A7FD4",
      "--accent-dark": "#084E96",
      "--accent-soft": "rgba(10,102,194,0.12)",
      "--wordmark-rest": "#0B1B2B",
      "--bg": "#F4F7FB",
      "--surface": "#FFFFFF",
      "--surface-solid": "#FFFFFF",
      "--sidebar": "#FFFFFF",
      "--border": "#D6DEE9",
      "--text": "#0B1B2B",
      "--text-mid": "#3A4859",
      "--text-dim": "#6B7787",
      "--input-bg": "#FFFFFF",
      "--hover": "#EDF2F9",
    },
  },
  midnight: {
    label: "Midnight",
    swatch: ["#2456E6", "#070B14"],
    dark: true,
    wordmark: "plain",
    vars: {
      "--accent": "#2456E6",
      "--accent-light": "#4F7DFF",
      "--accent-dark": "#1A3FAE",
      "--accent-soft": "rgba(36,86,230,0.15)",
      "--wordmark-rest": "#FFFFFF",
      "--bg": "#070B14",
      "--surface": "rgba(15,22,40,0.8)",
      "--surface-solid": "#0B1020",
      "--sidebar": "rgba(11,16,32,0.6)",
      "--border": "rgba(28,39,66,0.6)",
      "--text": "#E8EDFA",
      "--text-mid": "#AAB6D3",
      "--text-dim": "#6B7794",
      "--input-bg": "#070B14",
      "--hover": "rgba(20,28,51,0.7)",
    },
  },
  dark: {
    label: "Dark",
    swatch: ["#E5E7EB", "#111318"],
    dark: true,
    wordmark: "plain",
    vars: {
      "--accent": "#9CA3AF",
      "--accent-light": "#D1D5DB",
      "--accent-dark": "#6B7280",
      "--accent-soft": "rgba(156,163,175,0.16)",
      "--wordmark-rest": "#FFFFFF",
      "--bg": "#0B0D11",
      "--surface": "rgba(24,27,34,0.85)",
      "--surface-solid": "#14171D",
      "--sidebar": "rgba(17,19,24,0.75)",
      "--border": "rgba(58,63,74,0.7)",
      "--text": "#F3F4F6",
      "--text-mid": "#C2C7D0",
      "--text-dim": "#858B98",
      "--input-bg": "#0B0D11",
      "--hover": "rgba(38,42,51,0.8)",
    },
  },
};

export const DEFAULT_THEME = "midnight";

export function getInitialTheme() {
  const saved = localStorage.getItem(KEY);
  return saved && THEMES[saved] ? saved : DEFAULT_THEME;
}

export function applyTheme(name) {
  const theme = THEMES[name] || THEMES[DEFAULT_THEME];
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.vars)) root.style.setProperty(k, v);
  // `light` drives the compatibility overrides for the dark-palette utility classes
  root.classList.toggle("light", !theme.dark);
  root.dataset.theme = name;
  root.dataset.wordmark = theme.wordmark;
  localStorage.setItem(KEY, name);
}

export function currentWordmarkStyle() {
  return document.documentElement.dataset.wordmark || "plain";
}

export function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme);
  useEffect(() => applyTheme(theme), [theme]);
  return [theme, setTheme];
}
