/**
 * Weather (temperature + wind) shift for the expected-runs model.
 *
 * Warmer air is less dense, so batted balls carry further — a real,
 * well-established sabermetric effect. Wind matters even more, but only
 * with DIRECTION: a 15mph wind blowing out to center field helps offense;
 * the same 15mph blowing in suppresses it. A bare wind-speed number with no
 * direction context is close to useless for this.
 *
 * Shared across both teams (not per-team like bullpen/platoon) — the same
 * park, same conditions, affect both offenses equally. Applies ONLY when
 * the venue's roof is reported "Open": whether a retractable roof is
 * actually open on a given day isn't reliably knowable in advance from any
 * free source, so this deliberately never guesses — a "Retractable" (or any
 * other non-"Open") park always gets a zero shift, same as a fixed dome
 * would if one existed in the current MLB Stats API roofType values.
 *
 * Same "transparent v1 heuristic, not a fitted model" caveat as every other
 * constant in expectedRuns.ts. Unlike the platoon feature, weather COULD in
 * principle be backtested (Open-Meteo has a true historical archive, not
 * just forecasts) — that's deliberately not attempted this pass (would need
 * a historical venue backfill first); see docs/architecture/
 * MLB-MODEL-INVENTORY.md for the follow-up note.
 */

export interface GameWeatherConditions {
  temperatureF: number | null;
  windMph: number | null;
  /** Meteorological convention: the direction the wind is coming FROM, in compass degrees. */
  windFromDeg: number | null;
  /** The venue's home-plate-to-center-field compass bearing. */
  venueAzimuthDeg: number | null;
  /** MLB's own reported roof type ("Open", "Retractable", ...). Weather only applies when this is exactly "Open". */
  roofType: string | null;
}

/** Neutral baseline temperature (°F) — the zero point for the temperature shift. */
const NEUTRAL_TEMP_F = 70;

/** Documented-guess runs/9 shift per 10°F above/below NEUTRAL_TEMP_F. */
const TEMP_RUNS_PER_10F = 0.06;

/** Documented-guess runs/9 shift per mph of wind blowing outward along the park's azimuth (negative = blowing in). */
const WIND_RUNS_PER_MPH_OUT = 0.03;

/** Caps how far either effect alone can move the projection, so one extreme reading (a very hot day, a stiff gale) can't dominate it. */
const MAX_TEMP_SHIFT = 0.3;
const MAX_WIND_SHIFT = 0.4;

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, -max), max);
}

/**
 * The wind's component blowing OUTWARD along the park's azimuth (toward
 * center field), in mph. Positive = blowing out (helps offense); negative =
 * blowing in (suppresses it); ~0 = pure crosswind.
 *
 * `windFromDeg` is where the wind is coming FROM (meteorological
 * convention). A wind blowing TOWARD center field is therefore blowing FROM
 * roughly the opposite direction of the park's azimuth — e.g. at a park
 * facing due north (azimuth 0°), a wind blowing straight out to center is
 * coming FROM the south (windFromDeg 180°). So the direction the wind is
 * blowing TOWARD is `windFromDeg + 180`, and its alignment with the park's
 * azimuth (via cosine — 1 when perfectly aligned, -1 when opposite, 0 when
 * perpendicular) gives the outward component.
 */
function outwardWindComponentMph(windMph: number, windFromDeg: number, venueAzimuthDeg: number): number {
  const windBlowingTowardDeg = windFromDeg + 180;
  const angleFromAzimuth = ((windBlowingTowardDeg - venueAzimuthDeg) * Math.PI) / 180;
  return windMph * Math.cos(angleFromAzimuth);
}

/** Runs/9 shift from temperature and direction-aware wind, applied equally to both teams' projections. Zero whenever the roof isn't reported "Open" or any required field is missing. */
export function weatherRunsShift(conditions: GameWeatherConditions | null): number {
  if (!conditions || conditions.roofType !== "Open") return 0;

  let shift = 0;

  if (conditions.temperatureF !== null) {
    shift += clamp((TEMP_RUNS_PER_10F * (conditions.temperatureF - NEUTRAL_TEMP_F)) / 10, MAX_TEMP_SHIFT);
  }

  if (conditions.windMph !== null && conditions.windFromDeg !== null && conditions.venueAzimuthDeg !== null) {
    const outward = outwardWindComponentMph(conditions.windMph, conditions.windFromDeg, conditions.venueAzimuthDeg);
    shift += clamp(WIND_RUNS_PER_MPH_OUT * outward, MAX_WIND_SHIFT);
  }

  return shift;
}
