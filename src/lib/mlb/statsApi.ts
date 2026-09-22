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

interface MlbScheduleVenue {
  id: number;
  name: string;
  location?: {
    defaultCoordinates?: { latitude: number; longitude: number };
    azimuthAngle?: number;
    elevation?: number;
  };
  fieldInfo?: { roofType?: string };
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
  venue?: MlbScheduleVenue;
}

interface MlbScheduleResponse {
  dates: {
    date: string;
    games: MlbScheduleGame[];
  }[];
}

/** A ballpark's geography — sourced from the schedule's own venue(location,fieldInfo) hydrate, confirmed live to already include everything the weather model needs (no separate venue lookup, no hand-built table). Null fields mean MLB didn't report that piece for this venue (rare) — never guessed. */
export interface MlbVenue {
  mlbVenueId: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
  elevationFt: number | null;
  azimuthDeg: number | null;
  roofType: string | null;
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
  venue: MlbVenue | null;
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
  // gameType=R,F,D,L,W keeps only games that count toward records: regular
  // season + every postseason round. Without it the API also returns spring
  // training (S), exhibition (E), and All-Star (A) games, which were being
  // stored as regular-season finals and polluting team form + player hit-rates.
  const url = `${BASE_URL}/schedule?sportId=${MLB_SPORT_ID}&startDate=${startDate}&endDate=${endDate}&gameType=R,F,D,L,W&hydrate=venue(location,fieldInfo)`;
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
      venue: g.venue
        ? {
            mlbVenueId: g.venue.id,
            name: g.venue.name,
            latitude: g.venue.location?.defaultCoordinates?.latitude ?? null,
            longitude: g.venue.location?.defaultCoordinates?.longitude ?? null,
            elevationFt: g.venue.location?.elevation ?? null,
            azimuthDeg: g.venue.location?.azimuthAngle ?? null,
            roofType: g.venue.fieldInfo?.roofType ?? null,
          }
        : null,
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
  const url = `${BASE_URL}/schedule?sportId=${MLB_SPORT_ID}&startDate=${startDate}&endDate=${endDate}&gameType=R,F,D,L,W&hydrate=probablePitcher`;
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

export interface MlbPitcherHandednessSplit {
  mlbPersonId: number;
  /** "L" or "R" only — the batter's side; MLB never returns a switch-hitter sitCode here (there's no such thing as "batting vs. switch"). */
  vsHand: "L" | "R";
  battersFaced: number;
  obp: number | null;
  slg: number | null;
}

interface MlbHandednessStatSplit {
  split: { code: string }; // "vl" | "vr"
  stat: { battersFaced?: number; obp?: string; slg?: string };
}

interface MlbPersonWithSplitStats {
  id: number;
  stats?: { splits: MlbHandednessStatSplit[] }[];
}

const SIT_CODE_TO_HAND: Record<string, "L" | "R"> = { vl: "L", vr: "R" };

/** Parses an MLB rate-stat string (e.g. ".285") to a number; null on a non-numeric placeholder (e.g. "-.--" for a split with no qualifying plate appearances) — same "null on parse failure" convention as era above, rather than trusting NaN downstream. */
function parseRateStat(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

/**
 * Batched vs-LHB/vs-RHB rate-stat splits for many pitchers in one call, same
 * batching shape as fetchPitcherSeasonStats. No era/earnedRuns field exists
 * at this split (confirmed live against the real API) — a run isn't
 * attributable to one batter's handedness, so the league doesn't track ERA
 * this way. obp/slg (→ OPS = obp + slg) are the closest rate-stat proxy for
 * "how hard is this pitcher to hit" against each hand. A pitcher with too
 * few career/season innings this year (rookie call-ups, injury returns)
 * simply has no splits entries — reported as [], not an error.
 */
export async function fetchPitcherHandednessSplits(
  personIds: number[],
  season: number
): Promise<MlbPitcherHandednessSplit[]> {
  if (personIds.length === 0) return [];

  const url = `${BASE_URL}/people?personIds=${personIds.join(",")}&hydrate=stats(group=pitching,type=statSplits,sitCodes=[vl,vr],season=${season})`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MLB Stats API people/statSplits request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { people?: MlbPersonWithSplitStats[] };

  const result: MlbPitcherHandednessSplit[] = [];
  for (const p of data.people ?? []) {
    for (const split of p.stats?.[0]?.splits ?? []) {
      const vsHand = SIT_CODE_TO_HAND[split.split.code];
      if (!vsHand) continue; // an unrecognized sitCode — skip rather than guess
      result.push({
        mlbPersonId: p.id,
        vsHand,
        battersFaced: split.stat.battersFaced ?? 0,
        obp: parseRateStat(split.stat.obp),
        slg: parseRateStat(split.stat.slg),
      });
    }
  }
  return result;
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
