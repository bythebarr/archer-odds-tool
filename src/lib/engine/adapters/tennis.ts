/**
 * Tennis adapter (Phase 4b — modeled). Tennis now carries the surface-aware Elo
 * model (src/lib/tennis/elo.ts), trained + backtested on the free Sackmann archive
 * and cleared through the calibration trust gate. `listPlays` prices the live odds
 * feed against each player's current Elo (read from the precomputed TennisRating
 * snapshot), so the board's tennis section lights up with real +EV plays whenever
 * a tournament is live — and self-gates to empty off-event. See
 * docs/architecture/{sport-engine,calibration}.md.
 */
import { prisma } from "@/lib/prisma";
import { pollAndStoreTennisOdds } from "@/lib/tennis/ingest";
import { TennisElo, canonicalSurface, winProbFromRatings } from "@/lib/tennis/elo";
import { normalizeName } from "@/lib/tennis/archive";
import { getOddsPoolForDate, type OddsPlay } from "@/lib/queries/oddsPool";
import { calculateEv } from "@/lib/odds/devig";
import { unitsFor } from "@/lib/betting/kelly";
import { playLine } from "@/lib/card/line";
import { sportMetaByKey } from "../sportsMeta";
import type { CalibrationSample } from "../calibration";
import type {
  IngestSummary,
  MarketSpec,
  Play,
  PlayGrade,
  SportAdapter,
  SportModel,
} from "../types";

/** Tennis is head-to-head only in the feed we carry (no games/sets totals yet). */
const TENNIS_MARKETS: MarketSpec[] = [{ market: "h2h", kind: "ml", label: "Moneyline" }];

/** Below this many career matches for either player, Elo has too little signal to price. */
const MIN_MATCHES_FOR_SIGNAL = 10;

/**
 * Believability band on the model edge (mirrors UFC's, see docs/discord/OPERATIONS.md).
 * A sanity filter, NOT an edge: the CLV backtest (npm run backtest:tennis:clv, see
 * docs/architecture/calibration.md) proved this well-calibrated Elo does NOT beat modern
 * closing lines — betting its +EV picks loses ~1% at the best line, ~3% vs Pinnacle, in
 * recent years. So tennis model output is analytical (honest win prob + line-shop
 * highlight), SIGNAL-ONLY, never auto-posted as +EV picks. The band just drops the
 * implausible blowups (stale-model longshot disagreements) so the surfaced numbers stay
 * sane; it does not manufacture profitability.
 */
const MIN_MODEL_EV = 0.02;
const MAX_MODEL_EV = 0.2;

/**
 * Lookahead-safe backtest sampler for the surface-aware Elo model (tennis Phase 4b).
 * Replays the entire free Sackmann archive in chronological order through one Elo
 * instance; at each match, BEFORE applying it, records the model favorite's pre-match
 * probability vs. whether that favorite actually won — the same favorite convention
 * as UFC/MLB. The pre-match rating is by construction blind to the result, so there's
 * no leakage. Matches where either player is still cold (< MIN_MATCHES) are skipped so
 * the verdict reflects the model's real operating regime, not coin-flip cold starts.
 */
async function collectTennisSamples({ limit }: { limit: number }): Promise<CalibrationSample[]> {
  const matches = await prisma.tennisArchiveMatch.findMany({
    select: { winnerSackId: true, loserSackId: true, surface: true },
    orderBy: [{ tourneyDate: "asc" }, { matchNum: "asc" }],
  });

  const elo = new TennisElo();
  const chrono: CalibrationSample[] = [];
  for (const m of matches) {
    const surf = canonicalSurface(m.surface);
    if (
      elo.matchesPlayed(m.winnerSackId) >= MIN_MATCHES_FOR_SIGNAL &&
      elo.matchesPlayed(m.loserSackId) >= MIN_MATCHES_FOR_SIGNAL
    ) {
      // P(actual winner beats actual loser); favorite = higher model prob.
      const pWinner = elo.winProb(m.winnerSackId, m.loserSackId, surf);
      chrono.push({
        pred: pWinner >= 0.5 ? pWinner : 1 - pWinner,
        won: pWinner >= 0.5 ? 1 : 0,
      });
    }
    elo.update(m.winnerSackId, m.loserSackId, surf);
  }
  // Most-recent `limit` samples, newest-first (for the harness's time split).
  return chrono.slice(-limit).reverse();
}

/**
 * Surface-aware Elo — tennis's ARCHR model, built entirely on free Sackmann history
 * (zero Odds API credits). See src/lib/tennis/elo.ts + docs/architecture/calibration.md.
 */
const TENNIS_MODEL: SportModel = {
  describes: "surface-aware Elo win probability (overall + per-surface rating blend)",
  backtest: { unit: "match", collect: collectTennisSamples },
  // From `npm run backtest:tennis` (N=20000) — our strongest model by far: real
  // discrimination AND well-calibrated after the 0.75 shrink. Refresh after each
  // archive import (elo.ts's shrink is what holds the calibration).
  calibration: {
    verdict: "trusted",
    brier: 0.2187,
    baseRateBrier: 0.2301,
    n: 20000,
    asOf: "2026-07-16",
  },
};

