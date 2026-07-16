import { fetchNflGames, type NflGame } from "@/lib/nfl/games";
import { NflElo } from "@/lib/nfl/elo";

/**
 * NFL CLV / beat-the-close backtest — the HONEST profitability test, run BEFORE we
 * build the rest of the adapter or surface a single pick. Calibration asks "does the
 * model call winners honestly"; this asks "does betting the model's disagreement with
 * the CLOSING line actually make money." Beating the close is the only proof of edge.
 *
 * Walk-forward over the free nflverse games file (results + closing spread/total/ML in
 * one stream). Elo is built strictly from prior games (lookahead-safe), warmed up over
 * ALL history in the file; bets are only tallied inside the reporting window.
 *
 * Two markets, because NFL is bet on both:
 *   1. Against the spread (ATS) — the dominant NFL market. Bet the side the model's
 *      expected margin disagrees with the closing spread by ≥ threshold, graded at
 *      the standard −110. Big sample (spreads since the 2000s).
 *   2. Moneyline — the direct analog to the tennis CLV test. Only 2019+ (that's when
 *      nflverse has closing MLs). Bet the model's +EV side into the closing ML.
 *
 * Run: `npm run backtest:nfl:clv` (optionally `YEARS=2019-2025`).
 */

const MIN_GAMES = 8; // ~half a season of Elo history before a team is "seen"
const ATS_EDGE = 1.0; // min |model margin − spread| in points to fire an ATS bet
const DECIMAL_110 = 1 + 100 / 110; // standard spread juice

// Moneyline believability band (mirrors tennis).
const MIN_EV = 0.02;
const MAX_EV = 0.2;
const ML_START_SEASON = 2019; // nflverse closing moneylines begin here

function amToDec(american: number): number {
  return american > 0 ? american / 100 + 1 : 100 / Math.abs(american) + 1;
}

interface Tally {
  bets: number;
  staked: number;
  pnl: number;
  wins: number;
  pushes: number;
}
const newTally = (): Tally => ({ bets: 0, staked: 0, pnl: 0, wins: 0, pushes: 0 });

