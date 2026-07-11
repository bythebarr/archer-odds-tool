"use client";

import { useMemo } from "react";
import type { MatchSummary, PlayerSummary } from "@/lib/queries/tennisMatches";
import type { GameLineRow } from "@/lib/queries/games";
import type { HitRateResult } from "@/lib/queries/hitRate";
import { calculateEv } from "@/lib/odds/devig";
import { h2hMarketConsensus } from "@/lib/odds/lineEconomics";
import { formatHitRate } from "@/lib/odds/format";
import { TennisPlayerBadge } from "./TennisPlayerBadge";
import { LinesLadder } from "./LinesLadder";

const SIDE_PLAYER: Record<string, (m: MatchSummary) => PlayerSummary> = {
  home: (m) => m.homePlayer,
  away: (m) => m.awayPlayer,
};

interface MatchLinesViewProps {
  match: MatchSummary;
  lines: GameLineRow[];
  homeHitRate: HitRateResult;
  awayHitRate: HitRateResult;
}

/**
 * Tennis v1's line-shopping view: moneyline-only, no MarketTabs (nothing to
 * tab between yet), no historical/Archer EV (no data source — see the
 * tennis plan doc's non-goals). Reuses h2hMarketConsensus/calculateEv
 * unchanged from the MLB build since both are fully sport-agnostic.
 */
export function MatchLinesView({ match, lines, homeHitRate, awayHitRate }: MatchLinesViewProps) {
  const consensus = useMemo(() => h2hMarketConsensus(lines), [lines]);

  function marketEvFor(row: GameLineRow): number | null {
    const prob =
      row.side === "home" ? consensus.fairProbA : row.side === "away" ? consensus.fairProbB : null;
    return prob !== null ? calculateEv(prob, row.priceAmerican) : null;
  }

  return (
    <LinesLadder
      rows={lines}
      slipContext={{
        sport: "tennis",
        matchId: match.id,
        matchLabel: `${match.awayPlayer.name} vs. ${match.homePlayer.name}`,
      }}
      sideHeader={(side) => {
        const player = SIDE_PLAYER[side]?.(match);
        return {
          badge: player ? <TennisPlayerBadge name={player.name} /> : null,
          label: player?.name ?? side,
          caption:
            side === "home"
              ? formatHitRate(homeHitRate)
              : side === "away"
                ? formatHitRate(awayHitRate)
                : undefined,
        };
      }}
      evColumns={[{ label: "Mkt EV", valueFor: marketEvFor }]}
      emptyMessage="No odds polled for this match yet."
      disclaimer="Mkt EV = vs. de-vigged market consensus. Tennis v1 is moneyline-only — no historical hit-rate or ARCHR Edge model yet."
    />
  );
}
