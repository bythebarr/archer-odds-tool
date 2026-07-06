import { prisma } from "@/lib/prisma";
import { fetchOdds, fetchSportsList, type OddsApiEvent, type OddsApiMarketKey } from "@/lib/odds/oddsApiClient";
import { storeBookmakerOdds } from "@/lib/odds/storeOdds";
import { WORLD_CUP_SPORT_KEY } from "./tournamentAllowlist";

/** h2h only (3-way: home/draw/away) — see the credit budget note below and lineEconomics.ts's 2-way-only devig. */
const SOCCER_MARKETS: OddsApiMarketKey[] = ["h2h"];
/** Same US-legal-books-only regions as MLB/tennis — see bookAllowlist.ts. */
const SOCCER_REGIONS = ["us", "us2"];

/**
 * Returns WORLD_CUP_SPORT_KEY if the Odds API currently lists it active,
 * null otherwise (e.g. between tournaments) — mirrors tennis's
 * resolveActiveTennisSportKey, but no ATP/WTA-style fallback since there's
 * only one allowlisted key here.
 */
export async function resolveActiveSoccerSportKey(): Promise<string | null> {
  const sports = await fetchSportsList();
  const match = sports.find((s) => s.key === WORLD_CUP_SPORT_KEY);
  return match?.active ? WORLD_CUP_SPORT_KEY : null;
}

/**
 * Turns a national-team name into a short display code, e.g. "Portugal" ->
 * "POR", "United States" -> "US". No real crest/logo source exists for
 * international soccer yet, so this is only a fallback-badge label
 * (TeamBadge already renders colored initials when no logo image matches) —
 * not meant to match any official federation code.
 */
function synthesizeAbbreviation(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words
      .map((w) => w[0]!.toUpperCase())
      .join("")
      .slice(0, 4);
  }
  return name.slice(0, 3).toUpperCase();
}

async function upsertTeam(name: string) {
  return prisma.team.upsert({
    where: { oddsApiName: name },
    create: {
      name,
      oddsApiName: name,
      abbreviation: synthesizeAbbreviation(name),
      league: "FIFA World Cup",
      division: "",
    },
    update: {},
  });
}

/**
 * Finds or creates the Game row for a World Cup match event. Same rationale
 * as tennis's upsertMatchForEvent: the odds poll itself is the source of
 * truth for which matches exist (no separate free schedule source), keyed by
 * the Odds API's own event id.
 */
async function upsertMatchForEvent(event: OddsApiEvent) {
  const existing = await prisma.game.findUnique({ where: { oddsApiEventId: event.id, sport: "soccer" } });
  if (existing) return existing;

  const [homeTeam, awayTeam] = await Promise.all([
    upsertTeam(event.home_team),
    upsertTeam(event.away_team),
  ]);

  return prisma.game.create({
    data: {
      sport: "soccer",
      oddsApiEventId: event.id,
      season: new Date(event.commence_time).getUTCFullYear(),
      scheduledStartUtc: new Date(event.commence_time),
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
    },
  });
}

export interface PollSoccerOddsSummary {
  sportKeyPolled: string | null;
  eventsFetched: number;
  matchesStored: number;
  snapshotsWritten: number;
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/**
 * Fetches current World Cup odds and archives them (see storeBookmakerOdds
 * for the write shape, shared unchanged with MLB/tennis). h2h only, us/us2
 * regions.
 *
 * Credit budget: 1 market x 2 regions = 2 credits/call, same shape as
 * tennis. Free-tier headroom is already tight (see PollCreditLog/PollLog
 * history) — start on tennis's fixed-cadence pattern (see
 * poll-odds-soccer/route.ts), not MLB's tiered 5-min-near-kickoff throttle,
 * until real World Cup usage data justifies tightening or loosening it.
 */
export async function pollAndStoreSoccerOdds(): Promise<PollSoccerOddsSummary> {
  const sportKey = await resolveActiveSoccerSportKey();
  if (!sportKey) {
    return {
      sportKeyPolled: null,
      eventsFetched: 0,
      matchesStored: 0,
      snapshotsWritten: 0,
      creditsUsed: null,
      creditsRemaining: null,
    };
  }

  const { events, creditsUsed, creditsRemaining } = await fetchOdds(sportKey, SOCCER_MARKETS, SOCCER_REGIONS);

  let matchesStored = 0;
  let snapshotsWritten = 0;
  const now = new Date();

  for (const event of events) {
    // Same rule as MLB/tennis: skip matches already underway — the Odds
    // API's h2h price reflects live match state once play starts, not a
    // shoppable pregame line.
    const minutesToStart = (new Date(event.commence_time).getTime() - now.getTime()) / 60_000;
    if (minutesToStart < 0) continue;

    const match = await upsertMatchForEvent(event);
    matchesStored++;
    snapshotsWritten += await storeBookmakerOdds(match.id, event.home_team, event.away_team, event.bookmakers);
  }

  return {
    sportKeyPolled: sportKey,
    eventsFetched: events.length,
    matchesStored,
    snapshotsWritten,
    creditsUsed,
    creditsRemaining,
  };
}
