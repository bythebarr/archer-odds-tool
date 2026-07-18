/**
 * Ballpark strikeout context for pitcher-K props.
 *
 * A matchup study (scripts/matchup-park.ts) showed starters beat their
 * OPPONENT-adjusted projection by ~+7–9pt more in high-strikeout parks than
 * low-strikeout ones — a real, free environmental signal ON TOP of the opponent
 * lineup term, and one the pitcher's own K rate can't see. Confounds are guarded
 * the same way the platoon check was: the study regresses the residual AFTER the
 * opponent shift, so the pitcher's own skill and the opposing lineup are already
 * netted out; what survives tracks the park itself. Out-of-sample Brier fell on
 * every line (as much as the wired opponent term), so it earns a place.
 *
 * This turns a park's trailing batter-K rate into the additive `contextShift`
 * projectPropHit accepts. Pure and DB-free (like projection.ts / opponentKRate.ts):
 * the caller passes batting rows tagged with the park (the game's home team) and
 * we build the per-park series; the caller supplies the park + date to look up.
 * Everything is trailing-only, so a lookup is lookahead-safe as long as the
 * caller asks for the rate strictly BEFORE the game being predicted.
 */

/** Total batter-K / PA across BOTH lineups in one game at a park. */
export interface ParkKGame {
  date: Date;
  strikeouts: number;
  plateAppearances: number;
}

export interface ParkKRateModel {
  /** park (home teamId) → date-sorted per-game total batter-K totals. */
  series: Map<string, ParkKGame[]>;
  /** Population batter-K rate (K per PA) across every row — the neutral prior. */
  leagueRate: number;
}

/** One batter line, tagged with the park (the game's home team) it was played in. */
export interface ParkBattingRow {
  park: string | null | undefined;
  gameDate: Date;
  strikeoutsBatting: number | null;
  plateAppearances: number | null;
}

/**
 * Park term per K line, fit by OLS of the opponent-adjusted pitcher residual on
 * the park's league-relative K rate over ALL starts (see matchup-park.ts §3).
 * Improves out-of-sample Brier on every line on top of the opponent term. Keyed
 * by the line's string form; a line with no entry gets no shift.
 */
export const PARK_K_BETA: Record<string, number> = {
  "4.5": 2.4346,
  "5.5": 2.1508,
  "6.5": 1.6923,
};

/** Minimum plate appearances logged at a park before its trailing rate is trusted. */
export const MIN_PARK_PA = 500;

/** Build the per-park trailing-K-rate model from batting rows tagged with their park. */
export function buildParkKRateModel(rows: ParkBattingRow[]): ParkKRateModel {
  // Aggregate every batter line into one bucket per (park, calendar day) — a park
  // hosts at most one game a day, and both lineups' rows share that park.
  const byDay = new Map<string, ParkKGame & { park: string }>();
  let leagueK = 0;
  let leaguePA = 0;
  for (const r of rows) {
    if (r.plateAppearances === null || !r.park) continue;
    const k = r.strikeoutsBatting ?? 0;
    leagueK += k;
    leaguePA += r.plateAppearances;
    const key = `${r.park}|${r.gameDate.toISOString().slice(0, 10)}`;
    const cur = byDay.get(key) ?? { park: r.park, date: r.gameDate, strikeouts: 0, plateAppearances: 0 };
    cur.strikeouts += k;
    cur.plateAppearances += r.plateAppearances;
    byDay.set(key, cur);
  }
  const series = new Map<string, ParkKGame[]>();
  for (const g of byDay.values()) {
    const arr = series.get(g.park) ?? [];
    arr.push({ date: g.date, strikeouts: g.strikeouts, plateAppearances: g.plateAppearances });
    series.set(g.park, arr);
  }
  for (const arr of series.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { series, leagueRate: leaguePA > 0 ? leagueK / leaguePA : 0.22 };
}

/**
 * A park's trailing K rate (K per PA) from games strictly before `before`.
 * Returns null when the park is unknown or hasn't yet cleared MIN_PARK_PA (too
 * thin to trust — the caller should then apply no shift).
 */
export function parkTrailingKRate(model: ParkKRateModel, park: string | null | undefined, before: Date): number | null {
  if (!park) return null;
  const arr = model.series.get(park);
  if (!arr) return null;
  let ks = 0;
  let pa = 0;
  for (const g of arr) {
    if (g.date >= before) break; // date-sorted
    ks += g.strikeouts;
    pa += g.plateAppearances;
  }
  return pa >= MIN_PARK_PA ? ks / pa : null;
}

/**
 * The additive probability shift for a pitcher-K prop given the park's trailing
 * K rate. `beta · (parkRate − leagueRate)`; 0 when the line has no fitted beta or
 * the park rate is unavailable (thin/unknown) — a safe no-op. Summed alongside
 * the opponent shift into projectPropHit's contextShift.
 */
export function pitcherKParkShift(line: number, parkRate: number | null, leagueRate: number): number {
  const beta = PARK_K_BETA[String(line)];
  if (beta === undefined || parkRate === null) return 0;
  return beta * (parkRate - leagueRate);
}
