import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { projectPropHit } from "@/lib/props/projection";

/**
 * Does the platoon matchup (batter hand vs the opposing starter's hand) explain
 * batter-prop residuals the overall-rate projection misses?
 *
 * A batter's season rate averages over every platoon state he faced. But today
 * he faces one starter of one hand — and the platoon split is one of the oldest
 * real effects in baseball (batters do better against opposite-handed pitching;
 * a switch-hitter always takes the good side). If our projection reads low when
 * the batter has the platoon EDGE and high when he's stuck same-handed, a simple
 * advantage/disadvantage shift is free signal — and the board already surfaces
 * the vsLHP/vsRHP split, so wiring it later is natural.
 *
 * Lookahead-safe: the projection uses only the batter's prior games this season.
 * Run: `npm run matchup:platoon`.
 *
 * VERDICT (do NOT wire): the residual spread is real but CONFOUNDED. Platoon-edge
 * games carry ~+0.44 more plate appearances (managers pinch-hit for the
 * disadvantaged batter, leave the advantaged one in), so EVERY counting stat
 * rises together — including strikeouts, which clean platoon skill would LOWER.
 * The naive advantage/disadvantage shift improves Brier only because it proxies
 * playing time, not hitting quality, and a book already prices the lineup + the
 * matchup — so it's a bias that looks like edge without beating the close (same
 * lesson as the pitcher workload ramp). A trustworthy platoon model would use
 * per-PA rates times an explicit plate-appearance model; that's the real work.
 */

interface Prop {
  label: string;
  col: "hits" | "totalBases" | "homeRuns" | "strikeoutsBatting";
  line: number;
}
const PROPS: Prop[] = [
  { label: "Hits o0.5", col: "hits", line: 0.5 },
  { label: "Total Bases o1.5", col: "totalBases", line: 1.5 },
  { label: "Home Runs o0.5", col: "homeRuns", line: 0.5 },
  { label: "Batter Ks o0.5", col: "strikeoutsBatting", line: 0.5 },
];

/** Platoon advantage: opposite hand, or a switch-hitter (always bats opposite). */
function hasPlatoonEdge(batSide: string | null, starterHand: string | null): boolean | null {
  if (!starterHand || starterHand === "S") return null; // pitcher hand unknown/invalid
  if (batSide === "S") return true;
  if (batSide === "L" || batSide === "R") return batSide !== starterHand;
  return null;
}

async function main() {
  console.log("Loading batting logs with batter hand + opposing starter hand…");
  const batting = await prisma.playerGameLog.findMany({
    where: { plateAppearances: { not: null } },
    select: {
      mlbPlayerId: true,
      gameDate: true,
      hits: true,
      totalBases: true,
      homeRuns: true,
      strikeoutsBatting: true,
      opposingStarterHand: true,
      mlbPlayer: { select: { batSide: true } },
    },
    orderBy: [{ mlbPlayerId: "asc" }, { gameDate: "asc" }],
  });
  console.log(`${batting.length} batting games.\n`);

  // Confound check: if platoon-EDGE games simply have MORE plate appearances,
  // every counting stat (hits AND strikeouts) rises together — an opportunity
  // effect, not platoon skill. Clean platoon skill would LOWER Ks on the edge.
  {
    let edgePA = 0;
    let edgeN = 0;
    let disPA = 0;
    let disN = 0;
    const paBatting = await prisma.playerGameLog.findMany({
      where: { plateAppearances: { not: null } },
      select: { plateAppearances: true, opposingStarterHand: true, mlbPlayer: { select: { batSide: true } } },
    });
    for (const b of paBatting) {
      const edge = hasPlatoonEdge(b.mlbPlayer?.batSide ?? null, b.opposingStarterHand ?? null);
      if (edge === null) continue;
      if (edge) {
        edgePA += b.plateAppearances!;
        edgeN += 1;
      } else {
        disPA += b.plateAppearances!;
        disN += 1;
      }
    }
    console.log(
      `Confound check — mean PA/game:  platoon-edge ${(edgePA / edgeN).toFixed(3)}  vs  disadvantage ${(disPA / disN).toFixed(3)}  ` +
        `(Δ ${(edgePA / edgeN - disPA / disN).toFixed(3)} PA)\n`
    );
  }

  console.log("prop".padEnd(20) + "edge resid".padStart(12) + "disadv resid".padStart(14) + "spread".padStart(9) + "OOS Brier →".padStart(22));
  for (const P of PROPS) {
    const base = batting.reduce((a, r) => a + (r[P.col]! > P.line ? 1 : 0), 0) / batting.length;
    interface Row { hit: number; proj: number; edge: boolean; date: Date }
    const rows: Row[] = [];
    let curPlayer = "";
    let curYear = -1;
    let seasonHits = 0;
    let seasonSample = 0;
    const recent: number[] = [];
    for (const b of batting) {
      const year = b.gameDate.getUTCFullYear();
      if (b.mlbPlayerId !== curPlayer || year !== curYear) {
        curPlayer = b.mlbPlayerId;
        curYear = year;
        seasonHits = 0;
        seasonSample = 0;
        recent.length = 0;
      }
      const hit = b[P.col]! > P.line ? 1 : 0;
      const edge = hasPlatoonEdge(b.mlbPlayer?.batSide ?? null, b.opposingStarterHand ?? null);
      if (seasonSample > 0 && edge !== null) {
        const recentRate = recent.length ? recent.reduce((a, x) => a + x, 0) / recent.length : null;
        const proj = projectPropHit({ seasonHits, seasonSample, recentRate, baseRate: base });
        if (proj) rows.push({ hit, proj: proj.probability, edge, date: b.gameDate });
      }
      seasonHits += hit;
      seasonSample += 1;
      recent.push(hit);
      if (recent.length > 10) recent.shift();
    }

    const edgeRows = rows.filter((r) => r.edge);
    const disRows = rows.filter((r) => !r.edge);
    const resid = (rs: Row[]) => (rs.reduce((a, r) => a + (r.hit - r.proj), 0) / rs.length) * 100;
    const eR = resid(edgeRows);
    const dR = resid(disRows);

    // OOS: fit an advantage/disadvantage shift on the older 70%, judge Brier on newer 30%.
    const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
    const cut = Math.floor(sorted.length * 0.7);
    const train = sorted.slice(0, cut);
    const val = sorted.slice(cut);
    const shiftEdge = resid(train.filter((r) => r.edge)) / 100;
    const shiftDis = resid(train.filter((r) => !r.edge)) / 100;
    const clamp = (p: number) => Math.min(Math.max(p, 0.02), 0.98);
    const brier = (fn: (r: Row) => number) => val.reduce((a, r) => a + (fn(r) - r.hit) ** 2, 0) / val.length;
    const bd = brier((r) => r.proj);
    const ba = brier((r) => clamp(r.proj + (r.edge ? shiftEdge : shiftDis)));

    console.log(
      P.label.padEnd(20) +
        `${eR >= 0 ? "+" : ""}${eR.toFixed(1)}`.padStart(12) +
        `${dR >= 0 ? "+" : ""}${dR.toFixed(1)}`.padStart(14) +
        `${(eR - dR).toFixed(1)}`.padStart(9) +
        `${bd.toFixed(4)} → ${ba.toFixed(4)} ${ba < bd - 0.00005 ? "✓" : "·"}`.padStart(22)
    );
  }
  console.log("\nspread = edge − disadvantage residual (pts). NOTE the confound above: the spread tracks");
  console.log("the +PA gap, and Ks rise WITH hits (skill would lower them) — so this is opportunity,");
  console.log("not platoon quality. Not wired. See the header for what a trustworthy version needs.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
