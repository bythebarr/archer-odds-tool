import { prisma } from "@/lib/prisma";
import {
  fetchSeasonResults,
  type ErgastCircuit,
  type ErgastConstructor,
  type ErgastDriver,
  type ErgastRace,
  type ErgastResult,
} from "./jolpicaApiClient";
import type { Prisma } from "@/generated/prisma/client";

// Ergast returns every numeric field as a string; these helpers centralize the
// parse so a stray "" or malformed value degrades to null rather than NaN.
function toInt(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}
function toFloat(value: string | undefined): number {
  const n = Number.parseFloat(value ?? "0");
  return Number.isFinite(n) ? n : 0;
}

/** Combine Ergast's separate date + optional time (both UTC) into one Date. */
function raceDateTime(race: ErgastRace): Date {
  return new Date(race.time ? `${race.date}T${race.time}` : `${race.date}T00:00:00Z`);
}

async function upsertCircuit(cache: Map<string, string>, c: ErgastCircuit): Promise<string> {
  const cached = cache.get(c.circuitId);
  if (cached) return cached;

  const data = {
    name: c.circuitName,
    locality: c.Location?.locality ?? null,
    country: c.Location?.country ?? null,
    lat: c.Location?.lat ? Number(c.Location.lat) : null,
    long: c.Location?.long ? Number(c.Location.long) : null,
  };
  const circuit = await prisma.f1Circuit.upsert({
    where: { ergastCircuitId: c.circuitId },
    create: { ergastCircuitId: c.circuitId, ...data },
    update: data,
  });
  cache.set(c.circuitId, circuit.id);
  return circuit.id;
}

async function upsertDriver(cache: Map<string, string>, d: ErgastDriver): Promise<string> {
  const cached = cache.get(d.driverId);
  if (cached) return cached;

  const data = {
    code: d.code ?? null,
    permanentNumber: toInt(d.permanentNumber),
    givenName: d.givenName,
    familyName: d.familyName,
    nationality: d.nationality ?? null,
    dateOfBirth: d.dateOfBirth ? new Date(`${d.dateOfBirth}T00:00:00Z`) : null,
  };
  const driver = await prisma.f1Driver.upsert({
    where: { ergastDriverId: d.driverId },
    create: { ergastDriverId: d.driverId, ...data },
    update: data,
  });
  cache.set(d.driverId, driver.id);
  return driver.id;
}

async function upsertConstructor(cache: Map<string, string>, c: ErgastConstructor): Promise<string> {
  const cached = cache.get(c.constructorId);
  if (cached) return cached;

  const data = { name: c.name, nationality: c.nationality ?? null };
  const constructor = await prisma.f1Constructor.upsert({
    where: { ergastConstructorId: c.constructorId },
    create: { ergastConstructorId: c.constructorId, ...data },
    update: data,
  });
  cache.set(c.constructorId, constructor.id);
  return constructor.id;
}

export interface F1BackfillSummary {
  seasonsProcessed: number;
  racesProcessed: number;
  resultsWritten: number;
}

/**
 * Backfills F1 race results for a span of seasons via Jolpica. Idempotent
 * throughout (upserts for Circuit/Driver/Constructor/Race, createMany +
 * skipDuplicates for the immutable result rows), so re-running it also serves
 * as the ongoing sync for the current season's newly-run races — same design
 * as the UFC backfill. Defaults to the last five seasons, which is plenty for
 * a v1 form/head-to-head view without pulling the entire 1950-onward archive
 * on every cron tick.
 */
export async function backfillF1History(
  fromSeason = new Date().getUTCFullYear() - 4,
  toSeason = new Date().getUTCFullYear()
): Promise<F1BackfillSummary> {
  const summary: F1BackfillSummary = { seasonsProcessed: 0, racesProcessed: 0, resultsWritten: 0 };

  const circuitCache = new Map<string, string>();
  const driverCache = new Map<string, string>();
  const constructorCache = new Map<string, string>();

  for (let season = fromSeason; season <= toSeason; season++) {
    const races = await fetchSeasonResults(season);
    summary.seasonsProcessed++;

    for (const race of races) {
      if (!race.Results || race.Results.length === 0) continue; // scheduled-but-unrun future race

      const circuitId = await upsertCircuit(circuitCache, race.Circuit);
      const dbRace = await prisma.f1Race.upsert({
        where: { season_round: { season: Number(race.season), round: Number(race.round) } },
        create: {
          season: Number(race.season),
          round: Number(race.round),
          raceName: race.raceName,
          raceDate: raceDateTime(race),
          wikiUrl: race.url ?? null,
          circuitId,
        },
        update: { raceName: race.raceName, raceDate: raceDateTime(race), wikiUrl: race.url ?? null, circuitId },
      });
      summary.racesProcessed++;

      const resultRows: Prisma.F1RaceResultCreateManyInput[] = [];
      for (const r of race.Results as ErgastResult[]) {
        const driverId = await upsertDriver(driverCache, r.Driver);
        const constructorId = await upsertConstructor(constructorCache, r.Constructor);
        resultRows.push({
          raceId: dbRace.id,
          driverId,
          constructorId,
          position: toInt(r.position),
          positionText: r.positionText,
          points: toFloat(r.points),
          grid: toInt(r.grid),
          laps: toInt(r.laps),
          status: r.status,
          timeMillis: toInt(r.Time?.millis),
          fastestLapRank: toInt(r.FastestLap?.rank),
          fastestLapTime: r.FastestLap?.Time?.time ?? null,
        });
      }

      if (resultRows.length > 0) {
        const written = await prisma.f1RaceResult.createMany({ data: resultRows, skipDuplicates: true });
        summary.resultsWritten += written.count;
      }
    }
  }

  return summary;
}
