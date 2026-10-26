/**
 * ARCHR's UFC fight model (v2): a fitted, opponent-aware win probability.
 *
 * Every completed bout is replayed in date order. Before each one, both
 * fighters are described by the same features, all as A-minus-B differences:
 *
 *   - elo: an opponent-adjusted rating. Beating a strong fighter moves it more
 *     than beating a weak one, finishes move it more than split decisions, and a
 *     debut starts from the pro record (inflated regional records read against a
 *     typical signee's).
 *   - per-minute fighting stats, decayed by recency (half-life 18 months) and
 *     shrunk toward the league average for short careers:
 *       striking differential (significant strikes landed − absorbed per minute;
 *       raw volume alone has no signal), strike defense, takedowns per 15 and
 *       takedown defense, knockdowns per 15, submission attempts per 15, and
 *       control-time share
 *   - reach, UFC experience, layoff, and moving up or down a weight class
 *
 * P(A wins) = logistic(Σ coefficient × feature). The coefficients are fitted by
 * `npm run backtest:ufc-fights` (L2 logistic regression on every past bout,
 * validated on the newest quarter) and read back live. DEFAULT_COEFFICIENTS
 * are priors for before the first fit. Age is the strongest single factor in
 * public UFC models, but our fight-data source carries no dates of birth yet,
 * so it isn't in here.
 */
import { predictLogistic } from "@/lib/stats/logistic";

export interface FighterInfo {
  id: string;
  reachInches: number | null;
  recordWins: number | null;
  recordLosses: number | null;
}

export interface BoutStatLine {
  sigLanded: number;
  sigAttempted: number;
  tdLanded: number;
  tdAttempted: number;
  knockdowns: number;
  subAttempts: number;
  controlSeconds: number;
}

export interface BoutRecord {
  id: string;
  date: Date;
  weightClass: string;
  red: string;
  blue: string;
  /** Winner's fighter id; null for a draw or no contest. */
  winner: string | null;
  method: string | null;
  /** Fight length in seconds, when known. */
  seconds: number | null;
  redStats: BoutStatLine | null;
  blueStats: BoutStatLine | null;
}

export const FEATURES = [
  "elo",
  "strikeDiff",
  "strikeDefense",
  "takedowns",
  "takedownDefense",
  "knockdowns",
  "submissions",
  "control",
  "reach",
  "experience",
  "layoff",
  "weightMove",
] as const;
export type FeatureName = (typeof FEATURES)[number];

export const FEATURE_LABEL: Record<FeatureName, string> = {
  elo: "Opponent-adjusted rating",
  strikeDiff: "Striking differential / min",
  strikeDefense: "Strike defense",
  takedowns: "Takedowns / 15 min",
  takedownDefense: "Takedown defense",
  knockdowns: "Knockdown power",
  submissions: "Submission threat",
  control: "Control time",
  reach: "Reach",
  experience: "UFC experience",
  layoff: "Layoff",
  weightMove: "Weight-class move",
};

/** Priors until the backtest fits them (logit per unit of each feature). */
export const DEFAULT_COEFFICIENTS: Record<FeatureName, number> = {
  elo: 0.45, // per 100 Elo
  strikeDiff: 0.15, // per significant strike per minute
  strikeDefense: 1.0, // per unit of defense rate
  takedowns: 0.08,
  takedownDefense: 0.5,
  knockdowns: 0.25,
  submissions: 0.05,
  control: 0.5,
  reach: 0.05, // per 5 inches
  experience: 0.05,
  layoff: -0.1,
  weightMove: -0.1,
};

// --- Elo -------------------------------------------------------------------

const ELO_START = 1500;
const K_NEW = 40;
const K_SETTLED = 28;
const SETTLED_AFTER = 5;
/** A typical UFC signee's pre-UFC win rate — regional records are read against this, not 50%. */
const SIGNEE_BASELINE = 0.8;
const PRIOR_PSEUDO = 5;
const PRIOR_ELO_SCALE = 400;
const PRIOR_ELO_CAP = 100;

function methodWeight(method: string | null): number {
  const m = method?.toLowerCase() ?? "";
  if (m.includes("ko") || m.includes("sub")) return 1.2;
  if (m.includes("split") || m.includes("majority")) return 0.8;
  return 1;
}

// --- Stats -----------------------------------------------------------------

const HALF_LIFE_MONTHS = 18;
const MS_PER_MONTH = 30.44 * 86_400_000;
/** League-average anchors and how many minutes / attempts of evidence they count as. */
const LEAGUE = { slpm: 3.6, sapm: 3.6, strDef: 0.55, td15: 1.3, tdDef: 0.65, kd15: 0.25, sub15: 0.45, ctrl: 0.18 };
const PSEUDO_MINUTES = 15;
const PSEUDO_STRIKE_ATTEMPTS = 120;
const PSEUDO_TD_ATTEMPTS = 8;

