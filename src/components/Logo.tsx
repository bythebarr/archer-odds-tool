"use client";

import { useState, useSyncExternalStore } from "react";

interface LogoProps {
  /** Candidate image paths, tried in order; falls back to initials if all fail. */
  sources: string[];
  alt: string;
  fallbackText: string;
  /** Background color for the fallback badge (e.g. a team/book brand color); defaults to neutral gray. */
  color?: string;
  size?: number;
  className?: string;
}

/** Picks readable text color (near-white or near-black) for a given hex background. */
function textColorFor(hex: string): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#18181b" : "#fafafa";
}

/**
 * True only after the component has mounted on the client (false during SSR and
 * the hydrating first render). Uses useSyncExternalStore rather than a
 * setState-in-effect flag: the server snapshot is `false`, the client snapshot
 * is `true`, and React swaps them post-hydration without a cascading re-render.
 */
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

/** Darkens a hex color by `amount` (0-1) — the gradient's second stop, for a bit of depth on the fallback badge instead of a flat fill. */
function darken(hex: string, amount: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const scale = (c: number) => Math.round(c * (1 - amount));
  return `rgb(${scale(r)}, ${scale(g)}, ${scale(b)})`;
}

export function Logo({ sources, alt, fallbackText, color, size = 20, className = "" }: LogoProps) {
  const [index, setIndex] = useState(0);
  // Local 404s can fire the img's error event before React finishes hydrating
  // and attaches its listener, so the <img> itself is only rendered once
  // mounted client-side — the fallback badge is otherwise what SSR sends. SSR
  // and the first client render both see mounted=false (no hydration mismatch);
  // useMounted flips it to true after mount.
  const mounted = useMounted();

  if (!mounted || index >= sources.length) {
    const background = color ?? "#71717a";
    return (
      <span
        style={{
          width: size,
          height: size,
          fontSize: size * 0.38,
          background: `linear-gradient(135deg, ${background} 0%, ${darken(background, 0.22)} 100%)`,
          color: textColorFor(background),
        }}
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none tracking-tight shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_1px_2px_rgba(0,0,0,0.15)] ring-1 ring-black/10 dark:ring-white/10 ${className}`}
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
      className={`inline-block shrink-0 rounded-full bg-background object-contain ring-1 ring-black/5 dark:ring-white/10 ${className}`}
      onError={() => setIndex((i) => i + 1)}
    />
  );
}
