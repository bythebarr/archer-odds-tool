/**
 * Pulls every player prop ESPN's free odds feed carries (DraftKings today) for
 * events in the next four days, in every league ESPN lists them for: NBA, NFL, MLB,
 * NHL, soccer, college, MMA. Everything lands in EventPropLine; NBA and NFL
 * props also go into CurrentNbaPropLine / CurrentNflPropLine (+ snapshots),
 * which their boards and alt-line ladders already read.
 *
 * Only the polled book's own rows on a polled event are replaced; another
 * feed's books on the same event are never touched.
 */
import { prisma } from "@/lib/prisma";
import { etDateOf, etDayBoundsUtc } from "@/lib/dateEt";
import { ALLOWED_BOOK_KEYS } from "@/lib/odds/bookAllowlist";
import { NBA_LEAGUE } from "@/lib/nba/league";
import { NFL_LEAGUE } from "@/lib/nfl/league";
import type { TeamLeague } from "@/lib/teamLeague/league";
import type { NbaPropStat, NflPropStat } from "@/generated/prisma/client";
import { providerKey } from "./espnOdds";
import { NBA_STAT_BY_KEY, NFL_STAT_BY_KEY, parseEspnProps, typedSide, type EspnPropBet, type EspnPropQuote } from "./espnProps";

