import Link from "next/link";
import { NAV_SPORT_META, sportHref } from "@/lib/sports";
import type { SportNavItem } from "@/lib/queries/sportNav";

function timeLabel(startUtc: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(startUtc);
}

function dateLabel(startUtc: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(startUtc);
}

/**
 * A sport category tile — accent-tinted icon, today's game count, and the next
 * start time. Shared by the Home launcher grid and the /sports lobby.
 */
export function SportCard({ sport, count, nextStartUtc, date }: SportNavItem & { date: string }) {
  const meta = NAV_SPORT_META[sport];
  const live = count > 0;

  return (
    <Link
      href={sportHref(sport, date)}
      className={`group flex min-h-[112px] flex-col justify-between rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/50 ${
        live ? "" : "opacity-60"
      }`}
    >
      <div className="flex items-start justify-between">
        <span
          className="grid size-11 place-items-center rounded-xl text-xl"
          style={{ backgroundColor: `${meta.accent}1f`, boxShadow: `inset 0 0 0 1px ${meta.accent}33` }}
        >
          {meta.icon}
        </span>
        <span className="font-mono text-sm font-bold tabular-nums text-foreground">{count}</span>
      </div>
      <div>
        <div className="font-semibold tracking-tight text-foreground">{meta.label}</div>
        <div className="text-xs text-muted-foreground">
          {live ? `${count} today · ${nextStartUtc ? timeLabel(nextStartUtc) : "scheduled"}` : null}
          {!live && nextStartUtc ? `Next · ${dateLabel(nextStartUtc)}` : null}
          {!live && !nextStartUtc ? "No games" : null}
        </div>
      </div>
    </Link>
  );
}
