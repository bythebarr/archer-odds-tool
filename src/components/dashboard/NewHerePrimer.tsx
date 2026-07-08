"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";

const DISMISS_KEY = "archer:primer-dismissed";
const CHANGE_EVENT = "archer:primer-change";

// Read the dismissed flag as an external store — the sanctioned way to surface
// client-only state (localStorage) without a hydration mismatch or a setState-
// in-effect. Server snapshot is "dismissed" so nothing renders during SSR; the
// client re-reads the real value on hydration.
function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * A one-time "new here?" nudge on Home, pointing a first-timer at the 60-second
 * primer on /learn. Dismiss persists across sessions (localStorage, unlike the
 * splash's per-session flag), so a pro kills it once and never sees it again —
 * and it's always re-findable via the footer "Learn" link.
 */
export function NewHerePrimer() {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(DISMISS_KEY) === "1",
    () => true
  );

  if (dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return (
    <div className="relative flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3">
      <span aria-hidden className="text-lg">🏹</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground">New to odds tools?</div>
        <Link href="/learn" className="text-xs font-medium text-primary hover:underline">
          The 60-second version →
        </Link>
      </div>
      <button
        type="button"
        aria-label="Dismiss primer"
        onClick={dismiss}
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <svg viewBox="0 0 16 16" aria-hidden className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
