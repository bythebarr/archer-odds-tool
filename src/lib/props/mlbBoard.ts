import { prisma } from "@/lib/prisma";
import { etDayBoundsUtc } from "@/lib/dateEt";
import { getRecentTeamPlayersBatch } from "@/lib/queries/props";
import { tallyPropHits, type PropHitRateResult } from "./hitRate";
import { projectPropHit, pooledBaseRate } from "./projection";
import { pitcherRampFor } from "./pitcherRamp";
import type { PropBoardColumnDef, PropBoardRow, PropLineCells, PropStatDef, PropView, SportPropConfig } from "./boardTypes";

/** A stat with the PlayerGameLog column it reads. */
interface MlbStatDef extends PropStatDef {
  column: string;
}

/** A recency window: the last `n` recorded games, or the whole season. */
interface WindowDef {
  key: string;
  n: number | "season";
}

// ── Batter view ──────────────────────────────────────────────────────────────
const BATTER_STATS: MlbStatDef[] = [
  { key: "hits", label: "Hits", shortLabel: "H", role: "Batter", column: "hits", standardLines: [0.5, 1.5, 2.5] },
  { key: "totalBases", label: "Total Bases", shortLabel: "TB", role: "Batter", column: "totalBases", standardLines: [1.5, 2.5, 3.5] },
  { key: "homeRuns", label: "Home Runs", shortLabel: "HR", role: "Batter", column: "homeRuns", standardLines: [0.5, 1.5] },
  { key: "rbi", label: "RBIs", shortLabel: "RBI", role: "Batter", column: "rbi", standardLines: [0.5, 1.5, 2.5] },
  { key: "runs", label: "Runs", shortLabel: "R", role: "Batter", column: "runs", standardLines: [0.5, 1.5] },
  { key: "battingStrikeouts", label: "Strikeouts", shortLabel: "K", role: "Batter", column: "strikeoutsBatting", standardLines: [0.5, 1.5, 2.5] },
];
const BATTER_WINDOWS: WindowDef[] = [
  { key: "l5", n: 5 },
  { key: "l10", n: 10 },
  { key: "l15", n: 15 },
  { key: "season", n: "season" },
];
const BATTER_SPLIT_KEYS = ["vsLHP", "vsRHP"];
const BATTER_COLUMNS: PropBoardColumnDef[] = [
  { key: "l5", label: "L5", kind: "window" },
  { key: "l10", label: "L10", kind: "window" },
  { key: "l15", label: "L15", kind: "window" },
  { key: "season", label: "Season", kind: "window" },
  { key: "vsLHP", label: "vs LHP", kind: "split" },
  { key: "vsRHP", label: "vs RHP", kind: "split" },
];

// ── Pitcher view ─────────────────────────────────────────────────────────────
const PITCHER_STATS: MlbStatDef[] = [
  { key: "pitcherStrikeouts", label: "Strikeouts", shortLabel: "K", role: "Pitcher", column: "strikeoutsPitching", standardLines: [3.5, 4.5, 5.5, 6.5, 7.5] },
  { key: "outsRecorded", label: "Outs", shortLabel: "Outs", role: "Pitcher", column: "outsRecorded", standardLines: [14.5, 15.5, 16.5, 17.5, 18.5, 19.5] },
  { key: "earnedRuns", label: "Earned Runs", shortLabel: "ER", role: "Pitcher", column: "earnedRuns", standardLines: [1.5, 2.5, 3.5] },
  { key: "hitsAllowed", label: "Hits Allowed", shortLabel: "H", role: "Pitcher", column: "hitsAllowed", standardLines: [3.5, 4.5, 5.5, 6.5, 7.5] },
  { key: "walksAllowed", label: "Walks", shortLabel: "BB", role: "Pitcher", column: "walksAllowed", standardLines: [1.5, 2.5, 3.5] },
];
const PITCHER_WINDOWS: WindowDef[] = [
  { key: "l3", n: 3 },
  { key: "l5", n: 5 },
  { key: "l10", n: 10 },
  { key: "season", n: "season" },
];
const PITCHER_SPLIT_KEYS = ["home", "away"];
const PITCHER_COLUMNS: PropBoardColumnDef[] = [
  { key: "l3", label: "L3", kind: "window" },
  { key: "l5", label: "L5", kind: "window" },
  { key: "l10", label: "L10", kind: "window" },
  { key: "season", label: "Season", kind: "window" },
  { key: "home", label: "Home", kind: "split" },
  { key: "away", label: "Away", kind: "split" },
];

