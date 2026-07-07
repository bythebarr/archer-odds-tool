import { prisma } from "@/lib/prisma";
import { etDayBoundsUtc } from "@/lib/dateEt";
import { getRecentTeamPlayersBatch } from "@/lib/queries/props";
import { tallyPropHits, type PropHitRateResult } from "./hitRate";
import type { PropBoardColumnDef, PropBoardRow, PropLineCells, PropStatDef, SportPropConfig } from "./boardTypes";

/** PlayerGameLog column each MLB batter stat lives in. */
interface MlbStatDef extends PropStatDef {
  column: string;
}

/**
 * v1 catalog = batter props, because vs-LHP/RHP (the split the user most wants
 * to rank on) is a batter dimension. Pitcher props are the same shape with
 * role-appropriate splits (home/away) — a follow-up, not a rebuild.
 */
const MLB_STATS: MlbStatDef[] = [
  { key: "hits", label: "Hits", shortLabel: "H", role: "Batter", column: "hits", standardLines: [0.5, 1.5, 2.5] },
  { key: "totalBases", label: "Total Bases", shortLabel: "TB", role: "Batter", column: "totalBases", standardLines: [1.5, 2.5, 3.5] },
  { key: "homeRuns", label: "Home Runs", shortLabel: "HR", role: "Batter", column: "homeRuns", standardLines: [0.5, 1.5] },
  { key: "rbi", label: "RBIs", shortLabel: "RBI", role: "Batter", column: "rbi", standardLines: [0.5, 1.5, 2.5] },
  { key: "runs", label: "Runs", shortLabel: "R", role: "Batter", column: "runs", standardLines: [0.5, 1.5] },
  { key: "battingStrikeouts", label: "Strikeouts", shortLabel: "K", role: "Batter", column: "strikeoutsBatting", standardLines: [0.5, 1.5, 2.5] },
];

const MLB_COLUMNS: PropBoardColumnDef[] = [
  { key: "l5", label: "L5", kind: "window" },
  { key: "l10", label: "L10", kind: "window" },
  { key: "l15", label: "L15", kind: "window" },
  { key: "season", label: "Season", kind: "window" },
  { key: "vsLHP", label: "vs LHP", kind: "split" },
  { key: "vsRHP", label: "vs RHP", kind: "split" },
];

