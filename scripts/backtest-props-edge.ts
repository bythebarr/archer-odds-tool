import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { projectPropHit } from "@/lib/props/projection";

/**
 * Props edge screen — the honest first look at whether player props (the market
 * the CLV finding says is our likeliest edge) are worth paying to pursue.
 *
 * The catch, stated plainly: a REAL props edge test needs historical prop ODDS
 * (the book's lines), which is paid data we don't have. What we have free is the
 * OUTCOME side — every player's actual game log — and the calibrated Archer Prop
 * Projection. So this does two things:
 *   1. Re-confirms the projection is calibrated on real outcomes (lookahead-safe).
 *   2. Runs a BOOK-SHARPNESS SWEEP: since we don't know how sharp prop lines are,
 *      sweep it. If the book's line captures fraction f of the projection's
 *      deviation from the population base rate, what ROI would betting the
 *      projection's side return (net of a typical prop hold)? The break-even f*
 *      answers the decision question: "props are +EV as long as books are softer
 *      than f* — is that plausible?" — and tells us exactly what paid prop-odds
 *      data would settle.
 *
 * This is a proxy, not proof: real lines move and vary. Directional only.
 * Run: `npm run backtest:props`.
 */

const HOLD = 0.06; // assumed prop over-round (~6%, props run richer than main lines)
const BET_THRESHOLD = 0.03; // only "bet" when the projection deviates ≥3pt from base
const SHARPNESS = [0, 0.25, 0.5, 0.75, 1.0]; // fraction of our deviation the book captures

interface Prop {
  label: string;
  column: "hits" | "totalBases" | "homeRuns" | "runs" | "rbi" | "strikeoutsBatting";
  line: number;
}
const PROPS: Prop[] = [
  { label: "Hits o0.5", column: "hits", line: 0.5 },
  { label: "Hits o1.5", column: "hits", line: 1.5 },
  { label: "Total Bases o1.5", column: "totalBases", line: 1.5 },
  { label: "Home Runs o0.5", column: "homeRuns", line: 0.5 },
  { label: "Runs o0.5", column: "runs", line: 0.5 },
  { label: "RBIs o0.5", column: "rbi", line: 0.5 },
];

interface Sample {
  prob: number; // projected P(over)
  base: number;
  hit: number; // 1 if the over cleared
}

/** Lookahead-safe: project each game from ONLY the player's prior games this season. */
function buildSamples(
  logs: { mlbPlayerId: string; gameDate: Date; value: number | null }[],
  line: number,
  baseRate: number
): Sample[] {
  const samples: Sample[] = [];
  let curPlayer = "";
  let curYear = -1;
  let seasonHits = 0;
  let seasonSample = 0;
  const recent: number[] = []; // rolling last-10 outcomes

  for (const g of logs) {
    if (g.value === null) continue;
    const year = g.gameDate.getUTCFullYear();
    if (g.mlbPlayerId !== curPlayer || year !== curYear) {
      curPlayer = g.mlbPlayerId;
      curYear = year;
      seasonHits = 0;
      seasonSample = 0;
      recent.length = 0;
    }
    const hit = g.value > line ? 1 : 0;

    // Project from PRIOR games only (before folding this game in).
    if (seasonSample > 0) {
      const recentRate = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
      const proj = projectPropHit({ seasonHits, seasonSample, recentRate, baseRate });
      if (proj) samples.push({ prob: proj.probability, base: baseRate, hit });
    }

    seasonHits += hit;
    seasonSample += 1;
    recent.push(hit);
    if (recent.length > 10) recent.shift();
  }
  return samples;
}

/** Realized ROI betting the projection's favored side, if books capture fraction f. */
function roiAtSharpness(samples: Sample[], f: number): { bets: number; roi: number } {
  let staked = 0;
  let pnl = 0;
  for (const s of samples) {
    const dev = s.prob - s.base;
    if (Math.abs(dev) < BET_THRESHOLD) continue; // no actionable deviation
    const betOver = dev > 0;
    const ourProb = betOver ? s.prob : 1 - s.prob;
    const bookProbOver = s.base + f * (s.prob - s.base);
    const bookImplied = betOver ? bookProbOver : 1 - bookProbOver;
    if (bookImplied <= 0 || bookImplied >= 1) continue;
    // Offered decimal odds after the book's hold.
    const decimal = 1 / (bookImplied * (1 + HOLD));
    const won = betOver ? s.hit === 1 : s.hit === 0;
    staked += 1;
    pnl += won ? decimal - 1 : -1;
    void ourProb;
  }
  return { bets: staked ? staked : 0, roi: staked ? (pnl / staked) * 100 : NaN };
}

function calibration(samples: Sample[]): string {
  // Brier vs the projection's own probabilities.
  const n = samples.length;
  const brier = samples.reduce((a, s) => a + (s.prob - s.hit) ** 2, 0) / n;
  const meanProb = (samples.reduce((a, s) => a + s.prob, 0) / n) * 100;
  const actual = (samples.reduce((a, s) => a + s.hit, 0) / n) * 100;
  return `n ${n}  proj ${meanProb.toFixed(1)}%  actual ${actual.toFixed(1)}%  gap ${(actual - meanProb).toFixed(1)}pt  Brier ${brier.toFixed(4)}`;
}

async function main() {
  console.log("Loading MLB game logs…");
  const rows = await prisma.playerGameLog.findMany({
    where: { plateAppearances: { not: null } },
    select: {
      mlbPlayerId: true,
      gameDate: true,
      hits: true,
      totalBases: true,
      homeRuns: true,
      runs: true,
      rbi: true,
      strikeoutsBatting: true,
    },
    orderBy: [{ mlbPlayerId: "asc" }, { gameDate: "asc" }],
  });
  console.log(`${rows.length} batting game logs.\n`);

  console.log(`Book-sharpness sweep (hold ${(HOLD * 100).toFixed(0)}%, bet when |edge|≥${BET_THRESHOLD * 100}pt).`);
  console.log(`f = fraction of the projection's deviation-from-base the book's line already captures.`);
  console.log(`f=0 → soft book (line at base rate); f=1 → book as sharp as our model.\n`);

  const header = "prop".padEnd(18) + "calibration".padEnd(52) + SHARPNESS.map((f) => `f=${f}`.padStart(9)).join("");
  console.log(header);

  for (const p of PROPS) {
    const logs = rows.map((r) => ({ mlbPlayerId: r.mlbPlayerId, gameDate: r.gameDate, value: r[p.column] }));
    const base = logs.filter((l) => l.value !== null).reduce((a, l) => a + (l.value! > p.line ? 1 : 0), 0) /
      logs.filter((l) => l.value !== null).length;
    const samples = buildSamples(logs, p.line, base);
    if (!samples.length) continue;
    const roiCells = SHARPNESS.map((f) => {
      const { roi } = roiAtSharpness(samples, f);
      return `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`.padStart(9);
    }).join("");
    console.log(p.label.padEnd(18) + calibration(samples).padEnd(52) + roiCells);
  }

  console.log(
    `\nRead: props are +EV only where ROI stays positive — i.e. only if real books are softer` +
      `\nthan that f. The true f is unknown without paid prop-odds history; this sweep is what` +
      `\nthat data would pin down. Directional proxy only (real lines move & vary).`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
