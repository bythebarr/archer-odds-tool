/**
 * Starting-pitcher ERA recency — last-10/last-5-start splits.
 *
 * Team offense/defense already blend season/last-10/last-5 (teamForm.ts's
 * weightedRunsRate), but a starting pitcher's ERA (winProbability.ts's
 * pitcherQualityScore, expectedRuns.ts's pitcherExpectedRuns) has always
 * been season-to-date only — a pitcher who's been lights-out or getting hit
 * hard his last few starts moves the model no differently than one pitching
 * exactly to his season average. This module gives ERA the same recency
 * shape teamForm.ts already gives runs, at "start" granularity instead of
 * "game."
 *
 * Pure and DB-free (same shape as archer/bullpenRate.ts): the caller passes
 * raw per-start pitching rows and a key to group them by (plain
 * mlbPlayerId for a single-season live lookup, `${season}:${pitcherId}` for
 * a multi-season backtest preload). Returns RAW totals, not a shrunk rate —
 * winProbability.ts/expectedRuns.ts own the season/last10/last5 blend
 * weights and the shrink-toward-league-average anchor, alongside every
 * other model constant.
 */

/** How many of a pitcher's most recent starts count as "last10"/"last5" — shared by the live query, mlb.ts's backtest, and the totals/spread backtest script, so the window size lives in one place. */
export const RECENT_STARTS_LONG_WINDOW = 10;
export const RECENT_STARTS_SHORT_WINDOW = 5;

/** One start, as read from PlayerGameLog (isStarter: true rows). */
export interface PitcherStartRow {
  /** Opaque grouping key — plain mlbPlayerId (live) or `${season}:${mlbPlayerId}` (backtest). */
  key: string;
  gameDate: Date;
  outsRecorded: number | null;
  earnedRuns: number | null;
}

/** Raw trailing starts totals — earned runs and outs recorded over some number of starts. */
export interface PitcherStartSplit {
  earnedRuns: number;
  outsRecorded: number;
  starts: number;
}

interface PitcherStart {
  date: Date;
  earnedRuns: number;
  outsRecorded: number;
}

export interface PitcherStartsModel {
  /** key → date-sorted (ascending) starts. */
  series: Map<string, PitcherStart[]>;
}

/** Build the per-pitcher trailing-starts model from raw per-start pitching rows. */
export function buildPitcherStartsModel(rows: PitcherStartRow[]): PitcherStartsModel {
  // One start per (key, calendar day) — a pitcher starts at most once a day.
  const byDay = new Map<string, PitcherStart & { key: string }>();
  for (const r of rows) {
    if (!r.outsRecorded || r.earnedRuns === null) continue;
    const dayKey = `${r.key}|${r.gameDate.toISOString().slice(0, 10)}`;
    byDay.set(dayKey, { key: r.key, date: r.gameDate, earnedRuns: r.earnedRuns, outsRecorded: r.outsRecorded });
  }

  const series = new Map<string, PitcherStart[]>();
  for (const s of byDay.values()) {
    const arr = series.get(s.key) ?? [];
    arr.push({ date: s.date, earnedRuns: s.earnedRuns, outsRecorded: s.outsRecorded });
    series.set(s.key, arr);
  }
  for (const arr of series.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { series };
}

/**
 * A pitcher's trailing split over their most recent `windowStarts` starts
 * strictly before `before` (or their whole series when `before` is
 * omitted — the live "as of now" case, matching getTeamFormForGame's
 * optional-cutoff convention). Null only when the key is unknown to the
 * model; a known key with fewer than `windowStarts` qualifying starts
 * returns whatever it has (possibly zeroed) rather than padding — the
 * caller (startSplitEraPerNine) treats zero outs as "no signal."
 */
export function trailingPitcherStartsSplit(
  model: PitcherStartsModel,
  key: string | null | undefined,
  windowStarts: number,
  before?: Date
): PitcherStartSplit | null {
  if (!key) return null;
  const arr = model.series.get(key);
  if (!arr) return null;

  const prior = before ? arr.filter((s) => s.date < before) : arr; // arr is date-sorted ascending
  const windowed = prior.slice(Math.max(0, prior.length - windowStarts));

  let earnedRuns = 0;
  let outsRecorded = 0;
  for (const s of windowed) {
    earnedRuns += s.earnedRuns;
    outsRecorded += s.outsRecorded;
  }
  return { earnedRuns, outsRecorded, starts: windowed.length };
}

/** ERA (runs per 9 innings) implied by a start split. Null if there's no innings to divide by (no starts yet in the window). */
export function startSplitEraPerNine(split: PitcherStartSplit | null): number | null {
  if (!split || split.outsRecorded === 0) return null;
  return (27 * split.earnedRuns) / split.outsRecorded;
}
