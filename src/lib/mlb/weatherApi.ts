/**
 * Open-Meteo forecast client — free, unauthenticated, confirmed live during
 * this feature's research (api.open-meteo.com/v1/forecast). A different
 * provider from every other MLB data source in this codebase (all of which
 * are MLB Stats API), so it gets its own small client file rather than
 * living in statsApi.ts.
 */

const FORECAST_BASE_URL = "https://api.open-meteo.com/v1/forecast";

export interface WeatherForecast {
  temperatureF: number;
  windMph: number;
  /** Meteorological convention: the direction the wind is coming FROM, in compass degrees. */
  windFromDeg: number;
}

interface OpenMeteoHourlyResponse {
  hourly?: {
    time: string[];
    temperature_2m: number[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
  };
}

/**
 * The forecast hour closest to `atUtc`, for one lat/long. Open-Meteo's free
 * forecast window is ~16 days, but accuracy is only meaningful a few days
 * out — callers should only fetch for games within that near window (see
 * syncWeather.ts), not just because the endpoint will technically respond
 * further out. Returns null if the response has no hourly data at all
 * (e.g. `atUtc` is outside the forecast window).
 */
export async function fetchWeatherForecast(
  latitude: number,
  longitude: number,
  atUtc: Date
): Promise<WeatherForecast | null> {
  const url =
    `${FORECAST_BASE_URL}?latitude=${latitude}&longitude=${longitude}` +
    `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo forecast request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as OpenMeteoHourlyResponse;
  const hourly = data.hourly;
  if (!hourly || hourly.time.length === 0) return null;

  // Hourly timestamps are UTC (timezone=UTC above), formatted "YYYY-MM-DDTHH:00" —
  // find the closest one to atUtc rather than assuming an exact match.
  let closestIndex = 0;
  let closestDiffMs = Infinity;
  for (let i = 0; i < hourly.time.length; i++) {
    const diff = Math.abs(new Date(`${hourly.time[i]}:00Z`).getTime() - atUtc.getTime());
    if (diff < closestDiffMs) {
      closestDiffMs = diff;
      closestIndex = i;
    }
  }

  return {
    temperatureF: hourly.temperature_2m[closestIndex],
    windMph: hourly.wind_speed_10m[closestIndex],
    windFromDeg: hourly.wind_direction_10m[closestIndex],
  };
}