/** Settle a unit stake. outcome: 1 win, 0 loss, 0.5 push. odds = decimal price. */
function settle(t: Tally, outcome: 0 | 0.5 | 1, odds: number) {
  t.bets++;
  t.staked += 1;
  if (outcome === 1) {
    t.pnl += odds - 1;
    t.wins++;
  } else if (outcome === 0.5) {
    t.pushes++; // stake returned, no P/L
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
  const decided = t.bets - t.pushes;
  const winPct = decided > 0 ? (t.wins / decided) * 100 : 0;
  console.log(
    `${name.padEnd(12)} bets ${String(t.bets).padStart(5)}  ` +
      `win ${winPct.toFixed(1)}%  ` +
      `push ${String(t.pushes).padStart(4)}  ` +
      `P/L ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(1)}u  ` +
      `ROI ${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%`
  );
}

function parseWindow(): [number, number] {
  const spec = process.env.YEARS ?? "2007-2025";
  const [a, b] = spec.split("-").map((s) => parseInt(s, 10));
  return [a, b ?? a];
}

async function main() {
  const [minY, maxY] = parseWindow();
  console.log("Loading nflverse games.csv (free: results + closing lines)…");
  const all = await fetchNflGames();
  // Completed games only, chronological. Elo warms over ALL of them; we tally inside window.
  const games = all
    .filter((g) => g.result !== null)
    .sort((x, y) => x.date.getTime() - y.date.getTime());
  console.log(
    `${games.length} completed games ${games[0].season}–${games[games.length - 1].season}; ` +
      `reporting window ${minY}–${maxY}.\n`
  );

  const elo = new NflElo();

  // ATS tallies (window + a recent 2019+ slice, since "recent = sharper" was the
  // decisive tennis finding) and a flat "bet the market favorite ATS" baseline.
  const atsWindow = newTally();
  const atsRecent = newTally();
  const atsFlatFav = newTally();
  const atsBuckets = [
    { lo: 1, hi: 2, t: newTally() },
    { lo: 2, hi: 3, t: newTally() },
    { lo: 3, hi: 5, t: newTally() },
    { lo: 5, hi: 99, t: newTally() },
  ];

  // Moneyline tallies (2019+ only): model +EV picks into the close + flat-fav baseline.
  const mlBanded = newTally();
  const mlFlatFav = newTally();

  for (const g of games) {
    elo.touch(g.home, g.season);
    elo.touch(g.away, g.season);

    const seen = elo.gamesPlayed(g.home) >= MIN_GAMES && elo.gamesPlayed(g.away) >= MIN_GAMES;
    const inWindow = g.season >= minY && g.season <= maxY;
    const result = g.result as number;

    if (seen && inWindow) {
      // ---- ATS ----
      if (g.spreadLine !== null) {
        const expMargin = elo.expectedHomeMargin(g.home, g.away);
        const edge = expMargin - g.spreadLine; // >0 model likes home, <0 likes away
        if (Math.abs(edge) >= ATS_EDGE) {
          const betHome = edge > 0;
          // Home covers if actual home margin > spread; push on exact; else away covers.
          const outcome: 0 | 0.5 | 1 =
            result === g.spreadLine ? 0.5 : betHome === result > g.spreadLine ? 1 : 0;
          settle(atsWindow, outcome, DECIMAL_110);
          if (g.season >= 2019) settle(atsRecent, outcome, DECIMAL_110);
          const bk = atsBuckets.find((b) => Math.abs(edge) >= b.lo && Math.abs(edge) < b.hi);
          if (bk) settle(bk.t, outcome, DECIMAL_110);
        }
        // Baseline: always back the market favorite ATS (should hover near 50%/−4.5%).
        if (g.spreadLine !== 0) {
          const favHome = g.spreadLine > 0;
          const favOutcome: 0 | 0.5 | 1 =
            result === g.spreadLine ? 0.5 : favHome === result > g.spreadLine ? 1 : 0;
          settle(atsFlatFav, favOutcome, DECIMAL_110);
        }
      }

      // ---- Moneyline (2019+) ----
      if (g.season >= ML_START_SEASON && g.homeMoneyline !== null && g.awayMoneyline !== null) {
        const pHome = elo.winProbHome(g.home, g.away);
        const decHome = amToDec(g.homeMoneyline);
        const decAway = amToDec(g.awayMoneyline);
        const evHome = pHome * decHome - 1;
        const evAway = (1 - pHome) * decAway - 1;
        const betHome = evHome >= evAway;
        const ev = betHome ? evHome : evAway;
        const odds = betHome ? decHome : decAway;
        const homeWon = result > 0;
        if (ev >= MIN_EV && ev <= MAX_EV) {
          settle(mlBanded, betHome === homeWon ? 1 : 0, odds);
        }
        // Baseline: back the moneyline favorite (shorter price).
        const favHome = decHome <= decAway;
        settle(mlFlatFav, favHome === homeWon ? 1 : 0, favHome ? decHome : decAway);
      }
    }

    elo.update(g.home, g.away, result);
  }

  console.log(`=== ATS: model vs close, |edge| ≥ ${ATS_EDGE}pt, graded at −110 (${minY}–${maxY}) ===`);
  report("model ATS", atsWindow);
  report("↳ 2019+ only", atsRecent);
  report("flat-fav", atsFlatFav);
  console.log("\n=== ATS ROI by model-vs-market edge bucket (monotone up = real signal) ===");
  for (const b of atsBuckets) report(`${b.lo}-${b.hi === 99 ? "∞" : b.hi}pt`, b.t);

  console.log(`\n=== Moneyline: model +EV picks [${MIN_EV * 100}%,${MAX_EV * 100}%] into the close (2019+) ===`);
  report("model ML", mlBanded);
  report("flat-fav", mlFlatFav);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
