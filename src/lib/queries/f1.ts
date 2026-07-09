import { prisma } from "@/lib/prisma";
import { flagForNationality } from "@/lib/f1/flags";

// F1 has no odds — this is a free, results-driven view (championship standings,
// the latest podium, the next race). Standings aren't stored; they're derived
// from F1RaceResult rows on read, which keeps the ingest a dumb append and
// makes "points so far" always consistent with the races we actually have.

export interface F1DriverStanding {
  rank: number;
  ergastDriverId: string;
  name: string;
  code: string | null;
  flag: string;
  constructorName: string;
  points: number;
  wins: number;
  podiums: number;
}

export interface F1ConstructorStanding {
  rank: number;
  ergastConstructorId: string;
  name: string;
  flag: string;
  points: number;
  wins: number;
}

export interface F1ResultRow {
  position: number | null;
  positionText: string;
  driverName: string;
  code: string | null;
  flag: string;
  constructorName: string;
  points: number;
  grid: number | null;
  status: string;
  gapOrTime: string | null;
  fastestLap: boolean;
}

export interface F1RaceView {
  season: number;
  round: number;
  raceName: string;
  circuitName: string;
  locality: string | null;
  country: string | null;
  raceDate: Date;
  results: F1ResultRow[];
}

export interface F1NextRace {
  season: number;
  round: number;
  raceName: string;
  circuitName: string;
  locality: string | null;
  country: string | null;
  raceDate: Date;
}

export interface F1SeasonView {
  season: number;
  roundsCompleted: number;
  driverStandings: F1DriverStanding[];
  constructorStandings: F1ConstructorStanding[];
  latestRace: F1RaceView | null;
  nextRace: F1NextRace | null;
}

/** The season we render — the one the most recent race belongs to. */
async function currentSeason(): Promise<number | null> {
  const latest = await prisma.f1Race.findFirst({ orderBy: { season: "desc" }, select: { season: true } });
  return latest?.season ?? null;
}

/**
 * Points relative to the leader in ms terms: only the winner has an absolute
 * `timeMillis`; everyone else's is a gap already, so we just surface the raw
 * status/time the row carries rather than reconstructing gaps.
 */
function gapLabel(position: number | null, status: string): string | null {
  if (position === 1) return "Winner";
  // "Finished" / "+1 Lap" / "Engine" etc. — the raw status is the honest label.
  return status;
}

export async function getF1Season(): Promise<F1SeasonView | null> {
  const season = await currentSeason();
  if (season == null) return null;

  const rows = await prisma.f1RaceResult.findMany({
    where: { race: { season } },
    include: {
      driver: { select: { ergastDriverId: true, code: true, givenName: true, familyName: true, nationality: true } },
      constructor: { select: { ergastConstructorId: true, name: true, nationality: true } },
      race: { select: { round: true } },
    },
  });

  // --- Driver standings -----------------------------------------------------
  const driverAgg = new Map<
    string,
    {
      ergastDriverId: string;
      name: string;
      code: string | null;
      nationality: string | null;
      points: number;
      wins: number;
      podiums: number;
      latestRound: number;
      constructorName: string;
    }
  >();

  for (const r of rows) {
    const key = r.driver.ergastDriverId;
    const entry =
      driverAgg.get(key) ??
      {
        ergastDriverId: key,
        name: `${r.driver.givenName} ${r.driver.familyName}`,
        code: r.driver.code,
        nationality: r.driver.nationality,
        points: 0,
        wins: 0,
        podiums: 0,
        latestRound: -1,
        constructorName: r.constructor.name,
      };
    entry.points += r.points;
    if (r.position === 1) entry.wins += 1;
    if (r.position != null && r.position <= 3) entry.podiums += 1;
    // A driver's "team" is whoever they drove for most recently this season.
    if (r.race.round > entry.latestRound) {
      entry.latestRound = r.race.round;
      entry.constructorName = r.constructor.name;
    }
    driverAgg.set(key, entry);
  }

  const driverStandings: F1DriverStanding[] = [...driverAgg.values()]
    .sort((a, b) => b.points - a.points || b.wins - a.wins)
    .map((d, i) => ({
      rank: i + 1,
      ergastDriverId: d.ergastDriverId,
      name: d.name,
      code: d.code,
      flag: flagForNationality(d.nationality),
      constructorName: d.constructorName,
      points: d.points,
      wins: d.wins,
      podiums: d.podiums,
    }));

  // --- Constructor standings ------------------------------------------------
  const ctorAgg = new Map<
    string,
    { ergastConstructorId: string; name: string; nationality: string | null; points: number; wins: number }
  >();
  for (const r of rows) {
    const key = r.constructor.ergastConstructorId;
    const entry =
      ctorAgg.get(key) ??
      { ergastConstructorId: key, name: r.constructor.name, nationality: r.constructor.nationality, points: 0, wins: 0 };
    entry.points += r.points;
    if (r.position === 1) entry.wins += 1;
    ctorAgg.set(key, entry);
  }
  const constructorStandings: F1ConstructorStanding[] = [...ctorAgg.values()]
    .sort((a, b) => b.points - a.points || b.wins - a.wins)
    .map((c, i) => ({
      rank: i + 1,
      ergastConstructorId: c.ergastConstructorId,
      name: c.name,
      flag: flagForNationality(c.nationality),
      points: c.points,
      wins: c.wins,
    }));

  const [latestRace, nextRace] = await Promise.all([getLatestRace(season), getNextRace()]);
  const roundsCompleted = latestRace?.round ?? 0;

  return { season, roundsCompleted, driverStandings, constructorStandings, latestRace, nextRace };
}

