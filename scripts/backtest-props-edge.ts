import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { projectPropHit } from "@/lib/props/projection";
import { buildTeamKRateModel, opponentTrailingKRate, pitcherKContextShift } from "@/lib/props/opponentKRate";
import { buildParkKRateModel, parkTrailingKRate, pitcherKParkShift } from "@/lib/props/parkKRate";
import { buildStarterKModel, opposingStarterKRate, batterKvsStarterShift } from "@/lib/props/opposingStarter";

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

type BattingCol =
  | "hits"
  | "totalBases"
  | "homeRuns"
  | "runs"
  | "rbi"
  | "strikeoutsBatting"
  | "baseOnBalls"
  | "stolenBases";
type PitchingCol =
  | "strikeoutsPitching"
  | "outsRecorded"
  | "earnedRuns"
  | "hitsAllowed"
  | "walksAllowed";

/** A game row carrying every stat + the flags that decide which games qualify. */
interface LogRow {
  mlbPlayerId: string;
  gameDate: Date;
  teamId: string;
  isHome: boolean;
  game: { homeTeamId: string | null; awayTeamId: string | null } | null;
  opposingStarterId: string | null;
  plateAppearances: number | null;
  isStarter: boolean | null;
  hits: number | null;
  totalBases: number | null;
  homeRuns: number | null;
  runs: number | null;
  rbi: number | null;
  strikeoutsBatting: number | null;
  baseOnBalls: number | null;
  stolenBases: number | null;
  strikeoutsPitching: number | null;
  outsRecorded: number | null;
  earnedRuns: number | null;
  hitsAllowed: number | null;
  walksAllowed: number | null;
}

interface Prop {
  group: "Batting" | "Pitching";
  label: string;
  column: BattingCol | PitchingCol;
  line: number;
  /**
   * Which games count for this prop's sample & base rate. Batting props need a
   * game where the player batted; pitcher-strikeout/outs style props are only
   * offered on STARTERS, so a reliever's stray game must not pollute the line's
   * base rate (an o5.5 K line looks impossible if you fold in one-out cameos).
   */
  qualifies: (r: LogRow) => boolean;
  /**
   * Season-progress ramp correction, fit per prop by `npm run calibrate:pitchers`
   * (see that script). Pitching counting stats ride a within-season workload ramp
   * a season-pooled base rate can't track; this de-biases them. Batting has none.
   */
  ramp?: { slope: number; pivot: number; cap: number };
}
const batted = (r: LogRow) => r.plateAppearances !== null;
const started = (r: LogRow) => r.isStarter === true;

const PROPS: Prop[] = [
  // ── Batting ──────────────────────────────────────────────────────────────
  { group: "Batting", label: "Hits o0.5", column: "hits", line: 0.5, qualifies: batted },
  { group: "Batting", label: "Hits o1.5", column: "hits", line: 1.5, qualifies: batted },
  { group: "Batting", label: "Total Bases o1.5", column: "totalBases", line: 1.5, qualifies: batted },
  { group: "Batting", label: "Home Runs o0.5", column: "homeRuns", line: 0.5, qualifies: batted },
  { group: "Batting", label: "Runs o0.5", column: "runs", line: 0.5, qualifies: batted },
  { group: "Batting", label: "RBIs o0.5", column: "rbi", line: 0.5, qualifies: batted },
  { group: "Batting", label: "Batter Ks o0.5", column: "strikeoutsBatting", line: 0.5, qualifies: batted },
  { group: "Batting", label: "Walks o0.5", column: "baseOnBalls", line: 0.5, qualifies: batted },
  { group: "Batting", label: "Stolen Bases o0.5", column: "stolenBases", line: 0.5, qualifies: batted },
  // ── Pitching (starters only) ─────────────────────────────────────────────
  { group: "Pitching", label: "Pitcher Ks o4.5", column: "strikeoutsPitching", line: 4.5, qualifies: started, ramp: { slope: 0.01766, pivot: 5.0, cap: 8 } },
  { group: "Pitching", label: "Pitcher Ks o5.5", column: "strikeoutsPitching", line: 5.5, qualifies: started, ramp: { slope: 0.01457, pivot: 5.14, cap: 8 } },
  { group: "Pitching", label: "Pitcher Ks o6.5", column: "strikeoutsPitching", line: 6.5, qualifies: started, ramp: { slope: 0.01407, pivot: 5.31, cap: 8 } },
  { group: "Pitching", label: "Outs Recorded o17.5", column: "outsRecorded", line: 17.5, qualifies: started, ramp: { slope: 0.02063, pivot: 4.7, cap: 8 } },
  { group: "Pitching", label: "Earned Runs o2.5", column: "earnedRuns", line: 2.5, qualifies: started, ramp: { slope: 0.01312, pivot: 4.29, cap: 8 } },
  { group: "Pitching", label: "Hits Allowed o5.5", column: "hitsAllowed", line: 5.5, qualifies: started, ramp: { slope: 0.02256, pivot: 4.57, cap: 8 } },
  { group: "Pitching", label: "Walks Allowed o1.5", column: "walksAllowed", line: 1.5, qualifies: started, ramp: { slope: -0.00537, pivot: 6.63, cap: 8 } },
];

interface Sample {
  prob: number; // projected P(over)
  base: number;
  hit: number; // 1 if the over cleared
}

