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

export type { EventArchr } from "@/lib/odds/bookVsArchr";
import { eventArchrOf, type EventArchr } from "@/lib/odds/bookVsArchr";

export const getEventArchr = cache(async (sport: "nba" | "nfl", gameId: string): Promise<EventArchr | null> => {
  return (await getEventArchrBatch(sport, [gameId])).get(gameId) ?? null;
});

/**
 * ARCHR's lines for a page of games: one read of every game's current lines,
 * then each game's model view. The view's per-team inputs (rest, players
 * out) are per game by nature; the ratings replay, fitted weights and
 * spreads it rests on are read once per request (cached).
 */
export const getEventArchrBatch = cache(async (sport: "nba" | "nfl", gameIds: string[]): Promise<Map<string, EventArchr | null>> => {
  const out = new Map<string, EventArchr | null>();
  if (!gameIds.length) return out;
  const rows = await prisma.currentOddsLine.findMany({ where: { gameId: { in: gameIds } }, include: { book: { select: { displayName: true } } } });
  const byGame = new Map<string, typeof rows>();
  for (const r of rows) (byGame.get(r.gameId) ?? byGame.set(r.gameId, []).get(r.gameId)!).push(r);
  await Promise.all(
    gameIds.map(async (id) => {
      const view = await getGameModelView(sport, id, (byGame.get(id) ?? []).map(toLineRow)).catch((err) => {
        console.error(`[archr] model view failed for ${id}`, err);
        return null;
      });
      out.set(id, view ? eventArchrOf(view) : null);
    })
  );
  return out;
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

/** ARCHR's chance red wins for every bout on a card (null where the model has no read). */
export async function ufcArchrRedBatch(boutIds: string[]): Promise<Record<string, number | null>> {
  const probs = await Promise.all(boutIds.map((id) => ufcArchrRedProb(id).catch(() => null)));
  return Object.fromEntries(boutIds.map((id, i) => [id, probs[i] ?? null]));
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
