import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { todayEt } from "@/lib/dateEt";
import { getLeagueDays } from "@/lib/queries/lobby";
import { getNbaPropsSlate, toWireSlate } from "@/lib/queries/nbaProps";
import { unpackLog, type GameLogPoint } from "@/lib/nba/propsMath";
import { nbaStandouts } from "@/lib/nba/standouts";
import { formatAmerican } from "@/lib/odds/americanOdds";

/**
 * Read-only: tonight's NBA standouts (the Hottest Tonight page) from production,
 * with the time it takes and the lineups and minutes behind them.
 * Run: `npm run diagnose:hot`.
 */
async function main() {
  const days = await getLeagueDays("nba", todayEt());
  const date = days[0] ?? todayEt();
  const t = Date.now();
  const slate = toWireSlate(await getNbaPropsSlate(date));
  const logs = Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackLog)])) as Record<string, GameLogPoint[]>;
  const t2 = Date.now();
  const out = nbaStandouts(slate, logs);
  const lineupStatus = Object.values(slate.lineups).reduce((a, l) => ({ ...a, [l.status]: (a[l.status] ?? 0) + 1 }), {} as Record<string, number>);
  console.log(`${date}: ${slate.props.length} props, ${slate.games.length} games, lineups ${JSON.stringify(lineupStatus)} · slate ${t2 - t} ms, standouts ${Date.now() - t2} ms · ${out.length} standouts (${out.filter((s) => s.side === "over").length} over, ${out.filter((s) => s.side === "under").length} under)\n`);
  for (const s of out.slice(0, 15)) {
    console.log(
      `${s.name} (${s.team} vs ${s.opponent}) ${s.side} ${s.point} ${s.statLabel} ${s.priceAmerican !== null ? formatAmerican(s.priceAmerican) : "—"} · proj ${s.projection.toFixed(1)} (z ${s.z.toFixed(2)}) · ARCHR ${(s.chance * 100).toFixed(0)}% · L10 ${s.hit.l10.join("/")} · min ${s.minutes?.toFixed(1)}${s.style ? ` · like ${s.opponent} ${s.style.hits}/${s.style.games} (${s.style.teams.join(",")})` : ""}${s.alt ? ` · alt ${s.alt.point} ${formatAmerican(s.alt.priceAmerican)} (${(s.alt.chance * 100).toFixed(0)}%, EV ${(s.alt.ev * 100).toFixed(0)}%)` : ""}`
    );
    for (const r of s.reasons.slice(0, 4)) console.log(`     ${r.supports ? "+" : "-"} ${r.text}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