/** Lookahead-safe: project each game from ONLY the player's prior games this season. */
function buildSamples(
  logs: { mlbPlayerId: string; gameDate: Date; value: number | null; contextShift: number }[],
  line: number,
  baseRate: number,
  ramp?: { slope: number; pivot: number; cap: number }
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
      const proj = projectPropHit(
        { seasonHits, seasonSample, recentRate, baseRate },
        { ramp, contextShift: g.contextShift }
      );
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
  const rows: LogRow[] = await prisma.playerGameLog.findMany({
    // Batting games OR pitching starts — everything a prop below can qualify on.
    where: { OR: [{ plateAppearances: { not: null } }, { isStarter: true }] },
    select: {
      mlbPlayerId: true,
      gameDate: true,
      teamId: true,
      isHome: true,
      game: { select: { homeTeamId: true, awayTeamId: true } },
      opposingStarterId: true,
      plateAppearances: true,
      isStarter: true,
      hits: true,
      totalBases: true,
      homeRuns: true,
      runs: true,
      rbi: true,
      strikeoutsBatting: true,
      baseOnBalls: true,
      stolenBases: true,
      strikeoutsPitching: true,
      outsRecorded: true,
      earnedRuns: true,
      hitsAllowed: true,
      walksAllowed: true,
    },
    orderBy: [{ mlbPlayerId: "asc" }, { gameDate: "asc" }],
  });
  const nBat = rows.filter(batted).length;
  const nStart = rows.filter(started).length;
  console.log(`${rows.length} game logs (${nBat} batting, ${nStart} starts).\n`);

  // Matchup models: opponent lineup K-rate (for pitcher-K props) and opposing
  // starter K-rate (for batter-K props). Both trailing-only → lookahead-safe.
  const teamModel = buildTeamKRateModel(rows.filter(batted));
  const starterModel = buildStarterKModel(rows.filter(started));
  const parkModel = buildParkKRateModel(
    rows.filter(batted).map((r) => ({ park: r.game?.homeTeamId, gameDate: r.gameDate, strikeoutsBatting: r.strikeoutsBatting, plateAppearances: r.plateAppearances }))
  );

  /** Matchup contextShift for a prop this game; 0 for props with no fitted matchup. */
  const contextShiftFor = (p: Prop, r: LogRow): number => {
    if (p.column === "strikeoutsPitching") {
      // Pitcher-K over: shift up vs a whiff-prone opposing lineup AND in a high-K park.
      const oppTeamId = r.isHome ? r.game?.awayTeamId : r.game?.homeTeamId;
      const oppRate = opponentTrailingKRate(teamModel, oppTeamId, r.gameDate);
      const parkRate = parkTrailingKRate(parkModel, r.game?.homeTeamId, r.gameDate);
      return (
        pitcherKContextShift(p.line, oppRate, teamModel.leagueRate) +
        pitcherKParkShift(p.line, parkRate, teamModel.leagueRate)
      );
    }
    if (p.column === "strikeoutsBatting") {
      // Batter-K over: shift up vs a high-K opposing starter.
      const starterRate = opposingStarterKRate(starterModel, r.opposingStarterId, r.gameDate);
      return batterKvsStarterShift(p.line, starterRate, starterModel.leagueRate);
    }
    return 0;
  };

  console.log(`Book-sharpness sweep (hold ${(HOLD * 100).toFixed(0)}%, bet when |edge|≥${BET_THRESHOLD * 100}pt).`);
  console.log(`f = fraction of the projection's deviation-from-base the book's line already captures.`);
  console.log(`f=0 → soft book (line at base rate); f=1 → book as sharp as our model.\n`);

  const header = "prop".padEnd(22) + "calibration".padEnd(52) + SHARPNESS.map((f) => `f=${f}`.padStart(9)).join("");

  let lastGroup = "";
  for (const p of PROPS) {
    if (p.group !== lastGroup) {
      console.log(`\n── ${p.group} ${"─".repeat(76 - p.group.length)}`);
      console.log(header);
      lastGroup = p.group;
    }
    // Null out games that don't qualify for this prop, so both the base rate and
    // the per-player rolling sample are built from only the games it's offered on.
    const logs = rows.map((r) => {
      const value = p.qualifies(r) ? r[p.column] : null;
      return {
        mlbPlayerId: r.mlbPlayerId,
        gameDate: r.gameDate,
        value,
        contextShift: value === null ? 0 : contextShiftFor(p, r),
      };
    });
    const qualified = logs.filter((l) => l.value !== null);
    if (!qualified.length) continue;
    const base = qualified.reduce((a, l) => a + (l.value! > p.line ? 1 : 0), 0) / qualified.length;
    const samples = buildSamples(logs, p.line, base, p.ramp);
    if (!samples.length) continue;
    const roiCells = SHARPNESS.map((f) => {
      const { roi } = roiAtSharpness(samples, f);
      return `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`.padStart(9);
    }).join("");
    console.log(p.label.padEnd(22) + calibration(samples).padEnd(52) + roiCells);
  }

  const holdBaseline = (-HOLD / (1 + HOLD)) * 100;
  console.log(
    `\nRead: props are +EV only where ROI stays positive — i.e. only if real books are softer` +
      `\nthan that f. The true f is unknown without paid prop-odds history; this sweep is what` +
      `\nthat data would pin down. Directional proxy only (real lines move & vary).` +
      `\n\nf=1 note: the book line then EQUALS our (calibrated) model, so a genuinely edgeless` +
      `\nprop pays exactly the hold — ROI ≈ ${holdBaseline.toFixed(1)}%, NOT 0%. Read the f=1 cell against` +
      `\nthat ${holdBaseline.toFixed(1)}% floor: sitting above it means the model still out-discriminates a` +
      `\nmodel-sharp book on its high-conviction bets. Pitcher Ks clear the floor by the most —` +
      `\nand their projection now folds in OPPONENT lineup K-rate (lib/props/opponentKRate.ts)` +
      `\nAND the PARK K-rate (lib/props/parkKRate.ts), both of which lower Brier and lift the` +
      `\nf=1 edge on top of the workload de-bias.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
