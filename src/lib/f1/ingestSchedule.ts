import { prisma } from "@/lib/prisma";
import { fetchSeasonSchedule, type ErgastCircuit, type ErgastRace } from "./jolpicaApiClient";

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

export interface F1ScheduleSummary {
  /** Races Jolpica returned for the season, before the upsert loop. */
  racesFetched: number;
  racesUpserted: number;
}

/**
 * Ingests a season's *calendar* (circuits + race rows, no results) so that
 * scheduled-but-unrun rounds exist in the DB — the results backfill can't see
 * them yet, but the "next race" card needs them. Idempotent: races already
 * carrying results (from `backfillF1History`) just get their date/circuit
 * refreshed, never their result rows touched. Safe to run alongside the
 * results backfill.
 */
export async function ingestSeasonSchedule(season: number): Promise<F1ScheduleSummary> {
  const races = await fetchSeasonSchedule(season);
  const circuitCache = new Map<string, string>();
  let racesUpserted = 0;

  for (const race of races) {
    const circuitId = await upsertCircuit(circuitCache, race.Circuit);
    const data = {
      raceName: race.raceName,
      raceDate: raceDateTime(race),
      wikiUrl: race.url ?? null,
      circuitId,
    };
    await prisma.f1Race.upsert({
      where: { season_round: { season: Number(race.season), round: Number(race.round) } },
      create: { season: Number(race.season), round: Number(race.round), ...data },
      update: data,
    });
    racesUpserted++;
  }

  return { racesFetched: races.length, racesUpserted };
}
