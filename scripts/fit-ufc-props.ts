import "dotenv/config";
/**
 * Fits the UFC props model (src/lib/ufc/propModel.ts): replays every bout with
 * stats since FROM, each fighter described only by his earlier fights, and
 * scores P(over) across a ladder of lines by log loss — against the same
 * fight-length mixture with his division's average rate (no fighter info).
 * Also reports how the model does for debuts and short careers.
 *
 *   npx tsx scripts/fit-ufc-props.ts [fromYear=2010]
 */
import { divisionPriors, loadUfcBouts, logFor, priorFor } from "@/lib/ufc/fightLogs";
import { UFC_PROP_PARAMS, finishChance, fightLength, type DivisionPrior, type UfcFightLog, type UfcPropStat, type UfcRates } from "@/lib/ufc/propModel";

const FROM = Number(process.argv[2] ?? 2010);
const LADDER: Record<UfcPropStat, number[]> = { sigStrikes: [10.5, 20.5, 30.5, 40.5, 50.5, 65.5, 80.5], takedowns: [0.5, 1.5, 2.5, 3.5], knockdowns: [0.5] };
const KEY = { sigStrikes: "sig", takedowns: "td", knockdowns: "kd" } as const;

/** Raw decayed sums before shrinking, so the grid can re-shrink cheaply. */
interface Raw { min: number; off: { sig: number; td: number; kd: number }; def: { sig: number; td: number; kd: number }; fin: number; wf: number; fights: number }
function raw(logs: UfcFightLog[], date: Date): Raw {
  const r: Raw = { min: 0, off: { sig: 0, td: 0, kd: 0 }, def: { sig: 0, td: 0, kd: 0 }, fin: 0, wf: 0, fights: 0 };
  for (const l of logs) {
    const w = Math.pow(0.5, (date.getTime() - new Date(l.date).getTime()) / (30.44 * 86_400_000) / UFC_PROP_PARAMS.halfLifeMonths);
    if (l.result !== "NC") {
      r.wf += w;
      if (l.method && !/decision/i.test(l.method)) r.fin += w;
    }
    r.fights++;
    if (!l.mine || !l.theirs || l.seconds <= 0) continue;
    r.min += (l.seconds / 60) * w;
    for (const k of ["sig", "td", "kd"] as const) {
      r.off[k] += w * l.mine[k];
      r.def[k] += w * l.theirs[k];
    }
  }
  return r;
}
function rates(r: Raw, prior: DivisionPrior, k: Record<UfcPropStat, number>, priorFights: number): UfcRates {
  const s = (x: number, avg: number, p: number) => (x + avg * p) / (r.min + p);
  return {
    minutes: r.min,
    fights: r.fights,
    sig: s(r.off.sig, prior.sig, k.sigStrikes),
    td: s(r.off.td, prior.td, k.takedowns),
    kd: s(r.off.kd, prior.kd, k.knockdowns),
    sigAllowed: s(r.def.sig, prior.sig, k.sigStrikes),
    tdAllowed: s(r.def.td, prior.td, k.takedowns),
    kdAllowed: s(r.def.kd, prior.kd, k.knockdowns),
    finish: (r.fin + prior.finish * priorFights) / (r.wf + priorFights),
  };
}

function nbOverMix(rate: number, length: [number, number][], point: number, size: number): number {
  let over = 0;
  for (const [m, w] of length) {
    const mean = rate * m;
    if (mean <= 0) continue;
    const p = size / (size + mean);
    let t = Math.pow(p, size);
    let below = 0;
    for (let k = 0; k <= point; k++) {
      below += t;
      t *= ((k + size) / (k + 1)) * (1 - p);
    }
    over += w * (1 - below);
  }
  return Math.min(0.995, Math.max(0.005, over));
}

interface Case { strength: number; me: Raw; them: Raw; prior: DivisionPrior; rounds: number; actual: Record<UfcPropStat, number>; myFights: number; minutesActual: number; finished: boolean }