/** Public, free MLB headshot by person id — the photos the user loves, no ingestion. */
function mlbHeadshotUrl(mlbPersonId: number): string {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_120,q_auto/v1/people/${mlbPersonId}/headshot/67/current`;
}

/** One event-log entry reduced to what the board needs: the stat value + which splits it belongs to. */
export interface PropLogEntry {
  value: number | null;
  /** Split-option keys this game qualifies for, e.g. ["vsLHP"] or ["home"]. */
  splits: string[];
}

/**
 * Pure board assembly — given an entity's season log (most-recent-first) for a
 * stat, produce the hit-rate cells for every alt-line across the given windows
 * and splits. Sport/view-agnostic (windows + splits are passed in), and no DB,
 * so it's unit-testable. Mirrors computePropHitRate's semantics: null stat
 * values are excluded from the sample (not a miss), and windows/splits are
 * taken over the recorded (non-null) games only.
 */
export function assembleLineCells(
  log: PropLogEntry[],
  standardLines: number[],
  windows: WindowDef[],
  splitKeys: string[]
): PropLineCells[] {
  const recorded = log.filter((e) => e.value !== null) as { value: number; splits: string[] }[];
  const season = recorded.map((e) => e.value);

  return standardLines.map((line) => {
    const cells: Record<string, PropHitRateResult> = {};
    for (const w of windows) {
      const values = w.n === "season" ? season : season.slice(0, w.n);
      cells[w.key] = tallyPropHits(values, line, "over");
    }
    for (const key of splitKeys) {
      const values = recorded.filter((e) => e.splits.includes(key)).map((e) => e.value);
      cells[key] = tallyPropHits(values, line, "over");
    }
    return { line, cells };
  });
}

type GameLogRow = Awaited<ReturnType<typeof prisma.playerGameLog.findMany>>[number];

/** One batched query for every candidate's season logs, grouped by player id. */
async function seasonLogsByPlayer(playerIds: string[]): Promise<Map<string, GameLogRow[]>> {
  const year = new Date().getUTCFullYear();
  const logs = await prisma.playerGameLog.findMany({
    where: {
      mlbPlayerId: { in: playerIds },
      gameDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
    },
    orderBy: { gameDate: "desc" },
  });
  const byPlayer = new Map<string, GameLogRow[]>();
  for (const row of logs) {
    const list = byPlayer.get(row.mlbPlayerId) ?? [];
    list.push(row);
    byPlayer.set(row.mlbPlayerId, list);
  }
  return byPlayer;
}

/**
 * Attach the Archer Prop Projection to every line cell, IN PLACE. Needs the
 * whole population at once (not one entity at a time) because the projection
 * regresses each player toward the field's base rate at that exact line — so we
 * pool every row's season sample for line index i, then project each row's
 * line[i] against it. The board's lines all share the stat's standardLines, so
 * line index i means the same number across every row. (See props/projection.ts
 * for why the raw trailing rate needed this in the first place.)
 */
function attachProjections(rows: PropBoardRow[], stat: MlbStatDef): void {
  for (let i = 0; i < stat.standardLines.length; i++) {
    const pool = rows
      .map((r) => r.lines[i]?.cells.season)
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => ({ seasonHits: s.hits, seasonSample: s.sampleSize }));
    const base = pooledBaseRate(pool);
    // Pitcher counting stats ride a within-season workload ramp; the fitted term
    // de-biases them. undefined for every batting stat → no ramp (as intended).
    const ramp = pitcherRampFor(stat.column, stat.standardLines[i]);
    for (const row of rows) {
      const cell = row.lines[i];
      if (!cell) continue;
      const season = cell.cells.season;
      cell.projection = season
        ? projectPropHit(
            {
              seasonHits: season.hits,
              seasonSample: season.sampleSize,
              // L10 is the recency window the projection was fit on; every MLB view
              // exposes it. Fall back to null (no tilt) if a view ever drops it.
              recentRate: cell.cells.l10?.hitRate ?? null,
              baseRate: base,
            },
            { ramp }
          )
        : null;
    }
  }
}

/**
 * Server's default ordering: the Archer Prop Projection at the mid line — the
 * honest, backtested number, NOT the raw season/L10 rate (which the backtest
 * showed overstates hot players). Falls back to the raw season rate only if no
 * projection exists (no sample).
 */
function defaultRank(row: PropBoardRow): number {
  const mid = row.lines[Math.floor(row.lines.length / 2)] ?? row.lines[0];
  return mid?.projection?.probability ?? mid?.cells.season?.hitRate ?? -1;
}

interface Candidate {
  playerId: string;
  personId: number;
  name: string;
  meta: string | null;
}

/** Shared row assembly for a set of candidate entities + a stat/window/split config. */
function buildRows(
  candidates: Candidate[],
  logsByPlayer: Map<string, GameLogRow[]>,
  stat: MlbStatDef,
  windows: WindowDef[],
  splitKeys: string[],
  toEntry: (row: GameLogRow, column: string) => PropLogEntry
): PropBoardRow[] {
  const rows: PropBoardRow[] = [];
  for (const c of candidates) {
    const entries = (logsByPlayer.get(c.playerId) ?? []).map((r) => toEntry(r, stat.column));
    const lines = assembleLineCells(entries, stat.standardLines, windows, splitKeys);
    if (!lines.some((l) => (l.cells.season?.sampleSize ?? 0) > 0)) continue; // no data for this stat
    rows.push({
      sport: "mlb",
      id: `${c.playerId}:${stat.key}`,
      entityId: c.playerId,
      entityName: c.name,
      entityImageUrl: mlbHeadshotUrl(c.personId),
      meta: c.meta,
      statKey: stat.key,
      direction: "over",
      lines,
      ev: null,
    });
  }
  attachProjections(rows, stat);
  rows.sort((a, b) => defaultRank(b) - defaultRank(a));
  return rows;
}

function readColumn(row: GameLogRow, column: string): number | null {
  return (row as unknown as Record<string, number | null>)[column] ?? null;
}

async function buildBatterBoard(dateEt: string, statKey: string): Promise<PropBoardRow[]> {
  const stat = BATTER_STATS.find((s) => s.key === statKey) ?? BATTER_STATS[0];
  const { gte, lt } = etDayBoundsUtc(dateEt);

  const games = await prisma.game.findMany({
    where: { sport: "mlb", scheduledStartUtc: { gte, lt } },
    select: {
      id: true,
      homeTeam: { select: { id: true, abbreviation: true } },
      awayTeam: { select: { id: true, abbreviation: true } },
    },
  });

  const teamContext = new Map<string, string>();
  const teamIds: string[] = [];
  const gameIds: string[] = [];
  for (const g of games) {
    if (g.homeTeam && g.awayTeam) {
      teamContext.set(g.homeTeam.id, `vs ${g.awayTeam.abbreviation}`);
      teamContext.set(g.awayTeam.id, `@ ${g.homeTeam.abbreviation}`);
      teamIds.push(g.homeTeam.id, g.awayTeam.id);
      gameIds.push(g.id);
    }
  }
  if (teamIds.length === 0) return [];

  // Confirmed starters where the lineup has been posted; fall back to
  // recently-active players for teams whose lineup hasn't dropped yet.
  const lineupSlots = await prisma.lineupSlot.findMany({
    where: { gameId: { in: gameIds } },
    orderBy: { battingOrder: "asc" },
    select: { teamId: true, mlbPersonId: true, battingOrder: true },
  });
  const lineupByTeam = new Map<string, { personId: number; order: number }[]>();
  for (const s of lineupSlots) {
    const list = lineupByTeam.get(s.teamId) ?? [];
    list.push({ personId: s.mlbPersonId, order: s.battingOrder });
    lineupByTeam.set(s.teamId, list);
  }

  const lineupPersonIds = [...new Set(lineupSlots.map((s) => s.mlbPersonId))];
  const lineupPlayers = lineupPersonIds.length
    ? await prisma.mlbPlayer.findMany({
        where: { mlbPersonId: { in: lineupPersonIds } },
        select: { id: true, mlbPersonId: true, fullName: true },
      })
    : [];
  const playerByPerson = new Map(lineupPlayers.map((p) => [p.mlbPersonId, p]));

  const fallbackTeamIds = teamIds.filter((id) => !lineupByTeam.has(id));
  const recentByTeam = fallbackTeamIds.length ? await getRecentTeamPlayersBatch(fallbackTeamIds, 13) : {};

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const teamId of teamIds) {
    const context = teamContext.get(teamId) ?? null;
    const lineup = lineupByTeam.get(teamId);
    if (lineup) {
      for (const { personId, order } of lineup) {
        const p = playerByPerson.get(personId);
        if (!p || seen.has(p.id)) continue;
        seen.add(p.id);
        candidates.push({ playerId: p.id, personId: p.mlbPersonId, name: p.fullName, meta: context ? `#${order} · ${context}` : `#${order}` });
      }
    } else {
      for (const { player } of recentByTeam[teamId] ?? []) {
        if (seen.has(player.id)) continue;
        seen.add(player.id);
        candidates.push({ playerId: player.id, personId: player.mlbPersonId, name: player.fullName, meta: context });
      }
    }
  }
  if (candidates.length === 0) return [];

  const logsByPlayer = await seasonLogsByPlayer(candidates.map((c) => c.playerId));
  return buildRows(candidates, logsByPlayer, stat, BATTER_WINDOWS, BATTER_SPLIT_KEYS, (row, column) => {
    const hand = row.opposingStarterHand;
    return { value: readColumn(row, column), splits: hand === "L" ? ["vsLHP"] : hand === "R" ? ["vsRHP"] : [] };
  });
}

