/**
 * Fits the tennis props model (src/lib/tennis/propModel.ts) on the archive:
 * replays Elo match by match and, before each match, records the pre-match win
 * chance against what happened —
 *   - total games: a + b·(p − ½)², per best-of (closer matches run longer);
 *   - games-won share: ½ + k·(p − ½);
 *   - aces / double faults per service game: each player's own rate from his
 *     earlier matches, shrunk to the tour's, × the opponent's (damped), scored
 *     at the half-point nearest the projection against a Poisson / negative
 *     binomial, by log loss and calibration.
 *
 *   npx tsx scripts/fit-tennis-props.ts [fromYear=2019]
 */
import { prisma } from "@/lib/prisma";
import { TennisElo, canonicalSurface } from "@/lib/tennis/elo";
import { parseScore } from "@/lib/tennis/matchLog";

const FROM = Number(process.argv[2] ?? 2019);

function ols(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  const sd = Math.sqrt(ys.reduce((s, y, i) => s + (y - (a + b * xs[i]!)) ** 2, 0) / n);
  return { a, b, sd, n };
}

/** A player's rolling serve record (service games, aces, dfs) and what he conceded on return. */
interface Serve { sg: number; aces: number; dfs: number; rg: number; acesAgainst: number; dfsAgainst: number }

