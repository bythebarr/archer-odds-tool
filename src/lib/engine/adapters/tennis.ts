/**
 * Tennis adapter (thin, Phase 4 lead-in). Tennis has an odds feed
 * (pollAndStoreTennisOdds) and a Slate presence, but no ARCHR model yet — so it
 * carries NO +EV board plays. It registers here so nav, the Slate list, and the
 * sport rail all derive from the ONE registry (Phase 3d) rather than a parallel
 * literal list; `listPlays` fills in when the paid-EV odds lens lights up (the
 * Slate's `ev` seam, see queries/slate.ts).
 *
 * Deliberately market-lite: meta + a real `ingest` wrapper, an empty board, and
 * a conservative `grade` (no tracked tennis plays exist to grade). See
 * docs/architecture/sport-engine.md.
 */
import { prisma } from "@/lib/prisma";
import { pollAndStoreTennisOdds } from "@/lib/tennis/ingest";
import { TennisElo, canonicalSurface } from "@/lib/tennis/elo";
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

/** No ARCHR tennis model yet → no +EV board plays. Lights up with the paid-EV lens. */
async function listPlays(): Promise<Play[]> {
  return [];
}

/** Tennis produces no tracked plays yet, so this never runs; void is the safe default. */
async function grade(): Promise<PlayGrade> {
  return "void";
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
