/**
 * UFC fighter props: significant strikes landed, takedowns landed and
 * knockdowns. Pure.
 *
 * Each fighter's rates per minute come from his UFC fights before this one,
 * weighted by recency (half-life 18 months) and shrunk toward his weight
 * class's averages by `priorMinutes` of evidence — a debut is his division's
 * average, and five rounds of tape moves him only part of the way. His rate
 * is then tilted by what the opponent allows (damped), and spread over how
 * long the fight lasts: a decision goes the full distance; a finish lands in a
 * round (the early ones far likelier), anywhere within it. Counts at a given
 * length are negative binomial. Constants fitted by scripts/fit-ufc-props.ts.
 */
export type UfcPropStat = "sigStrikes" | "takedowns" | "knockdowns";

export interface UfcLogLine {
  sig: number;
  sigAtt: number;
  td: number;
  tdAtt: number;
  kd: number;
  sub: number;
  ctrl: number;
  head: number;
  body: number;
  leg: number;
  distance: number;
  clinch: number;
  ground: number;
  total: number;
}

/** One fight from a fighter's side. */
export interface UfcFightLog {
  date: string;
  opponent: string;
  opponentId: string;
  result: "W" | "L" | "D" | "NC";
  method: string | null;
  round: number | null;
  time: string | null;
  seconds: number;
  scheduledRounds: number;
  weightClass: string;
  mine: UfcLogLine | null;
  theirs: UfcLogLine | null;
}

export interface UfcPropStatDef {
  key: UfcPropStat;
  label: string;
  shortLabel: string;
  value: (l: UfcLogLine) => number;
}

export const UFC_PROP_STATS: UfcPropStatDef[] = [
  { key: "sigStrikes", label: "Significant strikes landed", shortLabel: "SIG STR", value: (l) => l.sig },
  { key: "takedowns", label: "Takedowns landed", shortLabel: "TD", value: (l) => l.td },
  { key: "knockdowns", label: "Knockdowns", shortLabel: "KD", value: (l) => l.kd },
];
export const UFC_PROP_STAT_BY_KEY = new Map(UFC_PROP_STATS.map((s) => [s.key, s]));

/** Per-minute averages for a weight class, and its finish rate. */
export interface DivisionPrior {
  sig: number;
  td: number;
  kd: number;
  finish: number;
}

export const UFC_PROP_PARAMS = {
  halfLifeMonths: 18,
  /** Minutes of division-average tape every fighter starts with. */
  priorMinutes: { sigStrikes: 25, takedowns: 15, knockdowns: 50 } as Record<UfcPropStat, number>,
  /** How much of the opponent's tilt (what he allows vs the division) carries over. */
  damp: { sigStrikes: 0.9, takedowns: 0.6, knockdowns: 0.6 } as Record<UfcPropStat, number>,
  /** Negative-binomial size at a given fight length. */
  size: { sigStrikes: 6, takedowns: 1, knockdowns: 5 } as Record<UfcPropStat, number>,
  /** Fights of division-average finish rate every fighter starts with. */
  priorFights: 10,
  /** Finishes skew early: share of finishes in R1..R5. */
  finishRound: [0.52, 0.3, 0.145, 0.02, 0.015],
};

const MS_PER_MONTH = 30.44 * 86_400_000;

export interface UfcRates {
  /** Decayed UFC minutes behind the rates. */
  minutes: number;
  fights: number;
  /** Offense per minute, shrunk. */
  sig: number;
  td: number;
  kd: number;
  /** Allowed per minute, shrunk. */
  sigAllowed: number;
  tdAllowed: number;
  kdAllowed: number;
  /** Share of his fights that ended inside the distance, shrunk. */
  finish: number;
}

/** His rates going into a fight on `date` from his earlier fights (any order). */
export function ufcRates(logs: UfcFightLog[], date: Date, prior: DivisionPrior, params = UFC_PROP_PARAMS): UfcRates {
  let min = 0;
  let fights = 0;
  let fin = 0;
  let wFights = 0;
  const off = { sig: 0, td: 0, kd: 0 };
  const def = { sig: 0, td: 0, kd: 0 };
  for (const l of logs) {
    const t = new Date(l.date).getTime();
    if (t >= date.getTime()) continue;
    const w = Math.pow(0.5, (date.getTime() - t) / MS_PER_MONTH / params.halfLifeMonths);
    if (l.result !== "NC") {
      wFights += w;
      if (l.method && !/decision/i.test(l.method)) fin += w;
    }
    fights++;
    if (!l.mine || !l.theirs || l.seconds <= 0) continue;
    const m = (l.seconds / 60) * w;
    min += m;
    off.sig += w * l.mine.sig;
    off.td += w * l.mine.td;
    off.kd += w * l.mine.kd;
    def.sig += w * l.theirs.sig;
    def.td += w * l.theirs.td;
    def.kd += w * l.theirs.kd;
  }
  const k = params.priorMinutes;
  const shrink = (x: number, avg: number, pseudo: number) => (x + avg * pseudo) / (min + pseudo);
  return {
    minutes: min,
    fights,
    sig: shrink(off.sig, prior.sig, k.sigStrikes),
    td: shrink(off.td, prior.td, k.takedowns),
    kd: shrink(off.kd, prior.kd, k.knockdowns),
    sigAllowed: shrink(def.sig, prior.sig, k.sigStrikes),
    tdAllowed: shrink(def.td, prior.td, k.takedowns),
    kdAllowed: shrink(def.kd, prior.kd, k.knockdowns),
    finish: (fin + prior.finish * params.priorFights) / (wFights + params.priorFights),
  };
}

