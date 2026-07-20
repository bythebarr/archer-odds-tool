import { loadSoccerHistory } from "@/lib/soccer/model";
import { SoccerPoisson } from "@/lib/soccer/poisson";
import type { SoccerMatch } from "@/lib/soccer/footballData";

/**
 * Soccer CLV / beat-the-close backtest — the HONEST profitability test for the
 * Poisson goals model, 3-way (home/draw/away). Calibration says the probabilities
 * are honest; this says whether betting the model's +EV disagreement INTO the closing
 * 1X2 line actually makes money. Beating a sharp closing line is the only proof of edge.
 *
 * Walk-forward over free football-data.co.uk history (goals + closing odds in one
 * stream): build the model exactly as production does, and at each match — using ONLY
 * prior results — bet the highest-EV of the three outcomes when it lands in the
 * believability band, realizing P/L at the actual closing price. Three references:
 *   - Pinnacle : the sharpest line — the hardest, truest test.
 *   - Best     : market max — what line-shopping would get.
 *   - Average  : typical book — conservative middle.
 *
 * Run: `npm run backtest:soccer:clv`.
 */
const MIN_GAMES = 6;
const MIN_EV = 0.02;
const MAX_EV = 0.2;

type Ref = "pinnacle" | "best" | "avg";
const REFS: Ref[] = ["pinnacle", "best", "avg"];
type Out = "H" | "D" | "A";
const OUTCOMES: Out[] = ["H", "D", "A"];

function priceOf(m: SoccerMatch, ref: Ref, o: Out): number | null {
  if (ref === "pinnacle") return o === "H" ? m.psH : o === "D" ? m.psD : m.psA;
  if (ref === "best") return o === "H" ? m.maxH : o === "D" ? m.maxD : m.maxA;
  return o === "H" ? m.avgH : o === "D" ? m.avgD : m.avgA;
}

interface Tally {
  bets: number;
  staked: number;
  pnl: number;
  wins: number;
  sumOdds: number;
}
const newTally = (): Tally => ({ bets: 0, staked: 0, pnl: 0, wins: 0, sumOdds: 0 });

function place(t: Tally, won: boolean, odds: number) {
  t.bets++;
  t.staked += 1;
  t.sumOdds += odds;
  if (won) {
    t.pnl += odds - 1;
    t.wins++;
  } else {
    t.pnl -= 1;
  }
}

function report(name: string, t: Tally) {
  if (!t.bets) {
    console.log(`${name.padEnd(12)} — no qualifying bets`);
    return;
  }
  const roi = (t.pnl / t.staked) * 100;
  console.log(
    `${name.padEnd(12)} bets ${String(t.bets).padStart(6)}  ` +
      `win ${((t.wins / t.bets) * 100).toFixed(1)}%  ` +
      `avg odds ${(t.sumOdds / t.bets).toFixed(2)}  ` +
      `P/L ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(1)}u  ` +
      `ROI ${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%`
  );
}

async function main() {
  console.log("Loading football-data closing odds (big-five + Championship)…");
  const matches = await loadSoccerHistory();
  console.log(`${matches.length} matches with goals; pricing where closing odds exist.\n`);

  const model = new SoccerPoisson();
  const banded: Record<Ref, Tally> = { pinnacle: newTally(), best: newTally(), avg: newTally() };
  const flatFav = newTally(); // baseline: back the market favorite (shortest price), best line
  const byOutcome: Record<Out, Tally> = { H: newTally(), D: newTally(), A: newTally() }; // best-line, per bet outcome
  const buckets = [
    { lo: 0.02, hi: 0.05, t: newTally() },
    { lo: 0.05, hi: 0.1, t: newTally() },
    { lo: 0.1, hi: 0.15, t: newTally() },
    { lo: 0.15, hi: 0.2, t: newTally() },
  ];

  for (const m of matches) {
    model.touch(m.home, m.season);
    model.touch(m.away, m.season);
    const seen =
      model.gamesPlayed(m.home) >= MIN_GAMES && model.gamesPlayed(m.away) >= MIN_GAMES;
    if (seen) {
      const probs = model.outcomeProbs(m.home, m.away);
      const pOf = (o: Out) => (o === "H" ? probs.home : o === "D" ? probs.draw : probs.away);

      for (const ref of REFS) {
        // Best +EV outcome at this reference.
        let bestOut: Out | null = null;
        let bestEv = -Infinity;
        let bestOdds = 0;
        for (const o of OUTCOMES) {
          const price = priceOf(m, ref, o);
          if (!price) continue;
          const ev = pOf(o) * price - 1;
          if (ev > bestEv) {
            bestEv = ev;
            bestOut = o;
            bestOdds = price;
          }
        }
        if (!bestOut) continue;
        const won = bestOut === m.result;
        if (bestEv >= MIN_EV && bestEv <= MAX_EV) {
          place(banded[ref], won, bestOdds);
          if (ref === "best") {
            place(byOutcome[bestOut], won, bestOdds);
            const bk = buckets.find((b) => bestEv >= b.lo && bestEv < b.hi);
            if (bk) place(bk.t, won, bestOdds);
          }
        }
        if (ref === "best") {
          // Baseline: back the market favorite (shortest of the three prices).
          let favOut: Out | null = null;
          let favOdds = Infinity;
          for (const o of OUTCOMES) {
            const price = priceOf(m, ref, o);
            if (price && price < favOdds) {
              favOdds = price;
              favOut = o;
            }
          }
          if (favOut) place(flatFav, favOut === m.result, favOdds);
        }
      }
    }
    model.update(m.home, m.away, m.homeGoals, m.awayGoals);
  }

  console.log("=== model +EV picks, band [2%,20%] — realized ROI betting INTO the close ===");
  for (const ref of REFS) report(ref, banded[ref]);
  console.log("\n=== references (best line) ===");
  report("flat-fav", flatFav);
  console.log("\n=== best-line banded ROI by bet outcome (home/draw/away) ===");
  for (const o of OUTCOMES) report(o, byOutcome[o]);
  console.log("\n=== best-line banded ROI by model-EV bucket (monotone up = real signal) ===");
  for (const b of buckets) report(`${(b.lo * 100).toFixed(0)}-${(b.hi * 100).toFixed(0)}%`, b.t);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
