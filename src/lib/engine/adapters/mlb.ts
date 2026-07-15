/**
 * MLB adapter (Phase 1). Wraps the existing MLB machinery — the Archer model +
 * odds pool (getOddsPoolForDate), Kelly sizing (unitsFor), and the pure graders
 * (gradeGameLine / gradeProp) — behind the sport-agnostic `SportAdapter`
 * contract. Nothing here re-implements pricing or grading; it maps the current
 * behavior onto the normalized `Play`, so `listPlays` reproduces today's card
 * byte-for-byte and `grade` reproduces `postResults.gradePending`'s MLB branch.
 *
 * See docs/architecture/sport-engine.md. This is the first of the two proving
 * adapters (MLB model + UFC fighter-math); once both fit one contract, the board,
 * ledger, grader, and nav can derive from the registry (Phase 3).
 */
import { prisma } from "@/lib/prisma";
import { shiftEtDate } from "@/lib/dateEt";
import { getOddsPoolForDate, type OddsPlay } from "@/lib/queries/oddsPool";
import { unitsFor } from "@/lib/betting/kelly";
import { playLine, mlbFreeLean } from "@/lib/card/line";
import { gradeGameLine, gradeProp } from "@/lib/discord/gradePlay";
import { STAT_COLUMN } from "@/lib/props/hitRate";
import { STAT_CATEGORY_LABELS } from "@/lib/props/format";
import { SPORT_META } from "@/lib/sports";
import { syncMlbSchedule, purgePreseasonGames } from "@/lib/mlb/syncSchedule";
import { syncProbablePitchers } from "@/lib/mlb/syncPitchers";
import type { StatCategory } from "@/generated/prisma/client";
import type {
  IngestSummary,
  MarketSpec,
  Play,
  PlayGrade,
  PropSpec,
  SportAdapter,
  SportModel,
} from "../types";

/** MLB's game markets, in the pool's compact vocabulary. */
const MLB_MARKETS: MarketSpec[] = [
  { market: "h2h", kind: "ml", label: "Moneyline" },
  { market: "spreads", kind: "spread", label: "Run Line" },
  { market: "totals", kind: "total", label: "Total" },
];

/** MLB's declared prop menu — derived from the existing StatCategory label map. */
const MLB_PROPS: PropSpec[] = (
  Object.entries(STAT_CATEGORY_LABELS) as [StatCategory, string][]
).map(([key, label]) => ({ key, label }));

/** MLB has a game-line model (only sport that does today); this is metadata only. */
const MLB_MODEL: SportModel = {
  describes: "win probability (moneyline) + expected runs (spreads/totals)",
};

/**
 * Map one priced pool play onto the normalized `Play`. Pure — the single point
 * where an MLB `OddsPlay` becomes engine currency, kept exported so the parity
 * test can assert it field-for-field against a fixture.
 *
 * `suggestedUnits` mirrors the card exactly: it sizes off the MODEL edge
 * (`unitsFor(modelEv, price)`), the same value recordPostedPlays stores. Plays
 * with no model edge fall back to the market edge so a market-only play still
 * carries a sane stake hint; the owner sets real units on /track regardless.
 */
export function toPlay(p: OddsPlay, postedForDate: string): Play {
  const evForUnits = p.modelEv ?? p.ev;
  return {
    sportKey: "mlb",
    playKey: p.key,
    eventRef: p.matchId,
    postedForDate,
    startUtc: p.startUtc,
    selection: {
      market: p.market,
      kind: p.kind,
      side: p.side,
      point: p.point,
      label: p.selectionLabel,
    },
    bestPrice: p.bestPrice,
    bestBookName: p.bestBookName,
    marketEv: p.ev,
    modelEv: p.modelEv,
    suggestedUnits: evForUnits !== null ? unitsFor(evForUnits, p.bestPrice) : 0.25,
    display: {
      href: p.href,
      backed: p.backed,
      playerImageUrl: p.playerImageUrl ?? null,
      playerName: p.playerName ?? null,
      bestBookInitials: p.bestBookInitials,
      booksCount: p.booksCount,
      // Pre-rendered here so the board concatenates lines with no MLB branch.
      line: playLine(p),
      freeLean: mlbFreeLean(p),
    },
  };
}

