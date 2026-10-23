/**
 * Backfill NBA player game logs from ESPN box scores (free, unkeyed) so the props
 * finder's hit rates have history before the daily sync has accumulated any.
 *
 *   npx tsx scripts/nba/backfill-game-logs.ts --from 2025-10-21 --to 2026-06-30
 *
 * Defaults to the start of last season through yesterday: last season fills the
 * L10/L20 windows in October, this season fills "Season". Re-runnable — games
 * already logged are skipped.
 */
import "dotenv/config";
import { shiftEtDate, todayEt } from "@/lib/dateEt";
import { syncNbaGameLogs } from "@/lib/nba/gameLogs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const from = arg("from") ?? "2025-10-21";
  const to = arg("to") ?? shiftEtDate(todayEt(), -1);
  let totalGames = 0;
  let totalLines = 0;
  for (let date = from; date <= to; date = shiftEtDate(date, 1)) {
    const s = await syncNbaGameLogs([date]);
    totalGames += s.gamesLogged;
    totalLines += s.playerLines;
    if (s.completedGames > 0) {
      console.log(`${date}: ${s.gamesLogged}/${s.completedGames} games logged (${s.gamesCreated} created), ${s.playerLines} lines`);
    }
    for (const failure of s.failures) console.warn(`  ! ${failure}`);
  }
  console.log(`done: ${totalGames} games, ${totalLines} player lines`);
}

main();