/** The most recent race that actually has results, with the full classification. */
export async function getLatestRace(season: number): Promise<F1RaceView | null> {
  const race = await prisma.f1Race.findFirst({
    where: { season, results: { some: {} } },
    orderBy: { round: "desc" },
    include: {
      circuit: { select: { name: true, locality: true, country: true } },
      results: {
        include: {
          driver: { select: { code: true, givenName: true, familyName: true, nationality: true } },
          constructor: { select: { name: true } },
        },
      },
    },
  });
  if (!race) return null;

  // Best fastest-lap rank of 1 gets the purple-lap marker.
  const results: F1ResultRow[] = race.results
    .slice()
    .sort((a, b) => {
      // Classified finishers by position; DNFs (null position) sink to the bottom.
      if (a.position == null && b.position == null) return 0;
      if (a.position == null) return 1;
      if (b.position == null) return -1;
      return a.position - b.position;
    })
    .map((r) => ({
      position: r.position,
      positionText: r.positionText,
      driverName: `${r.driver.givenName} ${r.driver.familyName}`,
      code: r.driver.code,
      flag: flagForNationality(r.driver.nationality),
      constructorName: r.constructor.name,
      points: r.points,
      grid: r.grid,
      status: r.status,
      gapOrTime: gapLabel(r.position, r.status),
      fastestLap: r.fastestLapRank === 1,
    }));

  return {
    season: race.season,
    round: race.round,
    raceName: race.raceName,
    circuitName: race.circuit.name,
    locality: race.circuit.locality,
    country: race.circuit.country,
    raceDate: race.raceDate,
    results,
  };
}

/** The next scheduled race with no results yet — null between seasons. */
export async function getNextRace(): Promise<F1NextRace | null> {
  const race = await prisma.f1Race.findFirst({
    where: { raceDate: { gt: new Date() }, results: { none: {} } },
    orderBy: { raceDate: "asc" },
    include: { circuit: { select: { name: true, locality: true, country: true } } },
  });
  if (!race) return null;
  return {
    season: race.season,
    round: race.round,
    raceName: race.raceName,
    circuitName: race.circuit.name,
    locality: race.circuit.locality,
    country: race.circuit.country,
    raceDate: race.raceDate,
  };
}

// --- Driver detail --------------------------------------------------------

export interface F1DriverRaceRow {
  round: number;
  raceName: string;
  raceDate: Date;
  position: number | null;
  positionText: string;
  points: number;
  grid: number | null;
  status: string;
  fastestLap: boolean;
  constructorName: string;
}

export interface F1DriverSeason {
  ergastDriverId: string;
  name: string;
  code: string | null;
  permanentNumber: number | null;
  flag: string;
  nationality: string | null;
  season: number;
  constructorName: string;
  rank: number;
  points: number;
  wins: number;
  podiums: number;
  bestFinish: number | null;
  starts: number;
  dnfs: number;
  races: F1DriverRaceRow[];
}

/**
 * One driver's current-season card — the standings row made tappable. Rank is
 * computed the same way the board sorts (points, then wins) so it always agrees
 * with the /f1 table. Returns null for an unknown driver or one with no results
 * this season (so the page 404s cleanly rather than rendering an empty shell).
 */
