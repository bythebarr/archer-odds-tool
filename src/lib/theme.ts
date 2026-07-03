/** Single source of truth for the two theme-color values, matching globals.css's --background tokens. */
export const THEME_COLORS = {
  light: "#ffffff",
  dark: "#0a0a0a",
} as const;

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";
