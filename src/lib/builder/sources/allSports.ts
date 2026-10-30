/**
 * Every other league's legs for the parlay builder: the all-sports engine's
 * games in the next few days (soccer, hockey, college football, baseball,
 * tennis, MMA beyond the UFC, …), each main moneyline (with the draw where the
 * sport has one), spread and total at the best price, ARCHR's blended chance,
 * and each bet's record in the two teams' recent games. Only games a book has
 * priced: a parlay is built from bets someone will take.
 *
 * Leagues with their own source (NBA, NFL, UFC) are left out here.
 */
import { prisma } from "@/lib/prisma";
import { mainOffer } from "@/lib/gameModel/offers";
import { leagueRatings } from "@/lib/allSports/model/history";
import { priceEvent, type PricedOffer } from "@/lib/allSports/model/price";
import { dropEspnTwins } from "@/lib/queries/allSports";
import { edgeOf, ratesOf, type BuilderLeg } from "../types";
import { teamBetOutcomes, type PastGame, type TeamBet } from "../teamHistory";

const LOOKAHEAD_DAYS = 3;
const HISTORY_DAYS = 400;
/** Covered by the NBA, NFL and UFC sources. */
const OWN_SOURCE = new Set(["basketball/nba", "football/nfl", "mma/ufc"]);

const signed = (x: number) => (x === 0 ? "PK" : x > 0 ? `+${x}` : `−${Math.abs(x)}`);

export async function allSportsLegs(now = new Date()): Promise<BuilderLeg[]> {
  const leagues = (await prisma.league.findMany({ where: { active: true, outright: false, upcomingCount: { gt: 0 } }, select: { id: true, sport: true, name: true, espnPath: true } })).filter(
    (l) => !(l.espnPath && OWN_SOURCE.has(l.espnPath)) && !["NBA", "NFL", "UFC"].includes(l.name)
  );
  if (!leagues.length) return [];
  const byId = new Map(leagues.map((l) => [l.id, l]));
  const events = dropEspnTwins(
    await prisma.sportEvent.findMany({
      where: { leagueId: { in: leagues.map((l) => l.id) }, status: "scheduled", startsAt: { gte: now, lte: new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000) } },
      orderBy: { startsAt: "asc" },
      include: { lines: true },
    })
  );
  const leagueIds = [...new Set(events.map((e) => e.leagueId))];
  const finals = await prisma.sportEvent.findMany({
    where: { leagueId: { in: leagueIds }, status: "final", homeScore: { not: null }, awayScore: { not: null }, startsAt: { gte: new Date(now.getTime() - HISTORY_DAYS * 86_400_000) } },
    orderBy: { startsAt: "desc" },
    select: { leagueId: true, startsAt: true, home: true, away: true, homeScore: true, awayScore: true },
  });
  // No common season across leagues: "season" here is the last twelve months.
  const yearAgo = now.getTime() - 365 * 86_400_000;
  const historyBy = new Map<string, PastGame[]>();
  for (const f of finals) {
    const list = historyBy.get(f.leagueId) ?? [];
    list.push({ startsAt: f.startsAt.toISOString(), season: f.startsAt.getTime() >= yearAgo ? 1 : 0, home: f.home, away: f.away, homeScore: f.homeScore!, awayScore: f.awayScore! });
    historyBy.set(f.leagueId, list);
  }

  const out: BuilderLeg[] = [];
  for (const leagueId of leagueIds) {
    const league = byId.get(leagueId)!;
    const ratings = await leagueRatings(leagueId, league.sport, now);
    const history = historyBy.get(leagueId) ?? [];
    for (const e of events.filter((x) => x.leagueId === leagueId && x.away)) {
      const base = {
        sport: league.sport,
        league: league.name,
        eventId: `as:${e.id}`,
        eventLabel: `${e.away} @ ${e.home}`,
        startsAt: e.startsAt.toISOString(),
        href: `/sports/${league.sport}/event/${encodeURIComponent(e.id)}`,
      };
      const add = (id: string, kind: BuilderLeg["kind"], label: string, group: string, prob: number | null, price: number | null, book: string | null, bet: TeamBet) =>
        out.push({ ...base, id: `as:${e.id}:${id}`, kind, label, group: `as:${e.id}:${group}`, priceAmerican: price, bookName: book, archr: prob, edge: edgeOf(prob, price), rates: ratesOf(teamBetOutcomes(history, bet), 1) });

      const { offers } = priceEvent(e.lines, ratings, e.home, e.away, league.sport);
      const game = offers.filter((o) => o.period === "game");
      const ml = game.find((o) => o.kind === "ml");
      if (ml) {
        for (const s of ml.sides) {
          const team = s.side === "home" ? e.home : s.side === "away" ? e.away : null;
          const bet: TeamBet = team ? { kind: "ml", team } : { kind: "draw", home: e.home, away: e.away };
          add(`ml:${s.side}`, "ml", team ? `${team} ML` : "Draw", "ml", s.prob, s.best?.priceAmerican ?? null, s.best?.bookName ?? null, bet);
        }
      }
      const pick = (kind: "spread" | "total"): PricedOffer | null => mainOffer(game.filter((o) => o.kind === kind)) as PricedOffer | null;
      const spread = pick("spread");
      for (const s of spread?.sides ?? []) {
        const team = s.side === "home" ? e.home : e.away;
        add(`spread:${s.side}`, "spread", `${team} ${signed(s.point)}`, "spread", s.prob, s.best?.priceAmerican ?? null, s.best?.bookName ?? null, { kind: "spread", team, point: s.point });
      }
      const total = pick("total");
      for (const s of total?.sides ?? []) {
        if (s.side !== "over" && s.side !== "under") continue;
        add(`total:${s.side}`, "total", `${s.side === "over" ? "Over" : "Under"} ${s.point}`, "total", s.prob, s.best?.priceAmerican ?? null, s.best?.bookName ?? null, {
          kind: "total",
          side: s.side,
          home: e.home,
          away: e.away,
          point: s.point,
        });
      }
    }
  }
  return out;
}
