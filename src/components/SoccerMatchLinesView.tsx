"use client";

import { useMemo, useState } from "react";
import type { SoccerMatchSummary, SoccerTeamSummary } from "@/lib/queries/soccerMatches";
import type { GameLineRow } from "@/lib/queries/games";
import { americanToDecimal, formatAmerican } from "@/lib/odds/americanOdds";
import { lineKey } from "@/lib/odds/lineEconomics";
import { PriceRangeSlider } from "./PriceRangeSlider";
import { BookBadge } from "./BookBadge";
import { TeamBadge } from "./TeamBadge";

const SIDE_TEAM: Record<string, (m: SoccerMatchSummary) => SoccerTeamSummary> = {
  home: (m) => m.homeTeam,
  away: (m) => m.awayTeam,
};

const SIDE_ORDER = ["away", "draw", "home"];

interface SoccerMatchLinesViewProps {
  match: SoccerMatchSummary;
  lines: GameLineRow[];
}

/**
 * World Cup v1's line-shopping view: raw price-shopping only, no Mkt EV.
 * Soccer's h2h is a 3-way market (home/draw/away) but devig.ts's
 * consensusFairProbability only normalizes two implied probabilities —
 * running it against a 3-way market's home/away prices alone would silently
 * produce inflated (wrong) fair probabilities, since it'd ignore the draw's
 * share of the vig. Rather than extend the shared 2-way devig math (used
 * unchanged by MLB/tennis) to N-way under time pressure, this view just
 * skips EV for soccer entirely until that's done properly. See
 * lineEconomics.ts / devig.ts.
 */
export function SoccerMatchLinesView({ match, lines }: SoccerMatchLinesViewProps) {
  const sides = useMemo(() => {
    const bySide = new Map<string, GameLineRow[]>();
    for (const line of lines) {
      const rows = bySide.get(line.side) ?? [];
      rows.push(line);
      bySide.set(line.side, rows);
    }
    for (const rows of bySide.values()) {
      rows.sort((a, b) => americanToDecimal(b.priceAmerican) - americanToDecimal(a.priceAmerican));
    }
    return bySide;
  }, [lines]);

  const domain = useMemo(() => {
    if (lines.length === 0) return null;
    const decimals = lines.map((l) => americanToDecimal(l.priceAmerican));
    return { min: Math.min(...decimals), max: Math.max(...decimals) };
  }, [lines]);

  const [range, setRange] = useState<[number, number] | null>(null);
  const effectiveRange: [number, number] | null = range ?? (domain ? [domain.min, domain.max] : null);

  if (!domain || !effectiveRange) {
    return <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">No odds polled for this match yet.</p>;
  }

  return (
    <div>
      <div className="mt-2">
        <PriceRangeSlider min={domain.min} max={domain.max} value={effectiveRange} onChange={setRange} />
      </div>

      <p className="mt-4 text-xs text-zinc-400">
        Line-shopping only — moneyline (3-way: home/draw/away). No Market EV yet for soccer;
        the de-vig math is currently 2-way only and would misrepresent a draw-inclusive market.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {SIDE_ORDER.filter((side) => sides.has(side)).map((side) => {
          const rows = sides.get(side) ?? [];
          const inRange = rows.filter((r) => {
            const d = americanToDecimal(r.priceAmerican);
            return d >= effectiveRange[0] && d <= effectiveRange[1];
          });
          const bestKey = inRange[0] ? lineKey(inRange[0].bookKey, inRange[0].side, inRange[0].point) : null;
          const team = SIDE_TEAM[side]?.(match);

          return (
            <div key={side}>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {team && <TeamBadge abbreviation={team.abbreviation} name={team.name} size={20} />}
                {team?.name ?? "Draw"}
              </h3>
              <p className="mb-2 text-xs text-zinc-400">
                {inRange.length} of {rows.length} books in range
              </p>
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {inRange.length === 0 && (
                  <li className="py-3 text-sm text-zinc-400">No books in this range.</li>
                )}
                {inRange.map((row) => {
                  const key = lineKey(row.bookKey, row.side, row.point);
                  const isBest = key === bestKey;
                  return (
                    <li key={row.bookKey} className="py-2">
                      <div
                        className={`flex items-center justify-between ${
                          isBest
                            ? "font-semibold text-zinc-900 dark:text-zinc-50"
                            : "text-zinc-600 dark:text-zinc-400"
                        }`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <BookBadge bookKey={row.bookKey} bookName={row.bookName} size={16} />
                          {row.bookName}
                          {isBest && (
                            <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                              BEST
                            </span>
                          )}
                        </span>
                        <span>{formatAmerican(row.priceAmerican)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
