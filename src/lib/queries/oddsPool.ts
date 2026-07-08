import { prisma } from "@/lib/prisma";
import { etDayBoundsUtc } from "@/lib/dateEt";
import type { SlateSport, SlateSide } from "./slate";
import type { GameLineRow } from "./games";
import type { MarketType } from "@/generated/prisma/client";
import { marketConsensus } from "@/lib/odds/lineEconomics";
import { calculateEv } from "@/lib/odds/devig";
import { americanToDecimal } from "@/lib/odds/americanOdds";
import { formatPoint } from "@/lib/odds/format";
import { ALLOWED_BOOK_KEYS, BOOK_INITIALS } from "@/lib/odds/bookAllowlist";

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
export type MarketKind = "ml" | "spread" | "total";

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
  market: MarketType;
  kind: MarketKind;
  /** home | away | over | under | draw */
  side: string;
  point: number | null;
  /** Full pick label, e.g. "Yankees", "Yankees -1.5", "Over 8.5". */
  selectionLabel: string;
  /** Which matchup avatar to emphasize (null for over/under/draw, which aren't a team). */
  backed: "home" | "away" | null;
  bestPrice: number;
  bestDecimal: number;
  bestBookKey: string;
  bestBookName: string;
  bestBookInitials: string;
  booksCount: number;
  /** EV of the best price vs de-vigged consensus, as a fraction; null for three-way soccer. */
  ev: number | null;
}

export interface OddsPool {
  date: string;
  plays: OddsPlay[];
  bounds: { minDecimal: number; maxDecimal: number } | null;
}

const HREF: Record<Exclude<SlateSport, "ufc">, (id: string) => string> = {
  mlb: (id) => `/games/${id}`,
  tennis: (id) => `/tennis/${id}`,
  soccer: (id) => `/soccer/${id}`,
};

type LineRow = {
  bookKey: string;
  book: { name: string };
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

  const allowed = new Set<string>(ALLOWED_BOOK_KEYS);
  const plays: OddsPlay[] = [];

  for (const g of games) {
    const sides = sidesFor(g);

    for (const market of ["h2h", "spreads", "totals"] as MarketType[]) {
      const mlines = g.currentLines.filter((l) => l.marketType === market);
      if (mlines.length === 0) continue;

      // h2h stores point as a 0 sentinel; normalize to null (see schema note).
      const norm = (l: LineRow): number | null => (market === "h2h" ? null : l.point);

      const rows: GameLineRow[] = mlines.map((l) => ({
        bookKey: l.bookKey,
        bookName: l.book.name,
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
          bestBookName: best.book.name,
          bestBookInitials: BOOK_INITIALS[best.bookKey] ?? best.bookKey.slice(0, 3).toUpperCase(),
          booksCount: candidates.length,
          ev: fairProb !== null ? calculateEv(fairProb, best.priceAmerican) : null,
        });
      }
    }
  }

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
