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
