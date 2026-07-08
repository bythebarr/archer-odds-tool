"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { GLOSSARY_BY_ID } from "@/lib/glossary";

function InfoGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="inline-block size-[13px] shrink-0 translate-y-[0.5px] text-muted-foreground/70 group-hover:text-foreground"
      fill="currentColor"
    >
      <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM8 3.6a.95.95 0 110 1.9.95.95 0 010-1.9zM7.1 6.9h1.8v5.1H7.1V6.9z" />
    </svg>
  );
}

/**
 * A tap-to-open definition popover, sourced from the glossary. Unlike a native
 * `title=` (desktop-hover only, invisible on phones), this opens on tap/click —
 * essential for the mobile shell. Wrap a term to get a dotted-underline label
 * plus an info glyph (`<InfoTip id="ev">EV</InfoTip>`), or render just the glyph
 * (`<InfoTip id="ev" />`). Fails open: an unknown id renders its children plain.
 */
export function InfoTip({
  id,
  children,
  className = "",
}: {
  id: string;
  children?: ReactNode;
  className?: string;
}) {
  const entry = GLOSSARY_BY_ID[id];
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Fail open — never hide the label just because a glossary id is missing.
  if (!entry) return <>{children}</>;

  return (
    <span ref={wrapRef} className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={children ? undefined : `What is ${entry.term}?`}
        className="group inline-flex items-center gap-0.5 text-left align-baseline"
      >
        {children != null && (
          <span className="border-b border-dotted border-muted-foreground/50 group-hover:border-foreground">
            {children}
          </span>
        )}
        <InfoGlyph />
      </button>

      {open && (
        <span
          id={panelId}
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-1.5 block w-[min(17rem,78vw)] rounded-lg border border-border bg-popover p-3 text-left text-popover-foreground shadow-lg"
        >
          <span className="block text-xs font-semibold text-foreground">{entry.term}</span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{entry.short}</span>
          <Link
            href={`/learn#${entry.id}`}
            className="mt-2 inline-block text-[11px] font-medium text-primary hover:underline"
            onClick={() => setOpen(false)}
          >
            Full glossary →
          </Link>
        </span>
      )}
    </span>
  );
}
