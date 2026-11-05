import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { getNflPropsSlate } from "@/lib/queries/nflProps";
import { espnTeamCode } from "@/lib/logos";
import { rosterAthleteIds } from "@/lib/rosters/espnRosters";

/**
 * Read-only: how complete this week's NFL data is in production. Book lines per
 * game (player props in the typed table and in ESPN's raw feed, game markets),
 * the feeds' last runs, and which players the props slate suggests who aren't
 * on their team's ESPN roster, are hurt, or haven't played lately.
 * Run: `npm run diagnose:nfl`.
 */
const count = <T,>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, number>>((a, x) => ((a[key(x)] = (a[key(x)] ?? 0) + 1), a), {});

async function main() {
  const now = new Date();
  const games = await prisma.game.findMany({
    where: { sport: "nfl", scheduledStartUtc: { gte: new Date(now.getTime() - 3 * 3_600_000), lte: new Date(now.getTime() + 7 * 86_400_000) }, status: { not: "final" } },
    orderBy: { scheduledStartUtc: "asc" },
    include: { homeTeam: true, awayTeam: true },
  });
  console.log(`${games.length} NFL games in the next 7 days\n`);

  console.log("Feeds' last runs:");
  for (const p of await prisma.pollLog.findMany({ where: { jobName: { in: ["espn-props", "espn-odds", "poll-odds-nfl", "sync-injuries", "sync-rosters", "sync-results-nfl", "sync-schedule", "nfl-advanced"] } } })) {
    console.log(`  ${p.jobName.padEnd(18)} ${p.lastPolledAt.toISOString()} credits ${p.creditsRemaining ?? "—"} · ${p.lastStatus.slice(0, 700)}`);
  }

  const ids = games.map((g) => g.id);
  const [typed, raw, odds, markets] = await Promise.all([
    prisma.currentNflPropLine.findMany({ where: { gameId: { in: ids } }, select: { gameId: true, bookKey: true, nflPlayerId: true, stat: true } }),
    prisma.eventPropLine.findMany({ where: { league: "football/nfl", startsAt: { gte: new Date(now.getTime() - 3 * 3_600_000) } }, select: { eventRef: true, espnEventId: true, eventName: true, athleteId: true, statKey: true, market: true, priceAmerican: true, bookKey: true, period: true } }),
    prisma.currentOddsLine.findMany({ where: { gameId: { in: ids } }, select: { gameId: true, bookKey: true, marketType: true } }),
    prisma.gameMarketLine.findMany({ where: { gameId: { in: ids } }, select: { gameId: true, bookKey: true, marketKey: true } }),
  ]);
  const known = new Set((await prisma.nflPlayer.findMany({ where: { espnAthleteId: { in: [...new Set(raw.map((r) => r.athleteId))] } }, select: { espnAthleteId: true } })).map((p) => p.espnAthleteId));

  console.log("\nPer game: typed prop lines (books, players) · ESPN raw props (priced/unpriced, athletes, unknown athletes) · game odds (books, markets) · extra markets");
  for (const g of games) {
    const t = typed.filter((r) => r.gameId === g.id);
    const r = raw.filter((x) => x.eventRef === g.id);
    const o = odds.filter((x) => x.gameId === g.id);
    const m = markets.filter((x) => x.gameId === g.id);
    console.log(
      `  ${g.scheduledStartUtc.toISOString().slice(0, 16)} ${g.awayTeam?.abbreviation}@${g.homeTeam?.abbreviation}: typed ${t.length} ${JSON.stringify(count(t, (x) => x.bookKey))} ${new Set(t.map((x) => x.nflPlayerId)).size}p · raw ${r.filter((x) => x.priceAmerican !== null).length}/${r.filter((x) => x.priceAmerican === null).length} ${new Set(r.map((x) => x.athleteId)).size}a ${new Set(r.filter((x) => !known.has(x.athleteId)).map((x) => x.athleteId)).size}?` +
        ` · odds ${JSON.stringify(count(o, (x) => x.bookKey))} ${JSON.stringify(count(o, (x) => x.marketType))} · extra ${m.length} ${JSON.stringify(count(m, (x) => x.bookKey))}`
    );
  }
  const orphan = raw.filter((x) => !x.eventRef);
  console.log(`\nRaw ESPN NFL prop rows with no matched game: ${orphan.length} (${[...new Set(orphan.map((x) => x.eventName))].slice(0, 8).join("; ")})`);
  console.log("Raw markets (game period) by stat key, priced:", JSON.stringify(count(raw.filter((x) => x.period === "game" && x.priceAmerican !== null), (x) => `${x.statKey}`)));
  console.log("Raw markets, unpriced:", JSON.stringify(count(raw.filter((x) => x.priceAmerican === null), (x) => `${x.statKey}`)));

  // The slate the props page reads.
  const t0 = Date.now();
  const slate = await getNflPropsSlate(now);
  const players = Object.values(slate.players);
  const withBook = new Set(slate.props.filter((p) => p.quotes.length > 0).map((p) => p.playerId));
  console.log(`\nSlate: ${players.length} players, ${slate.props.length} props (${slate.props.filter((p) => p.quotes.length > 0).length} with book prices, ${slate.props.filter((p) => !p.quotes.length).length} ARCHR-only) · ${Date.now() - t0} ms`);
  console.log("  injury levels:", JSON.stringify(count(players, (p) => p.injury?.level ?? "none")));

  // Who's on each team's ESPN roster right now.
  const espnId = new Map((await prisma.nflPlayer.findMany({ where: { id: { in: players.map((p) => p.id) } }, select: { id: true, espnAthleteId: true } })).map((p) => [p.id, p.espnAthleteId]));
  const rosters = new Map<string, Set<string>>();
  for (const abbr of [...new Set(players.map((p) => p.team?.abbreviation).filter((x): x is string => !!x))]) {
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${espnTeamCode("nfl", abbr)}/roster`, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) rosters.set(abbr, new Set(rosterAthleteIds(await res.json())));
    } catch {
      // Left out: counted as unknown below.
    }
  }
  const offRoster = players.filter((p) => p.team && rosters.has(p.team.abbreviation) && !rosters.get(p.team.abbreviation)!.has(espnId.get(p.id) ?? ""));
  console.log(`  not on their team's ESPN roster: ${offRoster.length} (${offRoster.filter((p) => withBook.has(p.id)).length} with book lines) · rosters read ${rosters.size}`);
  for (const p of offRoster.slice(0, 25)) console.log(`    ${p.name} (${p.position}, ${p.team?.abbreviation}) ${withBook.has(p.id) ? "BOOK" : "archr-only"} injury ${p.injury?.level ?? "—"}`);

  // Players whose team has played since their last game (missed the team's last 1+ games).
  const lastGame: Record<string, string> = {};
  for (const g of await prisma.game.findMany({ where: { sport: "nfl", status: "final", scheduledStartUtc: { lt: now, gte: new Date(now.getTime() - 30 * 86_400_000) } }, include: { homeTeam: true, awayTeam: true } })) {
    for (const t of [g.homeTeam?.abbreviation, g.awayTeam?.abbreviation]) {
      const d = g.scheduledStartUtc.toISOString().slice(0, 10);
      if (t && (!lastGame[t] || d > lastGame[t])) lastGame[t] = d;
    }
  }
  const missed = players.filter((p) => {
    const last = (slate.logs[p.id] ?? [])[0]?.[0] as string | undefined;
    const team = p.team?.abbreviation;
    return team && lastGame[team] && (!last || last < lastGame[team]);
  });
  console.log(`  missed their team's last game: ${missed.length} (${missed.filter((p) => !p.injury).length} with no injury tag, ${missed.filter((p) => withBook.has(p.id)).length} with book lines)`);
  for (const p of missed.filter((x) => !x.injury).slice(0, 25)) console.log(`    ${p.name} (${p.position}, ${p.team?.abbreviation}) last ${(slate.logs[p.id] ?? [])[0]?.[0] ?? "never"} · ${withBook.has(p.id) ? "BOOK" : "archr-only"} · on roster ${rosters.get(p.team!.abbreviation)?.has(espnId.get(p.id) ?? "") ?? "?"}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