async function main() {
  const bouts = await loadUfcBouts();
  const priors = divisionPriors(bouts);
  const logs = new Map<string, UfcFightLog[]>();
  const cases: Case[] = [];
  const elo = new Map<string, number>();
  for (const b of bouts) {
    const er = elo.get(b.red) ?? 1500;
    const eb = elo.get(b.blue) ?? 1500;
    const prior = priorFor(priors, b.weightClass);
    if (b.date.getUTCFullYear() >= FROM && b.redLine && b.blueLine && b.method && !/overturned|could not|dq/i.test(b.method)) {
      const rr = raw(logs.get(b.red) ?? [], b.date);
      const rb = raw(logs.get(b.blue) ?? [], b.date);
      const sec = logFor(b, b.red).seconds;
      for (const [me, them, line, strength] of [[rr, rb, b.redLine, 1 / (1 + 10 ** ((eb - er) / 400)) - 0.5], [rb, rr, b.blueLine, 1 / (1 + 10 ** ((er - eb) / 400)) - 0.5]] as const) {
        cases.push({ strength, me, them, prior, rounds: b.scheduledRounds, actual: { sigStrikes: line.sig, takedowns: line.td, knockdowns: line.kd }, myFights: me.fights, minutesActual: sec / 60, finished: !/decision/i.test(b.method) });
      }
    }
    for (const id of [b.red, b.blue]) logs.set(id, [...(logs.get(id) ?? []), logFor(b, id)]);
    if (b.method && !/overturned|no contest/i.test(b.method)) {
      const exp = 1 / (1 + 10 ** ((eb - er) / 400));
      const sc = b.winner === b.red ? 1 : b.winner === b.blue ? 0 : 0.5;
      elo.set(b.red, er + 32 * (sc - exp));
      elo.set(b.blue, eb - 32 * (sc - exp));
    }
  }
  console.log(`${cases.length} fighter-fights since ${FROM}`);

  // Fight length: finish chance calibration by prior-fights.
  for (const pf of [6, 10, 15, 25]) {
    let ll = 0;
    for (const c of cases) {
      const k = UFC_PROP_PARAMS.priorMinutes;
      const p = finishChance(rates(c.me, c.prior, k, pf), rates(c.them, c.prior, k, pf), c.prior);
      ll -= c.finished ? Math.log(p) : Math.log(1 - p);
    }
    const base = cases.filter((c) => c.finished).length / cases.length;
    console.log(`finish priorFights=${pf}: LL ${(ll / cases.length).toFixed(4)} (base ${(-(base * Math.log(base) + (1 - base) * Math.log(1 - base))).toFixed(4)})`);
  }

  const score = (stat: UfcPropStat, k: number, damp: number, size: number, filter: (c: Case) => boolean = () => true, naive = false, gamma = 0) => {
    let ll = 0;
    let n = 0;
    const kk = { ...UFC_PROP_PARAMS.priorMinutes, [stat]: k };
    for (const c of cases) {
      if (!filter(c)) continue;
      const me = rates(c.me, c.prior, kk, UFC_PROP_PARAMS.priorFights);
      const them = rates(c.them, c.prior, kk, UFC_PROP_PARAMS.priorFights);
      const length = fightLength(naive ? c.prior.finish : finishChance(me, them, c.prior), c.rounds);
      const key = KEY[stat];
      const allowed = stat === "sigStrikes" ? them.sigAllowed : stat === "takedowns" ? them.tdAllowed : them.kdAllowed;
      const rate = naive ? c.prior[key] : me[key] * Math.pow(allowed / c.prior[key], damp) * Math.exp(gamma * c.strength);
      for (const pt of LADDER[stat]) {
        const p = nbOverMix(rate, length, pt, size);
        ll -= c.actual[stat] > pt ? Math.log(p) : Math.log(1 - p);
        n++;
      }
    }
    return ll / n;
  };

  for (const stat of ["sigStrikes", "takedowns", "knockdowns"] as UfcPropStat[]) {
    let best = { k: 0, damp: 0, size: 0, ll: Infinity };
    for (const size of stat === "sigStrikes" ? [4, 6, 9, 14] : [1, 2, 3, 5]) {
      const naive = score(stat, 1, 0, size, () => true, true);
      for (const k of stat === "sigStrikes" ? [15, 25, 40] : [15, 25, 50, 90]) {
        for (const damp of [0.3, 0.6, 0.9, 1.2]) {
          const ll = score(stat, k, damp, size);
          if (ll < best.ll) best = { k, damp, size, ll };
        }
      }
      console.log(`${stat} size=${size}: naive ${naive.toFixed(4)}`);
    }
    const naive = score(stat, 1, 0, best.size, () => true, true);
    console.log(`${stat} BEST priorMinutes=${best.k} damp=${best.damp} size=${best.size}: LL ${best.ll.toFixed(4)} vs division-only ${naive.toFixed(4)}`);
    for (const g of [0, 0.3, 0.6, 1, 1.5]) console.log(`   strength gamma=${g}: all ${score(stat, best.k, best.damp, best.size, () => true, false, g).toFixed(4)} · debut ${score(stat, best.k, best.damp, best.size, (c) => c.myFights === 0, false, g).toFixed(4)}`);
    for (const [label, f] of [["debut", (c: Case) => c.myFights === 0], ["1-3 fights", (c: Case) => c.myFights >= 1 && c.myFights <= 3], ["4+ fights", (c: Case) => c.myFights >= 4]] as const) {
      console.log(`   ${label}: model ${score(stat, best.k, best.damp, best.size, f).toFixed(4)} vs division-only ${score(stat, best.k, best.damp, best.size, f, true).toFixed(4)}`);
    }
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
