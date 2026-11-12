/**
 * Every leg the parlay finder can use in one NBA game: each line a bettable
 * book hangs (main lines and every alt rung), at its best price, with the
 * player's game-by-game values for the stat and ARCHR's chance at that number.
 * Players listed out or doubtful are left off.
 */
import { bestBettableLine } from "@/lib/odds/bestPrice";
import { NBA_PROP_STAT_BY_KEY } from "./propStats";
import { summarizeProp, type GameLogPoint, type PropContext } from "./propsMath";
import type { WireNbaPropsSlate } from "@/lib/queries/nbaProps";
import { nbaProjectionContext, nbaTonightRole } from "./slateContext";
import type { FinderLeg } from "@/lib/props/parlayFinder";
import type { PropDirection } from "@/lib/props/tally";
import type { TonightRole } from "@/lib/propModel/cautiousRead";

export interface NbaLegOptions {
  /** Skip legs priced shorter than this (e.g. −500), so near-certain rungs don't pad the count. */
  shortestPrice: number;
}

export function nbaFinderLegs(slate: WireNbaPropsSlate, logs: Record<string, GameLogPoint[]>, gameId: string, opts: NbaLegOptions): FinderLeg[] {
  const out: FinderLeg[] = [];
  const roles = new Map<string, TonightRole | null>();
  for (const prop of slate.props) {
    const player = slate.players[prop.playerId];
    const statDef = NBA_PROP_STAT_BY_KEY.get(prop.stat);
    if (!player || player.gameId !== gameId || !statDef || !prop.quotes.length) continue;
    if (player.injury?.level === "out" || player.injury?.level === "doubtful") continue;
    const playerLogs = logs[prop.playerId] ?? [];
    const legLogs = playerLogs.map((l) => ({
      date: l.date,
      opponent: l.opponent,
      isHome: l.isHome,
      season: l.season,
      team: l.team,
      value: statDef.value(l),
      minutes: l.minutes,
      ...(l.starter === undefined ? {} : { starter: l.starter }),
    }));
    if (!roles.has(prop.playerId)) roles.set(prop.playerId, nbaTonightRole(slate, player, playerLogs));
    const tonight = roles.get(prop.playerId)!;
    const context: PropContext = {
      season: slate.season,
      venue: player.venue,
      opponent: player.opponent?.abbreviation,
      projection: nbaProjectionContext(slate, player),
      injury: player.injury?.level ?? null,
      modelWeight: slate.modelWeights[prop.stat],
      calibrationFactor: slate.calibrationFactors?.[prop.stat],
    };
    for (const side of ["over", "under"] as PropDirection[]) {
      const quotes = prop.quotes.filter((q) => q.side === side);
      for (const point of [...new Set(quotes.map((q) => q.point))]) {
        const best = bestBettableLine(quotes, point);
        if (!best || best.priceAmerican < opts.shortestPrice) continue;
        const summary = summarizeProp(prop, playerLogs, statDef, side, context, point);
        const model = summary?.model ? (side === "over" ? summary.model.probOver : summary.model.probUnder) : null;
        const mk = summary?.model?.market ?? null;
        out.push({
          key: `${prop.playerId}:${prop.stat}:${side}:${point}`,
          group: `${prop.playerId}:${prop.stat}`,
          player: prop.playerId,
          id: `${prop.playerId}:${prop.stat}`,
          gameId,
          playerName: player.name,
          team: player.team?.abbreviation ?? player.id,
          statShort: statDef.shortLabel,
          side,
          sideLabel: statDef.milestone ? (side === "over" ? "Yes" : "No") : side === "over" ? "Over" : "Under",
          point,
          modelProb: model,
          priceAmerican: best.priceAmerican,
          bookName: best.bookName,
          logs: legLogs,
          tonight,
          facts: {
            market: mk ? (side === "over" ? mk.probOver : 1 - mk.probOver) : null,
            injury: player.injury?.level ?? null,
            games: summary?.model?.projection.games ?? playerLogs.length,
            recentMinutes: summary?.avgMinutesL5 ?? null,
          },
        });
      }
    }
  }
  return out;
}
