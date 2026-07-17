/**
 * Opponent strikeout context for pitcher-K props.
 *
 * A matchup study (scripts/matchup-pitcher-k.ts) showed starters beat their
 * pitcher-ONLY projection by ~+8–10pt more against whiff-prone lineups than
 * contact ones — a real, free signal the player's own K rate can't see. This
 * turns the opposing team's trailing batter-strikeout rate into the additive
 * `contextShift` projectPropHit accepts.
 *
 * Pure and DB-free (like projection.ts): the caller passes batting game rows and
 * we build the team series; the caller supplies the opponent + date to look up.
 * Everything is trailing-only, so a lookup is lookahead-safe as long as the
 * caller asks for the rate strictly BEFORE the game being predicted.
 */

/** A team's batter line for one game (strikeouts over plate appearances). */
export interface TeamKGame {
  date: Date;
  strikeouts: number;
  plateAppearances: number;
}

export interface TeamKRateModel {
  /** teamId → date-sorted per-game batter-K totals. */
  series: Map<string, TeamKGame[]>;
  /** Population batter-K rate (K per PA) across every row — the neutral prior. */
  leagueRate: number;
}

/**
 * Opponent term per K line, fit by OLS of the pitcher-only residual on the
 * opponent's league-relative K rate over ALL starts (see the matchup script's
 * section 3). Improves out-of-sample Brier on every line. Keyed by the line's
 * string form; a line with no entry gets no shift.
 */
export const OPPONENT_K_BETA: Record<string, number> = {
  "4.5": 1.856,
  "5.5": 1.576,
  "6.5": 1.338,
};

/** Minimum opponent PA before its trailing rate is trusted (~a few games). */
export const MIN_OPPONENT_PA = 100;

interface BattingRow {
  teamId: string;
  gameDate: Date;
  strikeoutsBatting: number | null;
  plateAppearances: number | null;
}

/** Build the per-team trailing-K-rate model from raw batting game logs. */
export function buildTeamKRateModel(rows: BattingRow[]): TeamKRateModel {
  // Aggregate batter lines into one bucket per (team, calendar day) — a team
  // plays at most one game a day in this data.
  const byDay = new Map<string, TeamKGame & { teamId: string }>();
  let leagueK = 0;
  let leaguePA = 0;
  for (const r of rows) {
    if (r.plateAppearances === null) continue;
    const k = r.strikeoutsBatting ?? 0;
    leagueK += k;
    leaguePA += r.plateAppearances;
    const key = `${r.teamId}|${r.gameDate.toISOString().slice(0, 10)}`;
    const cur = byDay.get(key) ?? { teamId: r.teamId, date: r.gameDate, strikeouts: 0, plateAppearances: 0 };
    cur.strikeouts += k;
    cur.plateAppearances += r.plateAppearances;
    byDay.set(key, cur);
  }
  const series = new Map<string, TeamKGame[]>();
  for (const g of byDay.values()) {
    const arr = series.get(g.teamId) ?? [];
    arr.push({ date: g.date, strikeouts: g.strikeouts, plateAppearances: g.plateAppearances });
    series.set(g.teamId, arr);
  }
  for (const arr of series.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { series, leagueRate: leaguePA > 0 ? leagueK / leaguePA : 0.22 };
}

/**
 * A team's trailing batter-K rate from games strictly before `before`. Returns
 * null when the team is unknown or hasn't yet cleared MIN_OPPONENT_PA (too thin
 * to trust — the caller should then apply no shift).
 */
export function opponentTrailingKRate(model: TeamKRateModel, teamId: string | null | undefined, before: Date): number | null {
  if (!teamId) return null;
  const arr = model.series.get(teamId);
  if (!arr) return null;
  let ks = 0;
  let pa = 0;
  for (const g of arr) {
    if (g.date >= before) break; // date-sorted
    ks += g.strikeouts;
    pa += g.plateAppearances;
  }
  return pa >= MIN_OPPONENT_PA ? ks / pa : null;
}

/**
 * The additive probability shift for a pitcher-K prop given the opponent's
 * trailing K rate. `beta · (oppRate − leagueRate)`; 0 when the line has no fitted
 * beta or the opponent rate is unavailable (thin/unknown) — a safe no-op.
 */
export function pitcherKContextShift(line: number, opponentRate: number | null, leagueRate: number): number {
  const beta = OPPONENT_K_BETA[String(line)];
  if (beta === undefined || opponentRate === null) return 0;
  return beta * (opponentRate - leagueRate);
}
