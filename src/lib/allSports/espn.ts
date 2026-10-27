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
