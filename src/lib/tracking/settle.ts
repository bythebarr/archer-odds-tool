/**
 * Settles the tracked leans (types.ts) once their games are final: a prop off
 * the player's box score (no box score, or no minutes, is a void: the bet is
 * refunded), a game line off the final score, each with the market's closing
 * line beside it, the last quotes before the start at the same number, for
 * closing-line value. Writes PredictionSettlement rows; never touches the
 * predictions themselves.
 */
import { prisma } from "@/lib/prisma";
import type { NbaPropStat, NflPropStat } from "@/generated/prisma/client";
import { NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import { NFL_PROP_STAT_BY_KEY } from "@/lib/nfl/propStats";
import type { PropQuote } from "@/lib/nba/propsMath";
import { TRACKED_MODELS, type SettleResult } from "./types";

/** Predictions settled per run (a full NBA night is ~1,000). */
const BATCH = 4000;
/** A game still not final this long after its start is called off: its leans void. */
const VOID_AFTER_MS = 3 * 86_400_000;

interface Pending {
  id: string;
  eventRef: string;
  scheduledStartUtc: Date;
  marketKey: string;
  selectionKey: string;
  modelKey: string;
}

export interface Settled {
  predictionId: string;
  result: SettleResult;
  actual: number | null;
  closingProb: number | null;
  closingPrice: number | null;
}

const graded = (value: number, side: string, point: number): SettleResult =>
  value === point ? "push" : (side === "over" ? value > point : value < point) ? "hit" : "miss";

/** A selection key "player|side|point" (props) or "side|point" (game lines). */
function parseSelection(key: string): { player: string | null; side: string; point: number | null } {
  const parts = key.split("|");
  if (parts.length === 3) return { player: parts[0], side: parts[1], point: Number(parts[2]) };
  return { player: null, side: parts[0], point: parts[1] === "" ? null : Number(parts[1]) };
}

/** Each book's last quote before `start`, at every number, from a game's snapshots. */
function closingQuotes<T extends { bookKey: string; side: string; point: number; priceAmerican: number; polledAt: Date }>(snaps: T[], start: Date): PropQuote[] {
  const latest = new Map<string, T>();
  for (const s of snaps) {
    if (s.polledAt >= start) continue;
    const k = `${s.bookKey}|${s.side}|${s.point}`;
    const prev = latest.get(k);
    if (!prev || s.polledAt > prev.polledAt) latest.set(k, s);
  }
  return [...latest.values()].map((s) => ({ bookKey: s.bookKey, bookName: s.bookKey, side: s.side === "under" ? "under" : "over", point: s.point, priceAmerican: s.priceAmerican }));
}

const implied = (american: number) => (american < 0 ? -american / (100 - american) : 100 / (american + 100));

/**
 * The closing chance of a side: each book that hung both sides at the number,
 * de-vigged and averaged (one book is enough for closing-line value, unlike the
 * live market read, which wants several).
 */
function closeOf(quotes: PropQuote[], side: string, point: number): { prob: number | null; price: number | null } {
  const at = quotes.filter((q) => q.point === point);
  const books = new Map<string, { over?: number; under?: number }>();
  for (const q of at) (books.get(q.bookKey) ?? books.set(q.bookKey, {}).get(q.bookKey)!)[q.side] = q.priceAmerican;
  const fair = [...books.values()].flatMap((b) => (b.over !== undefined && b.under !== undefined ? [implied(b.over) / (implied(b.over) + implied(b.under))] : []));
  const probOver = fair.length ? fair.reduce((a, b) => a + b, 0) / fair.length : null;
  const mine = at.filter((q) => q.side === (side === "under" ? "under" : "over"));
  const price = mine.length ? Math.max(...mine.map((q) => q.priceAmerican)) : null;
  return { prob: probOver === null ? null : side === "under" ? 1 - probOver : probOver, price };
}

async function settleProps(sport: "nba" | "nfl", game: { id: string; scheduledStartUtc: Date }, preds: Pending[]): Promise<Settled[]> {
  const logs =
    sport === "nba"
      ? await prisma.nbaPlayerGameLog.findMany({ where: { gameId: game.id } }).then((r) => new Map(r.map((l) => [l.nbaPlayerId, l as unknown as Record<string, number>])))
      : await prisma.nflPlayerGameLog.findMany({ where: { gameId: game.id } }).then((r) => new Map(r.map((l) => [l.nflPlayerId, l as unknown as Record<string, number>])));
  type Snap = { playerId: string; stat: string; bookKey: string; side: string; point: number; priceAmerican: number; polledAt: Date };
  const snaps: Snap[] =
    sport === "nba"
      ? (await prisma.nbaPropSnapshot.findMany({ where: { gameId: game.id, polledAt: { lt: game.scheduledStartUtc } } })).map((s) => ({ ...s, playerId: s.nbaPlayerId }))
      : (await prisma.nflPropSnapshot.findMany({ where: { gameId: game.id, polledAt: { lt: game.scheduledStartUtc } } })).map((s) => ({ ...s, playerId: s.nflPlayerId }));
  const byPlayerStat = new Map<string, Snap[]>();
  for (const s of snaps) {
    const k = `${s.playerId}|${s.stat}`;
    (byPlayerStat.get(k) ?? byPlayerStat.set(k, []).get(k)!).push(s);
  }
  return preds.map((p) => {
    const stat = p.marketKey.slice("prop:".length);
    const { player, side, point } = parseSelection(p.selectionKey);
    const log = player ? logs.get(player) : undefined;
    const def = sport === "nba" ? NBA_PROP_STAT_BY_KEY.get(stat as NbaPropStat) : NFL_PROP_STAT_BY_KEY.get(stat as NflPropStat);
    const close = player && point !== null ? closeOf(closingQuotes(byPlayerStat.get(`${player}|${stat}`) ?? [], game.scheduledStartUtc), side, point) : { prob: null, price: null };
    const base = { predictionId: p.id, closingProb: close.prob, closingPrice: close.price };
    // Didn't play (or the stat isn't in his box score): the book voids it.
    if (!log || !def || point === null || !(log.minutes > 0 || sport === "nfl")) return { ...base, result: "void" as const, actual: null };
    const nflDef = def as { available?: (l: never) => boolean };
    if (nflDef.available && !nflDef.available(log as never)) return { ...base, result: "void" as const, actual: null };
    const value = (def.value as (l: never) => number)(log as never);
    return { ...base, result: graded(value, side, point), actual: value };
  });
}

async function settleGameLines(game: { id: string; scheduledStartUtc: Date; homeScore: number | null; awayScore: number | null }, preds: Pending[]): Promise<Settled[]> {
  const closing = await prisma.gameClosingLine.findMany({ where: { gameId: game.id } });
  const MT = { ml: "h2h", spread: "spreads", total: "totals" } as const;
  return preds.map((p) => {
    const { side, point } = parseSelection(p.selectionKey);
    const home = game.homeScore!;
    const away = game.awayScore!;
    let result: SettleResult;
    let actual: number;
    if (p.marketKey === "total") {
      actual = home + away;
      result = graded(actual, side, point!);
    } else {
      // Home's margin, from the lean's side: a spread adds its own number.
      const margin = side === "home" ? home - away : away - home;
      actual = margin;
      const covered = margin + (p.marketKey === "spread" ? point! : 0);
      result = covered === 0 ? "push" : covered > 0 ? "hit" : "miss";
    }
    // The closing line: both sides at the lean's number, de-vigged.
    const mt = MT[p.marketKey as keyof typeof MT];
    const mine = closing.find((c) => c.marketType === mt && c.side === side);
    const other = closing.find((c) => c.marketType === mt && c.side !== side && c.side !== "draw");
    const samePoint = (c: typeof mine) => (p.marketKey === "ml" ? true : p.marketKey === "total" ? c?.point === point : c?.point !== null && c?.point === (c?.side === side ? point : -point!));
    let closingProb: number | null = null;
    if (mine && other && samePoint(mine) && samePoint(other)) {
      const a = mine.priceAmerican < 0 ? -mine.priceAmerican / (100 - mine.priceAmerican) : 100 / (mine.priceAmerican + 100);
      const b = other.priceAmerican < 0 ? -other.priceAmerican / (100 - other.priceAmerican) : 100 / (other.priceAmerican + 100);
      closingProb = a / (a + b);
    }
    return { predictionId: p.id, result, actual, closingProb, closingPrice: mine && samePoint(mine) ? mine.priceAmerican : null };
  });
}

export async function settleLeans(now = new Date()): Promise<{ considered: number; settled: number; waiting: number }> {
  const rows = await prisma.modelPrediction.findMany({
    where: { settlement: null, scheduledStartUtc: { lt: new Date(now.getTime() - 3 * 3_600_000) }, run: { modelKey: { in: Object.values(TRACKED_MODELS) } } },
    select: { id: true, eventRef: true, scheduledStartUtc: true, marketKey: true, selectionKey: true, run: { select: { modelKey: true } } },
    orderBy: { scheduledStartUtc: "asc" },
    take: BATCH,
  });
  const pending: Pending[] = rows.map((r) => ({ ...r, modelKey: r.run.modelKey }));
  const byGame = new Map<string, Pending[]>();
  for (const p of pending) (byGame.get(p.eventRef) ?? byGame.set(p.eventRef, []).get(p.eventRef)!).push(p);
  const games = new Map(
    (await prisma.game.findMany({ where: { id: { in: [...byGame.keys()] } }, select: { id: true, sport: true, status: true, scheduledStartUtc: true, homeScore: true, awayScore: true } })).map((g) => [g.id, g])
  );

  const out: Settled[] = [];
  let waiting = 0;
  for (const [gameId, preds] of byGame) {
    const game = games.get(gameId);
    const stale = now.getTime() - (game?.scheduledStartUtc ?? preds[0].scheduledStartUtc).getTime() > VOID_AFTER_MS;
    if (!game || game.status === "postponed" || (game.status !== "final" && stale)) {
      if (!game || game.status === "postponed" || stale) out.push(...preds.map((p) => ({ predictionId: p.id, result: "void" as const, actual: null, closingProb: null, closingPrice: null })));
      continue;
    }
    if (game.status !== "final" || game.homeScore === null || game.awayScore === null) {
      waiting += preds.length;
      continue;
    }
    const sport = game.sport === "nfl" ? "nfl" : "nba";
    const props = preds.filter((p) => p.marketKey.startsWith("prop:"));
    const lines = preds.filter((p) => !p.marketKey.startsWith("prop:"));
    // A prop's box score lands with the results sync, a little after the final score: wait for it rather than void.
    if (props.length) {
      const logged = sport === "nba" ? await prisma.nbaPlayerGameLog.count({ where: { gameId } }) : await prisma.nflPlayerGameLog.count({ where: { gameId } });
      if (logged === 0 && !stale) waiting += props.length;
      else out.push(...(await settleProps(sport, game, props)));
    }
    if (lines.length) out.push(...(await settleGameLines(game, lines)));
  }
  if (out.length) await prisma.predictionSettlement.createMany({ data: out, skipDuplicates: true });
  return { considered: pending.length, settled: out.length, waiting };
}
