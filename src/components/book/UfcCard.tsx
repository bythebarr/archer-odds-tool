import Link from "next/link";
import type { UfcEventSummary, UfcBoutCorner } from "@/lib/queries/ufcEvents";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { FighterBadge } from "@/components/FighterBadge";

function Corner({ corner, align }: { corner: UfcBoutCorner; align: "left" | "right" }) {
  return (
    <div className={`flex min-w-0 items-center gap-2 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
      <FighterBadge name={corner.name} imageUrl={corner.imageUrl} size={34} />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold leading-tight text-foreground">{corner.name}</p>
        <p className="text-[11px] text-muted-foreground">{corner.record ?? ""}</p>
      </div>
    </div>
  );
}

function Price({ value }: { value: number | null }) {
  return (
    <span className={`flex h-9 w-16 shrink-0 items-center justify-center rounded-lg font-mono text-[13px] font-semibold ${value === null ? "bg-muted/50 text-muted-foreground/60" : "bg-muted text-foreground"}`}>
      {value === null ? "—" : formatAmerican(value)}
    </span>
  );
}

/** A fight card as sportsbook rows: each bout, both fighters, their best moneylines. */
export function UfcCard({ event, limit }: { event: UfcEventSummary; limit?: number }) {
  const date = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    event.eventDate
  );
  const bouts = limit ? event.bouts.slice(0, limit) : event.bouts;
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-3 py-2.5">
        <p className="truncate text-sm font-bold text-foreground">{event.title}</p>
        <p className="text-[11px] text-muted-foreground">
          {date}
          {event.location ? ` · ${event.location}` : ""}
        </p>
      </div>
      <ul className="divide-y divide-border">
        {bouts.map((b) => (
          <li key={b.id}>
            <Link href={`/ufc/${b.id}`} className="block px-3 py-2.5 hover:bg-muted/40">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {b.isMainEvent ? "Main event · " : ""}
                {b.weightClass}
              </p>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Corner corner={b.red} align="left" />
                </div>
                <Price value={b.red.moneyline} />
                <Price value={b.blue.moneyline} />
                <div className="min-w-0 flex-1">
                  <Corner corner={b.blue} align="right" />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
