import { prisma } from "@/lib/prisma";
import { etDayBoundsUtc } from "@/lib/dateEt";
import type { SlateSport, SlateSide } from "./slate";
import type { GameLineRow } from "./games";
import type { MarketType } from "@/generated/prisma/client";
import { marketConsensus } from "@/lib/odds/lineEconomics";
import { calculateEv, consensusFairProbability, type DevigPair } from "@/lib/odds/devig";
import { americanToDecimal } from "@/lib/odds/americanOdds";
import { formatPoint } from "@/lib/odds/format";
import { BETTABLE_BOOK_KEYS, BOOK_INITIALS } from "@/lib/odds/bookAllowlist";
import { STAT_CATEGORY_LABELS } from "@/lib/props/format";
import { mlbHeadshotUrl } from "@/lib/logos";
import { getGameMatchupsBatch } from "./matchup";
import { computeArcherWinProbability } from "@/lib/archer/winProbability";
import { computeExpectedRuns, type ExpectedRuns } from "@/lib/archer/expectedRuns";
import { archerProbForRow } from "@/lib/archer/runProbability";
import type { StatCategory } from "@/generated/prisma/client";
import {
  seasonLogsByPlayer,
  MLB_STAT_DEFS,
  seasonValuesForStat,
  tallyPointSample,
  type PointSample,
} from "@/lib/props/mlbBoard";
import { projectPropHit, pooledBaseRate, type PropProjection } from "@/lib/props/projection";
import { pitcherRampFor } from "@/lib/props/pitcherRamp";

/**
 * The odds pool: one row per *play* — a specific bettable selection (a side of a
 * game market at its price), not per matchup — across every priced market so
 * you can scan the whole day by price. Each play carries its best available
 * American price (line-shopped across the allowed books) and, where the market
 * is two-way, the value (EV) of that best price vs the de-vigged consensus.
 * This is the Slate's core: an odds-range slider over the pool, sorted by value.
 *
 * Scope: game markets — moneyline (h2h), spread, total — for MLB, tennis, and
 * soccer. Player props fold into the same pool next. Soccer h2h is three-way,
 * which the 2-way devig can't fair-price, so those plays show a price but no EV
 * (line-shopping only), the same call the rest of the app makes.
 */
export type MarketKind = "ml" | "spread" | "total" | "prop";

/** Compact market kind for a stored MarketType — the pool's filter/label vocabulary. */
const MARKET_KIND: Record<MarketType, MarketKind> = { h2h: "ml", spreads: "spread", totals: "total" };
const MARKET_SIDES: Record<MarketType, [string, string]> = {
  h2h: ["home", "away"],
  spreads: ["home", "away"],
  totals: ["over", "under"],
};

export interface OddsPlay {
  key: string;
  sport: SlateSport;
  matchId: string;
  startUtc: Date;
  href: string;
  home: SlateSide;
  away: SlateSide;
  /** Stored game market, or null for player props (which aren't a MarketType). */
  market: MarketType | null;
  kind: MarketKind;
  /** home | away | over | under | draw */
  side: string;
  point: number | null;
  /** Full pick label, e.g. "Yankees", "Yankees -1.5", "Over 8.5", "Aaron Judge o1.5 Hits". */
  selectionLabel: string;
  /** Which matchup avatar to emphasize (null for over/under/draw/props, which aren't a team). */
  backed: "home" | "away" | null;
  /** Prop only: the player's headshot + name, for a face on the row. */
  playerImageUrl?: string | null;
  playerName?: string | null;
  /** Prop only: grading inputs — the player id + stat this prop settles on. */
  mlbPlayerId?: string | null;
  statCategory?: StatCategory | null;
  bestPrice: number;
  bestDecimal: number;
  bestBookKey: string;
  bestBookName: string;
  bestBookInitials: string;
  booksCount: number;
  /** MARKET lens: EV of the best price vs the de-vigged market consensus, as a fraction; null for three-way soccer. */
  ev: number | null;
  /** MODEL lens: EV of the best price vs Archer's own model probability (win prob for ML, expected-runs cover prob for spreads/totals, the Archer Prop Projection for player props), as a fraction; null for non-MLB and three-way soccer. */
  modelEv: number | null;
}

