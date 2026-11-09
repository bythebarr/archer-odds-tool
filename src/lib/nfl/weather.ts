import type { NflPropStat } from "@/generated/prisma/client";

/**
 * Weather → NFL props (Phase 4, Decision 11). Wind and precipitation are
 * the two weather inputs with a real, replicated effect on football
 * outcomes; both bite the passing and kicking games and leave rushing
 * essentially alone. Temperature is stored but deliberately not priced —
 * cold alone has no comparable documented effect once wind is counted.
 *
 * The magnitudes are PRIORS, in this codebase's usual shape (capped,
 * monotone, one knob per channel): wind drag ramps from 10 mph (no effect
 * below) to a cap at 25+ mph; precip drag scales linearly with the
 * forecast probability. Each stat carries a sensitivity share of the full
 * drag — kicking takes the most wind (a kick is a projectile with no
 * spiral to stabilize it), deep passing next, rushing none. The archive
 * endpoint (mlb/weatherApi's fetchHistoricalWeather pattern) makes these
 * refittable from history; until that fit runs they stay conservative.
 */

export interface NflGameWeather {
  windMph: number;
  /** Probability of precipitation at game time, 0–1; null = no signal. */
  precipProb: number | null;
  temperatureF: number;
}

/** Wind speed where the drag starts, and where it reaches its cap. */
export const WIND_ONSET_MPH = 10;
export const WIND_FULL_MPH = 25;
/** Full-drag magnitudes at sensitivity 1. */
export const MAX_WIND_DRAG = 0.18;
export const MAX_PRECIP_DRAG = 0.08;
/** The factor never drops below this, whatever the forecast says. */
export const WEATHER_FACTOR_FLOOR = 0.78;

const WIND_SENSITIVITY: Partial<Record<NflPropStat, number>> = {
  kickingPoints: 1.15,
  fieldGoals: 1.15,
  extraPoints: 0.9,
  passYards: 1,
  passTds: 1,
  recYards: 0.9,
  passCompletions: 0.8,
  receptions: 0.7,
  longestReception: 0.7,
  rushRecYards: 0.55,
  passAttempts: 0.4,
  anytimeTd: 0.3,
};

const PRECIP_SENSITIVITY: Partial<Record<NflPropStat, number>> = {
  passYards: 1,
  passTds: 1,
  recYards: 0.9,
  kickingPoints: 0.9,
  fieldGoals: 0.9,
  passCompletions: 0.8,
  receptions: 0.7,
  longestReception: 0.6,
  rushRecYards: 0.5,
  extraPoints: 0.6,
  passAttempts: 0.4,
  anytimeTd: 0.3,
};

/**
 * The multiplicative weather adjustment for one stat in one game. 1 when
 * there is no weather row (dome, retractable roof, unsynced, or unknown
 * stadium) — the pre-Decision-11 behavior. Wind direction is not used:
 * unlike a baseball park, a football field's axis varies by stadium and
 * crosswind vs. headwind averages out over four quarters of alternating
 * direction; speed is the priced signal.
 */
export function nflWeatherFactor(weather: NflGameWeather | null | undefined, stat: NflPropStat): number {
  if (!weather) return 1;
  const windShare = WIND_SENSITIVITY[stat] ?? 0;
  const precipShare = PRECIP_SENSITIVITY[stat] ?? 0;
  const windRamp = Math.min(1, Math.max(0, (weather.windMph - WIND_ONSET_MPH) / (WIND_FULL_MPH - WIND_ONSET_MPH)));
  const windDrag = MAX_WIND_DRAG * windRamp * windShare;
  const precipDrag = weather.precipProb === null ? 0 : MAX_PRECIP_DRAG * Math.min(1, Math.max(0, weather.precipProb)) * precipShare;
  return Math.max(WEATHER_FACTOR_FLOOR, 1 - windDrag - precipDrag);
}