const WEIGHT_LBS: [RegExp, number][] = [
  [/straw/i, 115],
  [/fly/i, 125],
  [/bantam/i, 135],
  [/feather/i, 145],
  [/light ?heavy/i, 205],
  [/light/i, 155],
  [/welter/i, 170],
  [/middle/i, 185],
  [/heavy/i, 265],
];
export function weightClassLbs(weightClass: string): number | null {
  for (const [re, lbs] of WEIGHT_LBS) if (re.test(weightClass)) return lbs;
  return null;
}

interface PastFight {
  date: Date;
  seconds: number;
  mine: BoutStatLine | null;
  theirs: BoutStatLine | null;
  lbs: number | null;
}

export interface FighterState {
  elo: number;
  fights: number;
  past: PastFight[]; // most recent first
}

export interface FighterProfile {
  elo: number;
  fights: number;
  monthsOff: number | null;
  slpm: number;
  sapm: number;
  strikeDefense: number;
  td15: number;
  takedownDefense: number;
  kd15: number;
  sub15: number;
  control: number;
  reach: number | null;
  lastLbs: number | null;
}

export class UfcReplay {
  private state = new Map<string, FighterState>();
  private ufcRecord = new Map<string, { w: number; l: number }>();

  constructor(private readonly fighters: Map<string, FighterInfo>, allBouts: BoutRecord[]) {
    // Each fighter's full UFC W/L in our data — what's subtracted from the listed
    // pro record to recover the pre-UFC record (fixed for all dates, so no lookahead).
    for (const b of allBouts) {
      if (!b.winner) continue;
      for (const id of [b.red, b.blue]) {
        const r = this.ufcRecord.get(id) ?? { w: 0, l: 0 };
        if (b.winner === id) r.w++;
        else r.l++;
        this.ufcRecord.set(id, r);
      }
    }
  }

  /** The Elo a debut starts from: the pre-UFC record read against a typical signee's. */
  private startingElo(id: string): number {
    const f = this.fighters.get(id);
    const ufc = this.ufcRecord.get(id) ?? { w: 0, l: 0 };
    if (f?.recordWins == null || f.recordLosses == null) return ELO_START;
    const w = f.recordWins - ufc.w;
    const l = f.recordLosses - ufc.l;
    if (w < 0 || l < 0) return ELO_START;
    const rate = (w + SIGNEE_BASELINE * PRIOR_PSEUDO) / (w + l + PRIOR_PSEUDO);
    return ELO_START + Math.max(-PRIOR_ELO_CAP, Math.min(PRIOR_ELO_CAP, (rate - SIGNEE_BASELINE) * PRIOR_ELO_SCALE));
  }

  private get(id: string): FighterState {
    let s = this.state.get(id);
    if (!s) {
      s = { elo: this.startingElo(id), fights: 0, past: [] };
      this.state.set(id, s);
    }
    return s;
  }

  /** Everything known about a fighter going into a bout on `date`. */
  profile(id: string, date: Date): FighterProfile {
    const s = this.get(id);
    let minutes = 0;
    let sigL = 0;
    let sigA = 0;
    let oppL = 0;
    let oppA = 0;
    let tdL = 0;
    let oppTdL = 0;
    let oppTdA = 0;
    let kd = 0;
    let sub = 0;
    let ctrl = 0;
    for (const f of s.past) {
      if (!f.mine || !f.theirs || f.seconds <= 0) continue;
      const w = Math.pow(0.5, (date.getTime() - f.date.getTime()) / MS_PER_MONTH / HALF_LIFE_MONTHS);
      const min = f.seconds / 60;
      minutes += w * min;
      sigL += w * f.mine.sigLanded;
      sigA += w * f.theirs.sigLanded;
      oppL += w * f.theirs.sigLanded;
      oppA += w * f.theirs.sigAttempted;
      tdL += w * f.mine.tdLanded;
      oppTdL += w * f.theirs.tdLanded;
      oppTdA += w * f.theirs.tdAttempted;
      kd += w * f.mine.knockdowns;
      sub += w * f.mine.subAttempts;
      ctrl += w * f.mine.controlSeconds;
    }
    const perMin = (x: number, avg: number) => (x + avg * PSEUDO_MINUTES) / (minutes + PSEUDO_MINUTES);
    const per15 = (x: number, avg: number) => ((x + (avg / 15) * PSEUDO_MINUTES) / (minutes + PSEUDO_MINUTES)) * 15;
    const last = s.past[0];
    return {
      elo: s.elo,
      fights: s.fights,
      monthsOff: last ? (date.getTime() - last.date.getTime()) / MS_PER_MONTH : null,
      slpm: perMin(sigL, LEAGUE.slpm),
      sapm: perMin(sigA, LEAGUE.sapm),
      strikeDefense: 1 - (oppL + (1 - LEAGUE.strDef) * PSEUDO_STRIKE_ATTEMPTS) / (oppA + PSEUDO_STRIKE_ATTEMPTS),
      td15: per15(tdL, LEAGUE.td15),
      takedownDefense: 1 - (oppTdL + (1 - LEAGUE.tdDef) * PSEUDO_TD_ATTEMPTS) / (oppTdA + PSEUDO_TD_ATTEMPTS),
      kd15: per15(kd, LEAGUE.kd15),
      sub15: per15(sub, LEAGUE.sub15),
      control: (ctrl / 60 + LEAGUE.ctrl * PSEUDO_MINUTES) / (minutes + PSEUDO_MINUTES),
      reach: this.fighters.get(id)?.reachInches ?? null,
      lastLbs: last?.lbs ?? null,
    };
  }

