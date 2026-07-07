/** Single source of truth for the two theme-color values, matching globals.css's --background tokens. */
export const THEME_COLORS = {
  light: "#f7f9fc",
  dark: "#0a0e17",
} as const;

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";
