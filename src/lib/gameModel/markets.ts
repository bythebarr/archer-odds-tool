/**
 * Every game-line market priced from the game model: halves and quarters,
 * team totals, and alternate numbers on any of them.
 *
 * A period is a slice of the game. Its expected points are the game's
 * expectation × the period's share of scoring, its expected margin × the
 * margin's share, and its spread is the game's scaled by √share (adjusted by a
 * per-period factor). A team's own points are a normal around its expected
 * score with variance (σ_total² + σ_margin²) / 4, which is what the game's two
 * spreads imply if margin and total move independently. Periods can tie (books
 * refund a 2-way or price the draw in a 3-way), and the NFL's key numbers apply
 * to full-game margins only.
 *
 * Shares and spread factors are priors, refit by `npm run backtest:games` from
 * the period scores the results sync stores.
 */
import type { ExpectedScore } from "./ratings";
import type { GameModelLeague } from "./leagues";
import { keyWeights, scoreDist, type ScoreDist } from "./scoreDist";

export type Period = "game" | "h1" | "h2" | "q1" | "q2" | "q3" | "q4";
/** btts (both teams to score) and dnb (draw no bet) come from the all-sports feed; NBA/NFL never carry them. */
export type MarketKind = "ml" | "spread" | "total" | "teamTotal" | "btts" | "dnb";

export interface PeriodSpec {
  /** Share of the game's points scored in the period. */
  share: number;
  /** Share of the game's expected margin built in the period. */
  marginShare: number;
  /** Multiplier on √share × the game's spreads. */
  sdScale: number;
}

const NBA_PERIODS: Record<Exclude<Period, "game">, PeriodSpec> = {
  h1: { share: 0.502, marginShare: 0.5, sdScale: 1.05 },
  h2: { share: 0.498, marginShare: 0.5, sdScale: 1.05 },
  q1: { share: 0.252, marginShare: 0.25, sdScale: 1.1 },
  q2: { share: 0.25, marginShare: 0.25, sdScale: 1.1 },
  q3: { share: 0.25, marginShare: 0.25, sdScale: 1.1 },
  q4: { share: 0.248, marginShare: 0.25, sdScale: 1.1 },
};

/** NFL scoring bunches before halftime and late: Q2 and Q4 carry the two-minute drills. Second half includes overtime. */
const NFL_PERIODS: Record<Exclude<Period, "game">, PeriodSpec> = {
  h1: { share: 0.47, marginShare: 0.5, sdScale: 1.05 },
  h2: { share: 0.53, marginShare: 0.5, sdScale: 1.05 },
  q1: { share: 0.19, marginShare: 0.22, sdScale: 1.15 },
  q2: { share: 0.28, marginShare: 0.28, sdScale: 1.1 },
  q3: { share: 0.2, marginShare: 0.22, sdScale: 1.15 },
  q4: { share: 0.31, marginShare: 0.28, sdScale: 1.1 },
};

export const PERIOD_SPECS = { nba: NBA_PERIODS, nfl: NFL_PERIODS } as const;

export interface ModelSpreads {
  marginSd: number;
  totalSd: number;
}

/** The score distribution for a period (or the whole game). */
export function periodDist(
  league: GameModelLeague,
  expected: ExpectedScore,
  period: Period,
  spreads: ModelSpreads,
  specs: Record<Exclude<Period, "game">, PeriodSpec> = PERIOD_SPECS[league.sport]
): ScoreDist {
  if (period === "game") {
    return scoreDist(expected, spreads.marginSd, spreads.totalSd, league.keyNumbers ? keyWeights(league.keyNumbers, spreads.marginSd) : undefined, league.ties);
  }
  const s = specs[period];
  const total = (expected.home + expected.away) * s.share;
  const margin = (expected.home - expected.away) * s.marginShare;
  const scale = Math.sqrt(s.share) * s.sdScale;
  return scoreDist({ home: (total + margin) / 2, away: (total - margin) / 2 }, spreads.marginSd * scale, spreads.totalSd * scale, undefined, true);
}

/** One team's points in a period: discrete normal with the variance the game's spreads imply. */
export function teamPointsDist(
  league: GameModelLeague,
  expected: ExpectedScore,
  team: "home" | "away",
  period: Period,
  spreads: ModelSpreads,
  specs: Record<Exclude<Period, "game">, PeriodSpec> = PERIOD_SPECS[league.sport]
): Map<number, number> {
  const s = period === "game" ? { share: 1, marginShare: 1, sdScale: 1 } : specs[period];
  const total = (expected.home + expected.away) * s.share;
  const margin = (expected.home - expected.away) * s.marginShare;
  const mean = team === "home" ? (total + margin) / 2 : (total - margin) / 2;
  const sd = (Math.sqrt(spreads.totalSd ** 2 + spreads.marginSd ** 2) / 2) * Math.sqrt(s.share) * s.sdScale;
  const out = new Map<number, number>();
  let sum = 0;
  for (let k = Math.max(0, Math.floor(mean - 5 * sd)); k <= Math.ceil(mean + 5 * sd); k++) {
    const p = Math.exp(-((k - mean) ** 2) / (2 * sd * sd));
    out.set(k, p);
    sum += p;
  }
  for (const [k, p] of out) out.set(k, p / sum);
  return out;
}

export interface LineOutcome {
  /** Chance this side wins outright. */
  win: number;
  /** Chance of a push (the line lands exactly). */
  push: number;
}

function outcome(dist: Map<number, number>, wins: (x: number) => number): LineOutcome {
  let win = 0;
  let push = 0;
  for (const [x, p] of dist) {
    const r = wins(x);
    if (r > 0) win += p;
    else if (r === 0) push += p;
  }
  return { win, push };
}

/**
 * The model's win / push chances for one side of one line. `point` is the
 * side's own number (spreads: that team's; totals: the total). Draw is the
 * 3-way tie outcome.
 */
export function lineOutcome(
  league: GameModelLeague,
  expected: ExpectedScore,
  spreads: ModelSpreads,
  line: { period: Period; kind: MarketKind; side: string; team: string; point: number },
  specs: Record<Exclude<Period, "game">, PeriodSpec> = PERIOD_SPECS[league.sport]
): LineOutcome | null {
  if (line.kind === "teamTotal") {
    if (line.team !== "home" && line.team !== "away") return null;
    const d = teamPointsDist(league, expected, line.team, line.period, spreads, specs);
    return outcome(d, (t) => (line.side === "over" ? t - line.point : line.point - t));
  }
  const d = periodDist(league, expected, line.period, spreads, specs);
  if (line.kind === "total") return outcome(d.total, (t) => (line.side === "over" ? t - line.point : line.point - t));
  if (line.kind === "spread") {
    if (line.side === "home") return outcome(d.margin, (m) => m + line.point);
    if (line.side === "away") return outcome(d.margin, (m) => -m + line.point);
    return null;
  }
  // Moneyline: a tie pushes a 2-way price; a 3-way prices the draw itself.
  if (line.side === "draw") return { win: d.margin.get(0) ?? 0, push: 0 };
  return outcome(d.margin, (m) => (line.side === "home" ? m : -m));
}

/** Win chance with pushes refunded — the 2-way probability to compare with a de-vigged price. */
export function noPushProb(o: LineOutcome): number {
  return o.push >= 1 ? 0.5 : o.win / (1 - o.push);
}

/** EV per unit staked at American odds, pushes returning the stake. */
export function evWithPush(o: LineOutcome, american: number): number {
  const decimal = american > 0 ? 1 + american / 100 : 1 + 100 / -american;
  const lose = 1 - o.win - o.push;
  return o.win * (decimal - 1) - lose;
}
