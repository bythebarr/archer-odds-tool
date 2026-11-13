/**
 * Tracked prop leans (lib/tracking), each with the props screener's record
 * windows rebuilt at the lean's line and side — L3, L5, L10, L15, this season,
 * last season — from the player's game logs BEFORE that game only, counted the
 * way the screener counts them (lib/screener/types screenRates). Leans store
 * ARCHR's chance, the price at capture, the books' chance, z and (NBA)
 * projected minutes, but not the records; this fills that in so the filter
 * sweep can run the screener's own filters over real, settled picks. Main
 * lines only (the screener's default); hits and misses only. Read-only.
 */
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { NBA_PROP_STATS } from "@/lib/nba/propStats";
import { NFL_PROP_STATS, type NflStatLine } from "@/lib/nfl/propStats";
import { NFL_LOG_COLUMNS } from "@/lib/nfl/propsMath";
import { screenRates, type ScreenWindow } from "@/lib/screener/types";
import type { Rate } from "@/lib/builder/types";
import type { GradedLean } from "@/lib/tracking/types";

export interface LeanScreenRow {
  sport: "nba" | "nfl";
  stat: string;
  side: "over" | "under";
  point: number;
  /** ARCHR's chance on the side, as shown when captured. */
  prob: number;
  /** The books' no-vig chance; null without a two-sided market. */
  market: number | null;
  /** Best price at capture; the pick is settled at this price. */
  price: number;
  rates: Record<ScreenWindow, Rate>;
  /** Games of history before the game (for the add-on filters). */
  games: number;
  minutes: number | null;
  z: number | null;
  confidence: number | null;
  won: 0 | 1;
  date: string;
}

/** The rows for a sport's leans whose player and stat the logs know. */
/** Why leans didn't make it into the sweep, per sport. */
export interface LeanAccount {
  settled: number;
  noPrice: number;
  noPlayer: number;
  noHistory: number;
  kept: number;
  /** The lowest ARCHR chance among the kept leans (is "ARCHR's side" always 50%+?). */
  minProb: number | null;
  /** Kept leans that carry the Confidence grade they were shown with. */
  graded: number;
}

function rowsFor(sport: "nba" | "nfl", leans: GradedLean[], valueOf: (stat: string, raw: unknown) => number | null, rawByPlayer: Map<string, unknown[]>, account: LeanAccount): LeanScreenRow[] {
  const out: LeanScreenRow[] = [];
  account.settled = leans.length;
  for (const l of leans) {
    const f = l.features;
    if (f.price === null) {
      account.noPrice++;
      continue;
    }
    if (f.playerId === undefined || f.point === null) {
      account.noPlayer++;
      continue;
    }
    const raws = rawByPlayer.get(f.playerId) ?? [];
    const dated = raws as { gameDate: Date; season: number }[];
    const day = etDateOf(l.startsAt);
    // Prior games only: strictly before the game's ET date.
    const prior = dated.filter((r) => etDateOf(r.gameDate) < day).sort((a, b) => b.gameDate.getTime() - a.gameDate.getTime());
    if (!prior.length) {
      account.noHistory++;
      continue;
    }
    const own = dated.find((r) => etDateOf(r.gameDate) === day);
    const season = own?.season ?? prior[0]!.season;
    const values = prior.map((r) => ({ season: r.season, value: valueOf(f.stat, r) }));
    if (values.every((v) => v.value === null)) {
      account.noHistory++;
      continue;
    }
    const side = f.side === "under" ? "under" : "over";
    out.push({
      sport,
      stat: f.stat,
      side,
      point: f.point,
      prob: l.prob,
      market: f.marketProb,
      price: f.price,
      rates: screenRates(values, side, f.point, season),
      games: values.filter((v) => v.value !== null).length,
      minutes: typeof f.minutes === "number" ? f.minutes : null,
      z: typeof f.z === "number" ? f.z : null,
      confidence: f.confidence?.score ?? null,
      won: l.result === "hit" ? 1 : 0,
      date: day,
    });
  }
  account.kept = out.length;
  account.minProb = out.length ? Math.min(...out.map((r) => r.prob)) : null;
  account.graded = out.filter((r) => r.confidence !== null).length;
  return out;
}

const emptyAccount = (): LeanAccount => ({ settled: 0, noPrice: 0, noPlayer: 0, noHistory: 0, kept: 0, minProb: null, graded: 0 });

export async function leanScreenRows(leans: GradedLean[]): Promise<{ nba: LeanScreenRow[]; nfl: LeanScreenRow[]; account: { nba: LeanAccount; nfl: LeanAccount } }> {
  const props = leans.filter((l) => l.features.kind === "prop" && !l.features.alt && (l.result === "hit" || l.result === "miss"));
  const nbaLeans = props.filter((l) => l.features.sport === "nba");
  const nflLeans = props.filter((l) => l.features.sport === "nfl");
  const ids = (ls: GradedLean[]) => [...new Set(ls.map((l) => l.features.playerId).filter((x): x is string => Boolean(x)))];

  const nbaLogs = nbaLeans.length ? await prisma.nbaPlayerGameLog.findMany({ where: { nbaPlayerId: { in: ids(nbaLeans) }, minutes: { gt: 0 } } }) : [];
  const nbaBy = new Map<string, unknown[]>();
  for (const r of nbaLogs) (nbaBy.get(r.nbaPlayerId) ?? nbaBy.set(r.nbaPlayerId, []).get(r.nbaPlayerId)!).push(r);
  const nbaValue = (stat: string, raw: unknown) => {
    const s = NBA_PROP_STATS.find((x) => x.key === stat);
    return s ? s.value(raw as Parameters<typeof s.value>[0]) : null;
  };

  const nflLogs = nflLeans.length ? await prisma.nflPlayerGameLog.findMany({ where: { nflPlayerId: { in: ids(nflLeans) } } }) : [];
  const nflBy = new Map<string, unknown[]>();
  for (const r of nflLogs) (nflBy.get(r.nflPlayerId) ?? nflBy.set(r.nflPlayerId, []).get(r.nflPlayerId)!).push(r);
  const nflValue = (stat: string, raw: unknown) => {
    const s = NFL_PROP_STATS.find((x) => x.key === stat);
    if (!s) return null;
    const line = Object.fromEntries(NFL_LOG_COLUMNS.map((c) => [c, (raw as Record<string, unknown>)[c]])) as unknown as NflStatLine;
    return !s.available || s.available(line) ? s.value(line) : null;
  };

  const account = { nba: emptyAccount(), nfl: emptyAccount() };
  return { nba: rowsFor("nba", nbaLeans, nbaValue, nbaBy, account.nba), nfl: rowsFor("nfl", nflLeans, nflValue, nflBy, account.nfl), account };
}
