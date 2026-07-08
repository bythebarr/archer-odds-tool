import { prisma } from "@/lib/prisma";
import { etDayBoundsUtc } from "@/lib/dateEt";
import type { SlateSport, SlateSide } from "./slate";
import type { GameLineRow } from "./games";
import { h2hMarketConsensus } from "@/lib/odds/lineEconomics";
import { calculateEv } from "@/lib/odds/devig";
import { americanToDecimal } from "@/lib/odds/americanOdds";
import { ALLOWED_BOOK_KEYS, BOOK_INITIALS } from "@/lib/odds/bookAllowlist";

/**
 * The odds pool: one row per *play* (a game moneyline side), not per matchup —
 * every priced h2h bet across MLB, tennis, and soccer in a single pool you can
 * scan by price. Each play carries its best available American price (line-
 * shopped across the allowed books) and, where the market is two-way, the
 * value (EV) of that best price vs the de-vigged consensus. This is the Slate's
 * core: an odds-range slider over the pool, sorted by value.
 *
 * v1 scope: game moneylines only. Spreads/totals/props plug in as more
 * markets get priced into the pool (they're already stored). Soccer h2h is
 * three-way, which the 2-way devig can't fair-price, so soccer plays show a
 * price but no EV (line-shopping only) — same call the rest of the app makes.
 */
export type PlaySide = "home" | "away" | "draw";

export interface OddsPlay {
  key: string;
  sport: SlateSport;
  startUtc: Date;
  href: string;
  home: SlateSide;
  away: SlateSide;
  /** Which side this play backs. */
  side: PlaySide;
  /** Display name of the backed side ("Draw" for the soccer third way). */
  pickName: string;
  /** Best (most bettor-favorable) American price across the allowed books. */
  bestPrice: number;
  /** Same price as decimal — the monotonic axis the range slider filters on. */
  bestDecimal: number;
  bestBookKey: string;
  bestBookInitials: string;
  /** How many allowed books priced this side (line-shopping depth). */
  booksCount: number;
  /** EV of the best price vs de-vigged consensus, as a fraction (0.05 = +5%); null for three-way soccer. */
  ev: number | null;
}

export interface OddsPool {
  date: string;
  plays: OddsPlay[];
  /** Decimal-odds bounds across the pool, for the range slider's domain (null when empty). */
  bounds: { minDecimal: number; maxDecimal: number } | null;
}

const HREF: Record<Exclude<SlateSport, "ufc">, (id: string) => string> = {
  mlb: (id) => `/games/${id}`,
  tennis: (id) => `/tennis/${id}`,
  soccer: (id) => `/soccer/${id}`,
};

type GameRow = {
  id: string;
  sport: SlateSport;
  scheduledStartUtc: Date;
  homeTeam: { name: string; abbreviation: string; mlbTeamId: number | null } | null;
  awayTeam: { name: string; abbreviation: string; mlbTeamId: number | null } | null;
  homePlayer: { name: string } | null;
  awayPlayer: { name: string } | null;
  currentLines: {
    bookKey: string;
    book: { name: string };
    side: string;
    priceAmerican: number;
    polledAt: Date;
  }[];
};

/** Build the two matchup sides (for avatars/labels) the way the slate adapters do, per sport. */
function sidesFor(g: GameRow): { home: SlateSide; away: SlateSide } {
  if (g.sport === "tennis") {
    return { home: { name: g.homePlayer?.name ?? "TBD" }, away: { name: g.awayPlayer?.name ?? "TBD" } };
  }
  // mlb + soccer are team sports; only MLB carries a crest id.
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

function pickName(side: PlaySide, sides: { home: SlateSide; away: SlateSide }): string {
  if (side === "draw") return "Draw";
  return side === "home" ? sides.home.name : sides.away.name;
}

export async function getOddsPoolForDate(dateEt: string): Promise<OddsPool> {
  const { gte, lt } = etDayBoundsUtc(dateEt);

  const games = (await prisma.game.findMany({
    where: {
      sport: { in: ["mlb", "tennis", "soccer"] },
      scheduledStartUtc: { gte, lt },
      currentLines: { some: { marketType: "h2h" } },
    },
    orderBy: { scheduledStartUtc: "asc" },
    include: {
      homeTeam: true,
      awayTeam: true,
      homePlayer: true,
      awayPlayer: true,
      currentLines: {
        where: { marketType: "h2h", isAlternate: false },
        include: { book: true },
      },
    },
  })) as unknown as GameRow[];

  const allowed = new Set<string>(ALLOWED_BOOK_KEYS);
  const plays: OddsPlay[] = [];

  for (const g of games) {
    const sides = sidesFor(g);

    // Consensus fair prob (home = A, away = B) from the two-way devig — null for soccer's three-way market.
    const rows: GameLineRow[] = g.currentLines.map((l) => ({
      bookKey: l.bookKey,
      bookName: l.book.name,
      marketType: "h2h",
      side: l.side,
      point: null,
      priceAmerican: l.priceAmerican,
      polledAt: l.polledAt,
      isAlternate: false,
    }));
    const consensus = g.sport === "soccer" ? null : h2hMarketConsensus(rows);

    // Group this game's allowed-book lines by side and take the best price.
    const bySide = new Map<PlaySide, GameRow["currentLines"]>();
    for (const l of g.currentLines) {
      if (!allowed.has(l.bookKey)) continue;
      if (l.side !== "home" && l.side !== "away" && l.side !== "draw") continue;
      const arr = bySide.get(l.side as PlaySide) ?? [];
      arr.push(l);
      bySide.set(l.side as PlaySide, arr);
    }

    for (const [side, lines] of bySide) {
      if (lines.length === 0) continue;
      const best = lines.reduce((b, l) =>
        americanToDecimal(l.priceAmerican) > americanToDecimal(b.priceAmerican) ? l : b
      );
      const fairProb =
        consensus === null ? null : side === "home" ? consensus.fairProbA : side === "away" ? consensus.fairProbB : null;

      plays.push({
        key: `${g.id}:${side}`,
        sport: g.sport,
        startUtc: g.scheduledStartUtc,
        href: HREF[g.sport as Exclude<SlateSport, "ufc">](g.id),
        home: sides.home,
        away: sides.away,
        side,
        pickName: pickName(side, sides),
        bestPrice: best.priceAmerican,
        bestDecimal: americanToDecimal(best.priceAmerican),
        bestBookKey: best.bookKey,
        bestBookInitials: BOOK_INITIALS[best.bookKey] ?? best.bookKey.slice(0, 3).toUpperCase(),
        booksCount: lines.length,
        ev: fairProb !== null ? calculateEv(fairProb, best.priceAmerican) : null,
      });
    }
  }

  // Best value first (priced-but-unvalued plays sort last), then earliest start.
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
