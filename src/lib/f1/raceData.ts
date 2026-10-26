/** Every F1 race with results, oldest first, in the race model's shape — shared by the live query and the backtest. */
import { prisma } from "@/lib/prisma";
import type { F1RaceRecord } from "./raceModel";

export async function loadF1Races(): Promise<F1RaceRecord[]> {
  const races = await prisma.f1Race.findMany({
    where: { results: { some: {} } },
    orderBy: { raceDate: "asc" },
    // `include`, not a nested select: a select literal with the result's scalar
    // fields trips over the `constructor` relation name (Object.prototype.constructor).
    include: { results: true },
  });
  return races.map((r) => ({
    id: r.id,
    season: r.season,
    date: r.raceDate,
    entries: r.results.map((e) => ({
      driverId: e.driverId,
      constructorId: e.constructorId,
      // Ergast fills `position` for every car; only a numeric positionText means classified.
      position: /^\d+$/.test(e.positionText) ? e.position : null,
      status: e.status,
      laps: e.laps,
    })),
  }));
}