export async function getDriverSeason(ergastDriverId: string): Promise<F1DriverSeason | null> {
  const season = await currentSeason();
  if (season == null) return null;

  const driver = await prisma.f1Driver.findUnique({ where: { ergastDriverId } });
  if (!driver) return null;

  // Season-wide points/wins for this driver's championship rank.
  // Scalar rows only (no relation include) — F1RaceResult's `constructor`
  // relation collides with Object.prototype in a select/include literal. We
  // already hold `driver.id`, so aggregate by the scalar `driverId`.
  const all = await prisma.f1RaceResult.findMany({ where: { race: { season } } });
  const agg = new Map<string, { points: number; wins: number }>();
  for (const r of all) {
    const e = agg.get(r.driverId) ?? { points: 0, wins: 0 };
    e.points += r.points;
    if (r.position === 1) e.wins += 1;
    agg.set(r.driverId, e);
  }
  const ranked = [...agg.entries()].sort((a, b) => b[1].points - a[1].points || b[1].wins - a[1].wins);
  const rank = ranked.findIndex(([id]) => id === driver.id) + 1;
  const self = agg.get(driver.id) ?? { points: 0, wins: 0 };

  const resultRows = await prisma.f1RaceResult.findMany({
    where: { driver: { ergastDriverId }, race: { season } },
    include: { constructor: { select: { name: true } } },
  });
  if (resultRows.length === 0) return null;

  // Fetch race meta in its OWN relation-free query. This generator mangles a
  // DateTime that's selected alongside a nested relation (raceDate comes back a
  // broken object with no getTime), but a scalar-only select returns a clean,
  // same-realm Date. So we pull round/name/date here and merge by raceId.
  const seasonRaces = await prisma.f1Race.findMany({
    where: { season },
    select: { id: true, round: true, raceName: true, raceDate: true },
  });
  const raceById = new Map(seasonRaces.map((ra) => [ra.id, ra]));

  const races: F1DriverRaceRow[] = resultRows
    .map((r) => {
      const race = raceById.get(r.raceId)!;
      return {
        round: race.round,
        raceName: race.raceName,
        raceDate: race.raceDate,
        position: r.position,
        positionText: r.positionText,
        points: r.points,
        grid: r.grid,
        status: r.status,
        fastestLap: r.fastestLapRank === 1,
        constructorName: r.constructor.name,
      };
    })
    .sort((a, b) => a.round - b.round);

  // A true retirement is a non-numeric positionText ("R"/"D"/"W"/…). A car that
  // retired but completed enough laps is still *classified* with a number
  // (e.g. Monaco P17 "R" vs. a numeric P15 that the status calls "Retired"), so
  // count DNFs by positionText, and best-finish/podiums off numeric finishes.
  const finishes = races.filter((r) => /^\d+$/.test(r.positionText)).map((r) => Number(r.positionText));
  const dnfs = races.filter((r) => !/^\d+$/.test(r.positionText)).length;

  return {
    ergastDriverId,
    name: `${driver.givenName} ${driver.familyName}`,
    code: driver.code,
    permanentNumber: driver.permanentNumber,
    flag: flagForNationality(driver.nationality),
    nationality: driver.nationality,
    season,
    constructorName: races[races.length - 1].constructorName, // most recent team
    rank,
    points: self.points,
    wins: self.wins,
    podiums: finishes.filter((p) => p <= 3).length,
    bestFinish: finishes.length ? Math.min(...finishes) : null,
    starts: races.length,
    dnfs,
    races,
  };
}

// --- Constructor detail ---------------------------------------------------

export interface F1ConstructorDriverLine {
  ergastDriverId: string;
  name: string;
  code: string | null;
  flag: string;
  points: number;
  wins: number;
}

export interface F1ConstructorRaceEntry {
  driverName: string;
  code: string | null;
  positionText: string;
  position: number | null;
  points: number;
  fastestLap: boolean;
}

export interface F1ConstructorRaceRow {
  round: number;
  raceName: string;
  raceDate: Date;
  points: number; // team total that weekend
  entries: F1ConstructorRaceEntry[];
}

export interface F1ConstructorSeason {
  ergastConstructorId: string;
  name: string;
  flag: string;
  nationality: string | null;
  season: number;
  rank: number;
  points: number;
  wins: number;
  podiums: number;
  bestFinish: number | null;
  drivers: F1ConstructorDriverLine[];
  races: F1ConstructorRaceRow[];
}

/**
 * One constructor's current-season card — the mirror of getDriverSeason. Rank
 * matches the board's sort (points, then wins). Both cars count toward podiums.
 * Race meta is fetched relation-free and merged by id to dodge the generator's
 * mangled-Date-on-relation-join quirk (see getDriverSeason). Null for an unknown
 * constructor or one with no results this season.
 */
