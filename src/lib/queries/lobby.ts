/**
 * Data for the sportsbook-style surfaces: the Home lobby and each league page.
 * One event row = one game with the best bettable Spread / Total / Moneyline
 * per side — the three-column grid every sportsbook lobby is built on.
 */
import { prisma } from "@/lib/prisma";
import { etDateOf, etDayBoundsUtc, shiftEtDate } from "@/lib/dateEt";
import { bestLinesBySide } from "@/lib/odds/bestPrice";
import { espnTeamLogoUrl } from "@/lib/logos";
import type { TeamLeagueSport } from "@/lib/teamLeague/league";
import { toLineRow, type GameLineRow } from "./games";

export interface EventTeam {
  abbreviation: string;
  name: string;
  logoUrl: string;
}

export interface EventPrice {
  /** Spread or total number; null for a moneyline. */
  point: number | null;
  priceAmerican: number;
  bookKey: string;
  bookName: string;
}

export interface LeagueEventRow {
  id: string;
  href: string;
  /** ISO string — crosses into client components. */
  startUtc: string;
  status: string;
  away: EventTeam;
  home: EventTeam;
  spread: { away: EventPrice | null; home: EventPrice | null };
  total: { over: EventPrice | null; under: EventPrice | null };
  moneyline: { away: EventPrice | null; home: EventPrice | null };
}

function best(lines: GameLineRow[], market: GameLineRow["marketType"], side: string): EventPrice | null {
  const [line] = bestLinesBySide(
    lines.filter((l) => l.marketType === market && !l.isAlternate),
    [side]
  );
  return line
    ? { point: line.point, priceAmerican: line.priceAmerican, bookKey: line.bookKey, bookName: line.bookName }
    : null;
}

/** Every game in a league on one ET date, as lobby rows, in start order. */
export async function getLeagueEvents(sport: TeamLeagueSport, dateEt: string): Promise<LeagueEventRow[]> {
  const { gte, lt } = etDayBoundsUtc(dateEt);
  const games = await prisma.game.findMany({
    where: { sport, scheduledStartUtc: { gte, lt }, status: { in: ["scheduled", "live"] } },
    orderBy: { scheduledStartUtc: "asc" },
    include: { homeTeam: true, awayTeam: true, currentLines: { include: { book: true } } },
  });

  return games.flatMap((g) => {
    if (!g.homeTeam || !g.awayTeam) return [];
    const lines = g.currentLines.map(toLineRow);
    const team = (t: { abbreviation: string; name: string }): EventTeam => ({
      abbreviation: t.abbreviation,
      name: t.name,
      logoUrl: espnTeamLogoUrl(sport, t.abbreviation),
    });
    return [
      {
        id: g.id,
        href: `/${sport}/${g.id}`,
        startUtc: g.scheduledStartUtc.toISOString(),
        status: g.status,
        away: team(g.awayTeam),
        home: team(g.homeTeam),
        spread: { away: best(lines, "spreads", "away"), home: best(lines, "spreads", "home") },
        total: { over: best(lines, "totals", "over"), under: best(lines, "totals", "under") },
        moneyline: { away: best(lines, "h2h", "away"), home: best(lines, "h2h", "home") },
      },
    ];
  });
}

/**
 * The upcoming ET dates (from `fromDateEt`, up to `days` ahead) that have games
 * in a league — the date strip across the top of a league page.
 */
export async function getLeagueDays(sport: TeamLeagueSport, fromDateEt: string, days = 8): Promise<string[]> {
  const { gte } = etDayBoundsUtc(fromDateEt);
  const { lt } = etDayBoundsUtc(shiftEtDate(fromDateEt, days - 1));
  const games = await prisma.game.findMany({
    where: { sport, scheduledStartUtc: { gte, lt }, status: { in: ["scheduled", "live"] } },
    select: { scheduledStartUtc: true },
    orderBy: { scheduledStartUtc: "asc" },
  });
  return [...new Set(games.map((g) => etDateOf(g.scheduledStartUtc)))];
}
