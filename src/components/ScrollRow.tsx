"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A horizontal row that scrolls sideways (chips, dates, games). Touch screens
 * and trackpads swipe it; a mouse can't, since the scrollbar is hidden, so on a
 * mouse it gets arrow buttons at the ends and the wheel scrolls it sideways
 * while there's more row in that direction (then the page scrolls on).
 */
export function ScrollRow({ className = "", children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      const atStart = el.scrollLeft <= 0 && e.deltaY < 0;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0;
      if (atStart || atEnd) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, [measure]);

  const step = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.7), behavior: "smooth" });
  };
  const arrow = (dir: 1 | -1) => (
    <button
      type="button"
      aria-label={dir < 0 ? "Scroll left" : "Scroll right"}
      onClick={() => step(dir)}
      className={`absolute top-1/2 z-[1] hidden size-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-md hover:bg-muted [@media(pointer:fine)]:flex ${
        dir < 0 ? "left-0" : "right-0"
      }`}
    >
      <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden>
        <path d={dir < 0 ? "M10 3L5 8l5 5" : "M6 3l5 5-5 5"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );

  return (
    <div className="relative">
      <div ref={ref} onScroll={measure} className={`overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`} {...rest}>
        {children}
      </div>
      {edges.left && arrow(-1)}
      {edges.right && arrow(1)}
    </div>
  );
}
