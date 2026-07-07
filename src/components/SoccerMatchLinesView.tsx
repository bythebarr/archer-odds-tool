"use client";

import type { SoccerMatchSummary, SoccerTeamSummary } from "@/lib/queries/soccerMatches";
import type { GameLineRow } from "@/lib/queries/games";
import { TeamBadge } from "./TeamBadge";
import { LinesLadder } from "./LinesLadder";

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
  return (
    <LinesLadder
      rows={lines}
      sideOrder={SIDE_ORDER}
      gridColsClassName="sm:grid-cols-3"
      slipContext={{
        sport: "soccer",
        matchId: match.id,
        matchLabel: `${match.awayTeam.abbreviation} @ ${match.homeTeam.abbreviation}`,
      }}
      sideHeader={(side) => {
        const team = SIDE_TEAM[side]?.(match);
        return {
          badge: team ? <TeamBadge abbreviation={team.abbreviation} name={team.name} size={20} /> : null,
          label: team?.name ?? "Draw",
        };
      }}
      emptyMessage="No odds polled for this match yet."
      disclaimer="Line-shopping only — moneyline (3-way: home/draw/away). No Market EV yet for soccer; the de-vig math is currently 2-way only and would misrepresent a draw-inclusive market."
    />
  );
}
