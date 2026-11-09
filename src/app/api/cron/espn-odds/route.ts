import { prisma } from "@/lib/prisma";
import { checkCronAuth } from "@/lib/cronAuth";
import { NBA_LEAGUE } from "@/lib/nba/league";
import { NFL_LEAGUE } from "@/lib/nfl/league";
import { NHL_LEAGUE } from "@/lib/nhl/league";
import { espnOddsStatus, pollEspnOddsMlb, pollEspnOddsTeamLeague, storeScoreboardOddsForLeague, storeSoccerPickcenterOdds, type EspnOddsSummary, type EspnRunSection } from "@/lib/odds/espnOddsPoll";
import { recordPollLog } from "@/lib/pollingPolicy";

/**
 * Free book prices from ESPN (no key, no credits): NBA, NFL, NHL and MLB games, every
 * US-style ESPN league in the all-sports engine, then soccer match by match
 * until the time runs out. Safe to call as often as the cron allows.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const started = Date.now();
  const deadline = started + 50_000;
  const out: Record<string, unknown> = {};
  const safe = async <T,>(key: string, f: () => Promise<T>): Promise<T | undefined> => {
    if (Date.now() > deadline) return undefined;
    try {
      const v = await f();
      out[key] = v;
      return v;
    } catch (error) {
      out[key] = { error: error instanceof Error ? error.message.slice(0, 160) : String(error) };
      return undefined;
    }
  };
  const nba = await safe("nba", () => pollEspnOddsTeamLeague(NBA_LEAGUE, 2));
  const nfl = await safe("nfl", () => pollEspnOddsTeamLeague(NFL_LEAGUE, 7));
  const mlb = await safe("mlb", () => pollEspnOddsMlb(3));
  const nhl = await safe("nhl", () => pollEspnOddsTeamLeague(NHL_LEAGUE, 3));
  const leagues = await prisma.league.findMany({ where: { active: true, espnPath: { not: null }, NOT: { sport: "soccer" }, upcomingCount: { gt: 0 } }, select: { espnPath: true } });
  let others = 0;
  let leagueFeedFailures = 0;
  const leagueErrors: string[] = [];
  for (const l of leagues) {
    if (Date.now() > deadline - 15_000) break;
    const r = await safe(`league:${l.espnPath}`, () => storeScoreboardOddsForLeague(l.espnPath!, 3));
    if (r) {
      others += r.lines;
      leagueFeedFailures += r.feedFailures;
    } else if (out[`league:${l.espnPath}`]) {
      leagueErrors.push(l.espnPath!);
    }
  }
  out.otherLeagueLines = others;
  const soccer = await safe("soccer", () => storeSoccerPickcenterOdds(60, 120, deadline));

  // Classify the run instead of stamping "ok" unconditionally (the silent
  // failure shape behind the Oct-Nov 2026 freeze): a section whose feed failed
  // outright, or whose job threw, is named in an error: status; work that
  // landed nothing is an error; a genuinely empty slate is not.
  const sections: EspnRunSection[] = [];
  const pushSummary = (label: string, v: EspnOddsSummary | undefined) => {
    if (v) {
      sections.push({ label, games: v.games, priced: v.priced, feedFailures: v.feedFailures });
    } else {
      const e = (out[label] as { error?: string } | undefined)?.error;
      if (e) sections.push({ label, games: 0, priced: 0, feedFailures: 0, error: e });
    }
  };
  pushSummary("nba", nba);
  pushSummary("nfl", nfl);
  pushSummary("mlb", mlb);
  pushSummary("nhl", nhl);
  sections.push({
    label: "otherLeagues",
    games: 0,
    priced: 0,
    feedFailures: leagueFeedFailures,
    ...(leagueErrors.length ? { error: `league jobs threw: ${leagueErrors.join(", ")}` } : {}),
  });
  if (soccer) {
    sections.push({ label: "soccer", games: 0, priced: 0, feedFailures: soccer.feedFailures });
  } else {
    const e = (out["soccer"] as { error?: string } | undefined)?.error;
    if (e) sections.push({ label: "soccer", games: 0, priced: 0, feedFailures: 0, error: e });
  }
  const status = espnOddsStatus(sections, others + (soccer?.lines ?? 0));
  await recordPollLog("espn-odds", status);
  return Response.json(out);
}
