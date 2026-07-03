const BASE_URL = "https://statsapi.mlb.com/api/v1";
const MLB_SPORT_ID = 1;

export interface MlbTeam {
  id: number;
  name: string;
  abbreviation: string;
  league: { id: number; name: string };
  division: { id: number; name: string };
}

export async function fetchMlbTeams(): Promise<MlbTeam[]> {
  const res = await fetch(`${BASE_URL}/teams?sportId=${MLB_SPORT_ID}&activeStatus=Y`);
  if (!res.ok) {
    throw new Error(`MLB Stats API teams request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.teams as MlbTeam[];
}

interface MlbScheduleTeam {
  team: { id: number; name: string };
  score?: number;
  probablePitcher?: { id: number; fullName: string };
}

interface MlbScheduleGame {
  gamePk: number;
  gameDate: string;
  season: string;
  status: {
    abstractGameState: "Preview" | "Live" | "Final" | "Other";
    detailedState: string;
  };
  teams: {
    home: MlbScheduleTeam;
    away: MlbScheduleTeam;
  };
}

interface MlbScheduleResponse {
  dates: {
    date: string;
    games: MlbScheduleGame[];
  }[];
}

export interface MlbGame {
  mlbGameId: number;
  scheduledStartUtc: Date;
  season: number;
  detailedState: string;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
}

/** MLB Stats API's own detailedState strings, mapped down to our GameStatus enum. */
export function mapDetailedStateToStatus(
  detailedState: string
): "scheduled" | "live" | "final" | "postponed" {
  const state = detailedState.toLowerCase();
  if (state.includes("postponed") || state.includes("cancelled") || state.includes("suspended")) {
    return "postponed";
  }
  if (state === "final" || state.includes("game over") || state.includes("completed")) {
    return "final";
  }
  if (state.includes("progress") || state.includes("live") || state.includes("delayed")) {
    return "live";
  }
  return "scheduled";
}

/** Fetches the MLB schedule for every date in [startDate, endDate], inclusive (YYYY-MM-DD, ET). */
export async function fetchMlbSchedule(startDate: string, endDate: string): Promise<MlbGame[]> {
  const url = `${BASE_URL}/schedule?sportId=${MLB_SPORT_ID}&startDate=${startDate}&endDate=${endDate}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MLB Stats API schedule request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as MlbScheduleResponse;

  return data.dates.flatMap((d) =>
    d.games.map((g) => ({
      mlbGameId: g.gamePk,
      scheduledStartUtc: new Date(g.gameDate),
      season: Number(g.season),
      detailedState: g.status.detailedState,
      homeTeamId: g.teams.home.team.id,
      awayTeamId: g.teams.away.team.id,
      homeScore: g.teams.home.score ?? null,
      awayScore: g.teams.away.score ?? null,
    }))
  );
}

export interface MlbProbablePitcher {
  mlbPersonId: number;
  fullName: string;
}

export interface MlbGameProbablePitchers {
  mlbGameId: number;
  homeProbable: MlbProbablePitcher | null;
  awayProbable: MlbProbablePitcher | null;
}

/** Probable starters for every date in [startDate, endDate]. Usually null 1-5+ days out — MLB confirms starters close to game day. */
export async function fetchMlbProbablePitchers(
  startDate: string,
  endDate: string
): Promise<MlbGameProbablePitchers[]> {
  const url = `${BASE_URL}/schedule?sportId=${MLB_SPORT_ID}&startDate=${startDate}&endDate=${endDate}&hydrate=probablePitcher`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MLB Stats API probable-pitcher request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as MlbScheduleResponse;

  function toProbable(team: MlbScheduleTeam): MlbProbablePitcher | null {
    if (!team.probablePitcher) return null;
    return { mlbPersonId: team.probablePitcher.id, fullName: team.probablePitcher.fullName };
  }

  return data.dates.flatMap((d) =>
    d.games.map((g) => ({
      mlbGameId: g.gamePk,
      homeProbable: toProbable(g.teams.home),
      awayProbable: toProbable(g.teams.away),
    }))
  );
}

export interface MlbPitcherSeasonStat {
  mlbPersonId: number;
  fullName: string;
  wins: number;
  losses: number;
  gamesStarted: number;
  era: number | null; // recomputed from earnedRuns/outs rather than trusting MLB's era string (which is non-numeric, e.g. "-.--", for 0-IP pitchers)
  inningsPitched: number | null;
}

interface MlbPitchingStatSplit {
  stat: {
    wins?: number;
    losses?: number;
    gamesStarted?: number;
    earnedRuns?: number;
    outs?: number;
  };
}

interface MlbPersonWithStats {
  id: number;
  fullName: string;
  stats?: { splits: MlbPitchingStatSplit[] }[];
}

/**
 * Batched season pitching line for many pitchers in one call — a day's slate
 * needs at most ~30 probable-pitcher ids, so this is one request per sync
 * tick regardless of slate size.
 */
export async function fetchPitcherSeasonStats(
  personIds: number[],
  season: number
): Promise<MlbPitcherSeasonStat[]> {
  if (personIds.length === 0) return [];

  const url = `${BASE_URL}/people?personIds=${personIds.join(",")}&hydrate=stats(group=pitching,type=season,season=${season})`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MLB Stats API people/stats request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { people?: MlbPersonWithStats[] };

  return (data.people ?? []).map((p) => {
    // Sum across splits rather than assuming exactly one — covers the rare
    // mid-season-trade case where a pitcher has a separate split per team.
    const splits = p.stats?.[0]?.splits ?? [];
    let wins = 0;
    let losses = 0;
    let gamesStarted = 0;
    let earnedRuns = 0;
    let outs = 0;
    for (const split of splits) {
      wins += split.stat.wins ?? 0;
      losses += split.stat.losses ?? 0;
      gamesStarted += split.stat.gamesStarted ?? 0;
      earnedRuns += split.stat.earnedRuns ?? 0;
      outs += split.stat.outs ?? 0;
    }

    return {
      mlbPersonId: p.id,
      fullName: p.fullName,
      wins,
      losses,
      gamesStarted,
      era: outs > 0 ? (earnedRuns * 27) / outs : null,
      inningsPitched: outs > 0 ? outs / 3 : null,
    };
  });
}