export async function getConstructorSeason(ergastConstructorId: string): Promise<F1ConstructorSeason | null> {
  const season = await currentSeason();
  if (season == null) return null;

  const constructor = await prisma.f1Constructor.findUnique({ where: { ergastConstructorId } });
  if (!constructor) return null;

  // Season-wide points/wins per constructor for the championship rank.
  const all = await prisma.f1RaceResult.findMany({ where: { race: { season } } });
  const agg = new Map<string, { points: number; wins: number }>();
  for (const r of all) {
    const e = agg.get(r.constructorId) ?? { points: 0, wins: 0 };
    e.points += r.points;
    if (r.position === 1) e.wins += 1;
    agg.set(r.constructorId, e);
  }
  const ranked = [...agg.entries()].sort((a, b) => b[1].points - a[1].points || b[1].wins - a[1].wins);
  const rank = ranked.findIndex(([id]) => id === constructor.id) + 1;
  const self = agg.get(constructor.id) ?? { points: 0, wins: 0 };

  // This constructor's car results (scalars only) + driver meta fetched
  // separately — an `include` on F1RaceResult trips the `constructor`-name /
  // Object.prototype clash, so we merge by driverId instead.
  const resultRows = await prisma.f1RaceResult.findMany({
    // Filter by the scalar FK, not the `constructor` relation — the relation key
    // collides with Object.prototype even in a where clause on this generator.
    where: { constructorId: constructor.id, race: { season } },
  });
  if (resultRows.length === 0) return null;

  const [seasonRaces, driverRows] = await Promise.all([
    prisma.f1Race.findMany({ where: { season }, select: { id: true, round: true, raceName: true, raceDate: true } }),
    prisma.f1Driver.findMany({
      where: { id: { in: [...new Set(resultRows.map((r) => r.driverId))] } },
      select: { id: true, ergastDriverId: true, code: true, givenName: true, familyName: true, nationality: true },
    }),
  ]);
  const raceById = new Map(seasonRaces.map((ra) => [ra.id, ra]));
  const driverById = new Map(driverRows.map((d) => [d.id, d]));

  // Per-driver contribution (tappable through to each driver's page).
  const driverAgg = new Map<string, F1ConstructorDriverLine>();
  for (const r of resultRows) {
    const d = driverById.get(r.driverId);
    if (!d) continue;
    const line =
      driverAgg.get(d.ergastDriverId) ??
      {
        ergastDriverId: d.ergastDriverId,
        name: `${d.givenName} ${d.familyName}`,
        code: d.code,
        flag: flagForNationality(d.nationality),
        points: 0,
        wins: 0,
      };
    line.points += r.points;
    if (r.position === 1) line.wins += 1;
    driverAgg.set(d.ergastDriverId, line);
  }
  const drivers = [...driverAgg.values()].sort((a, b) => b.points - a.points);

  // Group both cars per race weekend.
  const byRace = new Map<string, F1ConstructorRaceRow>();
  for (const r of resultRows) {
    const race = raceById.get(r.raceId);
    const d = driverById.get(r.driverId);
    if (!race || !d) continue;
    const row =
      byRace.get(r.raceId) ??
      { round: race.round, raceName: race.raceName, raceDate: race.raceDate, points: 0, entries: [] };
    row.points += r.points;
    row.entries.push({
      driverName: `${d.givenName} ${d.familyName}`,
      code: d.code,
      positionText: r.positionText,
      position: r.position,
      points: r.points,
      fastestLap: r.fastestLapRank === 1,
    });
    byRace.set(r.raceId, row);
  }
  const races = [...byRace.values()].sort((a, b) => a.round - b.round);
  for (const row of races) {
    // Best car first within each weekend (classified numbers, then DNFs).
    row.entries.sort((a, b) => {
      const an = /^\d+$/.test(a.positionText) ? Number(a.positionText) : Infinity;
      const bn = /^\d+$/.test(b.positionText) ? Number(b.positionText) : Infinity;
      return an - bn;
    });
  }

  const numericFinishes = resultRows
    .filter((r) => /^\d+$/.test(r.positionText))
    .map((r) => Number(r.positionText));

  return {
    ergastConstructorId,
    name: constructor.name,
    flag: flagForNationality(constructor.nationality),
    nationality: constructor.nationality,
    season,
    rank,
    points: self.points,
    wins: self.wins,
    podiums: numericFinishes.filter((p) => p <= 3).length,
    bestFinish: numericFinishes.length ? Math.min(...numericFinishes) : null,
    drivers,
    races,
  };
}
