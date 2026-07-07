"use client";

import { useMemo, useState } from "react";
import type { GameLineRow, GameSummary } from "@/lib/queries/games";
import type { TeamHitRates } from "@/lib/queries/hitRate";
import { americanToDecimal } from "@/lib/odds/americanOdds";
import { calculateEv } from "@/lib/odds/devig";
import { computeLineEconomics, historicalProbBySide, lineKey } from "@/lib/odds/lineEconomics";
import { SIDE_LABELS, formatHitRate } from "@/lib/odds/format";
import type { ExpectedRuns } from "@/lib/archer/expectedRuns";
import { archerProbForRow } from "@/lib/archer/runProbability";
import { MarketTabs } from "./MarketTabs";
import { TeamBadge } from "./TeamBadge";
import { PointFilterSelect, MAIN_LINE, ALL_ALT_LINES, type PointFilter } from "./PointFilterSelect";
import { LinesLadder, type LinesLadderAltGroup } from "./LinesLadder";

const SIDE_TEAM_ABBR: Record<string, (g: GameSummary) => string | null> = {
  home: (g) => g.homeTeam.abbreviation,
  away: (g) => g.awayTeam.abbreviation,
  over: () => null,
  under: () => null,
};

/** Hit-rate caption for a given market tab + side, given both teams' precomputed rates. */
function hitRateCaption(
  market: GameLineRow["marketType"],
  side: string,
  homeHitRates: TeamHitRates,
  awayHitRates: TeamHitRates,
  game: GameSummary
): string {
  if (market === "h2h") {
    return side === "home" ? formatHitRate(homeHitRates.h2h) : formatHitRate(awayHitRates.h2h);
  }
  if (market === "spreads") {
    return side === "home" ? formatHitRate(homeHitRates.spreads) : formatHitRate(awayHitRates.spreads);
  }
  // totals: over/under isn't team-specific, so show both teams' rates for this side.
  const homeRate = side === "over" ? homeHitRates.totalsOver : homeHitRates.totalsUnder;
  const awayRate = side === "over" ? awayHitRates.totalsOver : awayHitRates.totalsUnder;
  return `${game.homeTeam.abbreviation} ${formatHitRate(homeRate)} · ${game.awayTeam.abbreviation} ${formatHitRate(awayRate)}`;
}

interface GameLinesViewProps {
  game: GameSummary;
  lines: GameLineRow[];
  homeHitRates: TeamHitRates;
  awayHitRates: TeamHitRates;
  /** Archer model's home/away win probability (see winProbability.ts) — used for the moneyline market. */
  archerWinProb: { home: number | null; away: number | null } | null;
  /** Archer model's expected runs for each team (see expectedRuns.ts) — used for the spreads/totals markets. */
  archerRuns: ExpectedRuns | null;
}

