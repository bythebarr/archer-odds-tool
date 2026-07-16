import { TennisElo, canonicalSurface } from "@/lib/tennis/elo";
import { fetchTennisData, type TennisDataMatch } from "@/lib/tennis/tennisDataOdds";

/**
 * CLV / beat-the-close backtest — the HONEST profitability test the calibration
 * gate can't give. Calibration says "the model predicts winners honestly"; this
 * says "does betting the model's +EV picks INTO the closing line actually make
 * money." Beating a sharp closing line is the real proof of edge.
 *
 * Walk-forward over tennis-data.co.uk history (free: results + surface + closing
 * odds in one stream): build Elo exactly as production does (same params), and at
 * each match — using ONLY ratings from prior matches — bet the higher-EV side when
 * it lands in the production believability band, then realize P/L at the actual
 * closing price. Reported at three price references:
 *   - Pinnacle : the sharpest line — beating it is the hardest, truest test.
 *   - Best     : max across books — what our line-shopping would actually get.
 *   - Average  : typical book — conservative middle.
 *
 * Run: `npm run backtest:tennis:clv` (optionally `YEARS=2012-2024`).
 */
const MIN_MATCHES = 10;
const MIN_EV = 0.02;
const MAX_EV = 0.2;

type Ref = "pinnacle" | "best" | "avg";
const REFS: Ref[] = ["pinnacle", "best", "avg"];

function priceOf(m: TennisDataMatch, ref: Ref, side: "w" | "l"): number | null {
  if (ref === "pinnacle") return side === "w" ? m.pinnacleWinner : m.pinnacleLoser;
  if (ref === "best") return side === "w" ? m.maxWinner : m.maxLoser;
  return side === "w" ? m.avgWinner : m.avgLoser;
}

interface Tally {
  bets: number;
  staked: number;
  pnl: number;
  wins: number;
  sumOdds: number;
}
const newTally = (): Tally => ({ bets: 0, staked: 0, pnl: 0, wins: 0, sumOdds: 0 });

function place(t: Tally, betWinner: boolean, odds: number) {
  t.bets++;
  t.staked += 1;
  t.sumOdds += odds;
  if (betWinner) {
    t.pnl += odds - 1;
    t.wins++;
  } else {
    t.pnl -= 1;
  }
}

function report(name: string, t: Tally) {
  if (!t.bets) {
    console.log(`${name.padEnd(10)} — no qualifying bets`);
    return;
  }
  const roi = (t.pnl / t.staked) * 100;
  console.log(
    `${name.padEnd(10)} bets ${String(t.bets).padStart(6)}  ` +
      `win ${((t.wins / t.bets) * 100).toFixed(1)}%  ` +
      `avg odds ${(t.sumOdds / t.bets).toFixed(2)}  ` +
      `P/L ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(1)}u  ` +
      `ROI ${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%`
  );
}

function parseYears(): number[] {
  const spec = process.env.YEARS ?? "2010-2024";
  const [a, b] = spec.split("-").map((s) => parseInt(s, 10));
  const years: number[] = [];
  for (let y = a; y <= (b ?? a); y++) years.push(y);
  return years;
}

async function main() {
  const years = parseYears();
  console.log(`Loading tennis-data closing odds ${years[0]}–${years[years.length - 1]} (ATP+WTA)…`);
  const matches = await fetchTennisData(years);
  matches.sort((x, y) => x.date.getTime() - y.date.getTime());
  console.log(`${matches.length} clean matches with results + closing odds.\n`);

  const elo = new TennisElo(); // production params (DEFAULT_ELO)
  const banded: Record<Ref, Tally> = { pinnacle: newTally(), best: newTally(), avg: newTally() };
  const unbanded = newTally(); // all model +EV picks at best line (no MAX cap)
  const flatFav = newTally(); // baseline: bet the shorter-priced (favorite) side, best line
  // EV-bucket monotonicity check on the best-line banded bets.
  const buckets: { lo: number; hi: number; t: Tally }[] = [
    { lo: 0.02, hi: 0.05, t: newTally() },
    { lo: 0.05, hi: 0.1, t: newTally() },
    { lo: 0.1, hi: 0.15, t: newTally() },
    { lo: 0.15, hi: 0.2, t: newTally() },
  ];

  for (const m of matches) {
    const surf = canonicalSurface(m.surface);
    const seen = elo.matchesPlayed(m.winner) >= MIN_MATCHES && elo.matchesPlayed(m.loser) >= MIN_MATCHES;
    if (seen) {
      const pW = elo.winProb(m.winner, m.loser, surf);
      const pL = 1 - pW;

      for (const ref of REFS) {
        const oW = priceOf(m, ref, "w");
        const oL = priceOf(m, ref, "l");
        if (!oW || !oL) continue;
        const evW = pW * oW - 1;
        const evL = pL * oL - 1;
        const betWinner = evW >= evL;
        const ev = betWinner ? evW : evL;
        const odds = betWinner ? oW : oL;
        if (ev >= MIN_EV && ev <= MAX_EV) place(banded[ref], betWinner, odds);

        if (ref === "best") {
          if (ev >= MIN_EV) place(unbanded, betWinner, odds); // no MAX cap
          if (ev >= MIN_EV && ev <= MAX_EV) {
            const bk = buckets.find((b) => ev >= b.lo && ev < b.hi);
            if (bk) place(bk.t, betWinner, odds);
          }
          // Baseline: always back the market favorite (shorter price), best line.
          const favWinner = oW <= oL;
          place(flatFav, favWinner, favWinner ? oW : oL);
        }
      }
    }
    elo.update(m.winner, m.loser, surf);
  }

  console.log("=== model +EV picks, believability band [2%,20%] — realized ROI betting INTO the close ===");
  for (const ref of REFS) report(ref, banded[ref]);
  console.log("\n=== references ===");
  report("unbanded", unbanded);
  report("flat-fav", flatFav);
  console.log("\n=== best-line banded ROI by model-EV bucket (monotone up = real signal) ===");
  for (const b of buckets) report(`${(b.lo * 100).toFixed(0)}-${(b.hi * 100).toFixed(0)}%`, b.t);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
