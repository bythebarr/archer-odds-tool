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
import { playLine } from "@/lib/card/line";
import { gradeGameLine, gradeProp } from "@/lib/discord/gradePlay";
import { getTeamFormForGame } from "@/lib/queries/teamForm";
import { computeArcherWinProbability } from "@/lib/archer/winProbability";
import { RECENT_STARTS_LONG_WINDOW, RECENT_STARTS_SHORT_WINDOW } from "@/lib/archer/pitcherRecency";
import type { GameMatchup, PitcherInfo } from "@/lib/queries/matchup";
import type { CalibrationSample } from "../calibration";
import { STAT_COLUMN } from "@/lib/props/hitRate";
import { STAT_CATEGORY_LABELS } from "@/lib/props/format";
import { syncMlbSchedule, purgePreseasonGames } from "@/lib/mlb/syncSchedule";
import { syncProbablePitchers } from "@/lib/mlb/syncPitchers";
import { sportMetaByKey } from "../sportsMeta";
import { buildIngestSummary, classifyFetchStore, summaryForCaughtError } from "../ingestResult";
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

/**
 * Lookahead-safe backtest sampler for the Archer win-probability (moneyline)
 * model (Phase 4a). This is the reconstruction the winProbability.ts docstring
 * describes but that was NEVER committed — so the shrink-0.2 calibration was, until
 * now, unreproducible. For each settled game it rebuilds the matchup as it stood
 * BEFORE first pitch: each team's actual starter's ERA + starts computed only from
 * that pitcher's earlier game logs, and team form via getTeamFormForGame's `before`
 * cutoff. It then records the model favorite's probability vs. whether that side won.
 *
 * We compute as-of ERA straight from PlayerGameLog pitching lines rather than the
 * stored season aggregates, because those aggregates are full-season totals — using
 * them would leak the rest of the season's results into a historical projection.
 */
async function collectMlbSamples({ limit }: { limit: number }): Promise<CalibrationSample[]> {
  const games = await prisma.game.findMany({
    where: {
      sport: "mlb",
      status: "final",
      homeScore: { not: null },
      awayScore: { not: null },
      homeTeamId: { not: null },
      awayTeamId: { not: null },
    },
    orderBy: { scheduledStartUtc: "desc" }, // newest first (for the time split)
    take: limit,
    select: {
      id: true,
      season: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
      scheduledStartUtc: true,
    },
  });
  if (!games.length) return [];

  // Preload every starter pitching line once (indexed in memory) so as-of ERA is a
  // filter, not a query per starter. Restricted to the seasons actually in view.
  const seasons = [...new Set(games.map((g) => g.season))];
  const starterLogs = await prisma.playerGameLog.findMany({
    where: {
      isStarter: true,
      outsRecorded: { gt: 0 },
      earnedRuns: { not: null },
      game: { sport: "mlb", season: { in: seasons } },
    },
    select: {
      gameId: true,
      mlbPlayerId: true,
      teamId: true,
      gameDate: true,
      earnedRuns: true,
      outsRecorded: true,
      game: { select: { season: true } },
    },
  });

  // gameId → { teamId → starterId }: who actually started for each team that game.
  const starterByGameTeam = new Map<string, Map<string, string>>();
  // `${season}:${pitcherId}` → their starts, so as-of ERA is a date filter + reduce.
  type Start = { date: Date; er: number; outs: number };
  const startsByPitcher = new Map<string, Start[]>();
  for (const r of starterLogs) {
    let byTeam = starterByGameTeam.get(r.gameId);
    if (!byTeam) starterByGameTeam.set(r.gameId, (byTeam = new Map()));
    byTeam.set(r.teamId, r.mlbPlayerId);
    const key = `${r.game.season}:${r.mlbPlayerId}`;
    const list = startsByPitcher.get(key) ?? [];
    list.push({ date: r.gameDate, er: r.earnedRuns ?? 0, outs: r.outsRecorded ?? 0 });
    startsByPitcher.set(key, list);
  }
  // Sort each pitcher's starts chronologically once — asOfPitcher's last10/last5
  // recency windows need ascending date order, which Prisma's return order
  // doesn't guarantee (the season-ERA sum above didn't care about order).
  for (const list of startsByPitcher.values()) list.sort((a, b) => a.date.getTime() - b.date.getTime());

  const startSplitFrom = (starts: Start[]) => ({
    earnedRuns: starts.reduce((s, r) => s + r.er, 0),
    outsRecorded: starts.reduce((s, r) => s + r.outs, 0),
    starts: starts.length,
  });

  /** As-of ERA + starts (season, plus last-10/last-5-start recency splits) for a pitcher, from starts that finished before `before`. */
  const asOfPitcher = (
    season: number,
    pitcherId: string | undefined,
    before: Date
  ): PitcherInfo | null => {
    if (!pitcherId) return null;
    const prior = (startsByPitcher.get(`${season}:${pitcherId}`) ?? []).filter(
      (s) => s.date < before
    ); // already chronological — filter preserves the sorted order above
    const outs = prior.reduce((s, r) => s + r.outs, 0);
    if (outs === 0) return null; // no prior work this season — model treats ERA as unknown
    const er = prior.reduce((s, r) => s + r.er, 0);
    return {
      fullName: "",
      wins: 0,
      losses: 0,
      era: (27 * er) / outs, // 9 * ER / (outs/3)
      gamesStarted: prior.length,
      inningsPitched: outs / 3,
      last10Starts: startSplitFrom(prior.slice(-RECENT_STARTS_LONG_WINDOW)),
      last5Starts: startSplitFrom(prior.slice(-RECENT_STARTS_SHORT_WINDOW)),
      // Moneyline pricing (computeArcherWinProbability) never reads platoon
      // data — only computeExpectedRuns does — so this backtest leaves it
      // unset rather than reconstructing it for no consumer.
      pitchHand: null,
      platoonVsLeft: null,
      platoonVsRight: null,
    };
  };

  const samples: CalibrationSample[] = [];
  for (const g of games) {
    const before = g.scheduledStartUtc;
    const starters = starterByGameTeam.get(g.id);
    const { home: homeForm, away: awayForm } = await getTeamFormForGame(
      g.homeTeamId!,
      g.awayTeamId!,
      g.season,
      before
    );
    const matchup: GameMatchup = {
      homePitcher: asOfPitcher(g.season, starters?.get(g.homeTeamId!), before),
      awayPitcher: asOfPitcher(g.season, starters?.get(g.awayTeamId!), before),
      homeForm,
      awayForm,
      // Moneyline pricing (computeArcherWinProbability) never reads bullpen
      // data — only computeExpectedRuns does — so this backtest leaves it
      // unset rather than reconstructing it for no consumer.
      homeBullpen: null,
      awayBullpen: null,
      homeBullpenRecentWorkload: null,
      awayBullpenRecentWorkload: null,
      homeLineupMix: null,
      awayLineupMix: null,
    };
    const proj = computeArcherWinProbability(matchup);
    if (proj.homeProb === null || proj.awayProb === null) continue; // too thin to price

    const homeFav = proj.homeProb >= 0.5;
    const homeWon = g.homeScore! > g.awayScore!;
    samples.push({
      pred: homeFav ? proj.homeProb : proj.awayProb,
      won: homeFav === homeWon ? 1 : 0,
    });
  }
  return samples;
}

