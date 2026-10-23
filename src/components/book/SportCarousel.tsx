import Link from "next/link";
import { SPORT_METAS } from "@/lib/engine/sportsMeta";

/**
 * The sportsbook sport switcher: in-season sports first as round icon tiles,
 * then the parked sports, dimmed, so every sport is one tap from anywhere.
 */
export function SportCarousel({ active }: { active?: string }) {
  const sports = [...SPORT_METAS].sort((a, b) => Number(a.parked) - Number(b.parked));
  return (
    <nav aria-label="Sports" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
      <ul className="flex gap-4">
        {sports.map((s) => {
          const isActive = s.sport === active;
          return (
            <li key={s.sport} className="shrink-0">
              <Link href={s.href} aria-current={isActive ? "page" : undefined} className="group flex w-14 flex-col items-center gap-1">
                <span
                  className={`flex size-12 items-center justify-center rounded-full text-[22px] ring-1 transition-all ${
                    isActive
                      ? "bg-foreground/5 ring-2 ring-foreground"
                      : s.parked
                        ? "bg-muted/60 opacity-50 ring-border grayscale group-hover:opacity-80"
                        : "bg-card ring-border group-hover:ring-foreground/40"
                  }`}
                  aria-hidden
                >
                  {s.icon}
                </span>
                <span
                  className={`text-[11px] font-semibold ${
                    isActive ? "text-foreground" : s.parked ? "text-muted-foreground/60" : "text-muted-foreground"
                  }`}
                >
                  {s.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
