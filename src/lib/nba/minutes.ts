/**
 * ARCHR's NBA minutes projection: how long a player should be on the floor
 * tonight, given he plays. Pure and client-safe; the props projection
 * (projection.ts) multiplies it by his per-minute rates, and the screener
 * filters on it. Every constant below is fitted by `npm run backtest:nba-minutes`
 * on two seasons of box scores, walk-forward (no lookahead).
 *
 * 1. Base: his recent minutes, recency-weighted. Games in his current role
 *    (starting or off the bench, as in his last game) count more, and games he
 *    left early (well under his usual minutes: an injury exit, foul trouble, an
 *    ejection) count less, so one cut-short night doesn't drag the number down.
 * 2. Teammates out: the games he's already played without them, blended in by
 *    how many there are; where there are too few, the absent players' usual
 *    minutes are shared out across the rest of the rotation in proportion to
 *    each player's share, at the rate the backtest finds.
 * 3. Rest: the second night of a back-to-back, separately for starters' and
 *    bench minutes.
 * 4. Returning: his first game after missing his team's last one (or several),
 *    when minutes are often managed.
 * Then tonight's spread (environment.ts) trims starters' minutes in likely
 * blowouts and adds to the bench's, on top of this.
 */
import { gamesWithout, withoutWeight, type Absence } from "@/lib/injuries/absence";

export interface MinutesLog {
  /** ET date, YYYY-MM-DD. */
  date: string;
  minutes: number;
  /** Started the game; undefined when unknown. */
  starter?: boolean;
  /** His team that night. */
  team?: string;
}

export interface MinutesParams {
  /** Games read, and the recency half-life over them. */
  window: number;
  halfLife: number;
  /** Games in his latest role count this many times as much. */
  roleWeight: number;
  /** A game under this share of his median minutes is an early exit… */
  exitRatio: number;
  /** …and counts this much. */
  exitWeight: number;
  /** Share of an absent teammate's minutes that reaches the rest of the rotation (when he has too few games without him). */
  absenceAlpha: number;
  /** The second night of a back-to-back. */
  b2bStarter: number;
  b2bBench: number;
  /** First game back after missing 1–2 of his team's games, and after 3 or more. */
  returnShort: number;
  returnLong: number;
}

/** Fitted by backtest:nba-minutes (see its report for the error each one removes). */
export const MINUTES_PARAMS: MinutesParams = {
  window: 20,
  halfLife: 5,
  roleWeight: 1,
  exitRatio: 0.5,
  exitWeight: 1,
  absenceAlpha: 0,
  b2bStarter: 1,
  b2bBench: 1,
  returnShort: 1,
  returnLong: 1,
};

/** No one plays more than this in regulation; overtime can't be forecast. */
export const MAX_MINUTES = 44;
/** A starter, for rest and blowout purposes: projected at least this many minutes. */
export const STARTER_MINUTES = 28;
/** The full-history estimate counts as this many games against the without-teammate games. */
const ABSENCE_PRIOR_GAMES = 5;
const MIN_WITHOUT_GAMES = 2;
const TEAM_MINUTES = 240;

export interface MinutesContext {
  /** Tonight, ET (YYYY-MM-DD). */
  date?: string;
  /** His team tonight. */
  team?: string;
  /** Every date his team has played (this season and last), any order. */
  teamDates?: string[];
  /** Rotation teammates out tonight. */
  absences?: Absence[];
}

export interface MinutesProjection {
  minutes: number;
  /** Before the adjustments: his recent minutes, as weighted. */
  base: number;
  role: "starter" | "bench" | null;
  /** Each adjustment as a multiplier (1 = none). */
  absence: number;
  rest: number;
  returning: number;
  backToBack: boolean;
  /** His team's games he missed right before tonight. */
  missed: number;
  /** Games he's played without tonight's absent teammates. */
  withoutGames: number;
}

const DAY = 86_400_000;
const prevDay = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) - DAY).toISOString().slice(0, 10);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** `logs`: his games, newest first. Games he didn't play (0 minutes) are skipped. Null without a game played. */
export function projectNbaMinutes(logs: MinutesLog[], ctx: MinutesContext = {}, p: MinutesParams = MINUTES_PARAMS): MinutesProjection | null {
  const played = logs.filter((l) => l.minutes > 0);
  if (played.length === 0) return null;
  const recent = played.slice(0, p.window);
  const med = median(recent.slice(0, 10).map((l) => l.minutes));
  const lastRole = recent[0].starter;
  let sum = 0;
  let w = 0;
  recent.forEach((l, i) => {
    let wi = Math.pow(0.5, i / p.halfLife);
    if (lastRole !== undefined && l.starter === lastRole) wi *= p.roleWeight;
    if (l.minutes < p.exitRatio * med) wi *= p.exitWeight;
    sum += l.minutes * wi;
    w += wi;
  });
  const base = sum / w;
  let minutes = base;

  // Teammates out.
  let absenceFactor = 1;
  let withoutGames = 0;
  if (ctx.absences?.length) {
    const without = gamesWithout(played, ctx.absences);
    withoutGames = without.length;
    if (without.length >= MIN_WITHOUT_GAMES) {
      const wMinutes = without.reduce((a, l) => a + l.minutes, 0) / without.length;
      const ww = withoutWeight(without.length, ABSENCE_PRIOR_GAMES);
      minutes = base * (1 - ww) + wMinutes * ww;
    } else {
      const lost = ctx.absences.reduce((a, x) => a + x.usage, 0);
      minutes = base + p.absenceAlpha * lost * (base / Math.max(TEAM_MINUTES - lost, 120));
    }
    absenceFactor = minutes / base;
  }

  // Rest and returns, from his team's schedule.
  let backToBack = false;
  let missed = 0;
  if (ctx.date && ctx.teamDates?.length) {
    const dates = new Set(ctx.teamDates);
    backToBack = dates.has(prevDay(ctx.date));
    // A traded player's older games were for another team: only count misses since he joined this one.
    if (!ctx.team || !played[0].team || played[0].team === ctx.team) {
      const last = played[0].date;
      missed = ctx.teamDates.filter((d) => d > last && d < ctx.date!).length;
    }
  }
  const starter = minutes >= STARTER_MINUTES;
  const rest = backToBack ? (starter ? p.b2bStarter : p.b2bBench) : 1;
  const returning = missed >= 3 ? p.returnLong : missed >= 1 ? p.returnShort : 1;
  minutes = Math.min(MAX_MINUTES, minutes * rest * returning);

  return {
    minutes,
    base,
    role: lastRole === undefined ? null : lastRole ? "starter" : "bench",
    absence: absenceFactor,
    rest,
    returning,
    backToBack,
    missed,
    withoutGames,
  };
}
