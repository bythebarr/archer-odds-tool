/**
 * Any line, priced from a league's ratings: the chance each side wins and the
 * chance it pushes. Goals sports read the Poisson score grid; points sports a
 * whole-number margin and total built from the fitted spreads; winner-only
 * sports price the moneyline and nothing else (handicaps in games or sets need
 * a point model they don't have yet, so those stay market-only).
 */
import type { LineOutcome } from "@/lib/gameModel/markets";
import type { LeagueRatings } from "./ratings";

export interface LineSpec {
  /** "ml" | "spread" | "total" | "teamTotal" | "btts" | "dnb" */
  kind: string;
  period: string;
  side: string;
  /** For team totals: "home" | "away". */
  team: string;
  point: number;
  /** A moneyline offered with a draw: regulation result, no overtime. */
  threeWay?: boolean;
}

/** Share of a game's scoring in the first half. */
const H1_SHARE = { goals: 0.45, points: 0.5 } as const;

function poisson(lambda: number, max: number): number[] {
  const out = [Math.exp(-lambda)];
  for (let k = 1; k <= max; k++) out.push((out[k - 1]! * lambda) / k);
  return out;
}

/** The score grid P(home = i, away = j), draws weighted by the league's draw correction. */
export function scoreGrid(lh: number, la: number, drawBoost: number, max = 12): number[][] {
  const ph = poisson(lh, max);
  const pa = poisson(la, max);
  const grid = ph.map((pi, i) => pa.map((pj, j) => pi * pj * (i === j ? 1 + drawBoost : 1)));
  const z = grid.flat().reduce((a, b) => a + b, 0);
  return grid.map((row) => row.map((p) => p / z));
}

/** Discrete normal: P(X = k) for whole k, by continuity correction. */
export function discreteNormal(mean: number, sd: number): Map<number, number> {
  const out = new Map<number, number>();
  const cdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
  const lo = Math.floor(mean - 7 * sd);
  const hi = Math.ceil(mean + 7 * sd);
  let z = 0;
  for (let k = lo; k <= hi; k++) {
    const p = cdf((k + 0.5 - mean) / sd) - cdf((k - 0.5 - mean) / sd);
    out.set(k, p);
    z += p;
  }
  for (const [k, p] of out) out.set(k, p / z);
  return out;
}

function erf(x: number): number {
  // Abramowitz–Stegun 7.1.26, |error| < 1.5e-7.
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

/** win/push for a value distribution against "beats the number" (`score(x) > 0` wins, `= 0` pushes). */
function settle(dist: Iterable<[number, number]>, score: (x: number) => number): LineOutcome {
  let win = 0;
  let push = 0;
  for (const [x, p] of dist) {
    const s = score(x);
    if (s > 1e-9) win += p;
    else if (Math.abs(s) <= 1e-9) push += p;
  }
  return { win, push };
}

/** Quarter lines (±0.25, ±0.75) are half the stake on each neighboring half-line. */
function splitQuarter(point: number, price: (p: number) => LineOutcome | null): LineOutcome | null {
  const frac = Math.abs(point * 4) % 2;
  if (frac !== 1) return price(point);
  const a = price(point - 0.25);
  const b = price(point + 0.25);
  return a && b ? { win: (a.win + b.win) / 2, push: (a.push + b.push) / 2 } : null;
}

interface Dists {
  margin: [number, number][];
  total: [number, number][];
  team: { home: [number, number][]; away: [number, number][] };
  bothScore: number;
  /** 2-way moneylines settle a tie as overtime, roughly a coin flip. */
  tiesGoToOvertime: boolean;
}

function goalsDists(lh: number, la: number, drawBoost: number, overtime: boolean): Dists {
  const grid = scoreGrid(lh, la, drawBoost);
  const margin = new Map<number, number>();
  const total = new Map<number, number>();
  const home = new Map<number, number>();
  const away = new Map<number, number>();
  let both = 0;
  grid.forEach((row, i) =>
    row.forEach((p, j) => {
      margin.set(i - j, (margin.get(i - j) ?? 0) + p);
      total.set(i + j, (total.get(i + j) ?? 0) + p);
      home.set(i, (home.get(i) ?? 0) + p);
      away.set(j, (away.get(j) ?? 0) + p);
      if (i > 0 && j > 0) both += p;
    })
  );
  return { margin: [...margin], total: [...total], team: { home: [...home], away: [...away] }, bothScore: both, tiesGoToOvertime: overtime };
}

function pointsDists(eh: number, ea: number, marginSd: number, totalSd: number): Dists {
  const teamSd = Math.sqrt((marginSd ** 2 + totalSd ** 2) / 4);
  return {
    margin: [...discreteNormal(eh - ea, marginSd)],
    total: [...discreteNormal(eh + ea, totalSd)],
    team: { home: [...discreteNormal(eh, teamSd)], away: [...discreteNormal(ea, teamSd)] },
    bothScore: 1,
    tiesGoToOvertime: true,
  };
}

/** The model's win / push chances for one side of one line; null where the model has no view. */
export function lineOutcomeFor(r: LeagueRatings, home: string, away: string, line: LineSpec, sport: string): LineOutcome | null {
  if (line.period !== "game" && line.period !== "h1") return null;

  if (r.family === "winner" || r.family === "field") {
    if (line.kind !== "ml" || line.period !== "game" || line.side === "draw") return null;
    const p = r.winProbs(home, away);
    return { win: line.side === "home" ? p.home : p.away, push: 0 };
  }

  const e = r.expected(home, away);
  if (!e) return null;
  const share = line.period === "h1" ? H1_SHARE[r.family] : 1;
  const d =
    r.family === "goals"
      ? goalsDists(e.home * share, e.away * share, r.drawBoost, sport === "hockey" && line.period === "game")
      : pointsDists(e.home * share, e.away * share, r.marginSd * Math.sqrt(share), r.totalSd * Math.sqrt(share));

  switch (line.kind) {
    case "ml": {
      if (line.side === "draw") return { win: d.margin.find(([m]) => m === 0)?.[1] ?? 0, push: 0 };
      const sign = line.side === "home" ? 1 : -1;
      const o = settle(d.margin, (m) => sign * m);
      // A 2-way price on a sport with overtime: the tie is played off, split evenly.
      if (line.threeWay) return { win: o.win, push: 0 };
      return d.tiesGoToOvertime && line.period === "game" ? { win: o.win + o.push / 2, push: 0 } : o;
    }
    case "dnb": {
      const sign = line.side === "home" ? 1 : -1;
      return settle(d.margin, (m) => sign * m);
    }
    case "spread": {
      const sign = line.side === "home" ? 1 : -1;
      return splitQuarter(line.point, (pt) => settle(d.margin, (m) => sign * m + pt));
    }
    case "total":
      return splitQuarter(line.point, (pt) => settle(d.total, (t) => (line.side === "over" ? t - pt : pt - t)));
    case "teamTotal": {
      const dist = line.team === "home" ? d.team.home : line.team === "away" ? d.team.away : null;
      if (!dist) return null;
      return splitQuarter(line.point, (pt) => settle(dist, (t) => (line.side === "over" ? t - pt : pt - t)));
    }
    case "btts":
      if (r.family !== "goals") return null;
      return { win: line.side === "yes" ? d.bothScore : 1 - d.bothScore, push: 0 };
    default:
      return null;
  }
}
