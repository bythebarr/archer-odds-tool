import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { defenseTableFromSums, type DefenseSumRow, type SlatePlayer, type WireNbaPropsSlate } from "@/lib/queries/nbaProps";
import { getCalibrationFactors, getModelWeights } from "@/lib/queries/modelWeights";
import { NBA_PROP_STATS, NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import { positionRates } from "@/lib/nba/projection";
import { positionGroup } from "@/lib/nba/positionGroups";
import type { GameLogPoint, PropQuote, SlateProp } from "@/lib/nba/propsMath";
import { STANDOUT_EDGE_SHRINK, calibrateStandout, isStandout, nbaStandouts } from "@/lib/nba/standouts";
import { americanToDecimal } from "@/lib/odds/americanOdds";
import type { GameLines } from "@/lib/propModel/environment";
import { closingGameLines } from "./props/history";

/**
 * Do the Hottest Tonight calls hit? Replays every graded NBA night with stored
 * prop snapshots through the live standout code (nbaStandouts), on what was
 * known before tip: each book's last quote, the player's earlier games, the
 * defense table built from games before that night, the closing spread and
 * total. Then the box score settles each call at the main line (and the alt
 * rung it suggested), at the best listed price.
 *
 * Reports, for every call and for the standouts the page shows:
 *   - hit rate, ARCHR's average chance (calibration), and ROI
 *   - the same by the size of the gap (|z|), by side, and night by night's top 10
 *   - the edge shrink (STANDOUT_EDGE_SHRINK) that best calibrates the standouts'
 *     chance, by log loss: copy it into standouts.ts
 *   - whether the opponent look-alike record (styleMatch) and the head-to-head
 *     record add anything when they agree with the call or disagree
 *
 * Known leaks, both small: the market-blend weights and calibration factors are
 * today's fits (one number per stat), and injuries/lineups that night aren't
 * replayed (the absences and starting-five reads are off), which if anything
 * understates the live page.
 *
 * Run: `npm run backtest:nba-standouts`.
 */

interface Graded {
  date: string;
  standout: boolean;
  side: "over" | "under";
  absZ: number;
  /** Calibrated (what the page shows), and the inputs to refit the calibration. */
  chance: number;
  rawChance: number;
  marketChance: number | null;
  won: boolean;
  profit: number | null;
  style: "agrees" | "disagrees" | "none";
  h2h: "agrees" | "disagrees" | "none";
  alt: { chance: number; won: boolean; profit: number } | null;
}

const DAY = 86_400_000;

function closingQuotes(snaps: { nbaPlayerId: string; stat: string; bookKey: string; side: string; point: number; priceAmerican: number; polledAt: Date }[], start: Date) {
  const latest = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) {
    if (s.polledAt >= start) continue;
    const k = `${s.nbaPlayerId}|${s.stat}|${s.bookKey}|${s.side}|${s.point}`;
    const prev = latest.get(k);
    if (!prev || s.polledAt > prev.polledAt) latest.set(k, s);
  }
  const out = new Map<string, PropQuote[]>();
  for (const s of latest.values()) {
    const k = `${s.nbaPlayerId}|${s.stat}`;
    const list = out.get(k) ?? [];
    list.push({ bookKey: s.bookKey, bookName: s.bookKey, side: s.side === "under" ? "under" : "over", point: s.point, priceAmerican: s.priceAmerican });
    out.set(k, list);
  }
  return out;
}

const profitAt = (price: number | null, won: boolean) => (price === null ? null : won ? americanToDecimal(price) - 1 : -1);
const agreement = (rec: [number, number] | null, min: number): Graded["style"] =>
  !rec || rec[1] < min ? "none" : rec[0] / rec[1] >= 0.5 ? "agrees" : "disagrees";

