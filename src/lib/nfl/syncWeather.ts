import { prisma } from "@/lib/prisma";
import { etDayBoundsUtc } from "@/lib/dateEt";
import { fetchGameWeatherForecast } from "@/lib/mlb/weatherApi";
import { nflStadiumFor } from "./stadiums";

export interface SyncNflWeatherSummary {
  /** Scheduled NFL games found in the window. */
  gamesConsidered: number;
  weatherUpserted: number;
}

/**
 * Upserts a forecast for every not-yet-final NFL game in [startDate,
 * endDate] (ET) played at an open-air stadium (lib/nfl/stadiums.ts).
 * Domes and retractable roofs are never fetched — the forecast would
 * never be used (same rule as the MLB weather sync). Teams without a
 * known stadium are skipped, not defaulted: no weather row means the
 * projection prices the game neutral, exactly as before Decision 11.
 *
 * Latest forecast always wins (upsert into the shared GameWeather table,
 * now carrying precipProb for the NFL factor), mirroring syncGameWeather.
 */
export async function syncNflGameWeather(startDate: string, endDate: string): Promise<SyncNflWeatherSummary> {
  const games = await prisma.game.findMany({
    where: {
      sport: "nfl",
      status: { not: "final" },
      scheduledStartUtc: { gte: etDayBoundsUtc(startDate).gte, lt: etDayBoundsUtc(endDate).lt },
    },
    select: { id: true, scheduledStartUtc: true, homeTeam: { select: { abbreviation: true } } },
  });

  let weatherUpserted = 0;
  for (const game of games) {
    const stadium = nflStadiumFor(game.homeTeam?.abbreviation);
    if (!stadium || stadium.roof !== "open") continue;
    const forecast = await fetchGameWeatherForecast(stadium.latitude, stadium.longitude, game.scheduledStartUtc);
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
