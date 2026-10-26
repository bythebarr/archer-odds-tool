/**
 * ARCHR's F1 race model: car + driver pace ratings, reliability, and a race
 * simulation for win / podium / points / teammate odds.
 *
 * Ratings. Each entry's pace is car[constructor] + driver[driver]. After every
 * race the finishing order updates both through the Plackett–Luce model (the
 * multi-competitor Elo: finishing ahead of strong cars moves you more than
 * finishing ahead of backmarkers). The car carries most of an F1 result, so it
 * learns faster than the driver. Between seasons the car reverts hard, because
 * regulations and development reshuffle the grid, and the driver reverts only
 * a little.
 *
 * Retirements. A mechanical failure (engine, gearbox, hydraulics...) is the
 * car's reliability, not pace, so it's left out of the ranking and counted
 * against the constructor's failure rate. A crash, collision or spin counts the
 * driver as finishing behind every classified car, and against his incident
 * rate. Both rates are recency-weighted and shrunk toward the field's.
 *
 * Simulation. Each run draws every car's performance as pace + Gumbel noise
 * (the exact sampling form of Plackett–Luce), retires cars at their
 * reliability rates, and reads off the order. `npm run backtest:f1` refits the
 * learning rates on history and grades the winner and podium probabilities.
 */

export interface F1Entry {
  driverId: string;
  constructorId: string;
  /** Numeric finishing place when classified; null for a DNF/DSQ. */
  position: number | null;
  status: string;
  laps: number | null;
}

export interface F1RaceRecord {
  id: string;
  season: number;
  date: Date;
  entries: F1Entry[];
}

export interface F1ModelOpts {
  carRate: number;
  driverRate: number;
  carRevert: number;
  driverRevert: number;
}

export const DEFAULT_F1_OPTS: F1ModelOpts = { carRate: 0.12, driverRate: 0.05, carRevert: 0.5, driverRevert: 0.15 };

const FIELD_MECH_RATE = 0.06;
const FIELD_INCIDENT_RATE = 0.04;
const PSEUDO_STARTS = 20;
/** Reliability evidence halves every this many races. */
const RELIABILITY_HALF_LIFE = 20;

export type Retirement = "none" | "mechanical" | "incident";

/** Classifies a non-finish: the driver's fault (incident) or the car's (mechanical). Classified cars ran to the end. */
export function retirementOf(e: F1Entry): Retirement {
  if (e.position !== null) return "none";
  return /accident|collision|spun|crash|disqualified|damage/i.test(e.status) ? "incident" : "mechanical";
}

interface Rate {
  fails: number;
  starts: number;
}

export class F1Ratings {
  private car = new Map<string, number>();
  private driver = new Map<string, number>();
  private carSeason = new Map<string, number>();
  private driverSeason = new Map<string, number>();
  private mech = new Map<string, Rate>();
  private incident = new Map<string, Rate>();
  private races = new Map<string, number>();

  constructor(private readonly opts: F1ModelOpts = DEFAULT_F1_OPTS) {}

  carPace(id: string): number {
    return this.car.get(id) ?? 0;
  }
  driverPace(id: string): number {
    return this.driver.get(id) ?? 0;
  }
  starts(driverId: string): number {
    return this.races.get(driverId) ?? 0;
  }

  /** Applies the between-season reversion the first time a car/driver appears in a new season. */
  touch(entries: { driverId: string; constructorId: string }[], season: number): void {
    for (const e of entries) {
      const cs = this.carSeason.get(e.constructorId);
      if (cs !== undefined && season > cs) this.car.set(e.constructorId, this.carPace(e.constructorId) * (1 - this.opts.carRevert));
      this.carSeason.set(e.constructorId, season);
      const ds = this.driverSeason.get(e.driverId);
      if (ds !== undefined && season > ds) this.driver.set(e.driverId, this.driverPace(e.driverId) * (1 - this.opts.driverRevert));
      this.driverSeason.set(e.driverId, season);
    }
  }

  pace(e: { driverId: string; constructorId: string }): number {
    return this.carPace(e.constructorId) + this.driverPace(e.driverId);
  }

  mechanicalRate(constructorId: string): number {
    const r = this.mech.get(constructorId) ?? { fails: 0, starts: 0 };
    return (r.fails + FIELD_MECH_RATE * PSEUDO_STARTS) / (r.starts + PSEUDO_STARTS);
  }
  incidentRate(driverId: string): number {
    const r = this.incident.get(driverId) ?? { fails: 0, starts: 0 };
    return (r.fails + FIELD_INCIDENT_RATE * PSEUDO_STARTS) / (r.starts + PSEUDO_STARTS);
  }

