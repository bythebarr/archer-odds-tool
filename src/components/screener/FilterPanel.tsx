"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The filters column: always open beside the results on a wide screen; on a
 * phone, open until a filter is applied, then folded under its header so the
 * results come first.
 */
export function FilterPanel({ active, summary, children, className }: { active: number; summary: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  // On a wide screen the column stays open: re-applied after every filter change too, since
  // `open` follows `active` and would otherwise fold it the moment a first filter is set.
  useEffect(() => {
    if (ref.current && window.matchMedia("(min-width: 1024px)").matches) ref.current.open = true;
  }, [active]);
  return (
    <details ref={ref} open={active === 0} className={className}>
      <summary className="cursor-pointer list-none text-sm font-semibold text-foreground">{summary}</summary>
      {children}
    </details>
  );
}
