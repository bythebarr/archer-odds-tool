"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { GameLineRow, GameSummary, GameWithLines } from "@/lib/queries/games";
import { americanToDecimal, formatAmerican } from "@/lib/odds/americanOdds";
import { formatPoint } from "@/lib/odds/format";

const MARKET_TABS: { key: GameLineRow["marketType"]; label: string }[] = [
  { key: "h2h", label: "Moneyline" },
  { key: "spreads", label: "Spread" },
  { key: "totals", label: "Total" },
];

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

/** Best (highest decimal-odds) price per side for a game's given market, ignoring point differences across books. */
function bestPricePreview(game: GameSummary, lines: GameLineRow[], market: GameLineRow["marketType"]): string | null {
  const marketLines = lines.filter((l) => l.marketType === market);
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
    .map((line) => `${SIDE_ABBR[line.side]?.(game) ?? line.side}${formatPoint(line.point)} ${formatAmerican(line.priceAmerican)}`);

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
      <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
        {MARKET_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setMarket(tab.key)}
            className={`px-3 py-2 text-sm font-medium ${
              market === tab.key
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {gamesWithLines.length === 0 && (
          <li className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No games scheduled for this date.
          </li>
        )}
        {gamesWithLines.map(({ game: g }) => (
          <li key={g.id}>
            <Link
              href={`/games/${g.id}`}
              className="block py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {g.awayTeam.abbreviation} @ {g.homeTeam.abbreviation}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {g.awayTeam.name} at {g.homeTeam.name}
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-sm text-zinc-900 dark:text-zinc-50">
                    {formatTime(g.scheduledStartUtc)} ET
                  </span>
                  <span className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
                    {g.status}
                    {g.status !== "scheduled" && g.homeScore !== null && g.awayScore !== null
                      ? ` · ${g.awayScore}-${g.homeScore}`
                      : ""}
                  </span>
                </div>
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {previews.get(g.id) ?? "No odds polled yet"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
