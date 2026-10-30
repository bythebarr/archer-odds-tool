/**
 * Every leg the parlay finder can use in one NFL game: each line a bettable
 * book hangs (main lines and every alt rung), at its best price, with the
 * player's game-by-game values for the stat and ARCHR's chance at that number.
 * Numbers posted without a price yet (DraftKings' NFL lines reach ESPN days
 * before their prices) are legs too, priced as unknown; without a price to
 * test, one is skipped as near-certain when ARCHR gives it better than the
 * shortest price allows. Players listed out or doubtful are left off.
 */
import { bestBettableLine } from "@/lib/odds/bestPrice";
import { NFL_PROP_STAT_BY_KEY } from "./propStats";
import { summarizeNflProp, type NflLogPoint } from "./propsMath";
import type { NflPropsSlate } from "@/lib/queries/nflProps";
import type { PostedLine } from "@/lib/queries/eventPropLines";
import { americanToImpliedProbability } from "@/lib/odds/americanOdds";
import type { NflPropStat } from "@/generated/prisma/client";
import { nflProjectionContext } from "./slateContext";
import type { FinderLeg } from "@/lib/props/parlayFinder";
import type { PropDirection } from "@/lib/props/tally";

export function nflFinderLegs(
  slate: Omit<NflPropsSlate, "logs">,
  logs: Record<string, NflLogPoint[]>,
  gameId: string,
  opts: { shortestPrice: number; posted?: Record<string, Record<string, PostedLine[]>> }
): FinderLeg[] {
  const out: FinderLeg[] = [];
  const surest = opts.shortestPrice === -Infinity ? 1 : americanToImpliedProbability(opts.shortestPrice);
  // Posted numbers on stats the slate has no prop for yet still make legs.
  const props = [...slate.props];
  for (const [playerId, stats] of Object.entries(opts.posted ?? {}))
    for (const stat of Object.keys(stats))
      if (slate.players[playerId] && !props.some((p) => p.playerId === playerId && p.stat === stat)) props.push({ playerId, stat: stat as NflPropStat, quotes: [] });
  for (const prop of props) {
    const player = slate.players[prop.playerId];
    const stat = NFL_PROP_STAT_BY_KEY.get(prop.stat);
    const posted = opts.posted?.[prop.playerId]?.[prop.stat] ?? [];
    if (!player || player.gameId !== gameId || !stat || (!prop.quotes.length && !posted.length)) continue;
    if (player.injury?.level === "out" || player.injury?.level === "doubtful") continue;
    const playerLogs = logs[prop.playerId] ?? [];
    const legLogs = playerLogs.map((l) => ({ date: l.date, opponent: l.opponent, isHome: l.isHome, season: l.season, team: l.team, value: !stat.available || stat.available(l) ? stat.value(l) : null }));
    const ctx = {
      season: slate.season,
      venue: player.venue,
      opponent: player.opponent?.abbreviation ?? null,
      projection: nflProjectionContext(slate, player),
      injury: player.injury?.level ?? null,
      modelWeight: slate.modelWeights[prop.stat],
      calibrationFactor: slate.calibrationFactors[prop.stat],
    };
    // A touchdown scorer is a Yes; its No is rarely hung and never what anyone parlays.
    const sides: PropDirection[] = stat.shape === "anytime" ? ["over"] : ["over", "under"];
    for (const side of sides) {
      const quotes = prop.quotes.filter((q) => q.side === side);
      const points = new Set([...quotes.map((q) => q.point), ...posted.filter((l) => l.side === side).map((l) => l.point)]);
      for (const point of points) {
        const best = bestBettableLine(quotes, point);
        if (best && best.priceAmerican < opts.shortestPrice) continue;
        const s = summarizeNflProp(prop, playerLogs, stat, side, ctx, point);
        const modelProb = s?.model ? (side === "over" ? s.model.probOver : s.model.probUnder) : null;
        if (!best && modelProb !== null && modelProb > surest) continue;
        out.push({
          key: `${prop.playerId}:${prop.stat}:${side}:${point}`,
          group: `${prop.playerId}:${prop.stat}`,
          player: prop.playerId,
          id: `${prop.playerId}:${prop.stat}`,
          gameId,
          playerName: player.name,
          team: player.team?.abbreviation ?? player.id,
          statShort: stat.shortLabel,
          side,
          sideLabel: stat.shape === "anytime" ? (side === "over" ? "Yes" : "No") : side === "over" ? "Over" : "Under",
          point,
          modelProb,
          priceAmerican: best?.priceAmerican ?? null,
          bookName: best?.bookName ?? null,
          logs: legLogs,
        });
      }
    }
  }
  return out;
}
