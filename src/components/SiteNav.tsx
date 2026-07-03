"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";

const NAV_LINKS = [
  { href: "/", label: "Games" },
  { href: "/slate", label: "Slate" },
];

/**
 * Carries the currently-browsed `date` across nav links so switching
 * between the Games and Slate views doesn't reset you back to today.
 */
export function SiteNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const date = searchParams.get("date");

  return (
    <nav className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-6 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            archer
          </Link>
          <div className="flex gap-4">
            {NAV_LINKS.map((link) => {
              const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
              const href = date ? `${link.href}?date=${date}` : link.href;
              return (
                <Link
                  key={link.href}
                  href={href}
                  className={`text-sm font-medium ${
                    isActive
                      ? "text-zinc-900 dark:text-zinc-50"
                      : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
        <ThemeToggle />
      </div>
    </nav>
  );
}
