import Link from "next/link";
import { shiftEtDate, todayEt } from "@/lib/dateEt";

function dayLabel(dateEt: string, today: string): { top: string; bottom: string } {
  const d = new Date(`${dateEt}T12:00:00Z`);
  const md = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
  if (dateEt === today) return { top: "Today", bottom: md };
  if (dateEt === shiftEtDate(today, 1)) return { top: "Tomorrow", bottom: md };
  return { top: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(d), bottom: md };
}

/** The days that have games, as a scrollable strip — the sportsbook way to browse ahead. */
export function DateStrip({ days, active, href }: { days: string[]; active: string; href: (dateEt: string) => string }) {
  if (days.length === 0) return null;
  const today = todayEt();
  return (
    <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
      <div className="flex gap-2">
        {days.map((d) => {
          const { top, bottom } = dayLabel(d, today);
          const isActive = d === active;
          return (
            <Link
              key={d}
              href={href(d)}
              scroll={false}
              aria-current={isActive ? "date" : undefined}
              className={`flex min-w-16 shrink-0 flex-col items-center rounded-xl px-3 py-1.5 transition-colors ${
                isActive ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="text-xs font-semibold">{top}</span>
              <span className={`text-[10px] ${isActive ? "opacity-70" : "opacity-80"}`}>{bottom}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
