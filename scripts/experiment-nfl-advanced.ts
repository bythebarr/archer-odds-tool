/**
 * Do the nflverse signals (air yards, snap share, red-zone and end-zone looks)
 * predict next week better than the box score alone? Least squares on
 * recency-weighted features from each player's earlier games, trained on the
 * older 60% of player-games by date and scored on the newest 40%.
 *
 *   npx tsx scripts/experiment-nfl-advanced.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

const decay = (xs: (number | null)[], hl = 4) => {
  let s = 0;
  let w = 0;
  xs.forEach((x, i) => {
    if (x === null) return;
    const k = Math.pow(0.5, i / hl);
    s += k * x;
    w += k;
  });
  return w ? s / w : 0;
};

/** Ridge least squares (tiny λ) via normal equations. */
function fit(X: number[][], y: number[], lambda = 1e-3): number[] {
  const d = X[0]!.length;
  const A = Array.from({ length: d }, () => new Array(d).fill(0));
  const b = new Array(d).fill(0);
  for (let i = 0; i < X.length; i++) {
    const x = X[i]!;
    for (let j = 0; j < d; j++) {
      b[j] += x[j]! * y[i]!;
      for (let k = 0; k < d; k++) A[j][k] += x[j]! * x[k]!;
    }
  }
  for (let j = 1; j < d; j++) A[j][j] += lambda * X.length;
  // Gauss-Jordan.
  for (let c = 0; c < d; c++) {
    let p = c;
    for (let r = c + 1; r < d; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < d; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < d; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}

async function main() {
  const rows = await prisma.nflPlayerGameLog.findMany({ orderBy: [{ nflPlayerId: "asc" }, { gameDate: "asc" }] });
  const vol = await prisma.nflPlayerGameLog.groupBy({ by: ["gameId", "teamId"], _sum: { targets: true, rushAttempts: true } });
  const volOf = new Map(vol.map((v) => [`${v.gameId}|${v.teamId}`, v._sum]));
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.nflPlayerId, [...(by.get(r.nflPlayerId) ?? []), r]);

  type S = { date: number; y: Record<string, number>; box: Record<string, number[]>; adv: Record<string, number[]> };
  const samples: S[] = [];
  for (const games of by.values()) {
    for (let i = 4; i < games.length; i++) {
      const g = games[i]!;
      const h = games.slice(Math.max(0, i - 10), i).reverse();
      // Only games the advanced line covers, so both models see the same rows.
      if (h.some((x) => x.rzTargets === null)) continue;
      const tg = (x: (typeof h)[number]) => volOf.get(`${x.gameId}|${x.teamId}`)?.targets ?? 0;
      const rs = (x: (typeof h)[number]) => volOf.get(`${x.gameId}|${x.teamId}`)?.rushAttempts ?? 0;
      const recYds = decay(h.map((x) => x.recYards));
      const tgts = decay(h.map((x) => x.targets));
      const share = decay(h.map((x) => (tg(x) ? x.targets / tg(x) : 0)));
      const ay = decay(h.map((x) => x.airYards ?? 0));
      const snap = decay(h.map((x) => x.snapPct));
      const lastSnap = h[0]!.snapPct ?? snap;
      const rz = decay(h.map((x) => x.rzTargets ?? 0));
      const ez = decay(h.map((x) => x.ezTargets ?? 0));
      const recTd = decay(h.map((x) => x.recTds));
      const rushYds = decay(h.map((x) => x.rushYards));
      const car = decay(h.map((x) => x.rushAttempts));
      const cshare = decay(h.map((x) => (rs(x) ? x.rushAttempts / rs(x) : 0)));
      const rzc = decay(h.map((x) => x.rzCarries ?? 0));
      const glc = decay(h.map((x) => x.glCarries ?? 0));
      const rushTd = decay(h.map((x) => x.rushTds));
      const td = (x: (typeof g)) => x.recTds + x.rushTds;
      samples.push({
        date: g.gameDate.getTime(),
        y: { recYards: g.recYards, targets: g.targets, rushYards: g.rushYards, td: td(g) > 0 ? 1 : 0 },
        box: {
          recYards: [1, recYds, tgts],
          targets: [1, tgts, share],
          rushYards: [1, rushYds, car, cshare],
          td: [1, recTd, rushTd],
        },
        adv: {
          recYards: [1, recYds, tgts, ay, snap, lastSnap - snap],
          targets: [1, tgts, share, ay, snap, lastSnap - snap],
          rushYards: [1, rushYds, car, cshare, snap, lastSnap - snap],
          td: [1, recTd, rushTd, rz, ez, rzc, glc],
        },
      });
    }
  }
  samples.sort((a, b) => a.date - b.date);
  const cut = Math.floor(samples.length * 0.6);
  const train = samples.slice(0, cut);
  const test = samples.slice(cut);
  console.log(`${samples.length} player-games (train ${train.length}, test ${test.length})`);
  for (const key of ["recYards", "targets", "rushYards", "td"]) {
    const relevant = (s: S) => (key === "rushYards" ? s.box.rushYards[2]! >= 3 : key === "td" ? true : s.box.targets[1]! >= 2);
    const tr = train.filter(relevant);
    const te = test.filter(relevant);
    const score = (kind: "box" | "adv") => {
      const w = fit(tr.map((s) => s[kind][key]!), tr.map((s) => s.y[key]!));
      const pred = (s: S) => s[kind][key]!.reduce((a, x, j) => a + x * w[j]!, 0);
      if (key === "td") {
        // Log loss of P(any TD), clamped.
        const ll = te.reduce((a, s) => {
          const p = Math.min(0.95, Math.max(0.02, pred(s)));
          return a - (s.y.td ? Math.log(p) : Math.log(1 - p));
        }, 0);
        return { m: ll / te.length, w };
      }
      return { m: te.reduce((a, s) => a + Math.abs(pred(s) - s.y[key]!), 0) / te.length, w };
    };
    const b = score("box");
    const a = score("adv");
    console.log(`${key.padEnd(9)} n=${te.length}  box-score ${b.m.toFixed(4)}  + advanced ${a.m.toFixed(4)}  (${(((a.m - b.m) / b.m) * 100).toFixed(1)}%)  w=${a.w.map((x) => x.toFixed(3)).join(",")}`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
