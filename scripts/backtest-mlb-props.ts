import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { rawProbOver, shrinkLogit } from "@/lib/propModel/distribution";
import { MLB_CALIBRATION_SHRINK, projectMlbProp, type MlbLogPoint, type MlbPropStat } from "@/lib/mlb/propProjection";
import { scoreCalibration, formatCalibrationReport, type CalibrationSample } from "@/lib/engine/calibration";
import { saveReport } from "@/lib/engine/saveReport";

/**
 * Backtest for the MLB prop projection (src/lib/mlb/propProjection.ts), the
 * NBA/NFL method: every logged game is projected from that player's earlier
 * games only (platoon side from the game's own opposing-starter hand, known
 * before first pitch), against the line books hang most often for the stat.
 * Reports projection MAE next to the L10 average and the calibration of the
 * model's favored side, and saves each card (mlb-props:<stat>).
 *
 * Run: `npm run backtest:mlb-props` (N caps samples per stat, default 40000).
 */
const STATS: { stat: MlbPropStat; line: number; pitcher?: boolean }[] = [
  { stat: "hits", line: 0.5 },
  { stat: "totalBases", line: 1.5 },
  { stat: "homeRuns", line: 0.5 },
  { stat: "battingStrikeouts", line: 0.5 },
  { stat: "hitsRunsRbis", line: 1.5 },
  { stat: "pitcherStrikeouts", line: 5.5, pitcher: true },
  { stat: "outsRecorded", line: 16.5, pitcher: true },
  { stat: "hitsAllowed", line: 5.5, pitcher: true },
  { stat: "earnedRuns", line: 2.5, pitcher: true },
];

function valueOf(stat: MlbPropStat, l: MlbLogPoint): number | null {
  switch (stat) {
    case "hits": return l.hits;
    case "totalBases": return l.totalBases;
    case "homeRuns": return l.homeRuns;
    case "battingStrikeouts": return l.strikeoutsBatting;
    case "hitsRunsRbis": return l.hits === null ? null : (l.hits ?? 0) + (l.runs ?? 0) + (l.rbi ?? 0);
    case "pitcherStrikeouts": return l.isStarter ? l.strikeoutsPitching : null;
    case "outsRecorded": return l.isStarter ? l.outsRecorded : null;
    case "hitsAllowed": return l.isStarter ? l.hitsAllowed : null;
    case "earnedRuns": return l.isStarter ? l.earnedRuns : null;
    default: return null;
  }
}

async function main() {
  const limit = Number(process.env.N ?? 40000);
  const rows = await prisma.playerGameLog.findMany({ orderBy: [{ mlbPlayerId: "asc" }, { gameDate: "asc" }] });
  const byPlayer = new Map<string, MlbLogPoint[]>();
  for (const r of rows) {
    const list = byPlayer.get(r.mlbPlayerId) ?? [];
    list.push({
      date: etDateOf(r.gameDate),
      season: r.gameDate.getUTCFullYear(),
      isHome: r.isHome,
      opposingStarterHand: r.opposingStarterHand === "L" || r.opposingStarterHand === "R" ? r.opposingStarterHand : null,
      plateAppearances: r.plateAppearances,
      hits: r.hits,
      totalBases: r.totalBases,
      homeRuns: r.homeRuns,
      rbi: r.rbi,
      runs: r.runs,
      baseOnBalls: r.baseOnBalls,
      strikeoutsBatting: r.strikeoutsBatting,
      stolenBases: r.stolenBases,
      isStarter: r.isStarter,
      outsRecorded: r.outsRecorded,
      strikeoutsPitching: r.strikeoutsPitching,
      earnedRuns: r.earnedRuns,
      hitsAllowed: r.hitsAllowed,
      walksAllowed: r.walksAllowed,
    });
    byPlayer.set(r.mlbPlayerId, list);
  }
  console.log(`${rows.length} player-games from ${byPlayer.size} players.`);

  for (const { stat, line } of STATS) {
    const samples: (CalibrationSample & { date: string })[] = [];
    let modelErr = 0;
    let naiveErr = 0;
    let n = 0;
    for (const games of byPlayer.values()) {
      for (let i = 10; i < games.length; i++) {
        const actual = valueOf(stat, games[i]);
        if (actual === null || (stat !== "pitcherStrikeouts" && stat !== "outsRecorded" && stat !== "hitsAllowed" && stat !== "earnedRuns" && !(games[i].plateAppearances ?? 0))) continue;
        const history = games.slice(0, i).reverse();
        const proj = projectMlbProp(history, stat, { opposingHand: games[i].opposingStarterHand, season: games[i].season });
        if (!proj) continue;
        const prior = history.map((g) => valueOf(stat, g)).filter((v): v is number => v !== null).slice(0, 10);
        if (prior.length < 5) continue;
        const l10 = prior.reduce((a, b) => a + b, 0) / prior.length;
        modelErr += Math.abs(proj.mean - actual);
        naiveErr += Math.abs(l10 - actual);
        n++;
        const p = shrinkLogit(rawProbOver(proj.distribution, line), MLB_CALIBRATION_SHRINK);
        const overFav = p >= 0.5;
        samples.push({ pred: overFav ? p : 1 - p, won: (actual > line) === overFav ? 1 : 0, date: games[i].date });
      }
    }
    if (n === 0) continue;
    samples.sort((a, b) => (a.date < b.date ? 1 : -1));
    const report = scoreCalibration(samples.slice(0, limit));
    console.log(`\n${stat} @ ${line}: projection MAE ${(modelErr / n).toFixed(3)} vs L10-average MAE ${(naiveErr / n).toFixed(3)} over ${n} games`);
    console.log(formatCalibrationReport(`MLB ${stat} o${line}`, "player-game", report));
    await saveReport(`mlb-props:${stat}`, `MLB props — ${stat} ${line}`, "player-game", report, {
      projectionMae: modelErr / n,
      baselineMae: naiveErr / n,
      baseline: "L10 average",
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
