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

export interface MlbBattingLine {
  atBats: number;
  plateAppearances: number;
  hits: number;
  totalBases: number;
  homeRuns: number;
  rbi: number;
  runs: number;
  baseOnBalls: number;
  strikeOuts: number;
  stolenBases: number;
}

export interface MlbPitchingLine {
  gamesStarted: number; // 1 if this player started the game, else 0 — used to identify the starter, not stored itself
  outs: number;
  strikeOuts: number;
  earnedRuns: number;
  hits: number; // hits allowed
  baseOnBalls: number; // walks allowed
}

export interface MlbBoxscorePlayer {
  personId: number;
  fullName: string;
  batting: MlbBattingLine | null;
  pitching: MlbPitchingLine | null;
}

export interface MlbBoxscoreTeam {
  mlbTeamId: number;
  players: MlbBoxscorePlayer[];
}

export interface MlbBoxscore {
  home: MlbBoxscoreTeam;
  away: MlbBoxscoreTeam;
}

interface MlbBoxscorePlayerRaw {
  person: { id: number; fullName: string };
  stats?: {
    batting?: Partial<MlbBattingLine> & Record<string, unknown>;
    pitching?: Partial<MlbPitchingLine> & Record<string, unknown>;
  };
}

interface MlbBoxscoreTeamRaw {
  team: { id: number };
  players: Record<string, MlbBoxscorePlayerRaw>;
}

interface MlbBoxscoreResponse {
  teams: { home: MlbBoxscoreTeamRaw; away: MlbBoxscoreTeamRaw };
}

function toTeamBoxscore(raw: MlbBoxscoreTeamRaw): MlbBoxscoreTeam {
  const players: MlbBoxscorePlayer[] = Object.values(raw.players).map((p) => {
    const battingStats = p.stats?.batting;
    // A player who didn't come to the plate has a batting stats object with
    // no atBats field at all (not zero) — treat that as "didn't bat", not "0-for-0".
    const batting: MlbBattingLine | null =
      battingStats && typeof battingStats.atBats === "number"
        ? {
            atBats: battingStats.atBats,
            plateAppearances: battingStats.plateAppearances ?? 0,
            hits: battingStats.hits ?? 0,
            totalBases: battingStats.totalBases ?? 0,
            homeRuns: battingStats.homeRuns ?? 0,
            rbi: battingStats.rbi ?? 0,
            runs: battingStats.runs ?? 0,
            baseOnBalls: battingStats.baseOnBalls ?? 0,
            strikeOuts: battingStats.strikeOuts ?? 0,
            stolenBases: battingStats.stolenBases ?? 0,
          }
        : null;

    const pitchingStats = p.stats?.pitching;
    const pitching: MlbPitchingLine | null =
      pitchingStats && typeof pitchingStats.outs === "number"
        ? {
            gamesStarted: pitchingStats.gamesStarted ?? 0,
            outs: pitchingStats.outs,
            strikeOuts: pitchingStats.strikeOuts ?? 0,
            earnedRuns: pitchingStats.earnedRuns ?? 0,
            hits: pitchingStats.hits ?? 0,
            baseOnBalls: pitchingStats.baseOnBalls ?? 0,
          }
        : null;

    return { personId: p.person.id, fullName: p.person.fullName, batting, pitching };
  });

  return { mlbTeamId: raw.team.id, players };
}

/** Full per-player batting/pitching lines for one completed game — the hit-rate engine's raw data source, free. */
export async function fetchMlbBoxscore(gamePk: number): Promise<MlbBoxscore> {
  const res = await fetch(`${BASE_URL}/game/${gamePk}/boxscore`);
  if (!res.ok) {
    throw new Error(`MLB Stats API boxscore request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as MlbBoxscoreResponse;
  return { home: toTeamBoxscore(data.teams.home), away: toTeamBoxscore(data.teams.away) };
}

export interface MlbGameLineup {
  mlbTeamId: number;
  /** Starter person ids in batting order; empty until the lineup is posted (~hours pre-game). */
  personIds: number[];
}

interface BoxscoreLineupTeamRaw {
  team: { id: number };
  battingOrder?: number[];
}

/** Just the posted batting orders for a game — lighter than the full boxscore. Free. */
export async function fetchMlbLineup(gamePk: number): Promise<{ home: MlbGameLineup; away: MlbGameLineup }> {
  const res = await fetch(`${BASE_URL}/game/${gamePk}/boxscore`);
  if (!res.ok) {
    throw new Error(`MLB Stats API lineup request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { teams: { home: BoxscoreLineupTeamRaw; away: BoxscoreLineupTeamRaw } };
  const side = (t: BoxscoreLineupTeamRaw): MlbGameLineup => ({ mlbTeamId: t.team.id, personIds: t.battingOrder ?? [] });
  return { home: side(data.teams.home), away: side(data.teams.away) };
}

export interface MlbPersonHandedness {
  batSide: "L" | "R" | "S" | null;
  pitchHand: "L" | "R" | null;
}

interface MlbPersonHandednessRaw {
  id: number;
  batSide?: { code: string };
  pitchHand?: { code: string };
}

/** Batched — one call covers every new player seen across a whole backfill batch/day, not one call per player. */
export async function fetchMlbPersonHandedness(personIds: number[]): Promise<Map<number, MlbPersonHandedness>> {
  if (personIds.length === 0) return new Map();

  const url = `${BASE_URL}/people?personIds=${personIds.join(",")}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MLB Stats API people request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { people?: MlbPersonHandednessRaw[] };

  const result = new Map<number, MlbPersonHandedness>();
  for (const p of data.people ?? []) {
    result.set(p.id, {
      batSide: (p.batSide?.code as MlbPersonHandedness["batSide"]) ?? null,
      pitchHand: (p.pitchHand?.code as MlbPersonHandedness["pitchHand"]) ?? null,
    });
  }
  return result;
}
