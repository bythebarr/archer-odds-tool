"use client";

import { formatAmerican } from "@/lib/odds/americanOdds";
import type { AltLineRow } from "@/lib/nba/propsMath";
import type { PropDirection, PropHitRateResult } from "@/lib/props/tally";
import { SheetSection } from "@/components/props/kit";
import { formatRate, rateTone } from "./HitMeter";

function Rate({ rate }: { rate: PropHitRateResult }) {
  return (
    <span className="text-right">
      <span className={`font-mono text-xs font-semibold ${rateTone(rate)}`}>{formatRate(rate)}</span>
      {rate.sampleSize > 0 && <span className="block font-mono text-[9px] text-muted-foreground">{rate.hits}/{rate.sampleSize}</span>}
    </span>
  );
}

/**
 * The prop read up and down the ladder: at each line, ARCHR's chance and the
 * hit rates for the chosen side, so you can see where the projection and the
 * history agree before picking a number. Tap a row to read the whole sheet at it.
 */
export function AltLinesTable({
  rows,
  point,
  main,
  side,
  projection,
  statShort,
  onPoint,
}: {
  rows: AltLineRow[];
  point: number;
  /** The main line (the books' consensus, or ARCHR's own before they post). */
  main: number;
  side: PropDirection;
  projection: number | null;
  statShort: string;
  onPoint: (p: number) => void;
}) {
  const cols = "grid-cols-[3.25rem_3.25rem_repeat(4,minmax(0,1fr))_3.5rem]";
  return (
    <SheetSection
      title={`Alt lines · ${side === "over" ? "Over" : "Under"}`}
      aside={projection !== null ? <span className="text-[11px] text-muted-foreground">proj <span className="font-mono font-semibold text-foreground">{projection.toFixed(1)}</span> {statShort}</span> : null}
    >
      <div className="overflow-hidden rounded-xl border border-border">
        <div className={`grid ${cols} gap-1 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground`}>
          <span>Line</span>
          <span className="text-right">ARCHR</span>
          <span className="text-right">L5</span>
          <span className="text-right">L10</span>
          <span className="text-right">This szn</span>
          <span className="text-right">Last szn</span>
          <span className="text-right">Best</span>
        </div>
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((r) => (
            <li key={r.point}>
              <button
                type="button"
                onClick={() => onPoint(r.point)}
                className={`grid w-full ${cols} items-center gap-1 px-3 py-1.5 text-left transition-colors hover:bg-muted/60 ${r.point === point ? "bg-primary/10" : ""}`}
              >
                <span className="font-mono text-xs font-semibold text-foreground">
                  {r.point}
                  {r.point === main && <span className="ml-1 font-sans text-[8px] font-medium text-muted-foreground">MAIN</span>}
                </span>
                <span className="text-right font-mono text-xs font-semibold text-foreground">{r.modelProb === null ? "—" : `${Math.round(r.modelProb * 100)}%`}</span>
                <Rate rate={r.l5} />
                <Rate rate={r.l10} />
                <Rate rate={r.season} />
                <Rate rate={r.lastSeason} />
                <span className="text-right font-mono text-xs text-muted-foreground">{r.best ? formatAmerican(r.best.priceAmerican) : r.posted ? "—" : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        ARCHR = the model&apos;s chance the {side === "over" ? "Over" : "Under"} cashes at that line · hit rate with hits/games · Best = top book price where one is posted
      </p>
    </SheetSection>
  );
}
