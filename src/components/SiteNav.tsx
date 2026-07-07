"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import { AppIconMark } from "@/lib/appIcon";

// carriesDate: MLB's Games/Slate views share a browsed date across nav
// clicks; Tennis/Soccer have no date filter (see tennisMatches.ts /
// soccerMatches.ts), so they never carry one.
const NAV_LINKS = [
  { href: "/", label: "Games", carriesDate: true },
  { href: "/slate", label: "Slate", carriesDate: true },
  { href: "/tennis", label: "Tennis", carriesDate: false },
  { href: "/soccer", label: "Soccer", carriesDate: false },
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
    <nav className="border-b border-border">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-6 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-mono text-sm font-semibold text-foreground">
            <span className="block h-[18px] w-[18px] overflow-hidden rounded-[22%]">
              <AppIconMark />
            </span>
            archer
          </Link>
          <div className="flex gap-4">
            {NAV_LINKS.map((link) => {
              const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
              const href = link.carriesDate && date ? `${link.href}?date=${date}` : link.href;
              return (
                <Link
                  key={link.href}
                  href={href}
                  className={`text-sm font-medium ${
                    isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
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