async function buildPitcherBoard(dateEt: string, statKey: string): Promise<PropBoardRow[]> {
  const stat = PITCHER_STATS.find((s) => s.key === statKey) ?? PITCHER_STATS[0];
  const { gte, lt } = etDayBoundsUtc(dateEt);

  const games = await prisma.game.findMany({
    where: { sport: "mlb", scheduledStartUtc: { gte, lt } },
    select: {
      homeTeam: { select: { abbreviation: true } },
      awayTeam: { select: { abbreviation: true } },
      homeProbablePitcher: { select: { mlbPersonId: true, fullName: true } },
      awayProbablePitcher: { select: { mlbPersonId: true, fullName: true } },
    },
  });

  // Probable starters, with the opponent they face for row context.
  const probables: { personId: number; name: string; meta: string }[] = [];
  for (const g of games) {
    if (g.homeProbablePitcher && g.awayTeam) {
      probables.push({ personId: g.homeProbablePitcher.mlbPersonId, name: g.homeProbablePitcher.fullName, meta: `vs ${g.awayTeam.abbreviation}` });
    }
    if (g.awayProbablePitcher && g.homeTeam) {
      probables.push({ personId: g.awayProbablePitcher.mlbPersonId, name: g.awayProbablePitcher.fullName, meta: `@ ${g.homeTeam.abbreviation}` });
    }
  }
  if (probables.length === 0) return [];

  // Pitchers live in the Pitcher table; their game logs live under MlbPlayer,
  // joined via the shared mlbPersonId (see getOpposingProbableHand's docstring).
  const players = await prisma.mlbPlayer.findMany({
    where: { mlbPersonId: { in: probables.map((p) => p.personId) } },
    select: { id: true, mlbPersonId: true },
  });
  const idByPerson = new Map(players.map((p) => [p.mlbPersonId, p.id]));

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const p of probables) {
    const playerId = idByPerson.get(p.personId);
    if (!playerId || seen.has(playerId)) continue;
    seen.add(playerId);
    candidates.push({ playerId, personId: p.personId, name: p.name, meta: p.meta });
  }
  if (candidates.length === 0) return [];

  const logsByPlayer = await seasonLogsByPlayer(candidates.map((c) => c.playerId));
  return buildRows(candidates, logsByPlayer, stat, PITCHER_WINDOWS, PITCHER_SPLIT_KEYS, (row, column) => ({
    value: readColumn(row, column),
    splits: row.isHome ? ["home"] : ["away"],
  }));
}

const batterView: PropView = {
  key: "batters",
  label: "Batters",
  stats: BATTER_STATS.map(({ key, label, shortLabel, role, standardLines }) => ({ key, label, shortLabel, role, standardLines })),
  columns: BATTER_COLUMNS,
  buildBoard: buildBatterBoard,
};

const pitcherView: PropView = {
  key: "pitchers",
  label: "Pitchers",
  stats: PITCHER_STATS.map(({ key, label, shortLabel, role, standardLines }) => ({ key, label, shortLabel, role, standardLines })),
  columns: PITCHER_COLUMNS,
  buildBoard: buildPitcherBoard,
};

export const mlbPropConfig: SportPropConfig = {
  sport: "mlb",
  label: "MLB",
  icon: "⚾",
  views: [batterView, pitcherView],
};
