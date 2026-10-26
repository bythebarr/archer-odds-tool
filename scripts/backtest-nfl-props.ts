import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { NFL_PROP_STAT_BY_KEY } from "@/lib/nfl/propStats";
import { nflProbOver, projectNflProp } from "@/lib/nfl/projection";
import type { NflLogPoint } from "@/lib/nfl/propsMath";
import { scoreCalibration, formatCalibrationReport, type CalibrationSample } from "@/lib/engine/calibration";
import { saveReport } from "@/lib/engine/saveReport";
import { NO_LINES } from "@/lib/propModel/environment";
import { closingGameLines, teamBaselinesByGame } from "./props/history";

/**
 * Backtest for the NFL prop projection (src/lib/nfl/projection.ts), the NBA
 * backtest's method: every logged game with 4+ earlier games for that player is
 * projected from those games only, against a stand-in line (his L5 average to
 * the nearest .5; 0.5 for anytime TD). Reports projection MAE next to the L5
 * average's (and the projection's without game lines — the environment layer
 * runs on each game's closing spread and total), and calibration of the
 * favored side. Matchup held neutral.
 *
 * Run: `npm run backtest:nfl-props`.
 */
const STATS = ["passYards", "rushYards", "recYards", "receptions", "anytimeTd"] as const;

async function main() {
  const rows = await prisma.nflPlayerGameLog.findMany({ orderBy: [{ nflPlayerId: "asc" }, { gameDate: "asc" }] });
  const [closing, baselines] = await Promise.all([closingGameLines("nfl"), teamBaselinesByGame("nfl", 17)]);
  const byPlayer = new Map<string, (NflLogPoint & { gameId: string })[]>();
  for (const r of rows) {
    const list = byPlayer.get(r.nflPlayerId) ?? [];
    list.push({ ...r, date: etDateOf(r.gameDate), opponent: "" });
    byPlayer.set(r.nflPlayerId, list);
  }
  console.log(`${rows.length} player-games from ${byPlayer.size} players.`);

  for (const key of STATS) {
    const stat = NFL_PROP_STAT_BY_KEY.get(key)!;
    const samples: (CalibrationSample & { date: string })[] = [];
    let modelErr = 0;
    let noLinesErr = 0;
    let naiveErr = 0;
    let withLines = 0;
    let n = 0;
    for (const games of byPlayer.values()) {
      for (let i = 4; i < games.length; i++) {
        const history = games.slice(0, i).reverse();
        const l5 = history.slice(0, 5).reduce((a, g) => a + stat.value(g), 0) / Math.min(history.length, 5);
        if (stat.shape !== "anytime" && l5 < (stat.shape === "yards" ? 15 : 1)) continue; // a line nobody hangs
        const line = stat.shape === "anytime" ? 0.5 : Math.round(l5 - 0.5) + 0.5;
        const game = games[i];
        const neutral = { defense: { season: 0, fromLastSeason: false, teams: {} }, opponent: null, position: null };
        const lines = closing.get(game.gameId) ?? NO_LINES;
        const base = baselines.get(game.gameId);
        const proj = projectNflProp(history, stat, {
          ...neutral,
          lines,
          isHome: game.isHome,
          baselinePoints: (game.isHome ? base?.home : base?.away)?.scored ?? null,
          season: game.season,
        });
        const plain = projectNflProp(history, stat, neutral);
        if (!proj || !plain) continue;
        const actual = stat.value(game);
        if (lines.total !== null) withLines++;
        modelErr += Math.abs(proj.mean - actual);
        noLinesErr += Math.abs(plain.mean - actual);
        naiveErr += Math.abs(l5 - actual);
        n++;
        const p = nflProbOver(proj, stat, line);
        const overFav = p >= 0.5;
        samples.push({ pred: overFav ? p : 1 - p, won: (actual > line) === overFav ? 1 : 0, date: games[i].date });
      }
    }
    samples.sort((a, b) => (a.date < b.date ? 1 : -1));
    console.log(
      `\n${stat.label}: projection MAE ${(modelErr / n).toFixed(3)} (without game lines ${(noLinesErr / n).toFixed(3)}) vs L5-average MAE ${(naiveErr / n).toFixed(3)} over ${n} games, ${withLines} with closing lines`
    );
    const report = scoreCalibration(samples);
    console.log(formatCalibrationReport(`NFL ${stat.shortLabel} projection`, "player-game", report));
    await saveReport(`nfl-props:${key}`, `NFL props — ${stat.label}`, "player-game", report, {
      projectionMae: modelErr / n,
      baselineMae: naiveErr / n,
      baseline: "L5 average",
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