  /** The A-minus-B feature vector for a bout between `a` and `b` on `date` in `weightClass`. */
  features(a: string, b: string, date: Date, weightClass: string): { x: number[]; a: FighterProfile; b: FighterProfile } {
    const pa = this.profile(a, date);
    const pb = this.profile(b, date);
    const lbs = weightClassLbs(weightClass);
    const move = (p: FighterProfile) => (lbs === null || p.lastLbs === null ? 0 : Math.sign(lbs - p.lastLbs));
    const layoff = (p: FighterProfile) => (p.monthsOff === null ? 0 : Math.log1p(Math.min(p.monthsOff, 48)));
    const values: Record<FeatureName, number> = {
      elo: (pa.elo - pb.elo) / 100,
      strikeDiff: pa.slpm - pa.sapm - (pb.slpm - pb.sapm),
      strikeDefense: pa.strikeDefense - pb.strikeDefense,
      takedowns: pa.td15 - pb.td15,
      takedownDefense: pa.takedownDefense - pb.takedownDefense,
      knockdowns: pa.kd15 - pb.kd15,
      submissions: pa.sub15 - pb.sub15,
      control: pa.control - pb.control,
      reach: pa.reach !== null && pb.reach !== null ? (pa.reach - pb.reach) / 5 : 0,
      experience: Math.log1p(pa.fights) - Math.log1p(pb.fights),
      layoff: layoff(pa) - layoff(pb),
      weightMove: move(pa) - move(pb),
    };
    return { x: FEATURES.map((f) => values[f]), a: pa, b: pb };
  }

  /** Applies a finished bout: Elo by result and method, and both fighters' fight logs. */
  update(b: BoutRecord): void {
    const red = this.get(b.red);
    const blue = this.get(b.blue);
    const nc = b.winner === null && /no contest|\bnc\b/i.test(b.method ?? "");
    if (!nc) {
      const exp = 1 / (1 + Math.pow(10, (blue.elo - red.elo) / 400));
      const score = b.winner === b.red ? 1 : b.winner === b.blue ? 0 : 0.5;
      const w = methodWeight(b.method);
      red.elo += (red.fights < SETTLED_AFTER ? K_NEW : K_SETTLED) * w * (score - exp);
      blue.elo -= (blue.fights < SETTLED_AFTER ? K_NEW : K_SETTLED) * w * (score - exp);
    }
    const lbs = weightClassLbs(b.weightClass);
    const seconds = b.seconds ?? 0;
    red.past.unshift({ date: b.date, seconds, mine: b.redStats, theirs: b.blueStats, lbs });
    blue.past.unshift({ date: b.date, seconds, mine: b.blueStats, theirs: b.redStats, lbs });
    red.fights++;
    blue.fights++;
  }
}

export function coefficientVector(coefs: Partial<Record<FeatureName, number>>): number[] {
  return FEATURES.map((f) => coefs[f] ?? DEFAULT_COEFFICIENTS[f]);
}

/** P(A wins) and each feature's contribution in logit (positive favors A). */
export function fightWinProb(x: number[], coefficients: number[]): { probA: number; contributions: { feature: FeatureName; logit: number }[] } {
  return {
    probA: predictLogistic(coefficients, x),
    contributions: FEATURES.map((feature, j) => ({ feature, logit: coefficients[j] * x[j] })),
  };
}

/** "3:21" in round 2 → seconds of fighting. */
export function fightSeconds(resultRound: number | null, resultTime: string | null): number | null {
  if (!resultRound || !resultTime) return null;
  const [m, s] = resultTime.split(":").map(Number);
  if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
  return (resultRound - 1) * 300 + m * 60 + s;
}
