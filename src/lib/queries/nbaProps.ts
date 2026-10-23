import { prisma } from "@/lib/prisma";
import { etDayBoundsUtc } from "@/lib/dateEt";
import { americanToDecimal } from "@/lib/odds/americanOdds";
import { bestBettableLine, consensusPoint, isBettableBook } from "@/lib/odds/bestPrice";
import { tallyPropHits, type PropDirection, type PropHitRateResult } from "@/lib/props/hitRate";
import { NBA_LEAGUE } from "@/lib/nba/league";
import { NBA_PROP_STAT_BY_KEY, NBA_PROP_STATS } from "@/lib/nba/propStats";
import type { NbaPropStat } from "@/generated/prisma/client";

export type NbaPropSort = "hitRate" | "price" | "margin";

export interface NbaPropBestPrice {
  bookKey: string;
  bookName: string;
  priceAmerican: number;
}

export interface NbaPropRow {
  key: string;
  gameId: string;
  playerId: string;
  playerName: string;
  headshotUrl: string | null;
  /** "BOS @ LAC"-style context from the player's side, e.g. "@ LAC" or "vs BOS". */
  matchup: string;
  stat: NbaPropStat;
  /** The number most bettable books hang; every price and hit rate below is at it. */
  point: number;
  over: NbaPropBestPrice | null;
  under: NbaPropBestPrice | null;
  /** Bettable books quoting the consensus number. */
  booksAtLine: number;
  /** Other numbers on the board for this prop (alt lines, outlier books). */
  otherLines: number;
  /** Hit rates for the chosen side, at `point`. */
  hitRates: { l5: PropHitRateResult; l10: PropHitRateResult; l20: PropHitRateResult; season: PropHitRateResult; venue: PropHitRateResult };
  /** Tonight's venue for the split column; null when the player's team isn't in this game (a trade not yet logged). */
  venue: "home" | "away" | null;
  avgL10: number | null;
  avgMinutesL5: number | null;
}

export interface NbaPropsFinder {
  date: string;
  stat: NbaPropStat;
  side: PropDirection;
  sort: NbaPropSort;
  games: { id: string; label: string }[];
  rows: NbaPropRow[];
  lastPolledAt: Date | null;
}

const HISTORY_GAMES = 82;