export function GameLinesView({
  game,
  lines,
  homeHitRates,
  awayHitRates,
  archerWinProb,
  archerRuns,
}: GameLinesViewProps) {
  const [market, setMarket] = useState<GameLineRow["marketType"]>("h2h");
  const [pointFilter, setPointFilter] = useState<PointFilter>(MAIN_LINE);
  const marketLines = useMemo(() => lines.filter((l) => l.marketType === market), [lines, market]);
  const altLines = useMemo(() => marketLines.filter((l) => l.isAlternate), [marketLines]);

  // Every point on offer for this market — lets you jump straight to a
  // specific alt line instead of scrolling the ladder below. h2h has none
  // (its point is always null), so the dropdown just won't render for it.
  const pointOptions = useMemo(() => {
    const points = new Set<number>();
    for (const line of marketLines) {
      if (line.point !== null) points.add(line.point);
    }
    return [...points].sort((a, b) => a - b);
  }, [marketLines]);

  // The slider/BEST-badge/list below compares prices within whatever's
  // picked from the dropdown: the main line by default, one exact alt point,
  // or every alt point pooled together (a -1.5 price isn't the same bet as a
  // -2.5 price, but each row still shows its own point so nothing's hidden).
  const focusLines = useMemo(
    () =>
      pointFilter === MAIN_LINE
        ? marketLines.filter((l) => !l.isAlternate)
        : pointFilter === ALL_ALT_LINES
          ? marketLines.filter((l) => l.isAlternate)
          : marketLines.filter((l) => l.point === pointFilter),
    [marketLines, pointFilter]
  );

  const economics = useMemo(
    () =>
      computeLineEconomics({
        marketType: market,
        lines: marketLines,
        historicalProbBySide: historicalProbBySide(market, homeHitRates, awayHitRates),
      }),
    [market, marketLines, homeHitRates, awayHitRates]
  );

  /** EV of one line against the Archer model's probability for that side — win probability for h2h, expected-runs-derived cover probability for spreads/totals. Null if the model has no input data yet. */
  function archerEvForSide(side: string, point: number | null, priceAmerican: number): number | null {
    const prob = archerProbForRow(market, side, point, archerWinProb, archerRuns);
    return prob !== null ? calculateEv(prob, priceAmerican) : null;
  }

  // Best-priced main-line point per side, used only to order alt points by
  // proximity below — mirrors focusLines' own side-grouping/sort so it lines
  // up with whatever LinesLadder computes internally from the same rows.
  const mainPointBySide = useMemo(() => {
    const bySide = new Map<string, GameLineRow[]>();
    for (const line of focusLines) {
      const list = bySide.get(line.side) ?? [];
      list.push(line);
      bySide.set(line.side, list);
    }
    const result = new Map<string, number | null>();
    for (const [side, list] of bySide) {
      const best = [...list].sort(
        (a, b) => americanToDecimal(b.priceAmerican) - americanToDecimal(a.priceAmerican)
      )[0];
      result.set(side, best?.point ?? null);
    }
    return result;
  }, [focusLines]);

  /** Alt points per side, ordered by proximity to that side's main point; each point's rows sorted by EV. */
  const altSectionsBySide = useMemo(() => {
    const byPointBySide = new Map<string, Map<number | null, GameLineRow[]>>();
    for (const line of altLines) {
      const byPoint = byPointBySide.get(line.side) ?? new Map<number | null, GameLineRow[]>();
      const rows = byPoint.get(line.point) ?? [];
      rows.push(line);
      byPoint.set(line.point, rows);
      byPointBySide.set(line.side, byPoint);
    }

    const result = new Map<string, LinesLadderAltGroup[]>();
    for (const [side, byPoint] of byPointBySide) {
      const mainPoint = mainPointBySide.get(side) ?? null;
      const groups = [...byPoint.entries()]
        .sort(([a], [b]) => {
          if (a === null || b === null || mainPoint === null) return (a ?? 0) - (b ?? 0);
          return Math.abs(a - mainPoint) - Math.abs(b - mainPoint);
        })
        .map(([point, rows]) => ({
          point,
          rows: [...rows].sort(
            (a, b) =>
              (economics.get(lineKey(b.bookKey, b.side, b.point))?.marketEv ?? -Infinity) -
              (economics.get(lineKey(a.bookKey, a.side, a.point))?.marketEv ?? -Infinity)
          ),
        }));
      result.set(side, groups);
    }
    return result;
  }, [altLines, mainPointBySide, economics]);

  return (
    <div>
      <MarketTabs
        market={market}
        onChange={(m) => {
          setMarket(m);
          setPointFilter(MAIN_LINE);
        }}
      />

      {pointOptions.length > 0 && (
        <div className="mt-4">
          <PointFilterSelect
            pointOptions={pointOptions}
            value={pointFilter}
            market={market}
            onChange={setPointFilter}
          />
        </div>
      )}

      <LinesLadder
        // Remount (and so reset the internal price-range slider) whenever
        // the market tab or point filter changes — otherwise a range picked
        // against one market/point's domain would silently carry over and
        // clamp oddly against the next one's.
        key={`${market}-${String(pointFilter)}`}
        rows={focusLines}
        sideHeader={(side) => {
          const teamAbbr = SIDE_TEAM_ABBR[side]?.(game) ?? null;
          const label = SIDE_LABELS[side]?.(game) ?? side;
          return {
            badge: teamAbbr ? <TeamBadge abbreviation={teamAbbr} name={label} /> : null,
            label,
            caption: hitRateCaption(market, side, homeHitRates, awayHitRates, game),
          };
        }}
        evColumns={[
          {
            label: "Mkt EV",
            valueFor: (row) => economics.get(lineKey(row.bookKey, row.side, row.point))?.marketEv ?? null,
          },
          {
            label: "Hist EV",
            valueFor: (row) => economics.get(lineKey(row.bookKey, row.side, row.point))?.historicalEv ?? null,
          },
          {
            label: "Archer EV",
            valueFor: (row) => archerEvForSide(row.side, row.point, row.priceAmerican),
          },
        ]}
        altSections={pointFilter === MAIN_LINE ? altSectionsBySide : undefined}
        emptyMessage="No odds polled for this market yet."
        disclaimer={
          <>
            Mkt EV = vs. de-vigged market consensus. Hist EV = vs. rolling hit-rate — a noisier,
            directional estimate only (small sample, no opponent/park/pitcher adjustment).
            {market === "h2h"
              ? " Archer EV = vs. the Archer model's pitcher+form win probability (see Matchup panel above)."
              : " Archer EV = vs. the Archer model's expected-runs projection (recent runs scored/allowed + starting pitcher ERA)."}
          </>
        }
      />
    </div>
  );
}
