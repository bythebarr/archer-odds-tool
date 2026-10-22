"use client";

import { useMemo, useState } from "react";
import type { MarketType } from "@/generated/prisma/client";
import type { NflGameSummary, NflTeamSummary } from "@/lib/queries/nflGames";
import type { GameLineRow } from "@/lib/queries/games";
import { MarketTabs } from "./MarketTabs";
import { TeamBadge } from "./TeamBadge";
import { LinesLadder } from "./LinesLadder";

const SIDE_TEAM: Record<string, (g: NflGameSummary) => NflTeamSummary | null> = {
  home: (g) => g.homeTeam,
  away: (g) => g.awayTeam,
  over: () => null,
  under: () => null,
};

/** Totals ladders read over-then-under; team markets read away-then-home, matching every other board. */
const SIDE_ORDER: Record<MarketType, string[]> = {
  h2h: ["away", "home"],
  spreads: ["away", "home"],
  totals: ["over", "under"],
};

interface NflGameLinesViewProps {
  game: NflGameSummary;
  lines: GameLineRow[];
}

/**
 * NFL's line-shopping view: price comparison across books for one game, on the
 * shared Moneyline/Spread/Total tabs.
 *
 * No EV column, deliberately — and for a different reason than soccer's (whose
 * 3-way market breaks the 2-way de-vig math). NFL's de-vig would compute fine;
 * what's missing is any evidence a number derived from it should be acted on.
 * Per docs/architecture/calibration.md, model EV that hasn't beaten a closing
 * line in a CLV backtest gets shown as signal at most, and NFL's hasn't been run
 * on live prices. Line shopping needs no such proof — the best price IS the best
 * price — so that's what ships first. See docs/architecture/nfl-adapter.md.
 */
export function NflGameLinesView({ game, lines }: NflGameLinesViewProps) {
  const [market, setMarket] = useState<MarketType>("spreads");

  // Alt lines are excluded: NFL's ingest doesn't request the alternate ladders
  // (MLB-only today), so this is belt-and-braces against a row arriving from a
  // provider that volunteers them.
  const rows = useMemo(
    () => lines.filter((l) => l.marketType === market && !l.isAlternate),
    [lines, market]
  );

  return (
    <>
      <MarketTabs market={market} onChange={setMarket} />
      <LinesLadder
        rows={rows}
        sideOrder={SIDE_ORDER[market]}
        slipContext={{
          sport: "nfl",
          matchId: game.id,
          matchLabel: `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`,
        }}
        sideHeader={(side) => {
          const team = SIDE_TEAM[side]?.(game) ?? null;
          if (!team) return { badge: null, label: side === "over" ? "Over" : "Under" };
          return {
            badge: <TeamBadge abbreviation={team.abbreviation} name={team.name} size={20} />,
            label: team.name,
          };
        }}
        emptyMessage="No odds polled for this game yet."
        disclaimer="Line-shopping only — the best available price per side across books. No model EV for NFL: the Elo model hasn't been shown to beat a closing line, so it prices nothing here."
      />
    </>
  );
}