function average(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Signed so a bigger number is always better for the chosen side. */
function margin(row: NbaPropRow, side: PropDirection): number {
  if (row.avgL10 === null) return -Infinity;
  return side === "over" ? row.avgL10 - row.point : row.point - row.avgL10;
}

function sortRows(rows: NbaPropRow[], sort: NbaPropSort, side: PropDirection): void {
  const price = (r: NbaPropRow) => {
    const best = side === "over" ? r.over : r.under;
    return best ? americanToDecimal(best.priceAmerican) : -Infinity;
  };
  const key: Record<NbaPropSort, (r: NbaPropRow) => number> = {
    // Small samples sort below real ones at the same rate: 2/2 is not 9/10.
    hitRate: (r) => (r.hitRates.l10.hitRate ?? -1) + Math.min(r.hitRates.l10.sampleSize, 10) / 1000,
    price,
    margin: (r) => margin(r, side),
  };
  rows.sort((a, b) => key[sort](b) - key[sort](a));
}

/**
 * The NBA props finder for one ET date and stat: every player prop on the board
 * with the best bettable Over and Under at the consensus number, and how often
 * the player has cleared that number.
 */
export async function getNbaPropsFinder({
  dateEt,
  stat,
  side,
  sort,
  gameId,
}: {
  dateEt: string;
  stat: NbaPropStat;
  side: PropDirection;
  sort: NbaPropSort;
  gameId?: string;
}): Promise<NbaPropsFinder> {
  const statDef = NBA_PROP_STAT_BY_KEY.get(stat) ?? NBA_PROP_STATS[0];
  const { gte, lt } = etDayBoundsUtc(dateEt);
  const games = await prisma.game.findMany({
    where: { sport: "nba", scheduledStartUtc: { gte, lt } },
    orderBy: { scheduledStartUtc: "asc" },
    select: {
      id: true,
      scheduledStartUtc: true,
      homeTeamId: true,
      awayTeamId: true,
      homeTeam: { select: { abbreviation: true } },
      awayTeam: { select: { abbreviation: true } },
    },
  });
  const gameList = games.map((g) => ({ id: g.id, label: `${g.awayTeam?.abbreviation} @ ${g.homeTeam?.abbreviation}` }));
  const scoped = gameId ? games.filter((g) => g.id === gameId) : games;
  const empty = { date: dateEt, stat: statDef.key, side, sort, games: gameList, rows: [], lastPolledAt: null };
  if (scoped.length === 0) return empty;

  const lines = await prisma.currentNbaPropLine.findMany({
    where: { gameId: { in: scoped.map((g) => g.id) }, stat: statDef.key },
    include: { book: { select: { displayName: true } }, nbaPlayer: { select: { fullName: true, headshotUrl: true, teamId: true } } },
  });
  if (lines.length === 0) return empty;

  const groups = new Map<string, typeof lines>();
  for (const line of lines) {
    const key = `${line.gameId}:${line.nbaPlayerId}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  const playerIds = [...new Set(lines.map((l) => l.nbaPlayerId))];
  const logs = await prisma.nbaPlayerGameLog.findMany({
    where: { nbaPlayerId: { in: playerIds }, gameDate: { lt: gte } },
    orderBy: { gameDate: "desc" },
  });
  const logsByPlayer = new Map<string, typeof logs>();
  for (const log of logs) {
    const list = logsByPlayer.get(log.nbaPlayerId) ?? [];
    if (list.length < HISTORY_GAMES) list.push(log);
    logsByPlayer.set(log.nbaPlayerId, list);
  }

  const gameById = new Map(scoped.map((g) => [g.id, g]));
  const rows: NbaPropRow[] = [];
  for (const [key, group] of groups) {
    const game = gameById.get(group[0].gameId)!;
    const player = group[0].nbaPlayer;
    const point = consensusPoint(group.filter((l) => isBettableBook(l.bookKey)));
    if (point === null) continue; // only unbettable books price it

    const best = (s: PropDirection): NbaPropBestPrice | null => {
      const line = bestBettableLine(group.filter((l) => l.side === s), point);
      return line ? { bookKey: line.bookKey, bookName: line.book.displayName, priceAmerican: line.priceAmerican } : null;
    };

    const venue = player.teamId === game.homeTeamId ? "home" : player.teamId === game.awayTeamId ? "away" : null;
    const history = logsByPlayer.get(group[0].nbaPlayerId) ?? [];
    const values = history.map((l) => statDef.value(l));
    const season = NBA_LEAGUE.seasonOf(game.scheduledStartUtc);
    const tally = (v: number[]) => tallyPropHits(v, point, side);

    rows.push({
      key,
      gameId: game.id,
      playerId: group[0].nbaPlayerId,
      playerName: player.fullName,
      headshotUrl: player.headshotUrl,
      matchup:
        venue === "home"
          ? `vs ${game.awayTeam?.abbreviation}`
          : venue === "away"
            ? `@ ${game.homeTeam?.abbreviation}`
            : `${game.awayTeam?.abbreviation} @ ${game.homeTeam?.abbreviation}`,
      stat: statDef.key,
      point,
      over: best("over"),
      under: best("under"),
      booksAtLine: new Set(group.filter((l) => l.point === point && isBettableBook(l.bookKey)).map((l) => l.bookKey)).size,
      otherLines: new Set(group.filter((l) => l.point !== point).map((l) => l.point)).size,
      hitRates: {
        l5: tally(values.slice(0, 5)),
        l10: tally(values.slice(0, 10)),
        l20: tally(values.slice(0, 20)),
        season: tally(history.filter((l) => l.season === season).map((l) => statDef.value(l))),
        venue: tally(
          history
            .filter((l) => venue === null || l.isHome === (venue === "home"))
            .slice(0, 20)
            .map((l) => statDef.value(l))
        ),
      },
      venue,
      avgL10: average(values.slice(0, 10)),
      avgMinutesL5: average(history.slice(0, 5).map((l) => l.minutes)),
    });
  }

  sortRows(rows, sort, side);
  const lastPolledAt = lines.reduce<Date | null>((max, l) => (!max || l.polledAt > max ? l.polledAt : max), null);
  return { date: dateEt, stat: statDef.key, side, sort, games: gameList, rows, lastPolledAt };
}
