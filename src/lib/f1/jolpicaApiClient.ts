// Thin wrapper over the Jolpica F1 API (api.jolpi.ca), the no-auth successor
// to Ergast. Same request/response shape as the old Ergast API, so the
// familiar MRData envelope is preserved here. No API key — this is a free,
// public, rate-limited data source (mirrors the "free data first" stance the
// UFC and MLB pipelines already take). Parsing of the string-typed numeric
// fields Ergast returns happens in the backfill layer, not here, so this
// client stays an unopinionated pass-through.

const BASE_URL = "https://api.jolpi.ca/ergast/f1";

export interface ErgastLocation {
  lat?: string;
  long?: string;
  locality?: string;
  country?: string;
}

export interface ErgastCircuit {
  circuitId: string;
  circuitName: string;
  Location?: ErgastLocation;
}

export interface ErgastRace {
  season: string;
  round: string;
  raceName: string;
  url?: string;
  date: string;
  time?: string;
  Circuit: ErgastCircuit;
  Results?: ErgastResult[];
}

export interface ErgastDriver {
  driverId: string;
  code?: string;
  permanentNumber?: string;
  givenName: string;
  familyName: string;
  nationality?: string;
  dateOfBirth?: string;
}

export interface ErgastConstructor {
  constructorId: string;
  name: string;
  nationality?: string;
}

export interface ErgastResult {
  number?: string;
  position: string;
  positionText: string;
  points: string;
  grid?: string;
  laps?: string;
  status: string;
  Driver: ErgastDriver;
  Constructor: ErgastConstructor;
  Time?: { millis?: string; time?: string };
  FastestLap?: { rank?: string; lap?: string; Time?: { time?: string } };
}

interface MRDataEnvelope {
  MRData: {
    limit: string;
    offset: string;
    total: string;
    RaceTable?: { season?: string; round?: string; Races: ErgastRace[] };
  };
}

async function jolpicaFetch(path: string, params: Record<string, string | number>): Promise<MRDataEnvelope> {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jolpica API request failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }
  return (await res.json()) as MRDataEnvelope;
}

/**
 * All race results for a full season, one race at a time is avoidable: the
 * `/{season}/results` endpoint returns every race's results in a season, but
 * paginated at 30 result-rows per page (~1.5 races). We page through until
 * every race+result for the season is collected and merged by round.
 */
export async function fetchSeasonResults(season: number): Promise<ErgastRace[]> {
  const PAGE_LIMIT = 100; // result rows per page; ~5 races/page keeps the call count low
  const byRound = new Map<string, ErgastRace>();
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const { MRData } = await jolpicaFetch(`/${season}/results/`, { limit: PAGE_LIMIT, offset });
    total = Number(MRData.total);
    const races = MRData.RaceTable?.Races ?? [];

    for (const race of races) {
      const existing = byRound.get(race.round);
      if (existing) {
        // Same race split across a page boundary — concatenate its result rows.
        existing.Results = [...(existing.Results ?? []), ...(race.Results ?? [])];
      } else {
        byRound.set(race.round, race);
      }
    }

    offset += PAGE_LIMIT;
    if (races.length === 0) break; // defensive: never loop forever on an empty page
  }

  return [...byRound.values()].sort((a, b) => Number(a.round) - Number(b.round));
}

/**
 * The full race *calendar* for a season — every round with its date/time and
 * circuit, but no Results (that's `/{season}/results`). This is what powers the
 * "next race" card: scheduled-but-unrun rounds only exist here, since the
 * results endpoint omits a race until it's been run. A season has ~24 rounds,
 * comfortably under one 100-row page, but we page defensively all the same.
 */
export async function fetchSeasonSchedule(season: number): Promise<ErgastRace[]> {
  const PAGE_LIMIT = 100;
  const byRound = new Map<string, ErgastRace>();
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const { MRData } = await jolpicaFetch(`/${season}/races/`, { limit: PAGE_LIMIT, offset });
    total = Number(MRData.total);
    const races = MRData.RaceTable?.Races ?? [];
    for (const race of races) byRound.set(race.round, race);
    offset += PAGE_LIMIT;
    if (races.length === 0) break;
  }

  return [...byRound.values()].sort((a, b) => Number(a.round) - Number(b.round));
}
