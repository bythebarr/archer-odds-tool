"use client";

import { useMemo, useState } from "react";
import type { MarketType } from "@/generated/prisma/client";
import type { TeamGameSummary, TeamSummary } from "@/lib/queries/teamLeagueGames";
import type { TeamLeagueSport } from "@/lib/teamLeague/league";
import type { GameLineRow } from "@/lib/queries/games";
import { MarketTabs } from "./MarketTabs";
import { TeamBadge } from "./TeamBadge";
import { LinesLadder } from "./LinesLadder";

const SIDE_TEAM: Record<string, (g: TeamGameSummary) => TeamSummary | null> = {
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

interface TeamGameLinesViewProps {
  sport: TeamLeagueSport;
  game: TeamGameSummary;
  lines: GameLineRow[];
  /** Footer under the ladder — each league states why it shows no model EV. */
  disclaimer: string;
}

/**
 * A team league's line-shopping view (NFL, NBA): price comparison across books
 * for one game, on the shared Moneyline/Spread/Total tabs, opening on the spread
 * because that's where both leagues' action is.
 *
 * No EV column, deliberately — and for a different reason than soccer's (whose
 * 3-way market breaks the 2-way de-vig math). The de-vig would compute fine;
 * what's missing is any evidence a number derived from it should be acted on.
 * Per docs/architecture/calibration.md, model EV that hasn't beaten a closing
 * line in a CLV backtest gets shown as signal at most. Line shopping needs no
 * such proof — the best price IS the best price — so that's what ships.
 */
export function TeamGameLinesView({ sport, game, lines, disclaimer }: TeamGameLinesViewProps) {
  const [market, setMarket] = useState<MarketType>("spreads");

  // Alt lines are excluded: the team-league ingest doesn't request the alternate ladders
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
          sport,
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
        disclaimer={disclaimer}
      />
    </>
  );
}
