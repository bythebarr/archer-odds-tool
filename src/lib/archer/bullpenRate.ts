/**
 * Team bullpen quality — trailing relief-pitching runs-allowed totals.
 *
 * expectedRuns.ts's pitcherExpectedRuns() splits a game into "starter share"
 * and "bullpen share" of a team's runs allowed, but historically priced the
 * bullpen share at a flat league-average constant for every team — no
 * team-specific signal at all, despite relief-appearance data already being
 * ingested (PlayerGameLog rows with isStarter: false). This module turns
 * those rows into a trailing bullpen runs-allowed split.
 *
 * Pure and DB-free (same shape as props/opponentKRate.ts): the caller passes
 * raw relief-appearance rows and a key to group them by (plain teamId for a
 * single-season live lookup, `${season}:${teamId}` for a multi-season
 * backtest preload — the same trick mlb.ts's collectMlbSamples uses for
 * startsByPitcher, so a backtest spanning several seasons doesn't blend
 * unrelated years' bullpens together). Returns RAW totals, not a shrunk
 * rate — expectedRuns.ts owns the shrink-toward-league-average anchor and
 * threshold, alongside every other shrink constant in this model.
 */

/** A relief appearance, as read from PlayerGameLog (isStarter: false rows). */
export interface BullpenLogRow {
  /** Opaque grouping key — plain teamId (live) or `${season}:${teamId}` (backtest). */
  key: string;
  gameDate: Date;
  outsRecorded: number | null;
  earnedRuns: number | null;
}

/** Raw trailing relief-pitching totals — earned runs and outs recorded. */
export interface BullpenSplit {
  earnedRuns: number;
  outsRecorded: number;
}

interface BullpenGame {
  date: Date;
  earnedRuns: number;
  outsRecorded: number;
}

export interface BullpenRunRateModel {
  /** key → date-sorted per-day relief totals. */
  series: Map<string, BullpenGame[]>;
}

/** Build the per-team trailing bullpen model from raw relief-appearance rows. */
export function buildBullpenRunRateModel(rows: BullpenLogRow[]): BullpenRunRateModel {
  // Aggregate multiple relievers' rows into one bucket per (key, calendar
  // day) — a team's whole bullpen for that game becomes one data point,
  // same "one row per team-day" shape opponentKRate.ts uses for batters.
  const byDay = new Map<string, BullpenGame & { key: string }>();
  for (const r of rows) {
    if (!r.outsRecorded || r.earnedRuns === null) continue;
    const dayKey = `${r.key}|${r.gameDate.toISOString().slice(0, 10)}`;
    const cur = byDay.get(dayKey) ?? { key: r.key, date: r.gameDate, earnedRuns: 0, outsRecorded: 0 };
    cur.earnedRuns += r.earnedRuns;
    cur.outsRecorded += r.outsRecorded;
    byDay.set(dayKey, cur);
  }

  const series = new Map<string, BullpenGame[]>();
  for (const g of byDay.values()) {
    const arr = series.get(g.key) ?? [];
    arr.push({ date: g.date, earnedRuns: g.earnedRuns, outsRecorded: g.outsRecorded });
    series.set(g.key, arr);
  }
  for (const arr of series.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { series };
}

/**
 * A team's trailing relief-pitching split from games strictly before
 * `before` (or the whole series when `before` is omitted — the live "as of
 * now" case, matching getTeamFormForGame's optional-cutoff convention).
 * Null only when the key is unknown to the model; a known key with zero
 * qualifying games returns a zeroed split, letting the caller decide how to
 * treat "no sample yet" (expectedRuns.ts shrinks it fully toward league
 * average, the same as an unknown key).
 */
export function trailingBullpenSplit(
  model: BullpenRunRateModel,
  key: string | null | undefined,
  before?: Date
): BullpenSplit | null {
  if (!key) return null;
  const arr = model.series.get(key);
  if (!arr) return null;

  let earnedRuns = 0;
  let outsRecorded = 0;
  for (const g of arr) {
    if (before && g.date >= before) break; // date-sorted
    earnedRuns += g.earnedRuns;
    outsRecorded += g.outsRecorded;
  }
  return { earnedRuns, outsRecorded };
}
