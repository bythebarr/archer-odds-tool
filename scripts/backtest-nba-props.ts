import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import { probOver, projectProp } from "@/lib/nba/projection";
import type { DefenseTable } from "@/lib/nba/matchup";
import { scoreCalibration, formatCalibrationReport, type CalibrationSample } from "@/lib/engine/calibration";
import { saveReport } from "@/lib/engine/saveReport";
import { loadNbaReplay } from "./props/nbaReplay";

/**
 * Backtest for the NBA prop projection (projection.ts). Every logged game with
 * at least 10 earlier games for that player is projected from those earlier
 * games only — no lookahead — against a stand-in line: the player's L10
 * average rounded to the nearest .5, which is roughly where books hang a main
 * line. Reports, per stat:
 *   - projection error (MAE) next to the L10 average's, the naive baseline
 *   - calibration of the model's favored side at the stand-in line (Brier vs
 *     base rate, reliability buckets, and the logit shrink that would fit)
 *
 * The projection graded is the LIVE one — the same circumstantial stack the
 * finder runs, rebuilt as of each date:
 *   - the defense table from games before that date (defenseTableFromSums,
 *     the slate's own builder), so matchup and pace are real, not neutral
 *   - availability reconstructed from the logs themselves: a rotation player
 *     (≥18 minutes over his team's previous 10 games — the slate's
 *     ROTATION_MINUTES rule, and the reconstruction the minutes backtest
 *     already uses) with no game that night was out, feeding both the
 *     with/without splits and, through nbaPlayerImpact, the opponent-absence
 *     lift on the other side
 *   - position rates as of the date (the thin-sample prior), his team's
 *     recent dates (rest and returns), and the game environment from the
 *     game's closing spread and total against the team's scoring before it
 * Beside it, the report keeps the REDUCED projection this backtest used to
 * grade (matchup and pace neutral, no availability) and the no-lines
 * projection, so what the stack adds stays visible. Graded against real book
 * prices: `npm run backtest:props-market`.
 *
 * Run: `npm run backtest:nba-props` (optionally `N=40000`).
 */
const STATS = ["points", "rebounds", "assists", "threes", "pointsReboundsAssists"] as const;
const NEUTRAL: DefenseTable = { season: 0, fromLastSeason: false, teams: {} };

async function main() {
  const limit = Number(process.env.N ?? 30000);
  // The walk-forward context (scripts/props/nbaReplay.ts): defense, availability, position rates, rest and lines as of each date.
  const replay = await loadNbaReplay();
  const byPlayer = replay.byPlayer;
  console.log(`${replay.rows} player-games from ${byPlayer.size} players.`);

  for (const key of STATS) {
    const stat = NBA_PROP_STAT_BY_KEY.get(key)!;
    const samples: (CalibrationSample & { date: string })[] = [];
    let modelErr = 0;
    let reducedErr = 0;
    let noLinesErr = 0;
    let naiveErr = 0;
    let withLines = 0;
    let withAbsences = 0;
    let withOpponentAbsences = 0;
    let n = 0;
    for (const games of byPlayer.values()) {
      for (let i = 10; i < games.length; i++) {
        const history = games.slice(0, i).reverse(); // most recent first, before game i
        const l10 = history.slice(0, 10).reduce((a, g) => a + stat.value(g), 0) / 10;
        if (l10 < 1) continue; // a line nobody hangs
        const line = Math.round(l10 - 0.5) + 0.5;
        const game = games[i];
        const ctx = replay.contextFor(game);
        const lines = ctx.lines!;
        const absences = ctx.absences!;
        const opponentAbsences = ctx.opponentAbsences!;
        const proj = projectProp(history, stat, ctx);
        const reduced = projectProp(history, stat, {
          defense: NEUTRAL,
          opponent: null,
          positionGroup: null,
          lines,
          isHome: game.isHome,
          baselineTotal: ctx.baselineTotal,
          season: game.season,
        });
        const plain = projectProp(history, stat, { defense: NEUTRAL, opponent: null, positionGroup: null });
        if (!proj || !reduced || !plain) continue;
        const actual = stat.value(game);
        if (lines.total !== null) withLines++;
        if (absences.length > 0) withAbsences++;
        if (opponentAbsences.length > 0) withOpponentAbsences++;
        modelErr += Math.abs(proj.mean - actual);
        reducedErr += Math.abs(reduced.mean - actual);
        noLinesErr += Math.abs(plain.mean - actual);
        naiveErr += Math.abs(l10 - actual);
        n++;
        const pOver = probOver(proj, line);
        const overFav = pOver >= 0.5;
        samples.push({ pred: overFav ? pOver : 1 - pOver, won: (actual > line) === overFav ? 1 : 0, date: games[i].date });
      }
    }
    samples.sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first, for the time-split refit
    const report = scoreCalibration(samples.slice(0, limit));
    console.log(
      `\n${stat.label}: LIVE projection MAE ${(modelErr / n).toFixed(3)} vs reduced ${(reducedErr / n).toFixed(3)}, without game lines ${(noLinesErr / n).toFixed(3)}, L10-average MAE ${(naiveErr / n).toFixed(3)} over ${n} games (${withLines} with closing lines, ${withAbsences} with a teammate out, ${withOpponentAbsences} with an opponent out)`
    );
    console.log(formatCalibrationReport(`NBA ${stat.shortLabel} projection`, "player-game", report));
    await saveReport(`nba-props:${key}`, `NBA props — ${stat.label}`, "player-game", report, {
      projectionMae: modelErr / n,
      reducedMae: reducedErr / n,
      baselineMae: naiveErr / n,
      baseline: "L10 average",
      noLinesMae: noLinesErr / n,
      gamesWithLines: withLines,
      gamesWithAbsences: withAbsences,
      gamesWithOpponentAbsences: withOpponentAbsences,
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
