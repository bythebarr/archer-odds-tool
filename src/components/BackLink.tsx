"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

interface BackLinkProps {
  fallbackHref: string;
  className?: string;
  children: ReactNode;
}

/**
 * Prefers browser-history back (preserves whatever date/scroll position the
 * user came from) over the fallback href, which only fires when there's no
 * history to go back to (e.g. a direct link/new tab landed straight here).
 */
export function BackLink({ fallbackHref, className, children }: BackLinkProps) {
  const router = useRouter();

  return (
    <Link
      href={fallbackHref}
      className={className}
      onClick={(e) => {
        if (window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
    >
      {children}
    </Link>
  );
}
