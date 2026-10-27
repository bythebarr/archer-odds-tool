/**
 * ESPN's free site API, for the leagues it covers (most of world soccer, the
 * NHL, college sports, the AFL, NRL…): every team's crest, abbreviation and
 * color, the league's logo, and results going back over a season — the
 * history the ratings need before our own feed has any.
 *
 * Results are stored as SportEvents with id "espn:<id>", final only. The odds
 * feed's own copy of the same match (a different id) is deduplicated when the
 * ratings read them (model/history.ts).
 */
import { prisma } from "@/lib/prisma";
import { teamKey } from "./names";
import { espnLeagues } from "./leagueDirectory";

const BASE = "https://site.api.espn.com/apis/site/v2/sports";

interface EspnTeam {
  displayName: string;
  shortDisplayName?: string;
  abbreviation?: string;
  color?: string;
  logos?: { href: string }[];
  logo?: string;
}

async function espnJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/** Every team in an ESPN league → Competitor rows with crest, abbreviation and color. */
export async function syncEspnTeams(sport: string, espnPath: string): Promise<number> {
  const data = await espnJson<{ sports?: { leagues?: { teams?: { team: EspnTeam }[] }[] }[] }>(`${BASE}/${espnPath}/teams?limit=1000`);
  const teams = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  for (const { team } of teams) {
    const logoUrl = team.logos?.[0]?.href ?? team.logo ?? null;
    const id = `${sport}/${teamKey(team.displayName)}`;
    const data = { sport, name: team.displayName, abbreviation: team.abbreviation ?? null, color: team.color ?? null, logoUrl, logoSource: logoUrl ? "espn" : null, logoCheckedAt: new Date() };
    await prisma.competitor.upsert({ where: { id }, create: { id, ...data }, update: data });
  }
  return teams.length;
}

interface EspnScoreboard {
  leagues?: { logos?: { href: string }[] }[];
  events?: {
    id: string;
    date: string;
    competitions: {
      neutralSite?: boolean;
      status: { type: { completed: boolean; state: string } };
      competitors: { homeAway: "home" | "away"; score?: string; team: EspnTeam }[];
    }[];
  }[];
}

function parseScoreboard(data: EspnScoreboard | null) {
  const logo = data?.leagues?.[0]?.logos?.[0]?.href ?? null;
  const results = (data?.events ?? []).flatMap((e) => {
    const c = e.competitions[0];
    if (!c?.status.type.completed) return [];
    const home = c.competitors.find((x) => x.homeAway === "home");
    const away = c.competitors.find((x) => x.homeAway === "away");
    const hs = Number(home?.score);
    const as = Number(away?.score);
    if (!home || !away || !Number.isFinite(hs) || !Number.isFinite(as)) return [];
    return [{ id: `espn:${e.id}`, startsAt: new Date(e.date), home: home.team.displayName, away: away.team.displayName, homeScore: hs, awayScore: as }];
  });
  return { logo, results };
}

/**
 * One month of a league's results (ESPN takes YYYYMM); returns the league logo
 * too. College scoreboards cap a month and list only ranked teams by default,
 * so those go day by day over the whole division.
 */
export async function fetchEspnMonth(espnPath: string, yyyymm: string) {
  const college = espnPath.includes("college");
  if (!college) return parseScoreboard(await espnJson<EspnScoreboard>(`${BASE}/${espnPath}/scoreboard?dates=${yyyymm}&limit=1000`));
  const groups = espnPath.endsWith("college-football") ? 80 : 50;
  const year = Number(yyyymm.slice(0, 4));
  const month = Number(yyyymm.slice(4)) - 1;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  let logo: string | null = null;
  const results: ReturnType<typeof parseScoreboard>["results"] = [];
  for (let d = 1; d <= days; d++) {
    const day = `${yyyymm}${String(d).padStart(2, "0")}`;
    const page = parseScoreboard(await espnJson<EspnScoreboard>(`${BASE}/${espnPath}/scoreboard?dates=${day}&limit=500&groups=${groups}`));
    logo = logo ?? page.logo;
    results.push(...page.results);
  }
  return { logo, results };
}

