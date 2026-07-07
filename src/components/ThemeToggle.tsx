"use client";

import { useState } from "react";
import { THEME_COLORS, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";
import { Button } from "@/components/ui/button";

function initialTheme(): Theme {
  if (typeof document === "undefined") return "light";
  // By the time this Client Component hydrates, the inline anti-flash
  // script in layout.tsx has already resolved and set the real attribute —
  // reading it back keeps this in sync without a client-only effect/flash.
  return (document.documentElement.getAttribute("data-theme") as Theme) ?? "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.getElementById("theme-color-meta")?.setAttribute("content", THEME_COLORS[theme]);
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => {
        const next: Theme = theme === "dark" ? "light" : "dark";
        setTheme(next);
        applyTheme(next);
      }}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded-full text-muted-foreground"
    >
      {/* Server always renders "light" state (sun/moon SVG below matches),
          client may immediately correct to the resolved theme — expected,
          one-time mismatch, not a bug: see preventing-flash-before-hydration. */}
      <span suppressHydrationWarning>
        {theme === "dark" ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z" />
          </svg>
        )}
      </span>
    </Button>
  );
}
