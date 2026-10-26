import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import { probOver, projectProp } from "@/lib/nba/projection";
import type { GameLogPoint } from "@/lib/nba/propsMath";
import type { DefenseTable } from "@/lib/nba/matchup";
import { scoreCalibration, formatCalibrationReport, type CalibrationSample } from "@/lib/engine/calibration";
import { saveReport } from "@/lib/engine/saveReport";
import { NO_LINES } from "@/lib/propModel/environment";
import { closingGameLines, teamBaselinesByGame } from "./props/history";

/**
 * Backtest for the NBA prop projection (projection.ts). Every logged game with
 * at least 10 earlier games for that player is projected from those earlier
 * games only — no lookahead — against a stand-in line: the player's L10
 * average rounded to the nearest .5, which is roughly where books hang a main
 * line. Reports, per stat:
 *   - projection error (MAE) next to the L10 average's, the naive baseline
 *   - calibration of the model's favored side at the stand-in line (Brier vs
 *     base rate, reliability buckets, and the logit shrink that would fit)
 * The game environment (nba/environment.ts) is applied from each game's
 * closing spread and total, against the team's scoring before that game; the
 * report shows projection error with and without it, so its priors can be
 * judged. The matchup and pace layers are held at neutral: rebuilding each
 * team's defense as-of every date is a follow-up. Graded against real book
 * prices: `npm run backtest:props-market`.
 *
 * Run: `npm run backtest:nba-props` (optionally `N=40000`).
 */
const STATS = ["points", "rebounds", "assists", "threes", "pointsReboundsAssists"] as const;
const NEUTRAL: DefenseTable = { season: 0, fromLastSeason: false, teams: {} };

async function main() {
  const limit = Number(process.env.N ?? 30000);
  const rows = await prisma.nbaPlayerGameLog.findMany({
    where: { minutes: { gt: 0 } },
    orderBy: [{ nbaPlayerId: "asc" }, { gameDate: "asc" }],
    select: {
      gameId: true,
      nbaPlayerId: true,
      gameDate: true,
      season: true,
      isHome: true,
      minutes: true,
      points: true,
      rebounds: true,
      assists: true,
      threesMade: true,
      steals: true,
      blocks: true,
    },
  });
  const [closing, baselines] = await Promise.all([closingGameLines("nba"), teamBaselinesByGame("nba", 30)]);
  type Log = GameLogPoint & { gameId: string };
  const byPlayer = new Map<string, Log[]>();
  for (const r of rows) {
    const list = byPlayer.get(r.nbaPlayerId) ?? [];
    list.push({ gameId: r.gameId, date: etDateOf(r.gameDate), opponent: "", isHome: r.isHome, season: r.season, minutes: r.minutes, points: r.points, rebounds: r.rebounds, assists: r.assists, threesMade: r.threesMade, steals: r.steals, blocks: r.blocks });
    byPlayer.set(r.nbaPlayerId, list);
  }
  console.log(`${rows.length} player-games from ${byPlayer.size} players.`);

  for (const key of STATS) {
    const stat = NBA_PROP_STAT_BY_KEY.get(key)!;
    const samples: (CalibrationSample & { date: string })[] = [];
    let modelErr = 0;
    let noLinesErr = 0;
    let naiveErr = 0;
    let withLines = 0;
    let n = 0;
    for (const games of byPlayer.values()) {
      for (let i = 10; i < games.length; i++) {
        const history = games.slice(0, i).reverse(); // most recent first, before game i
        const l10 = history.slice(0, 10).reduce((a, g) => a + stat.value(g), 0) / 10;
        if (l10 < 1) continue; // a line nobody hangs
        const line = Math.round(l10 - 0.5) + 0.5;
        const game = games[i];
        const lines = closing.get(game.gameId) ?? NO_LINES;
        const base = baselines.get(game.gameId);
        const proj = projectProp(history, stat, {
          defense: NEUTRAL,
          opponent: null,
          positionGroup: null,
          lines,
          isHome: game.isHome,
          baselineTotal: (game.isHome ? base?.home : base?.away)?.combined ?? null,
          season: game.season,
        });
        const plain = projectProp(history, stat, { defense: NEUTRAL, opponent: null, positionGroup: null });
        if (!proj || !plain) continue;
        const actual = stat.value(game);
        if (lines.total !== null) withLines++;
        modelErr += Math.abs(proj.mean - actual);
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
      `\n${stat.label}: projection MAE ${(modelErr / n).toFixed(3)} (without game lines ${(noLinesErr / n).toFixed(3)}) vs L10-average MAE ${(naiveErr / n).toFixed(3)} over ${n} games, ${withLines} with closing lines`
    );
    console.log(formatCalibrationReport(`NBA ${stat.shortLabel} projection`, "player-game", report));
    await saveReport(`nba-props:${key}`, `NBA props — ${stat.label}`, "player-game", report, {
      projectionMae: modelErr / n,
      baselineMae: naiveErr / n,
      baseline: "L10 average",
      noLinesMae: noLinesErr / n,
      gamesWithLines: withLines,
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