/** The YYYYMM months from `monthsBack` ago through this one. */
export function monthsBack(now: Date, monthsBack: number): string[] {
  const out: string[] = [];
  for (let i = monthsBack; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Stores a league's ESPN results for the given months and its logo. Returns the
 * number of results stored.
 */
export async function backfillEspnLeague(leagueId: string, espnPath: string, months: string[]): Promise<number> {
  let n = 0;
  let logo: string | null = null;
  for (const m of months) {
    const res = await fetchEspnMonth(espnPath, m);
    logo = logo ?? res.logo;
    for (const r of res.results) {
      await prisma.sportEvent.upsert({
        where: { id: r.id },
        create: { ...r, leagueId, status: "final" },
        update: { homeScore: r.homeScore, awayScore: r.awayScore, status: "final" },
      });
      n++;
    }
  }
  if (logo) await prisma.league.update({ where: { id: leagueId }, data: { logoUrl: logo } });
  return n;
}

/**
 * Every league ESPN covers gets a League row even before an odds feed lists it,
 * so its fixtures, history, crests and ARCHR's own prices show from day one. A
 * feed that later lists the league takes the row over (same id).
 */
export async function seedEspnLeagues(): Promise<number> {
  let n = 0;
  for (const l of espnLeagues()) {
    const sport = l.id.slice(0, l.id.indexOf("/"));
    const exists = await prisma.league.findUnique({ where: { id: l.id }, select: { id: true } });
    if (exists) continue;
    await prisma.league.create({ data: { id: l.id, sport, name: l.name, region: l.region, provider: "espn", providerKey: l.espn!, espnPath: l.espn!, rank: l.rank, outright: false } });
    n++;
  }
  return n;
}

interface ScheduledEvent {
  id: string;
  date: string;
  competitions: { status: { type: { state: string; completed: boolean } }; competitors: { homeAway: "home" | "away"; team: EspnTeam }[] }[];
}

/**
 * The next `days` days of a league's fixtures as scheduled SportEvents
 * ("espn:<id>" — the same id the result lands on later). Returns how many.
 */
export async function syncEspnFixtures(leagueId: string, espnPath: string, days: number, now = new Date()): Promise<number> {
  const groups = espnPath.endsWith("college-football") ? "&groups=80" : espnPath.includes("college-basketball") ? "&groups=50" : "";
  let n = 0;
  for (let d = 0; d < days; d++) {
    const day = new Date(now.getTime() + d * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
    const data = await espnJson<{ events?: ScheduledEvent[] }>(`${BASE}/${espnPath}/scoreboard?dates=${day}&limit=500${groups}`);
    for (const e of data?.events ?? []) {
      const c = e.competitions[0];
      if (!c || c.status.type.completed || c.status.type.state === "post") continue;
      const home = c.competitors.find((x) => x.homeAway === "home")?.team.displayName;
      const away = c.competitors.find((x) => x.homeAway === "away")?.team.displayName;
      if (!home || !away) continue;
      const id = `espn:${e.id}`;
      const status = c.status.type.state === "in" ? "live" : "scheduled";
      await prisma.sportEvent.upsert({
        where: { id },
        create: { id, leagueId, startsAt: new Date(e.date), home, away, status },
        update: { startsAt: new Date(e.date), home, away, status },
      });
      n++;
    }
  }
  const upcoming = await prisma.sportEvent.findMany({
    where: { leagueId, status: { in: ["scheduled", "live"] }, startsAt: { gte: new Date(now.getTime() - 3 * 3_600_000) } },
    orderBy: { startsAt: "asc" },
    select: { startsAt: true },
  });
  // A feed-polled league keeps the feed's own count; an ESPN-only one takes these.
  await prisma.league.updateMany({
    where: { id: leagueId, provider: "espn" },
    data: { nextEventAt: upcoming[0]?.startsAt ?? null, upcomingCount: upcoming.length, active: true },
  });
  return n;
}