export interface OddsPool {
  date: string;
  plays: OddsPlay[];
  bounds: { minDecimal: number; maxDecimal: number } | null;
}

const HREF: Record<Exclude<SlateSport, "ufc">, (id: string) => string> = {
  mlb: (id) => `/games/${id}`,
  nfl: (id) => `/nfl/${id}`,
  tennis: (id) => `/tennis/${id}`,
  soccer: (id) => `/soccer/${id}`,
};

type LineRow = {
  bookKey: string;
  book: { displayName: string };
  marketType: MarketType;
  side: string;
  point: number | null;
  priceAmerican: number;
  polledAt: Date;
  isAlternate: boolean;
};

type GameRow = {
  id: string;
  sport: SlateSport;
  scheduledStartUtc: Date;
  homeTeam: { name: string; abbreviation: string; mlbTeamId: number | null } | null;
  awayTeam: { name: string; abbreviation: string; mlbTeamId: number | null } | null;
  homePlayer: { name: string } | null;
  awayPlayer: { name: string } | null;
  currentLines: LineRow[];
};

function sidesFor(g: GameRow): { home: SlateSide; away: SlateSide } {
  if (g.sport === "tennis") {
    return { home: { name: g.homePlayer?.name ?? "TBD" }, away: { name: g.awayPlayer?.name ?? "TBD" } };
  }
  return {
    home: {
      name: g.homeTeam?.name ?? "TBD",
      meta: g.homeTeam?.abbreviation,
      teamId: g.sport === "mlb" ? g.homeTeam?.mlbTeamId ?? null : null,
    },
    away: {
      name: g.awayTeam?.name ?? "TBD",
      meta: g.awayTeam?.abbreviation,
      teamId: g.sport === "mlb" ? g.awayTeam?.mlbTeamId ?? null : null,
    },
  };
}

/** The bettable-selection label + which team (if any) the pick backs. */
function labelFor(
  market: MarketType,
  side: string,
  point: number | null,
  sides: { home: SlateSide; away: SlateSide }
): { selectionLabel: string; backed: "home" | "away" | null } {
  if (side === "draw") return { selectionLabel: "Draw", backed: null };
  if (side === "over") return { selectionLabel: `Over${formatPoint(point, "totals")}`, backed: null };
  if (side === "under") return { selectionLabel: `Under${formatPoint(point, "totals")}`, backed: null };
  const team = side === "home" ? sides.home : sides.away;
  const backed = side === "home" ? "home" : "away";
  if (market === "spreads") return { selectionLabel: `${team.name}${formatPoint(point, "spreads")}`, backed };
  return { selectionLabel: team.name, backed }; // moneyline
}

type PropLineRow = {
  bookKey: string;
  book: { displayName: string };
  side: string; // over | under
  point: number;
  priceAmerican: number;
  statCategory: StatCategory;
  mlbPlayer: { fullName: string; mlbPersonId: number };
  game: {
    id: string;
    scheduledStartUtc: Date;
    homeTeam: { name: string; abbreviation: string; mlbTeamId: number | null } | null;
    awayTeam: { name: string; abbreviation: string; mlbTeamId: number | null } | null;
  };
};

/**
 * The Archer Prop Projection's probability at one player/stat/point, plus
 * the market EV that probability implies — pure and DB-free so it's
 * unit-testable without mocking Prisma, composing the same already-pure,
 * already-tested pieces mlbBoard.ts's board uses (tallyPointSample,
 * pooledBaseRate, pitcherRampFor, projectPropHit), just at an arbitrary
 * market point instead of the board's fixed standardLines grid.
 */
export function projectPropAtPoint(
  playerSample: PointSample,
  populationSamples: PointSample[],
  column: string,
  point: number
): PropProjection | null {
  const baseRate = pooledBaseRate(populationSamples);
  const ramp = pitcherRampFor(column, point); // undefined off the fitted grid — projectPropHit applies no ramp, same as the board
  return projectPropHit(
    {
      seasonHits: playerSample.seasonHits,
      seasonSample: playerSample.seasonSample,
      recentRate: playerSample.recentRate,
      baseRate,
    },
    { ramp } // contextShift omitted (0) — matchup-context parity with the board's K-prop terms is a deliberate follow-up, not this pass
  );
}

