"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin bar across the top while a page is on its way: the screener, the
 * builder and the boards render on the server, so after a tap on a filter
 * there's a moment where nothing seems to happen. The bar starts on any
 * same-site link or GET form, creeps toward the end, and finishes when the new
 * URL is in place (or after a few seconds, if the tap didn't navigate after all).
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timers = useRef<number[]>([]);

  const clear = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };

  useEffect(() => {
    const start = (target: URL) => {
      if (target.origin !== window.location.origin) return;
      if (target.pathname === window.location.pathname && target.search === window.location.search) return;
      clear();
      setVisible(true);
      setWidth(12);
      // Creep toward 90%; the new page finishes it.
      [180, 600, 1400, 2800].forEach((ms, i) => timers.current.push(window.setTimeout(() => setWidth([35, 60, 78, 90][i]), ms)));
      timers.current.push(window.setTimeout(() => finish(), 10_000));
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      start(new URL(href, window.location.href));
    };
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      if (!form || (form.method || "get").toLowerCase() !== "get") return;
      const url = new URL(form.action || window.location.href);
      url.search = new URLSearchParams(new FormData(form) as unknown as Record<string, string>).toString();
      start(url);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finish() {
    clear();
    setWidth(100);
    timers.current.push(window.setTimeout(() => setVisible(false), 250));
    timers.current.push(window.setTimeout(() => setWidth(0), 500));
  }

  // The URL changed: the new page is in.
  const key = `${pathname}?${search.toString()}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5">
      <div
        className="h-full bg-brand shadow-[0_0_8px_var(--color-brand,#c6f432)] transition-[width,opacity] duration-300 ease-out"
        style={{ width: `${width}%`, opacity: visible ? 1 : 0 }}
      />
    </div>
  );
}