  private bump(map: Map<string, Rate>, id: string, failed: boolean): void {
    const decay = Math.pow(0.5, 1 / RELIABILITY_HALF_LIFE);
    const r = map.get(id) ?? { fails: 0, starts: 0 };
    map.set(id, { fails: r.fails * decay + (failed ? 1 : 0), starts: r.starts * decay + 1 });
  }

  /** Learns from a finished race (Plackett–Luce gradient on the observed order). */
  update(race: F1RaceRecord): void {
    const ranked = race.entries
      .filter((e) => retirementOf(e) !== "mechanical")
      .sort((a, b) => {
        const ra = retirementOf(a) === "incident" ? 1 : 0;
        const rb = retirementOf(b) === "incident" ? 1 : 0;
        if (ra !== rb) return ra - rb; // classified cars ahead of crashed ones
        if (ra === 0) return (a.position ?? 99) - (b.position ?? 99);
        return (b.laps ?? 0) - (a.laps ?? 0);
      });
    const theta = ranked.map((e) => this.pace(e));
    const grad = new Array(ranked.length).fill(0);
    // Stage k: entry k "wins" among those not yet placed.
    for (let k = 0; k < ranked.length - 1; k++) {
      let max = -Infinity;
      for (let j = k; j < ranked.length; j++) max = Math.max(max, theta[j]);
      let z = 0;
      for (let j = k; j < ranked.length; j++) z += Math.exp(theta[j] - max);
      for (let j = k; j < ranked.length; j++) grad[j] -= Math.exp(theta[j] - max) / z;
      grad[k] += 1;
    }
    ranked.forEach((e, i) => {
      this.car.set(e.constructorId, this.carPace(e.constructorId) + this.opts.carRate * grad[i]);
      this.driver.set(e.driverId, this.driverPace(e.driverId) + this.opts.driverRate * grad[i]);
    });
    for (const e of race.entries) {
      const r = retirementOf(e);
      this.bump(this.mech, e.constructorId, r === "mechanical");
      if (r !== "mechanical") this.bump(this.incident, e.driverId, r === "incident");
      this.races.set(e.driverId, this.starts(e.driverId) + 1);
    }
  }
}

export interface DriverOdds {
  driverId: string;
  constructorId: string;
  pace: number;
  win: number;
  podium: number;
  points: number; // top 10
  dnf: number;
  /** Chance of finishing ahead of his teammate (when both start). */
  beatsTeammate: number | null;
  expectedPosition: number;
}

/** A small deterministic PRNG so a page's odds don't flicker between renders. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simulates the race `runs` times for this entry list. */
export function simulateRace(ratings: F1Ratings, entries: { driverId: string; constructorId: string }[], runs = 20000, seed = 42): DriverOdds[] {
  const rand = mulberry32(seed);
  const n = entries.length;
  const pace = entries.map((e) => ratings.pace(e));
  const pFail = entries.map((e) => 1 - (1 - ratings.mechanicalRate(e.constructorId)) * (1 - ratings.incidentRate(e.driverId)));
  const win = new Array(n).fill(0);
  const podium = new Array(n).fill(0);
  const points = new Array(n).fill(0);
  const dnf = new Array(n).fill(0);
  const posSum = new Array(n).fill(0);
  const ahead = new Array(n).fill(0);
  const teammate = entries.map((e, i) => entries.findIndex((o, j) => j !== i && o.constructorId === e.constructorId));
  const perf = new Array(n);
  for (let r = 0; r < runs; r++) {
    for (let i = 0; i < n; i++) {
      const out = rand() < pFail[i];
      if (out) dnf[i]++;
      // Gumbel(0, 1) noise; a retired car sorts last.
      perf[i] = out ? -1e9 - rand() : pace[i] - Math.log(-Math.log(rand() || 1e-12));
    }
    const order = [...perf.keys()].sort((a, b) => perf[b] - perf[a]);
    order.forEach((i, place) => {
      if (place === 0) win[i]++;
      if (place < 3) podium[i]++;
      if (place < 10) points[i]++;
      posSum[i] += place + 1;
    });
    for (let i = 0; i < n; i++) if (teammate[i] >= 0 && perf[i] > perf[teammate[i]]) ahead[i]++;
  }
  return entries
    .map((e, i) => ({
      driverId: e.driverId,
      constructorId: e.constructorId,
      pace: pace[i],
      win: win[i] / runs,
      podium: podium[i] / runs,
      points: points[i] / runs,
      dnf: dnf[i] / runs,
      beatsTeammate: teammate[i] >= 0 ? ahead[i] / runs : null,
      expectedPosition: posSum[i] / runs,
    }))
    .sort((a, b) => b.win - a.win || a.expectedPosition - b.expectedPosition);
}

/** Fair American odds for a probability. */
export function fairAmerican(p: number): number {
  if (p <= 0) return Infinity;
  if (p >= 1) return -Infinity;
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}
