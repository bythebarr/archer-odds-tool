"use client";

import { formatAmerican } from "@/lib/odds/americanOdds";
import type { AltLineRow } from "@/lib/props/altLines";
import type { PropHitRateResult } from "@/lib/props/tally";
import { SheetSection } from "./kit";
import { formatRate, rateTone } from "@/components/nba/HitMeter";

function Rate({ rate }: { rate: PropHitRateResult }) {
  return (
    <span className="text-right">
      <span className={`font-mono text-xs font-semibold ${rateTone(rate)}`}>{formatRate(rate)}</span>
      {rate.sampleSize > 0 && <span className="block font-mono text-[9px] text-muted-foreground">{rate.hits}/{rate.sampleSize}</span>}
    </span>
  );
}

/**
 * A prop read up and down the ladder: at each line, ARCHR's chance and the hit
 * rates for the chosen side, so you can see where the projection and the
 * history agree before picking a number. Tap a row to read the whole sheet at it.
 */
export function AltLinesTable({
  rows,
  columns,
  point,
  main,
  sideLabel,
  projection,
  statShort,
  onPoint,
}: {
  rows: AltLineRow[];
  /** Header for each entry of `row.rates`, in order. */
  columns: readonly string[];
  point: number;
  /** The main line (the books' consensus, or ARCHR's own before they post). */
  main: number;
  sideLabel: string;
  projection: string | null;
  statShort: string;
  onPoint: (p: number) => void;
}) {
  const cols = { gridTemplateColumns: `3.5rem 3.25rem repeat(${columns.length}, minmax(0, 1fr)) 3.5rem` };
  return (
    <SheetSection
      title={`Alt lines · ${sideLabel}`}
      aside={projection !== null ? <span className="text-[11px] text-muted-foreground">proj <span className="font-mono font-semibold text-foreground">{projection}</span> {statShort}</span> : null}
    >
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="grid gap-1 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground" style={cols}>
          <span>Line</span>
          <span className="text-right">ARCHR</span>
          {columns.map((c) => (
            <span key={c} className="text-right">{c}</span>
          ))}
          <span className="text-right">Best</span>
        </div>
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((r) => (
            <li key={r.point}>
              <button
                type="button"
                onClick={() => onPoint(r.point)}
                className={`grid w-full items-center gap-1 px-3 py-1.5 text-left transition-colors hover:bg-muted/60 ${r.point === point ? "bg-primary/10" : ""}`}
                style={cols}
              >
                <span className="font-mono text-xs font-semibold text-foreground">
                  {r.point}
                  {r.point === main && <span className="ml-1 font-sans text-[8px] font-medium text-muted-foreground">MAIN</span>}
                </span>
                <span className="text-right font-mono text-xs font-semibold text-foreground">{r.modelProb === null ? "—" : `${Math.round(r.modelProb * 100)}%`}</span>
                {r.rates.map((rate, i) => (
                  <Rate key={columns[i]} rate={rate} />
                ))}
                <span className="text-right font-mono text-xs text-muted-foreground">{r.best ? formatAmerican(r.best.priceAmerican) : r.posted ? "—" : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        ARCHR = the model&apos;s chance the {sideLabel} cashes at that line · hit rate with hits/games · Best = top book price where one is posted
      </p>
    </SheetSection>
  );
}
