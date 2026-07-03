"use client";

import { useState, useSyncExternalStore } from "react";

interface LogoProps {
  /** Candidate image paths, tried in order; falls back to initials if all fail. */
  sources: string[];
  alt: string;
  fallbackText: string;
  size?: number;
  className?: string;
}

function noopSubscribe() {
  return () => {};
}

export function Logo({ sources, alt, fallbackText, size = 20, className = "" }: LogoProps) {
  const [index, setIndex] = useState(0);
  // Local 404s can fire the img's error event before React finishes hydrating
  // and attaches its listener, so the <img> itself is only rendered once
  // mounted client-side — the fallback badge is otherwise what SSR sends.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );

  if (!mounted || index >= sources.length) {
    return (
      <span
        style={{ width: size, height: size, fontSize: size * 0.4 }}
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-200 font-semibold leading-none text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300 ${className}`}
        title={alt}
      >
        {fallbackText}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- small local/optional files, need onError fallback
    <img
      src={sources[index]}
      alt={alt}
      width={size}
      height={size}
      className={`inline-block shrink-0 rounded-full object-contain ${className}`}
      onError={() => setIndex((i) => i + 1)}
    />
  );
}
