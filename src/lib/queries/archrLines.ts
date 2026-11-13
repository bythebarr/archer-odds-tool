/**
 * ARCHR's own line for the lobby's cells, read from the models the detail
 * pages already show — nothing re-priced here:
 *   - NBA / NFL games: the game model the game page uses (getGameModelView):
 *     its projected spread and total, and its moneyline chance (the blended
 *     one where the books price both sides, the model's own otherwise) as a
 *     fair price.
 *   - UFC bouts: the bout page's chance (the fitted fight model once it beat
 *     v1, else v1 blended with the books' no-vig line).
 *   - Props: the screener pool's ARCHR chance for the same player, stat, side
 *     and number.
 * Null wherever the model has no read; the cell then shows the book alone.
 */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { toLineRow } from "@/lib/queries/games";
import { getGameModelView } from "@/lib/queries/gameModel";
import { getUfcMatchup } from "@/lib/queries/ufcMatchup";
import { getUfcBoutOdds } from "@/lib/queries/ufcOdds";
import { getUfcFightModel } from "@/lib/queries/ufcFightModel";
import { computeUfcWinProbability } from "@/lib/ufc/fighterMath";
import { blendWithMarket, DEFAULT_MODEL_WEIGHT } from "@/lib/propModel/market";
import { getScreenerPool } from "@/lib/screener/pool";
import { fairAmericanOf } from "@/lib/odds/bookVsArchr";

export interface EventArchr {
  /** Each team's projected spread (the home number is minus the away number). */
  spread: { home: number; away: number };
  total: number;
  /** Fair American price per side. */
  ml: { home: number | null; away: number | null };
}

export const getEventArchr = cache(async (sport: "nba" | "nfl", gameId: string): Promise<EventArchr | null> => {
  const rows = await prisma.currentOddsLine.findMany({ where: { gameId }, include: { book: { select: { displayName: true } } } });
  const view = await getGameModelView(sport, gameId, rows.map(toLineRow));
  if (!view) return null;
  const ml = view.markets.find((m) => m.market === "ml");
  const pHome = ml ? ml.probA : view.pHomeWin;
  return { spread: { home: view.fairSpread, away: -view.fairSpread }, total: view.fairTotal, ml: { home: fairAmericanOf(pHome), away: fairAmericanOf(1 - pHome) } };
});

/** ARCHR's chance red wins, as the bout page computes it; null without a read. */
export async function ufcArchrRedProb(boutId: string): Promise<number | null> {
  const [matchup, odds, fightModel] = await Promise.all([getUfcMatchup(boutId), getUfcBoutOdds(boutId), getUfcFightModel(boutId)]);
  const v1 = matchup ? computeUfcWinProbability(matchup) : null;
  if (fightModel?.beatsV1) return fightModel.probRed;
  const p = v1?.fighterAProb ?? null;
  if (p === null) return null;
  return odds?.marketFairProbRed != null ? blendWithMarket(p, odds.marketFairProbRed, DEFAULT_MODEL_WEIGHT) : p;
}

const propKey = (player: string, stat: string, side: string, point: number) => `${player}|${stat}|${side}|${point}`;

/** ARCHR's chance per prop from the screener pool, keyed by player name, stat key, side and number. */
export const getPropArchr = cache(async (sport: "nba" | "nfl"): Promise<Map<string, number>> => {
  const pool = await getScreenerPool(sport, false).catch(() => []);
  const out = new Map<string, number>();
  for (const p of pool) if (p.archr !== null) out.set(propKey(p.player, p.stat, p.side === "yes" ? "over" : p.side, p.point), p.archr);
  return out;
});

export function propArchrOf(map: Map<string, number>, player: string, stat: string, side: string, point: number): number | null {
  return map.get(propKey(player, stat, side, point)) ?? null;
}
