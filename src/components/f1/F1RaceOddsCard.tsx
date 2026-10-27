import Link from "next/link";
import type { F1RaceModelView } from "@/lib/queries/f1RaceModel";
import { fairAmerican } from "@/lib/f1/raceModel";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { F1Avatar } from "./F1Avatar";

const pct = (x: number) => (x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);

/**
 * ARCHR's simulated odds for the next Grand Prix: each driver's chance to
 * win, podium and score, the fair price on the win, and his odds of beating
 * his teammate — what a book's F1 board should be measured against.
 */
export function F1RaceOddsCard({ view }: { view: F1RaceModelView }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 flex items-center gap-2 font-display text-sm font-extrabold uppercase italic tracking-wide text-foreground">
        <span className="brand-slash" aria-hidden />
        ARCHR race odds · {view.race.raceName}
      </h2>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-[minmax(0,1fr)_3rem_3rem_3rem_4rem] gap-1 border-b border-border bg-muted/40 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Driver</span>
          <span className="text-right">Win</span>
          <span className="text-right">Podium</span>
          <span className="text-right">Points</span>
          <span className="text-right">Fair win</span>
        </div>
        <ul className="divide-y divide-border">
          {view.rows.map((r) => (
            <li key={r.driverId} className="grid grid-cols-[minmax(0,1fr)_3rem_3rem_3rem_4rem] items-center gap-1 px-3 py-2 text-xs">
              <Link href={`/f1/driver/${r.ergastDriverId}`} className="flex min-w-0 items-center gap-2 hover:underline">
                <F1Avatar kind="driver" name={r.name} flag={r.flag} size={30} />
                <span className="min-w-0">
                <span className="block truncate font-semibold text-foreground">{r.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {r.constructorName}
                  {r.beatsTeammate !== null ? ` · beats teammate ${pct(r.beatsTeammate)}` : ""} · DNF {pct(r.dnf)}
                </span>
                </span>
              </Link>
              <span className="text-right font-mono font-semibold text-foreground">{pct(r.win)}</span>
              <span className="text-right font-mono text-foreground">{pct(r.podium)}</span>
              <span className="text-right font-mono text-muted-foreground">{pct(r.points)}</span>
              <span className="text-right font-mono text-muted-foreground">{r.win >= 0.001 ? formatAmerican(fairAmerican(r.win)) : "—"}</span>
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-3 py-2.5 text-[10px] leading-relaxed text-muted-foreground">
          Car and driver pace ratings learned from {view.racesReplayed} races (the car resets harder each season), each team&apos;s
          reliability and each driver&apos;s incident rate, simulated 20,000 times. Lineup from the latest race; before qualifying, so the grid
          isn&apos;t in it yet. {view.fitted ? "Learning rates fitted on history." : "Default learning rates until the backtest fits them."}{" "}
          <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
            How accurate is it?
          </Link>
        </p>
      </div>
    </section>
  );
}