async function main() {
  const rows = await prisma.tennisArchiveMatch.findMany({ orderBy: [{ tourneyDate: "asc" }, { matchNum: "asc" }] });
  const elo = new TennisElo();
  const serve = new Map<string, Serve>();
  const tour = { atp: { sg: 0, aces: 0, dfs: 0 }, wta: { sg: 0, aces: 0, dfs: 0 } } as Record<string, { sg: number; aces: number; dfs: number }>;
  const total: Record<number, { x: number[]; y: number[] }> = { 3: { x: [], y: [] }, 5: { x: [], y: [] } };
  const share = { x: [] as number[], y: [] as number[] };
  const aceRows: { mean: number; actual: number; tour: string }[] = [];
  const dfRows: { mean: number; actual: number; tour: string }[] = [];

  const PRIOR_SG = 60;
  const DAMP = 0.5;
  for (const r of rows) {
    const surface = canonicalSurface(r.surface);
    const known = elo.matchesPlayed(r.winnerSackId) >= 10 && elo.matchesPlayed(r.loserSackId) >= 10;
    const p = elo.winProb(r.winnerSackId, r.loserSackId, surface);
    const sc = parseScore(r.score);
    const year = r.tourneyDate.getUTCFullYear();
    if (known && year >= FROM && !sc.walkover && !sc.retired && sc.sets.length) {
      const bo = r.bestOf ?? (sc.sets.length > 3 ? 5 : 3);
      const w = sc.sets.reduce((a, [x]) => a + x, 0);
      const l = sc.sets.reduce((a, [, y]) => a + y, 0);
      if (total[bo]) {
        total[bo]!.x.push((p - 0.5) ** 2);
        total[bo]!.y.push(w + l);
      }
      share.x.push(p - 0.5, 0.5 - p);
      share.y.push(w / (w + l) - 0.5, l / (w + l) - 0.5);

      // Aces and DFs: each side's own rate × the opponent's concession, over his actual service games.
      const t = tour[r.tour]!;
      if (t.sg > 500) {
        for (const [me, them, aces, dfs, sg] of [
          [r.winnerSackId, r.loserSackId, r.winnerAces, r.winnerDfs, r.winnerSvGms],
          [r.loserSackId, r.winnerSackId, r.loserAces, r.loserDfs, r.loserSvGms],
        ] as const) {
          if (aces === null || dfs === null || !sg) continue;
          const a = serve.get(me);
          const o = serve.get(them);
          const tourAce = t.aces / t.sg;
          const tourDf = t.dfs / t.sg;
          const myAce = ((a?.aces ?? 0) + tourAce * PRIOR_SG) / ((a?.sg ?? 0) + PRIOR_SG);
          const myDf = ((a?.dfs ?? 0) + tourDf * PRIOR_SG) / ((a?.sg ?? 0) + PRIOR_SG);
          const oppAce = ((o?.acesAgainst ?? 0) + tourAce * PRIOR_SG) / ((o?.rg ?? 0) + PRIOR_SG) / tourAce;
          const oppDf = ((o?.dfsAgainst ?? 0) + tourDf * PRIOR_SG) / ((o?.rg ?? 0) + PRIOR_SG) / tourDf;
          aceRows.push({ mean: myAce * (1 + DAMP * (oppAce - 1)) * sg, actual: aces, tour: r.tour });
          dfRows.push({ mean: myDf * (1 + DAMP * (oppDf - 1)) * sg, actual: dfs, tour: r.tour });
        }
      }
    }
    // Then learn from the match.
    if (!sc.walkover) elo.update(r.winnerSackId, r.loserSackId, surface);
    const t = tour[r.tour];
    for (const [me, them, aces, dfs, sg, oppSg] of [
      [r.winnerSackId, r.loserSackId, r.winnerAces, r.winnerDfs, r.winnerSvGms, r.loserSvGms],
      [r.loserSackId, r.winnerSackId, r.loserAces, r.loserDfs, r.loserSvGms, r.winnerSvGms],
    ] as const) {
      if (aces === null || dfs === null || !sg || !t) continue;
      const a = serve.get(me) ?? { sg: 0, aces: 0, dfs: 0, rg: 0, acesAgainst: 0, dfsAgainst: 0 };
      // Decay: a season-ish memory.
      const k = 0.985;
      a.sg = a.sg * k + sg;
      a.aces = a.aces * k + aces;
      a.dfs = a.dfs * k + dfs;
      serve.set(me, a);
      const o = serve.get(them) ?? { sg: 0, aces: 0, dfs: 0, rg: 0, acesAgainst: 0, dfsAgainst: 0 };
      o.rg = o.rg * k + sg;
      o.acesAgainst = o.acesAgainst * k + aces;
      o.dfsAgainst = o.dfsAgainst * k + dfs;
      serve.set(them, o);
      void oppSg;
      t.sg += sg;
      t.aces += aces;
      t.dfs += dfs;
    }
  }

  for (const bo of [3, 5]) {
    const f = ols(total[bo]!.x, total[bo]!.y);
    console.log(`total games bo${bo}: a=${f.a.toFixed(2)} b=${f.b.toFixed(2)} sd=${f.sd.toFixed(2)} n=${f.n}`);
  }
  const s = ols(share.x, share.y);
  console.log(`games share: k=${s.b.toFixed(3)} (intercept ${s.a.toFixed(4)}) sd=${s.sd.toFixed(4)} n=${s.n}`);

  // Count calibration: over at the half-point nearest the mean, Poisson vs NB(r).
  const pmf = (k: number, m: number, r: number) => {
    if (!Number.isFinite(r)) {
      let t = Math.exp(-m);
      for (let i = 1; i <= k; i++) t *= m / i;
      return t;
    }
    const p = r / (r + m);
    let t = Math.pow(p, r);
    for (let i = 1; i <= k; i++) t *= ((i - 1 + r) / i) * (1 - p);
    return t;
  };
  const over = (m: number, pt: number, r: number) => {
    let c = 0;
    for (let k = 0; k <= Math.floor(pt); k++) c += pmf(k, m, r);
    return Math.min(0.999, Math.max(0.001, 1 - c));
  };
  for (const [name, list] of [["aces", aceRows], ["double faults", dfRows]] as const) {
    for (const r of [Infinity, 12, 8, 5, 3]) {
      let ll = 0;
      let hits = 0;
      let sumP = 0;
      for (const row of list) {
        const pt = Math.max(0.5, Math.round(row.mean - 0.5) + 0.5);
        const p = over(row.mean, pt, r);
        const y = row.actual > pt ? 1 : 0;
        ll -= y ? Math.log(p) : Math.log(1 - p);
        hits += y;
        sumP += p;
      }
      const base = hits / list.length;
      const baseLL = -(base * Math.log(base) + (1 - base) * Math.log(1 - base));
      console.log(`${name} r=${r}: n=${list.length} hit ${(base * 100).toFixed(1)}% model ${((sumP / list.length) * 100).toFixed(1)}% LL ${(ll / list.length).toFixed(4)} base ${baseLL.toFixed(4)}`);
    }
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