/** Chance the fight ends inside the distance: both fighters' tendencies around the division's. */
export function finishChance(a: UfcRates, b: UfcRates, prior: DivisionPrior): number {
  const p = prior.finish + (a.finish - prior.finish) + (b.finish - prior.finish);
  return Math.min(0.92, Math.max(0.12, p));
}

/** How long the fight lasts: [minutes, probability] points. */
export function fightLength(pFinish: number, rounds: number, params = UFC_PROP_PARAMS): [number, number][] {
  const w = params.finishRound.slice(0, rounds);
  const total = w.reduce((a, b) => a + b, 0);
  const out: [number, number][] = [];
  const STEPS = 5;
  for (let r = 0; r < rounds; r++) {
    for (let s = 0; s < STEPS; s++) out.push([r * 5 + ((s + 0.5) / STEPS) * 5, (pFinish * w[r]!) / total / STEPS]);
  }
  out.push([rounds * 5, 1 - pFinish]);
  return out;
}

export interface UfcPropProjection {
  stat: UfcPropStat;
  /** Per minute, after the opponent's tilt. */
  rate: number;
  mean: number;
  expectedMinutes: number;
  pFinish: number;
  size: number;
  length: [number, number][];
  opponentFactor: number;
}

export function projectUfcProp(stat: UfcPropStat, me: UfcRates, them: UfcRates, prior: DivisionPrior, rounds: number, params = UFC_PROP_PARAMS): UfcPropProjection {
  const key = stat === "sigStrikes" ? "sig" : stat === "takedowns" ? "td" : "kd";
  const allowed = stat === "sigStrikes" ? them.sigAllowed : stat === "takedowns" ? them.tdAllowed : them.kdAllowed;
  const avg = prior[key];
  const opponentFactor = avg > 0 ? Math.pow(allowed / avg, params.damp[stat]) : 1;
  const rate = me[key] * opponentFactor;
  const pFinish = finishChance(me, them, prior);
  const length = fightLength(pFinish, rounds, params);
  const expectedMinutes = length.reduce((a, [m, p]) => a + m * p, 0);
  return { stat, rate, mean: rate * expectedMinutes, expectedMinutes, pFinish, size: params.size[stat], length, opponentFactor };
}

function nbBelow(mean: number, point: number, r: number): number {
  if (mean <= 0) return 1;
  const p = r / (r + mean);
  let t = Math.pow(p, r);
  let below = 0;
  for (let k = 0; k <= Math.floor(point); k++) {
    below += t;
    t *= ((k + r) / (k + 1)) * (1 - p);
  }
  return below;
}

/** P(stat > point), over the fight-length mixture. */
export function ufcPropOver(p: UfcPropProjection, point: number): number {
  let over = 0;
  for (const [m, w] of p.length) over += w * (1 - nbBelow(p.rate * m, point, p.size));
  return Math.min(0.995, Math.max(0.005, over));
}

/** ARCHR's line: the half-point closest to even. */
export function ufcPropLine(p: UfcPropProjection): number {
  let best = 0.5;
  let gap = Infinity;
  for (let pt = 0.5; pt <= p.mean * 2 + 3; pt += 1) {
    const g = Math.abs(ufcPropOver(p, pt) - 0.5);
    if (g < gap) {
      gap = g;
      best = pt;
    }
  }
  return best;
}

/** Career-style numbers for the sheet: per minute / per 15, accuracy and defense, over a window of fights. */
export function ufcCareerNumbers(logs: UfcFightLog[]) {
  const s = logs.filter((l) => l.mine && l.theirs && l.seconds > 0);
  const sum = (f: (l: UfcFightLog) => number) => s.reduce((a, l) => a + f(l), 0);
  const min = sum((l) => l.seconds) / 60;
  const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
  const sigAtt = sum((l) => l.mine!.sigAtt);
  const oppSigAtt = sum((l) => l.theirs!.sigAtt);
  const tdAtt = sum((l) => l.mine!.tdAtt);
  const oppTdAtt = sum((l) => l.theirs!.tdAtt);
  const sig = sum((l) => l.mine!.sig);
  return {
    fights: s.length,
    minutes: min,
    slpm: ratio(sum((l) => l.mine!.sig), min),
    sapm: ratio(sum((l) => l.theirs!.sig), min),
    strAcc: ratio(sig, sigAtt),
    strDef: oppSigAtt > 0 ? 1 - sum((l) => l.theirs!.sig) / oppSigAtt : null,
    td15: min > 0 ? (sum((l) => l.mine!.td) / min) * 15 : null,
    tdAcc: ratio(sum((l) => l.mine!.td), tdAtt),
    tdDef: oppTdAtt > 0 ? 1 - sum((l) => l.theirs!.td) / oppTdAtt : null,
    sub15: min > 0 ? (sum((l) => l.mine!.sub) / min) * 15 : null,
    kd15: min > 0 ? (sum((l) => l.mine!.kd) / min) * 15 : null,
    ctrlShare: min > 0 ? sum((l) => l.mine!.ctrl) / 60 / min : null,
    /** Where his strikes land and from where, as shares of significant strikes. */
    head: ratio(sum((l) => l.mine!.head), sig),
    body: ratio(sum((l) => l.mine!.body), sig),
    leg: ratio(sum((l) => l.mine!.leg), sig),
    distance: ratio(sum((l) => l.mine!.distance), sig),
    clinch: ratio(sum((l) => l.mine!.clinch), sig),
    ground: ratio(sum((l) => l.mine!.ground), sig),
    avgMinutes: s.length ? min / s.length : null,
  };
}
