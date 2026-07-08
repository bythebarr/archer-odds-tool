"use client";

import { THEME_COLORS, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";
import { Button } from "@/components/ui/button";

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.getElementById("theme-color-meta")?.setAttribute("content", THEME_COLORS[theme]);
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

/**
 * Both icons are always rendered; CSS (keyed off :root[data-theme], see
 * globals.css) shows the right one. So the server and client render identical
 * markup — no theme-dependent branch, no hydration mismatch, no icon flash.
 * The click handler reads the live theme off the DOM (the anti-flash script
 * in layout.tsx is the source of truth) and flips it.
 */
export function ThemeToggle() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => {
        const current: Theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
        applyTheme(current === "dark" ? "light" : "dark");
      }}
      aria-label="Toggle color theme"
      className="rounded-full text-muted-foreground"
    >
      {/* Moon (shown in light theme) */}
      <span className="theme-icon-moon inline-flex" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z" />
        </svg>
      </span>
      {/* Sun (shown in dark theme) */}
      <span className="theme-icon-sun" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      </span>
    </Button>
  );
}