async function main() {
  const snapGames = await prisma.game.findMany({
    where: { sport: "nba", status: "final", nbaPropSnapshots: { some: {} } },
    select: { id: true, season: true },
  });
  if (snapGames.length === 0) {
    console.log("No graded NBA games with prop snapshots.");
    return;
  }
  const seasons = [...new Set(snapGames.flatMap((g) => [g.season - 1, g.season]))];
  const snapIds = new Set(snapGames.map((g) => g.id));

  const games = await prisma.game.findMany({
    where: { sport: "nba", season: { in: seasons } },
    select: { id: true, season: true, scheduledStartUtc: true, status: true, homeTeamId: true, awayTeamId: true },
  });
  const teamIds = [...new Set(games.flatMap((g) => [g.homeTeamId, g.awayTeamId]).filter((x): x is string => !!x))];
  const [teams, logRows, modelWeights, calibrationFactors, closing] = await Promise.all([
    prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, abbreviation: true, name: true } }),
    prisma.nbaPlayerGameLog.findMany({ where: { season: { in: seasons } } }),
    getModelWeights("nba"),
    getCalibrationFactors("nba-props"),
    closingGameLines("nba"),
  ]);
  const abbr = new Map(teams.map((t) => [t.id, t.abbreviation]));
  const teamName = new Map(teams.map((t) => [t.abbreviation, t.name]));
  const gameById = new Map(games.map((g) => [g.id, g]));
  const slateTeam = (a: string) => ({ abbreviation: a, name: teamName.get(a) ?? a, logoUrl: "" });

  // Every log as the slate carries it, per player, newest first.
  const logsByPlayer = new Map<string, (GameLogPoint & { gameId: string; at: number })[]>();
  const sums = new Map<string, DefenseSumRow & { at: number }>();
  for (const l of logRows) {
    const g = gameById.get(l.gameId);
    if (!g) continue;
    const oppId = l.teamId === g.homeTeamId ? g.awayTeamId : g.homeTeamId;
    const point: GameLogPoint & { gameId: string; at: number } = {
      gameId: l.gameId,
      at: l.gameDate.getTime(),
      date: etDateOf(l.gameDate),
      opponent: (oppId && abbr.get(oppId)) ?? "",
      isHome: l.isHome,
      season: l.season,
      minutes: l.minutes,
      points: l.points,
      rebounds: l.rebounds,
      assists: l.assists,
      threesMade: l.threesMade,
      steals: l.steals,
      blocks: l.blocks,
      turnovers: l.turnovers,
      team: abbr.get(l.teamId),
      starter: l.starter,
    };
    const list = logsByPlayer.get(l.nbaPlayerId) ?? [];
    list.push(point);
    logsByPlayer.set(l.nbaPlayerId, list);
    // The defense table's per-game sums, as getNbaDefenseTable groups them.
    const k = `${l.gameId}|${l.teamId}|${l.positionGroup}`;
    const row = sums.get(k) ?? { season: l.season, gameId: l.gameId, teamId: l.teamId, positionGroup: l.positionGroup, at: l.gameDate.getTime(), _sum: {} };
    for (const c of ["points", "rebounds", "assists", "threesMade", "steals", "blocks", "turnovers"] as const) row._sum[c] = (row._sum[c] ?? 0) + l[c];
    sums.set(k, row);
  }
  for (const list of logsByPlayer.values()) list.sort((a, b) => b.at - a.at);
  const sumRows = [...sums.values()];

  // Team → the dates it played.
  const teamDates = new Map<string, string[]>();
  for (const g of games) {
    if (g.status !== "final") continue;
    for (const id of [g.homeTeamId, g.awayTeamId]) {
      const a = id && abbr.get(id);
      if (a) teamDates.set(a, [...(teamDates.get(a) ?? []), etDateOf(g.scheduledStartUtc)]);
    }
  }

  const players = new Map(
    (await prisma.nbaPlayer.findMany({ select: { id: true, fullName: true, headshotUrl: true, positionGroup: true } })).map((p) => [p.id, p])
  );

  // Slate nights, oldest first.
  const nights = new Map<string, string[]>();
  for (const g of games) {
    if (!snapIds.has(g.id)) continue;
    const d = etDateOf(g.scheduledStartUtc);
    nights.set(d, [...(nights.get(d) ?? []), g.id]);
  }
  const graded: Graded[] = [];
  const started = Date.now();
  for (const [date, gameIds] of [...nights].sort(([a], [b]) => a.localeCompare(b))) {
    const nightStart = Math.min(...gameIds.map((id) => gameById.get(id)!.scheduledStartUtc.getTime()));
    const season = gameById.get(gameIds[0])!.season;
    const defense = defenseTableFromSums(
      sumRows.filter((r) => r.at < nightStart - DAY / 4),
      abbr,
      season
    );
    const slate: WireNbaPropsSlate = {
      date,
      season,
      games: [],
      players: {},
      logs: {},
      props: [],
      defense,
      absences: {},
      lines: {},
      modelWeights,
      calibrationFactors,
      positionRates: {},
      teamDates: Object.fromEntries([...teamDates].map(([t, ds]) => [t, ds.filter((d) => d < date)])),
      lineups: {},
      lastPolledAt: null,
    };
    const history: Record<string, GameLogPoint[]> = {};
    const tonight = new Map<string, GameLogPoint>();
    for (const gameId of gameIds) {
      const g = gameById.get(gameId)!;
      const home = g.homeTeamId ? abbr.get(g.homeTeamId) : undefined;
      const away = g.awayTeamId ? abbr.get(g.awayTeamId) : undefined;
      if (!home || !away) continue;
      slate.games.push({ id: g.id, startUtc: g.scheduledStartUtc.toISOString(), home: slateTeam(home), away: slateTeam(away) });
      slate.lines[g.id] = closing.get(g.id) ?? ({ homeSpread: null, total: null } satisfies GameLines);
      const snaps = await prisma.nbaPropSnapshot.findMany({ where: { gameId: g.id } });
      for (const [key, quotes] of closingQuotes(snaps, g.scheduledStartUtc)) {
        const [playerId, stat] = key.split("|");
        const mine = logsByPlayer.get(playerId) ?? [];
        const played = mine.find((l) => l.gameId === g.id);
        const info = players.get(playerId);
        if (!played || played.minutes <= 0 || !info) continue; // didn't play: void
        tonight.set(playerId, played);
        history[playerId] ??= mine.filter((l) => l.at < g.scheduledStartUtc.getTime());
        const isHome = played.isHome;
        const player: SlatePlayer = {
          id: playerId,
          name: info.fullName,
          headshotUrl: info.headshotUrl ?? "",
          gameId: g.id,
          team: slateTeam(isHome ? home : away),
          opponent: slateTeam(isHome ? away : home),
          venue: isHome ? "home" : "away",
          positionGroup: positionGroup(info.positionGroup),
          injury: null,
        };
        slate.players[playerId] = player;
        slate.props.push({ playerId, stat: stat as SlateProp["stat"], quotes });
      }
    }
    slate.positionRates = positionRates(Object.values(slate.players), history, NBA_PROP_STATS.filter((s) => !s.milestone));

    for (const s of nbaStandouts(slate, history, { all: true })) {
      const box = tonight.get(s.playerId);
      const stat = NBA_PROP_STAT_BY_KEY.get(s.stat as SlateProp["stat"]);
      if (!box || !stat) continue;
      const actual = stat.value(box);
      if (actual === s.point) continue; // push
      const won = s.side === "over" ? actual > s.point : actual < s.point;
      let alt: Graded["alt"] = null;
      if (s.alt && actual !== s.alt.point) {
        const altWon = s.side === "over" ? actual > s.alt.point : actual < s.alt.point;
        alt = { chance: s.alt.chance, won: altWon, profit: profitAt(s.alt.priceAmerican, altWon)! };
      }
      graded.push({
        date,
        standout: isStandout(s.z, s.rawChance, s.hit.l10),
        side: s.side,
        absZ: Math.abs(s.z),
        chance: s.chance,
        rawChance: s.rawChance,
        marketChance: s.marketChance,
        won,
        profit: profitAt(s.priceAmerican, won),
        style: agreement(s.style ? [s.style.hits, s.style.games] : null, 4),
        h2h: agreement(s.hit.h2h, 3),
        alt,
      });
    }
  }

  const standouts = graded.filter((g) => g.standout);
  console.log(`${nights.size} nights · ${graded.length} graded calls · ${standouts.length} standouts · ${((Date.now() - started) / 1000).toFixed(0)} s\n`);

  const line = (label: string, rows: { won: boolean; chance: number; profit: number | null }[]) => {
    if (rows.length === 0) return console.log(`  ${label.padEnd(28)}     0`);
    const priced = rows.filter((r) => r.profit !== null);
    const hit = rows.filter((r) => r.won).length / rows.length;
    const chance = rows.reduce((a, r) => a + r.chance, 0) / rows.length;
    const roi = priced.length ? priced.reduce((a, r) => a + r.profit!, 0) / priced.length : null;
    const se = Math.sqrt((hit * (1 - hit)) / rows.length);
    console.log(
      `  ${label.padEnd(28)} ${String(rows.length).padStart(5)}  hit ${(hit * 100).toFixed(1).padStart(5)}% ±${(se * 100).toFixed(1)}  ARCHR ${(chance * 100).toFixed(1).padStart(5)}%  ROI ${roi === null ? "  —" : `${roi >= 0 ? "+" : ""}${(roi * 100).toFixed(1)}%`}`
    );
  };

  console.log("Every call vs the standouts the page shows (main line, best listed price):");
  line("all calls", graded);
  line("not standouts", graded.filter((g) => !g.standout));
  line("standouts", standouts);
  line("  overs", standouts.filter((g) => g.side === "over"));
  line("  unders", standouts.filter((g) => g.side === "under"));

  console.log("\nBy the gap, |z| (every call):");
  const buckets = [0, 0.2, 0.35, 0.5, 0.75, 1, Infinity];
  for (let i = 0; i < buckets.length - 1; i++) {
    const [lo, hi] = [buckets[i], buckets[i + 1]];
    line(`|z| ${lo}–${hi === Infinity ? "" : hi}`, graded.filter((g) => g.absZ >= lo && g.absZ < hi));
  }

  console.log(`\nBy ARCHR's calibrated chance (standouts; edge shrink ${STANDOUT_EDGE_SHRINK}):`);
  for (const [lo, hi] of [[0, 0.54], [0.54, 0.56], [0.56, 0.58], [0.58, 0.6], [0.6, 1.01]]) line(`${lo}–${hi > 1 ? "" : hi}`, standouts.filter((g) => g.chance >= lo && g.chance < hi));
  console.log("\nBy ARCHR's raw chance (standouts):");
  for (const [lo, hi] of [[0.58, 0.62], [0.62, 0.66], [0.66, 0.7], [0.7, 1.01]])
    line(`${lo}–${hi > 1 ? "" : hi}`, standouts.filter((g) => g.rawChance >= lo && g.rawChance < hi).map((g) => ({ ...g, chance: g.rawChance })));

  // The edge shrink that calibrates the standouts best.
  const logLoss = (k: number) =>
    standouts.reduce((a, g) => {
      const p = Math.min(0.99, Math.max(0.01, calibrateStandout(g.rawChance, g.marketChance, k)));
      return a - Math.log(g.won ? p : 1 - p);
    }, 0) / standouts.length;
  let bestK = 1;
  for (let k = 0; k <= 1.0001; k += 0.05) if (logLoss(k) < logLoss(bestK)) bestK = k;
  console.log(
    `\nEdge shrink by log loss on the standouts: best ${bestK.toFixed(2)} (${logLoss(bestK).toFixed(4)}), in use ${STANDOUT_EDGE_SHRINK} (${logLoss(STANDOUT_EDGE_SHRINK).toFixed(4)}), none 1 (${logLoss(1).toFixed(4)}), market alone 0 (${logLoss(0).toFixed(4)}) · ${standouts.filter((g) => g.marketChance !== null).length}/${standouts.length} with a market read`
  );

  console.log("\nNight by night's top standouts, as the page ranks them (calibrated chance):");
  const byChance = (a: Graded, b: Graded) => b.chance - a.chance || b.absZ - a.absZ;
  const byNightRanked = new Map<string, Graded[]>();
  for (const g of standouts) byNightRanked.set(g.date, [...(byNightRanked.get(g.date) ?? []), g]);
  line("top 10 a night", [...byNightRanked.values()].flatMap((l) => [...l].sort(byChance).slice(0, 10)));
  line("top 3 a night", [...byNightRanked.values()].flatMap((l) => [...l].sort(byChance).slice(0, 3)));

  console.log("\nNight by night's top 10 standouts by |z| (the old ranking):");
  const byNight = new Map<string, Graded[]>();
  for (const g of standouts) byNight.set(g.date, [...(byNight.get(g.date) ?? []), g]);
  const top = [...byNight.values()].flatMap((l) => [...l].sort((a, b) => b.absZ - a.absZ).slice(0, 10));
  line("top 10 a night", top);
  line("top 3 a night", [...byNight.values()].flatMap((l) => [...l].sort((a, b) => b.absZ - a.absZ).slice(0, 3)));

  for (const [key, label] of [["style", "Look-alike opponents' record"], ["h2h", "Head-to-head record"]] as const) {
    console.log(`\n${label}, when it agrees with the call or not:`);
    for (const set of [["standouts", standouts], ["every call", graded]] as const) {
      for (const v of ["agrees", "disagrees", "none"] as const) line(`${set[0]}: ${v}`, set[1].filter((g) => g[key] === v));
    }
  }

  console.log("\nThe alt rung each standout suggested:");
  line("alt lines", standouts.flatMap((g) => (g.alt ? [g.alt] : [])));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
