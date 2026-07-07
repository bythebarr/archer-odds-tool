"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { GameLineRow, GameSummary, GameWithLines } from "@/lib/queries/games";
import { americanToDecimal, formatAmerican } from "@/lib/odds/americanOdds";
import { formatPoint } from "@/lib/odds/format";
import { MarketTabs } from "./MarketTabs";
import { TeamBadge } from "./TeamBadge";

const SIDE_ABBR: Record<string, (g: GameSummary) => string> = {
  home: (g) => g.homeTeam.abbreviation,
  away: (g) => g.awayTeam.abbreviation,
  over: () => "O",
  under: () => "U",
};

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(date);
}

/** Best (highest decimal-odds) main-line price per side for a game's given market. */
function bestPricePreview(game: GameSummary, lines: GameLineRow[], market: GameLineRow["marketType"]): string | null {
  // isAlternate filter is required, not cosmetic: without it, a deep alt
  // line's price could outrank the real main line here and be shown as if
  // it were the best available price on the main bet.
  const marketLines = lines.filter((l) => l.marketType === market && !l.isAlternate);
  if (marketLines.length === 0) return null;

  const bestBySide = new Map<string, GameLineRow>();
  for (const line of marketLines) {
    const current = bestBySide.get(line.side);
    if (!current || americanToDecimal(line.priceAmerican) > americanToDecimal(current.priceAmerican)) {
      bestBySide.set(line.side, line);
    }
  }

  const order = market === "totals" ? ["over", "under"] : ["away", "home"];
  const parts = order
    .map((side) => bestBySide.get(side))
    .filter((line): line is GameLineRow => line !== undefined)
    .map((line) => `${SIDE_ABBR[line.side]?.(game) ?? line.side}${formatPoint(line.point, market)} ${formatAmerican(line.priceAmerican)}`);

  return parts.length > 0 ? parts.join("  ·  ") : null;
}

interface HomeGamesListProps {
  gamesWithLines: GameWithLines[];
}

export function HomeGamesList({ gamesWithLines }: HomeGamesListProps) {
  const [market, setMarket] = useState<GameLineRow["marketType"]>("h2h");

  const previews = useMemo(
    () =>
      new Map(
        gamesWithLines.map(({ game, lines }) => [game.id, bestPricePreview(game, lines, market)])
      ),
    [gamesWithLines, market]
  );

  return (
    <div>
      <MarketTabs market={market} onChange={setMarket} />

      <ul className="divide-y divide-border">
        {gamesWithLines.length === 0 && (
          <li className="py-6 text-center text-sm text-muted-foreground">
            No games scheduled for this date.
          </li>
        )}
        {gamesWithLines.map(({ game: g }) => (
          <li key={g.id}>
            <Link href={`/games/${g.id}`} className="block py-4 hover:bg-accent/50">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    <TeamBadge abbreviation={g.awayTeam.abbreviation} name={g.awayTeam.name} />
                    {g.awayTeam.abbreviation} @ {g.homeTeam.abbreviation}
                    <TeamBadge abbreviation={g.homeTeam.abbreviation} name={g.homeTeam.name} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {g.awayTeam.name} at {g.homeTeam.name}
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-sm text-foreground">{formatTime(g.scheduledStartUtc)} ET</span>
                  <span className="text-xs uppercase text-muted-foreground">
                    {g.status}
                    {g.status !== "scheduled" && g.homeScore !== null && g.awayScore !== null
                      ? ` · ${g.awayScore}-${g.homeScore}`
                      : ""}
                  </span>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {previews.get(g.id) ?? "No odds polled yet"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
