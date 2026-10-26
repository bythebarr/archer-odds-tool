import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { NFL_PROP_STAT_BY_KEY } from "@/lib/nfl/propStats";
import { nflProbOver, projectNflProp } from "@/lib/nfl/projection";
import type { NflLogPoint } from "@/lib/nfl/propsMath";
import { scoreCalibration, formatCalibrationReport, type CalibrationSample } from "@/lib/engine/calibration";

/**
 * Backtest for the NFL prop projection (src/lib/nfl/projection.ts), the NBA
 * backtest's method: every logged game with 4+ earlier games for that player is
 * projected from those games only, against a stand-in line (his L5 average to
 * the nearest .5; 0.5 for anytime TD). Reports projection MAE next to the L5
 * average's, and calibration of the favored side. Matchup held neutral.
 *
 * Run: `npm run backtest:nfl-props`.
 */
const STATS = ["passYards", "rushYards", "recYards", "receptions", "anytimeTd"] as const;

async function main() {
  const rows = await prisma.nflPlayerGameLog.findMany({ orderBy: [{ nflPlayerId: "asc" }, { gameDate: "asc" }] });
  const byPlayer = new Map<string, NflLogPoint[]>();
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
    let naiveErr = 0;
    let n = 0;
    for (const games of byPlayer.values()) {
      for (let i = 4; i < games.length; i++) {
        const history = games.slice(0, i).reverse();
        const l5 = history.slice(0, 5).reduce((a, g) => a + stat.value(g), 0) / Math.min(history.length, 5);
        if (stat.shape !== "anytime" && l5 < (stat.shape === "yards" ? 15 : 1)) continue; // a line nobody hangs
        const line = stat.shape === "anytime" ? 0.5 : Math.round(l5 - 0.5) + 0.5;
        const proj = projectNflProp(history, stat, { defense: { season: 0, fromLastSeason: false, teams: {} }, opponent: null, position: null });
        if (!proj) continue;
        const actual = stat.value(games[i]);
        modelErr += Math.abs(proj.mean - actual);
        naiveErr += Math.abs(l5 - actual);
        n++;
        const p = nflProbOver(proj, stat, line);
        const overFav = p >= 0.5;
        samples.push({ pred: overFav ? p : 1 - p, won: (actual > line) === overFav ? 1 : 0, date: games[i].date });
      }
    }
    samples.sort((a, b) => (a.date < b.date ? 1 : -1));
    console.log(`\n${stat.label}: projection MAE ${(modelErr / n).toFixed(2)} vs L5-average MAE ${(naiveErr / n).toFixed(2)} over ${n} games`);
    console.log(formatCalibrationReport(`NFL ${stat.shortLabel} projection`, "player-game", scoreCalibration(samples)));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
