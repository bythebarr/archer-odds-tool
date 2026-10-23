import { BRAND } from "@/lib/brand/colors";

/** Single source of truth for the two theme-color values, matching globals.css's --background tokens. */
export const THEME_COLORS = {
  light: BRAND.paper,
  dark: BRAND.ink,
} as const;

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";
