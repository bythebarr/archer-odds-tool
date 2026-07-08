"use client";

import { useState } from "react";
import { useSlip } from "@/lib/slip/SlipContext";
import { SlipDrawer } from "./SlipDrawer";

/** Global floating slip trigger + drawer, mounted once in the root layout so it's available on every page. */
export function SlipButton() {
  const { picks } = useSlip();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open slip (${picks.length} picks)`}
        className="fixed bottom-20 right-5 z-30 flex h-12 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-100 sm:bottom-5"
      >
        <svg viewBox="0 0 20 20" fill="none" className="size-4">
          <path
            d="M5 3h10a1 1 0 0 1 1 1v13l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M7.5 7h5M7.5 10h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Slip
        {picks.length > 0 && (
          <span className="flex size-5 items-center justify-center rounded-full bg-primary-foreground text-xs font-bold text-primary">
            {picks.length}
          </span>
        )}
      </button>
      <SlipDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