/** Pull tennis odds into the shared Game/odds tables (mirrors the poll-odds-tennis cron). */
async function ingest(): Promise<IngestSummary> {
  const summary = await pollAndStoreTennisOdds();
  return {
    sportKey: "tennis",
    ok: true,
    detail: `${summary.matchesStored} matches, ${summary.snapshotsWritten} snapshots`,
    ...summary,
  };
}

/**
 * Map a priced tennis pool play onto the normalized `Play`. The generic card line
 * (`playLine`) renders in the shared capper voice once the play carries `modelEv`,
 * so tennis needs no bespoke formatter — it slots into the board like any modeled sport.
 */
function tennisToPlay(p: OddsPlay, postedForDate: string, modelEv: number): Play {
  return {
    sportKey: "tennis",
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
    modelEv,
    suggestedUnits: unitsFor(modelEv, p.bestPrice),
    display: {
      href: p.href,
      backed: p.backed,
      booksCount: p.booksCount,
      bestBookInitials: p.bestBookInitials,
      // Hand playLine an OddsPlay carrying our modelEv so it renders edge/units.
      line: playLine({ ...p, modelEv }),
    },
  };
}

/**
 * Price the live tennis odds feed against the Elo model — the board's +EV tennis
 * plays. Pulls the day's tennis h2h plays from the shared pool, matches each
 * competitor to their current Elo (via normalized name → TennisRating), computes
 * the model's win probability on the match surface, and keeps the plays where the
 * best price beats the model (modelEv > 0). Players we can't confidently match or
 * rate (name miss, or too few career matches) are skipped, never guessed.
 */
async function listPlays(dateEt: string): Promise<Play[]> {
  const { plays } = await getOddsPoolForDate(dateEt);
  const tennisPlays = plays.filter((p) => p.sport === "tennis" && p.kind === "ml");
  if (!tennisPlays.length) return [];

  // Surface per match (persisted at ingest from the tournament).
  const matchIds = [...new Set(tennisPlays.map((p) => p.matchId))];
  const games = await prisma.game.findMany({
    where: { id: { in: matchIds } },
    select: { id: true, surface: true },
  });
  const surfaceByMatch = new Map(games.map((g) => [g.id, canonicalSurface(g.surface)]));

  // Ratings by normalized name; on a norm collision keep the higher-sample player.
  const norms = new Set<string>();
  for (const p of tennisPlays) {
    norms.add(normalizeName(p.home.name));
    norms.add(normalizeName(p.away.name));
  }
  const ratingRows = await prisma.tennisRating.findMany({ where: { norm: { in: [...norms] } } });
  const ratingByNorm = new Map<string, (typeof ratingRows)[number]>();
  for (const r of ratingRows) {
    const prev = ratingByNorm.get(r.norm);
    if (!prev || r.nOverall > prev.nOverall) ratingByNorm.set(r.norm, r);
  }

  const out: Play[] = [];
  for (const p of tennisPlays) {
    const backed = ratingByNorm.get(normalizeName(p.side === "home" ? p.home.name : p.away.name));
    const opp = ratingByNorm.get(normalizeName(p.side === "home" ? p.away.name : p.home.name));
    if (!backed || !opp) continue; // couldn't match a player to a rating
    if (backed.nOverall < MIN_MATCHES_FOR_SIGNAL || opp.nOverall < MIN_MATCHES_FOR_SIGNAL) continue;

    const modelProb = winProbFromRatings(backed, opp, surfaceByMatch.get(p.matchId) ?? null);
    const modelEv = calculateEv(modelProb, p.bestPrice);
    // Believability band: a plausible edge, not a coin-flip or a stale-model blowup.
    if (modelEv < MIN_MODEL_EV || modelEv > MAX_MODEL_EV) continue;
    out.push(tennisToPlay(p, dateEt, modelEv));
  }
  return out.sort((a, b) => (b.modelEv ?? 0) - (a.modelEv ?? 0));
}

/**
 * Grade one tracked tennis play against its settled match, reading the backed
 * player's own GameOutcome h2h row.
 *
 * Those rows are written by src/lib/tennis/results.ts off ESPN's free scoreboard.
 * The odds provider still serves no tennis scores — this grader sat returning
 * "pending" for exactly as long as that was our only source, which is what
 * `signalOnly` described. ESPN filled the gap, the flag is cleared, and nothing
 * in here had to change: it was written against GameOutcome all along.
 *
 * "pending" is still the right answer for a match ESPN hasn't posted yet — the
 * next sync pass settles it, and a re-run regrades to the same value.
 */
async function grade(play: Play): Promise<PlayGrade> {
  const game = await prisma.game.findUnique({
    where: { id: play.eventRef },
    select: { status: true, homePlayerId: true, awayPlayerId: true },
  });
  if (!game || game.status !== "final") return "pending";
  const playerId = play.selection.side === "home" ? game.homePlayerId : game.awayPlayerId;
  if (!playerId) return "void";
  const outcome = await prisma.gameOutcome.findUnique({
    where: { gameId_playerId_marketType: { gameId: play.eventRef, playerId, marketType: "h2h" } },
  });
  if (!outcome) return "pending"; // not graded yet — leave for a later pass
  return outcome.result as PlayGrade; // hit | miss | push — all valid PlayResults
}

export const tennisAdapter = {
  key: "tennis",
  meta: sportMetaByKey.tennis,
  model: TENNIS_MODEL,
  markets: TENNIS_MARKETS,
  ingest,
  listPlays,
  grade,
} satisfies SportAdapter;
