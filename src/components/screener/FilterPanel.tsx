"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The filters column: always open beside the results on a wide screen; on a
 * phone, open until a filter is applied, then folded under its header so the
 * results come first.
 */
export function FilterPanel({ active, summary, children, className }: { active: number; summary: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current && window.matchMedia("(min-width: 1024px)").matches) ref.current.open = true;
  }, []);
  return (
    <details ref={ref} open={active === 0} className={className}>
      <summary className="cursor-pointer list-none text-sm font-semibold text-foreground">{summary}</summary>
      {children}
    </details>
  );
}
