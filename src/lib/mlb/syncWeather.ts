import { prisma } from "@/lib/prisma";
import { etDayBoundsUtc } from "@/lib/dateEt";
import { fetchWeatherForecast } from "./weatherApi";

export interface SyncWeatherSummary {
  /** Scheduled, open-roof MLB games found in the window. */
  gamesConsidered: number;
  weatherUpserted: number;
}

/**
 * Upserts a forecast for every scheduled MLB game in [startDate, endDate]
 * (ET) whose venue is open-air ("Open" roofType) — a retractable/other roof
 * park is never fetched at all, since whether it'll actually be open isn't
 * knowable in advance and the forecast would never be used anyway (see
 * archer/weatherEffect.ts). Games without a resolved venue (venue hydrate
 * missing that sync, or predates this feature) are skipped, not defaulted.
 *
 * Latest forecast always wins (upsert, no snapshot history) — same
 * "informational, refreshed on every sync" choice syncPitchers.ts already
 * made for season stats and handedness splits.
 */
export async function syncGameWeather(startDate: string, endDate: string): Promise<SyncWeatherSummary> {
  const games = await prisma.game.findMany({
    where: {
      sport: "mlb",
      status: "scheduled",
      scheduledStartUtc: { gte: etDayBoundsUtc(startDate).gte, lt: etDayBoundsUtc(endDate).lt },
      venue: { roofType: "Open" },
    },
    select: { id: true, scheduledStartUtc: true, venue: { select: { latitude: true, longitude: true } } },
  });

  let weatherUpserted = 0;
  for (const game of games) {
    if (!game.venue) continue; // the `venue: { roofType: "Open" }` filter above already implies a venue exists; guards TS/a race, not expected to fire
    const forecast = await fetchWeatherForecast(game.venue.latitude, game.venue.longitude, game.scheduledStartUtc);
    if (!forecast) continue; // outside Open-Meteo's forecast window — re-synced as it comes into range

    await prisma.gameWeather.upsert({
      where: { gameId: game.id },
      create: { gameId: game.id, ...forecast },
      update: { ...forecast },
    });
    weatherUpserted++;
  }

  return { gamesConsidered: games.length, weatherUpserted };
}