/** Public, free MLB headshot by person id — the photos the user loves, no ingestion. */
function mlbHeadshotUrl(mlbPersonId: number): string {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_120,q_auto/v1/people/${mlbPersonId}/headshot/67/current`;
}

/** One event-log entry reduced to just what a prop board needs. */
export interface PropLogEntry {
  value: number | null;
  opposingHand: "L" | "R" | null;
}

/**
 * Pure board assembly — given an entity's season log (most-recent-first) for a
 * stat, produce the hit-rate cells for every alt-line across every window +
 * split. No DB, so it's unit-testable. Mirrors computePropHitRate's semantics
 * exactly: null stat values are excluded from the sample (not counted as a
 * miss), and windows/splits are taken over the non-null-value games.
 */
export function assembleLineCells(
  log: PropLogEntry[],
  standardLines: number[]
): PropLineCells[] {
  const recorded = log.filter((e) => e.value !== null) as { value: number; opposingHand: "L" | "R" | null }[];
  const season = recorded.map((e) => e.value);
  const l5 = season.slice(0, 5);
  const l10 = season.slice(0, 10);
  const l15 = season.slice(0, 15);
  const vsLhp = recorded.filter((e) => e.opposingHand === "L").map((e) => e.value);
  const vsRhp = recorded.filter((e) => e.opposingHand === "R").map((e) => e.value);

  return standardLines.map((line) => {
    const at = (values: number[]): PropHitRateResult => tallyPropHits(values, line, "over");
    return {
      line,
      cells: {
        l5: at(l5),
        l10: at(l10),
        l15: at(l15),
        season: at(season),
        vsLHP: at(vsLhp),
        vsRHP: at(vsRhp),
      },
    };
  });
}

/** Best available season hit rate for a row, used for the server's default ordering. */
function defaultRank(row: PropBoardRow): number {
  const mid = row.lines[Math.floor(row.lines.length / 2)] ?? row.lines[0];
  return mid?.cells.season?.hitRate ?? -1;
}

async function buildMlbBoard(dateEt: string, statKey: string): Promise<PropBoardRow[]> {
  const stat = MLB_STATS.find((s) => s.key === statKey) ?? MLB_STATS[0];
  const { gte, lt } = etDayBoundsUtc(dateEt);

  const games = await prisma.game.findMany({
    where: { sport: "mlb", scheduledStartUtc: { gte, lt } },
    select: {
      homeTeam: { select: { id: true, abbreviation: true } },
      awayTeam: { select: { id: true, abbreviation: true } },
    },
  });

  // teamId -> "vs OPP" context for row meta.
  const teamContext = new Map<string, string>();
  const teamIds: string[] = [];
  for (const g of games) {
    if (g.homeTeam && g.awayTeam) {
      teamContext.set(g.homeTeam.id, `vs ${g.awayTeam.abbreviation}`);
      teamContext.set(g.awayTeam.id, `@ ${g.homeTeam.abbreviation}`);
      teamIds.push(g.homeTeam.id, g.awayTeam.id);
    }
  }
  if (teamIds.length === 0) return [];

  const recentByTeam = await getRecentTeamPlayersBatch(teamIds, 13);
  const entities: { playerId: string; personId: number; name: string; meta: string | null }[] = [];
  const seen = new Set<string>();
  for (const teamId of teamIds) {
    for (const { player } of recentByTeam[teamId] ?? []) {
      if (seen.has(player.id)) continue;
      seen.add(player.id);
      entities.push({ playerId: player.id, personId: player.mlbPersonId, name: player.fullName, meta: teamContext.get(teamId) ?? null });
    }
  }
  if (entities.length === 0) return [];

  // One query for every candidate's season logs, grouped in memory.
  const year = new Date().getUTCFullYear();
  const logs = await prisma.playerGameLog.findMany({
    where: {
      mlbPlayerId: { in: entities.map((e) => e.playerId) },
      gameDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
    },
    orderBy: { gameDate: "desc" },
  });

  const logsByPlayer = new Map<string, PropLogEntry[]>();
  for (const row of logs) {
    const value = (row as unknown as Record<string, number | null>)[stat.column];
    const hand = row.opposingStarterHand;
    const list = logsByPlayer.get(row.mlbPlayerId) ?? [];
    list.push({ value: value ?? null, opposingHand: hand === "L" || hand === "R" ? hand : null });
    logsByPlayer.set(row.mlbPlayerId, list);
  }

  const rows: PropBoardRow[] = [];
  for (const e of entities) {
    const lines = assembleLineCells(logsByPlayer.get(e.playerId) ?? [], stat.standardLines);
    // Drop entities with no recorded games for this stat (e.g. pitchers on a batter board).
    const hasSample = lines.some((l) => (l.cells.season?.sampleSize ?? 0) > 0);
    if (!hasSample) continue;
    rows.push({
      sport: "mlb",
      id: `${e.playerId}:${stat.key}`,
      entityId: e.playerId,
      entityName: e.name,
      entityImageUrl: mlbHeadshotUrl(e.personId),
      meta: e.meta,
      statKey: stat.key,
      direction: "over",
      lines,
      ev: null,
    });
  }

  rows.sort((a, b) => defaultRank(b) - defaultRank(a));
  return rows;
}

export const mlbPropConfig: SportPropConfig = {
  sport: "mlb",
  label: "MLB",
  icon: "⚾",
  stats: MLB_STATS.map(({ key, label, shortLabel, role, standardLines }) => ({ key, label, shortLabel, role, standardLines })),
  columns: MLB_COLUMNS,
  buildBoard: buildMlbBoard,
};