/**
 * The MLB board's +EV candidates: every pool play with a positive MODEL edge,
 * sorted by edge descending — byte-for-byte the selection postCard makes today
 * (`modelEv !== null && modelEv > 0`, re-sorted from the pool's market-ev order).
 * Model EV is non-null only for MLB game lines, so this is inherently MLB-only;
 * the explicit sport guard just states the intent. Exported for the parity test.
 */
export function selectBoardPlays(pool: OddsPlay[]): (OddsPlay & { modelEv: number })[] {
  return pool
    .filter(
      (p): p is OddsPlay & { modelEv: number } =>
        p.sport === "mlb" && p.modelEv !== null && p.modelEv > 0
    )
    .sort((a, b) => b.modelEv - a.modelEv);
}

/**
 * Recover a prop's grading inputs from its own playKey. The adapter owns the key
 * format (`${gameId}:prop:${mlbPlayerId}:${stat}:${side}:${point}`, see
 * oddsPool.propPlays), so parsing it keeps MLB-specific grading state out of the
 * shared `Play` type — the adapter reads only its own storage to settle.
 */
export function parsePropKey(key: string): { mlbPlayerId: string; stat: StatCategory } | null {
  const parts = key.split(":");
  if (parts.length !== 6 || parts[1] !== "prop") return null;
  return { mlbPlayerId: parts[2], stat: parts[3] as StatCategory };
}

/**
 * Grade one tracked MLB play against its settled game — the exact logic of
 * postResults.gradePending's MLB branch, returning `"pending"` wherever that code
 * leaves a row unsettled (a `continue`): game not final, or a prop whose game log
 * hasn't synced. We never turn a sync lag into a fake loss or a premature void.
 */
async function grade(play: Play): Promise<PlayGrade> {
  const game = await prisma.game.findUnique({ where: { id: play.eventRef } });
  if (!game || game.status !== "final" || game.homeScore === null || game.awayScore === null) {
    return "pending"; // not final yet — leave for a later pass
  }

  const { kind, market, side, point } = play.selection;

  if (kind === "prop") {
    const parsed = parsePropKey(play.playKey);
    if (!parsed || point === null) return "void"; // un-gradeable prop shape
    const log = await prisma.playerGameLog.findUnique({
      where: { mlbPlayerId_gameId: { mlbPlayerId: parsed.mlbPlayerId, gameId: game.id } },
    });
    if (!log) return "pending"; // log not synced yet (or DNP) — never a fake loss
    const value = (log as unknown as Record<string, number | null>)[STAT_COLUMN[parsed.stat]] ?? null;
    return gradeProp(side, point, value);
  }

  if (market) {
    return gradeGameLine(
      market as "h2h" | "spreads" | "totals",
      side,
      point,
      game.homeScore,
      game.awayScore
    );
  }
  return "void";
}

/**
 * Pull MLB's own data (schedule + probable pitchers, then purge preseason) — the
 * inputs to the Archer model and the pool. Mirrors the sync-schedule cron; odds
 * polling stays a shared step outside the adapter (it serves every sport). In
 * Phase 3 the cron becomes a thin wrapper over this.
 */
async function ingest(dateEt: string): Promise<IngestSummary> {
  const schedule = await syncMlbSchedule(shiftEtDate(dateEt, -7), shiftEtDate(dateEt, 6));
  const pitchers = await syncProbablePitchers(dateEt, shiftEtDate(dateEt, 6));
  const purge = await purgePreseasonGames();
  return {
    sportKey: "mlb",
    ok: true,
    detail: `${schedule.gamesUpserted} games, ${pitchers.pitchersUpserted} pitchers`,
    schedule,
    pitchers,
    purge,
  };
}

async function listPlays(dateEt: string): Promise<Play[]> {
  const { plays } = await getOddsPoolForDate(dateEt);
  return selectBoardPlays(plays).map((p) => toPlay(p, dateEt));
}

export const mlbAdapter: SportAdapter = {
  key: "mlb",
  meta: SPORT_META.mlb,
  model: MLB_MODEL,
  markets: MLB_MARKETS,
  props: MLB_PROPS,
  ingest,
  listPlays,
  grade,
};