/** Player-prop plays — one per (player, stat, over/under) at the modal line, best-priced with over/under-devig value. MLB only today. */
async function propPlays(gte: Date, lt: Date, allowed: Set<string>): Promise<OddsPlay[]> {
  const lines = (await prisma.currentPlayerPropLine.findMany({
    where: { game: { sport: "mlb", scheduledStartUtc: { gte, lt } } },
    include: {
      book: true,
      mlbPlayer: true,
      game: { include: { homeTeam: true, awayTeam: true } },
    },
  })) as unknown as (PropLineRow & { mlbPlayerId: string })[];

  // Group by player + stat within a game.
  const groups = new Map<string, (PropLineRow & { mlbPlayerId: string })[]>();
  for (const l of lines) {
    const key = `${l.game.id}|${l.mlbPlayerId}|${l.statCategory}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(l);
  }

  // One batched fetch for every player referenced anywhere on the prop slate
  // — same discipline mlbBoard.ts already uses, reused directly rather than
  // re-implemented. Population is the players already being priced for each
  // stat today (no extra lineup/probable-pitcher query needed) — the tightest
  // available match to "the field this player should be regressed toward"
  // without a second DB round-trip.
  const playerIds = [...new Set(lines.map((l) => l.mlbPlayerId))];
  const logsByPlayer = await seasonLogsByPlayer(playerIds);
  const populationByStat = new Map<StatCategory, Set<string>>();
  for (const l of lines) {
    (populationByStat.get(l.statCategory) ?? populationByStat.set(l.statCategory, new Set()).get(l.statCategory)!).add(
      l.mlbPlayerId
    );
  }
  // Population samples are a function of (stat, point) — cache per group of
  // calls, since many groups for the same stat legitimately share a point.
  const populationCache = new Map<string, PointSample[]>();
  function populationSamplesFor(stat: StatCategory, point: number): PointSample[] {
    const cacheKey = `${stat}|${point}`;
    const cached = populationCache.get(cacheKey);
    if (cached) return cached;
    const column = MLB_STAT_DEFS[stat].column;
    const samples = [...(populationByStat.get(stat) ?? [])].map((playerId) =>
      tallyPointSample(seasonValuesForStat(logsByPlayer.get(playerId) ?? [], column), point)
    );
    populationCache.set(cacheKey, samples);
    return samples;
  }

  const plays: OddsPlay[] = [];
  for (const group of groups.values()) {
    const g = group[0].game;
    const player = group[0].mlbPlayer;
    const stat = group[0].statCategory;

    // Devig over/under per book (same point), then consensus fair prob at the modal point.
    const overByBook = new Map(group.filter((l) => l.side === "over").map((l) => [l.bookKey, l]));
    const underByBook = new Map(group.filter((l) => l.side === "under").map((l) => [l.bookKey, l]));
    const pairs: DevigPair[] = [];
    for (const [bookKey, o] of overByBook) {
      const u = underByBook.get(bookKey);
      if (u && o.point === u.point) pairs.push({ bookKey, priceA: o.priceAmerican, priceB: u.priceAmerican, point: o.point });
    }
    const consensus = consensusFairProbability(pairs);
    const modalPoint = consensus.modalPoint;

    const home: SlateSide = { name: g.homeTeam?.name ?? "TBD", meta: g.homeTeam?.abbreviation, teamId: g.homeTeam?.mlbTeamId ?? null };
    const away: SlateSide = { name: g.awayTeam?.name ?? "TBD", meta: g.awayTeam?.abbreviation, teamId: g.awayTeam?.mlbTeamId ?? null };
    const statLabel = STAT_CATEGORY_LABELS[stat];

    for (const side of ["over", "under"] as const) {
      const candidates = group.filter(
        (l) => l.side === side && allowed.has(l.bookKey) && (modalPoint === null || l.point === modalPoint)
      );
      if (candidates.length === 0) continue;
      const best = candidates.reduce((b, l) =>
        americanToDecimal(l.priceAmerican) > americanToDecimal(b.priceAmerican) ? l : b
      );
      const fairProb = side === "over" ? consensus.fairProbA : consensus.fairProbB;

      // Computed per side (not hoisted above this loop) and at THIS side's own
      // best.point: when there's no paired same-point over/under to devig
      // (modalPoint === null), the over and under candidates can legitimately
      // resolve to different points.
      const column = MLB_STAT_DEFS[stat].column;
      const playerSample = tallyPointSample(
        seasonValuesForStat(logsByPlayer.get(group[0].mlbPlayerId) ?? [], column),
        best.point
      );
      const projection = projectPropAtPoint(playerSample, populationSamplesFor(stat, best.point), column, best.point);
      const overProb = projection?.probability ?? null;
      // Under = 1 - over: the complement of P(clears the line), same
      // convention archerTotalUnderProb already uses for game totals — there's
      // no separate "under model."
      const modelSideProb = overProb === null ? null : side === "over" ? overProb : 1 - overProb;
      const modelEv = modelSideProb !== null ? calculateEv(modelSideProb, best.priceAmerican) : null;

      plays.push({
        key: `${g.id}:prop:${group[0].mlbPlayerId}:${stat}:${side}:${best.point}`,
        sport: "mlb",
        matchId: g.id,
        startUtc: g.scheduledStartUtc,
        href: `/games/${g.id}`,
        home,
        away,
        market: null,
        kind: "prop",
        side,
        point: best.point,
        selectionLabel: `${player.fullName} ${side === "over" ? "o" : "u"}${best.point} ${statLabel}`,
        backed: null,
        playerImageUrl: mlbHeadshotUrl(player.mlbPersonId),
        playerName: player.fullName,
        mlbPlayerId: group[0].mlbPlayerId,
        statCategory: stat,
        bestPrice: best.priceAmerican,
        bestDecimal: americanToDecimal(best.priceAmerican),
        bestBookKey: best.bookKey,
        bestBookName: best.book.displayName,
        bestBookInitials: BOOK_INITIALS[best.bookKey] ?? best.bookKey.slice(0, 3).toUpperCase(),
        booksCount: candidates.length,
        ev: fairProb !== null ? calculateEv(fairProb, best.priceAmerican) : null,
        modelEv,
      });
    }
  }
  return plays;
}

export async function getOddsPoolForDate(dateEt: string): Promise<OddsPool> {
  const { gte, lt } = etDayBoundsUtc(dateEt);

  const games = (await prisma.game.findMany({
    where: {
      sport: { in: ["mlb", "tennis", "soccer"] },
      scheduledStartUtc: { gte, lt },
      currentLines: { some: {} },
    },
    orderBy: { scheduledStartUtc: "asc" },
    include: {
      homeTeam: true,
      awayTeam: true,
      homePlayer: true,
      awayPlayer: true,
      currentLines: {
        where: { marketType: { in: ["h2h", "spreads", "totals"] }, isAlternate: false },
        include: { book: true },
      },
    },
  })) as unknown as GameRow[];

  // BETTABLE, not ALLOWED: best-price selection must never surface a book the
  // member can't actually use. The sharp book is still stored and still shapes
  // the de-vigged consensus above — it just isn't a place we send anyone.
  const allowed = new Set<string>(BETTABLE_BOOK_KEYS);
  const plays: OddsPlay[] = [];

  // Archer model for the MLB games — the "model" value lens. Win probability
  // (moneyline) + expected runs (spreads/totals) feed archerProbForRow, so the
  // lens covers all three MLB game markets. Only MLB has a game-line model
  // today; a game we can't project stays absent.
  const mlbGameIds = games.filter((g) => g.sport === "mlb").map((g) => g.id);
  const matchups = mlbGameIds.length > 0 ? await getGameMatchupsBatch(mlbGameIds) : {};
  const modelData = new Map<string, { winProb: { home: number | null; away: number | null }; runs: ExpectedRuns }>();
  for (const id of mlbGameIds) {
    const m = matchups[id];
    if (!m) continue;
    const wp = computeArcherWinProbability(m);
    modelData.set(id, { winProb: { home: wp.homeProb, away: wp.awayProb }, runs: computeExpectedRuns(m) });
  }

  for (const g of games) {
    const sides = sidesFor(g);

    for (const market of ["h2h", "spreads", "totals"] as MarketType[]) {
      const mlines = g.currentLines.filter((l) => l.marketType === market);
      if (mlines.length === 0) continue;

      // h2h stores point as a 0 sentinel; normalize to null (see schema note).
      const norm = (l: LineRow): number | null => (market === "h2h" ? null : l.point);

      const rows: GameLineRow[] = mlines.map((l) => ({
        bookKey: l.bookKey,
        bookName: l.book.displayName,
        marketType: market,
        side: l.side,
        point: norm(l),
        priceAmerican: l.priceAmerican,
        polledAt: l.polledAt,
        isAlternate: false,
      }));

      // Soccer h2h is three-way — no 2-way devig, so line-shopping only (no EV).
      const consensus = g.sport === "soccer" && market === "h2h" ? null : marketConsensus(rows, market);
      const [sideA, sideB] = MARKET_SIDES[market];
      const modalPoint = consensus?.modalPoint ?? null;

      // Every side present for this market (adds soccer's "draw" beyond the pair).
      const sidesPresent = new Set(mlines.map((l) => l.side));
      for (const side of sidesPresent) {
        // Same-bet integrity: for spreads/totals compare only the modal point;
        // moneyline has no point. If we couldn't establish a modal point, skip
        // the priced-but-unpairable market rather than mixing different bets.
        const candidates = mlines.filter((l) => {
          if (!allowed.has(l.bookKey) || l.side !== side) return false;
          if (market === "h2h") return true;
          return modalPoint !== null && l.point === modalPoint;
        });
        if (candidates.length === 0) continue;

        const best = candidates.reduce((b, l) =>
          americanToDecimal(l.priceAmerican) > americanToDecimal(b.priceAmerican) ? l : b
        );
        const point = norm(best);
        const fairProb =
          consensus === null ? null : side === sideA ? consensus.fairProbA : side === sideB ? consensus.fairProbB : null;
        const { selectionLabel, backed } = labelFor(market, side, point, sides);

        // Model lens: MLB game markets — the Archer model's probability for this
        // exact side/point (win prob for ML, expected-runs cover prob for spreads/totals) vs the best price.
        const md = g.sport === "mlb" ? modelData.get(g.id) : undefined;
        const modelSideProb = md ? archerProbForRow(market, side, point, md.winProb, md.runs) : null;
        const modelEv = modelSideProb !== null ? calculateEv(modelSideProb, best.priceAmerican) : null;

        plays.push({
          key: `${g.id}:${market}:${side}:${point ?? ""}`,
          sport: g.sport,
          matchId: g.id,
          startUtc: g.scheduledStartUtc,
          href: HREF[g.sport as Exclude<SlateSport, "ufc">](g.id),
          home: sides.home,
          away: sides.away,
          market,
          kind: MARKET_KIND[market],
          side,
          point,
          selectionLabel,
          backed,
          bestPrice: best.priceAmerican,
          bestDecimal: americanToDecimal(best.priceAmerican),
          bestBookKey: best.bookKey,
          bestBookName: best.book.displayName,
          bestBookInitials: BOOK_INITIALS[best.bookKey] ?? best.bookKey.slice(0, 3).toUpperCase(),
          booksCount: candidates.length,
          ev: fairProb !== null ? calculateEv(fairProb, best.priceAmerican) : null,
          modelEv,
        });
      }
    }
  }

  // Player props fold into the same pool.
  plays.push(...(await propPlays(gte, lt, allowed)));

  plays.sort((a, b) => {
    const av = a.ev ?? -Infinity;
    const bv = b.ev ?? -Infinity;
    if (av !== bv) return bv - av;
    return a.startUtc.getTime() - b.startUtc.getTime();
  });

  const decimals = plays.map((p) => p.bestDecimal);
  const bounds = decimals.length
    ? { minDecimal: Math.min(...decimals), maxDecimal: Math.max(...decimals) }
    : null;

  return { date: dateEt, plays, bounds };
}
