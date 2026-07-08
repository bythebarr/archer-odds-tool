"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { GameLineRow, GameSummary, GameWithLines } from "@/lib/queries/games";
import { americanToDecimal, formatAmerican } from "@/lib/odds/americanOdds";
import { formatPoint } from "@/lib/odds/format";
import { MarketTabs } from "./MarketTabs";
import { TeamBadge } from "./TeamBadge";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

interface PricePreviewChip {
  label: string;
  value: string;
}

/** Best (highest decimal-odds) main-line price per side for a game's given market, one chip per side. */
function bestPricePreview(game: GameSummary, lines: GameLineRow[], market: GameLineRow["marketType"]): PricePreviewChip[] {
  // isAlternate filter is required, not cosmetic: without it, a deep alt
  // line's price could outrank the real main line here and be shown as if
  // it were the best available price on the main bet.
  const marketLines = lines.filter((l) => l.marketType === market && !l.isAlternate);
  if (marketLines.length === 0) return [];

  const bestBySide = new Map<string, GameLineRow>();
  for (const line of marketLines) {
    const current = bestBySide.get(line.side);
    if (!current || americanToDecimal(line.priceAmerican) > americanToDecimal(current.priceAmerican)) {
      bestBySide.set(line.side, line);
    }
  }

  const order = market === "totals" ? ["over", "under"] : ["away", "home"];
  return order
    .map((side) => bestBySide.get(side))
    .filter((line): line is GameLineRow => line !== undefined)
    .map((line) => ({
      label: `${SIDE_ABBR[line.side]?.(game) ?? line.side}${formatPoint(line.point, market)}`,
      value: formatAmerican(line.priceAmerican),
    }));
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

      {gamesWithLines.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No games scheduled for this date.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {gamesWithLines.map(({ game: g }) => {
            const chips = previews.get(g.id) ?? [];
            const isLive = g.status === "live";
            return (
              <Link key={g.id} href={`/games/${g.id}`} className="block">
                <Card className="transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md hover:ring-primary/40">
                  <CardContent className="flex items-center justify-between gap-4">
                    <div className="flex flex-1 items-center gap-3">
                      <div className="flex flex-col items-center gap-1">
                        <TeamBadge abbreviation={g.awayTeam.abbreviation} name={g.awayTeam.name} mlbTeamId={g.awayTeam.mlbTeamId} size={36} />
                        <span className="text-xs font-semibold text-foreground">{g.awayTeam.abbreviation}</span>
                      </div>
                      <span className="text-xs font-medium text-muted-foreground">@</span>
                      <div className="flex flex-col items-center gap-1">
                        <TeamBadge abbreviation={g.homeTeam.abbreviation} name={g.homeTeam.name} mlbTeamId={g.homeTeam.mlbTeamId} size={36} />
                        <span className="text-xs font-semibold text-foreground">{g.homeTeam.abbreviation}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-sm font-medium text-foreground">{formatTime(g.scheduledStartUtc)} ET</span>
                      {isLive ? (
                        <Badge className="border-transparent bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                          <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-red-500" />
                          LIVE
                          {g.homeScore !== null && g.awayScore !== null ? ` ${g.awayScore}-${g.homeScore}` : ""}
                        </Badge>
                      ) : (
                        <span className="text-xs uppercase text-muted-foreground">
                          {g.status}
                          {g.status !== "scheduled" && g.homeScore !== null && g.awayScore !== null
                            ? ` · ${g.awayScore}-${g.homeScore}`
                            : ""}
                        </span>
                      )}
                    </div>
                  </CardContent>
                  <CardFooter className="flex-wrap gap-2 bg-transparent border-t-0 p-0 px-(--card-spacing) pb-(--card-spacing)">
                    {chips.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No odds polled yet</span>
                    ) : (
                      chips.map((chip) => (
                        <Badge key={chip.label} variant="outline" className="font-mono">
                          {chip.label} {chip.value}
                        </Badge>
                      ))
                    )}
                  </CardFooter>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