const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const CORE = "https://sports.core.api.espn.com/v2/sports";
/** DraftKings posts NFL props from midweek and soccer's a couple of days out; later than this isn't up yet. */
const LOOKAHEAD_DAYS = 4;
const LOOKAHEAD_MS = LOOKAHEAD_DAYS * 86_400_000;
const ALLOWED = new Set<string>(ALLOWED_BOOK_KEYS);

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url.replace(/^http:/, "https:"), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** "soccer/eng.1" → "soccer/leagues/eng.1" (the core API's shape). */
const corePath = (espnPath: string) => {
  const [sport, league] = espnPath.split("/");
  return `${sport}/leagues/${league}`;
};

interface ScoreboardEvent {
  id: string;
  date: string;
  competitions: { status?: { type?: { state?: string } }; competitors: { homeAway: "home" | "away"; team: { displayName: string } }[] }[];
}

async function upcomingEvents(espnPath: string, now: Date): Promise<ScoreboardEvent[]> {
  const out: ScoreboardEvent[] = [];
  for (let d = 0; d <= LOOKAHEAD_DAYS; d++) {
    const day = etDateOf(new Date(now.getTime() + d * 86_400_000)).replace(/-/g, "");
    const sb = await getJson<{ events?: ScoreboardEvent[] }>(`${SITE}/${espnPath}/scoreboard?dates=${day}&limit=500`);
    for (const e of sb?.events ?? []) {
      const t = new Date(e.date).getTime();
      if (e.competitions[0]?.status?.type?.state === "pre" && t >= now.getTime() && t <= now.getTime() + LOOKAHEAD_MS && !out.some((x) => x.id === e.id)) out.push(e);
    }
  }
  return out;
}

/** Every book's props on one event: { bookKey → quotes }. */
async function eventProps(espnPath: string, eventId: string): Promise<{ bookKey: string; quotes: EspnPropQuote[]; refs: Map<string, string> }[]> {
  const base = `${CORE}/${corePath(espnPath)}/events/${eventId}/competitions/${eventId}/odds`;
  const odds = await getJson<{ items?: { provider?: { id?: string; name?: string }; propBets?: unknown }[] }>(base);
  const out: { bookKey: string; quotes: EspnPropQuote[]; refs: Map<string, string> }[] = [];
  for (const item of odds?.items ?? []) {
    const bookKey = providerKey(item.provider?.name);
    if (!item.propBets || !item.provider?.id || !bookKey || !ALLOWED.has(bookKey)) continue;
    const items: EspnPropBet[] = [];
    for (let page = 1; page <= 10; page++) {
      const pb = await getJson<{ items?: EspnPropBet[]; pageCount?: number }>(`${base}/${item.provider.id}/propBets?limit=1000&page=${page}`);
      items.push(...(pb?.items ?? []));
      if (!pb || page >= (pb.pageCount ?? 1)) break;
    }
    const refs = new Map<string, string>();
    for (const p of items) {
      const id = p.athlete?.$ref?.match(/\/athletes\/(\d+)/)?.[1];
      if (id && p.athlete?.$ref) refs.set(id, p.athlete.$ref);
    }
    out.push({ bookKey, quotes: parseEspnProps(items).quotes, refs });
  }
  return out;
}

/** Names for athletes we hold no row for, one ESPN lookup each (cached for the run). */
async function athleteNames(ids: string[], refs: Map<string, string>, known: Map<string, string>, deadline: number): Promise<void> {
  const missing = ids.filter((id) => !known.has(id) && refs.has(id));
  for (let i = 0; i < missing.length && Date.now() < deadline; i += 8) {
    await Promise.all(
      missing.slice(i, i + 8).map(async (id) => {
        const a = await getJson<{ displayName?: string; fullName?: string }>(refs.get(id)!);
        const name = a?.displayName ?? a?.fullName;
        if (name) known.set(id, name);
      })
    );
  }
}

export interface EspnPropsSummary {
  leagues: number;
  eventsChecked: number;
  eventsWithProps: number;
  quotesStored: number;
  /** Of those, lines posted with no price yet. */
  unpriced: number;
  nbaLinesStored: number;
  nflLinesStored: number;
  /** Markets stored only in EventPropLine for a sport with a typed table (count by market). */
  unmappedTyped: Record<string, number>;
  /** Athletes with props but no NbaPlayer / NflPlayer row (rookies not yet logged, mostly). */
  unmatchedAthletes: number;
  stoppedEarly: boolean;
}

type Typed = { kind: "nba" | "nfl"; league: TeamLeague };
const TYPED: Record<string, Typed> = {
  "basketball/nba": { kind: "nba", league: NBA_LEAGUE },
  "football/nfl": { kind: "nfl", league: NFL_LEAGUE },
};

function matchupName(e: ScoreboardEvent): string | null {
  const c = e.competitions[0];
  const home = c?.competitors.find((x) => x.homeAway === "home")?.team.displayName;
  const away = c?.competitors.find((x) => x.homeAway === "away")?.team.displayName;
  return home && away ? `${away} @ ${home}` : null;
}

async function gameIdFor(espnPath: string, e: ScoreboardEvent): Promise<string | null> {
  const c = e.competitions[0];
  const homeName = c?.competitors.find((x) => x.homeAway === "home")?.team.displayName ?? "";
  const awayName = c?.competitors.find((x) => x.homeAway === "away")?.team.displayName ?? "";
  const typed = TYPED[espnPath];
  if (typed) {
    const home = typed.league.lookupTeam(homeName);
    const away = typed.league.lookupTeam(awayName);
    if (!home || !away) return null;
    const { gte, lt } = etDayBoundsUtc(etDateOf(new Date(e.date)));
    const g = await prisma.game.findFirst({ where: { sport: typed.league.sport, scheduledStartUtc: { gte, lt }, homeTeam: { name: home.name }, awayTeam: { name: away.name } }, select: { id: true } });
    return g?.id ?? null;
  }
  if (espnPath === "baseball/mlb") {
    const t = new Date(e.date).getTime();
    const g = await prisma.game.findFirst({
      where: { sport: "mlb", scheduledStartUtc: { gte: new Date(t - 6 * 3_600_000), lte: new Date(t + 6 * 3_600_000) }, homeTeam: { name: homeName }, awayTeam: { name: awayName } },
      select: { id: true },
    });
    return g?.id ?? null;
  }
  const ev = await prisma.sportEvent.findUnique({ where: { id: `espn:${e.id}` }, select: { id: true } });
  return ev?.id ?? null;
}

/** The leagues to read: the big four, then every active ESPN league in the all-sports engine. */
async function leaguePaths(): Promise<string[]> {
  const fixed = ["basketball/nba", "football/nfl", "baseball/mlb", "hockey/nhl", "mma/ufc"];
  const rows = await prisma.league.findMany({ where: { active: true, espnPath: { not: null }, upcomingCount: { gt: 0 } }, select: { espnPath: true }, orderBy: { rank: "asc" } });
  return [...new Set([...fixed, ...rows.map((r) => r.espnPath!)])];
}

export async function pollEspnProps(deadline: number, now = new Date()): Promise<EspnPropsSummary> {
  const out: EspnPropsSummary = { leagues: 0, eventsChecked: 0, eventsWithProps: 0, quotesStored: 0, unpriced: 0, nbaLinesStored: 0, nflLinesStored: 0, unmappedTyped: {}, unmatchedAthletes: 0, stoppedEarly: false };
  const names = new Map<string, string>();
  const unmatched = new Set<string>();

  for (const espnPath of await leaguePaths()) {
    if (Date.now() > deadline) {
      out.stoppedEarly = true;
      break;
    }
    const events = await upcomingEvents(espnPath, now);
    out.leagues++;
    for (const e of events) {
      if (Date.now() > deadline) {
        out.stoppedEarly = true;
        break;
      }
      out.eventsChecked++;
      const books = await eventProps(espnPath, e.id);
      if (!books.some((b) => b.quotes.length)) continue;
      out.eventsWithProps++;
      const eventRef = await gameIdFor(espnPath, e);
      const typed = TYPED[espnPath];

      // Our own player rows by ESPN id, and names for the rest.
      const ids = [...new Set(books.flatMap((b) => b.quotes.map((q) => q.athleteId)))];
      const players =
        typed?.kind === "nba"
          ? await prisma.nbaPlayer.findMany({ where: { espnAthleteId: { in: ids } }, select: { id: true, espnAthleteId: true, fullName: true } })
          : typed?.kind === "nfl"
            ? await prisma.nflPlayer.findMany({ where: { espnAthleteId: { in: ids } }, select: { id: true, espnAthleteId: true, fullName: true } })
            : [];
      const playerId = new Map(players.map((p) => [p.espnAthleteId, p.id]));
      for (const p of players) names.set(p.espnAthleteId, p.fullName);
      if (espnPath.startsWith("soccer/")) {
        for (const p of await prisma.soccerPlayer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) names.set(p.id, p.name);
      }
      for (const b of books) await athleteNames(ids, b.refs, names, deadline);

      for (const { bookKey, quotes } of books) {
        if (!quotes.length) continue;
        const polledAt = new Date();
        const startsAt = new Date(e.date);
        const rows = quotes.map((q) => ({
          league: espnPath,
          espnEventId: e.id,
          eventRef,
          eventName: matchupName(e),
          startsAt,
          athleteId: q.athleteId,
          athleteName: names.get(q.athleteId) ?? null,
          market: q.market,
          statKey: q.statKey,
          period: q.period,
          side: q.side,
          point: q.point,
          bookKey,
          priceAmerican: q.priceAmerican,
          openPriceAmerican: q.openPriceAmerican,
          sourceUpdatedAt: q.updatedAt,
          polledAt,
        }));
        await prisma.$transaction([
          prisma.eventPropLine.deleteMany({ where: { espnEventId: e.id, bookKey } }),
          prisma.eventPropLine.createMany({ data: rows, skipDuplicates: true }),
        ]);
        out.quotesStored += rows.length;
        out.unpriced += quotes.filter((q) => q.priceAmerican === null).length;

        if (!typed || !eventRef) continue;
        const map = typed.kind === "nba" ? NBA_STAT_BY_KEY : NFL_STAT_BY_KEY;
        const typedRows = new Map<string, { gameId: string; playerId: string; stat: string; side: "over" | "under"; point: number; priceAmerican: number }>();
        for (const q of quotes) {
          const stat = map[q.statKey];
          const ts = typedSide(q);
          // The boards compare prices: a number with no price yet stays in EventPropLine only.
          if (q.priceAmerican === null) continue;
          const price = q.priceAmerican;
          if (!stat || !ts) {
            if (q.period === "game" && !stat) out.unmappedTyped[q.market] = (out.unmappedTyped[q.market] ?? 0) + 1;
            continue;
          }
          const pid = playerId.get(q.athleteId);
          if (!pid) {
            unmatched.add(q.athleteId);
            continue;
          }
          // The main line and its alt rung can be the same number: keep one (the main line's, listed first).
          const key = `${pid}|${stat}|${ts.side}|${ts.point}`;
          if (!typedRows.has(key)) typedRows.set(key, { gameId: eventRef, playerId: pid, stat, side: ts.side, point: ts.point, priceAmerican: price });
        }
        if (!typedRows.size) continue;
        await prisma.sportsbook.upsert({ where: { key: bookKey }, create: { key: bookKey, displayName: bookKey === "draftkings" ? "DraftKings" : bookKey, region: "us" }, update: {} });
        const list = [...typedRows.values()];
        if (typed.kind === "nba") {
          const data = list.map((r) => ({ gameId: r.gameId, nbaPlayerId: r.playerId, bookKey, stat: r.stat as NbaPropStat, side: r.side, point: r.point, priceAmerican: r.priceAmerican, polledAt }));
          await prisma.$transaction([
            prisma.nbaPropSnapshot.createMany({ data }),
            prisma.currentNbaPropLine.deleteMany({ where: { gameId: eventRef, bookKey } }),
            prisma.currentNbaPropLine.createMany({ data, skipDuplicates: true }),
          ]);
          out.nbaLinesStored += data.length;
        } else {
          const data = list.map((r) => ({ gameId: r.gameId, nflPlayerId: r.playerId, bookKey, stat: r.stat as NflPropStat, side: r.side, point: r.point, priceAmerican: r.priceAmerican, polledAt }));
          await prisma.$transaction([
            prisma.nflPropSnapshot.createMany({ data }),
            prisma.currentNflPropLine.deleteMany({ where: { gameId: eventRef, bookKey } }),
            prisma.currentNflPropLine.createMany({ data, skipDuplicates: true }),
          ]);
          out.nflLinesStored += data.length;
        }
      }
    }
  }
  out.unmatchedAthletes = unmatched.size;
  return out;
}