/** MLB has a game-line model (only sport that does today); this is metadata only. */
const MLB_MODEL: SportModel = {
  describes: "win probability (moneyline) + expected runs (spreads/totals)",
  backtest: { unit: "game moneyline", collect: collectMlbSamples },
  // From `npm run backtest:mlb` — the moneyline model is honest but edgeless
  // (Brier ~= base rate). Refresh when the model gains features or the season grows.
  calibration: {
    verdict: "marginal",
    brier: 0.2499,
    baseRateBrier: 0.2489,
    n: 1343,
    asOf: "2026-07-16",
  },
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
 *
 * Status is driven by the schedule window alone (games fetched vs. upserted) —
 * pitchers/purge ride along as detail, not the ok/empty/unusable decision,
 * since a probable-pitcher gap is normal for most of the forward window and
 * shouldn't paint the whole ingest "unusable". Zero games fetched for the
 * window is a legitimate empty slate (off-season) — never a fake failure.
 */
async function ingest(dateEt: string): Promise<IngestSummary> {
  try {
    const schedule = await syncMlbSchedule(shiftEtDate(dateEt, -7), shiftEtDate(dateEt, 6));
    const pitchers = await syncProbablePitchers(dateEt, shiftEtDate(dateEt, 6));
    const purge = await purgePreseasonGames();
    const { status, detail } = classifyFetchStore(
      { fetched: schedule.gamesFetched, stored: schedule.gamesUpserted },
      { noun: "games" }
    );
    return buildIngestSummary(
      "mlb",
      status,
      `${detail}; ${pitchers.pitchersUpserted} pitchers upserted`,
      { fetched: schedule.gamesFetched, stored: schedule.gamesUpserted },
      { schedule, pitchers, purge }
    );
  } catch (error) {
    return summaryForCaughtError("mlb", error);
  }
}

async function listPlays(dateEt: string): Promise<Play[]> {
  const { plays } = await getOddsPoolForDate(dateEt);
  return selectBoardPlays(plays).map((p) => toPlay(p, dateEt));
}

export const mlbAdapter = {
  key: "mlb",
  meta: sportMetaByKey.mlb,
  model: MLB_MODEL,
  markets: MLB_MARKETS,
  props: MLB_PROPS,
  ingest,
  listPlays,
  grade,
} satisfies SportAdapter;
