/**
 * NFL adapter — phase 1 of docs/architecture/nfl-adapter.md: the feed, not the
 * model. Shaped after soccer.ts (real `ingest`, empty board) rather than mlb.ts,
 * on the doc's own advice: ship the feed before the model.
 *
 * Why NFL is worth this while MLB's model isn't sellable: the coverage audit found
 * NFL carrying 11 bettable books, Pinnacle, and 67–82 prop markets — more prop
 * breadth than MLB, on a provider we already pay for. That's a line-shopping
 * surface, which is the edge that actually survived backtesting
 * (docs/architecture/calibration.md), rather than another model that loses to the
 * close.
 *
 * `src/lib/nfl/model.ts` already holds a validated-on-free-data Elo model. It is
 * deliberately NOT wired to `model` here: per the calibration work, a model only
 * prices real plays after a CLV backtest says it beats the closing line, and NFL's
 * hasn't been run on live prices. Wiring it early is exactly the mistake the
 * project has made before.
 */
import { prisma } from "@/lib/prisma";
import { pollAndStoreNflOdds } from "@/lib/nfl/ingest";
import { sportMetaByKey } from "../sportsMeta";
import type { MarketType } from "@/generated/prisma/client";
import type { IngestSummary, MarketSpec, Play, PlayGrade, SportAdapter } from "../types";

/** Spreads and totals lead for NFL; the moneyline is the secondary market, unlike MLB. */
const NFL_MARKETS: MarketSpec[] = [
  { market: "spreads", kind: "spread", label: "Spread" },
  { market: "totals", kind: "total", label: "Total Points" },
  { market: "h2h", kind: "ml", label: "Moneyline" },
];

/** Pull NFL odds into the shared Game/odds tables. */
async function ingest(): Promise<IngestSummary> {
  const summary = await pollAndStoreNflOdds();
  return {
    sportKey: "nfl",
    ok: true,
    detail: `${summary.gamesStored} games, ${summary.snapshotsWritten} snapshots`,
    ...summary,
  };
}

/**
 * No board plays in phase 1. Not "no model" — the Elo model exists and is
 * calibrated on free history; it just hasn't been shown to beat a closing line,
 * so it prices nothing real. Phase 2 (line shopping, no EV claim) is what fills
 * the NFL surface next; see the adapter doc's phasing.
 */
async function listPlays(): Promise<Play[]> {
  return [];
}

/**
 * Grade one tracked NFL play against its settled game.
 *
 * Settlement lives in GameOutcome, written by the shared `gradeGame` off ESPN's
 * free scoreboard (see nfl/results.ts) — the same table and the same grader MLB
 * uses, so h2h/spreads/totals all settle without NFL-specific math. Not final,
 * or final but not yet graded → "pending"; a later pass settles it, and a
 * fabricated loss is never returned.
 */
async function grade(play: Play): Promise<PlayGrade> {
  const game = await prisma.game.findUnique({
    where: { id: play.eventRef },
    select: { status: true, homeTeamId: true, awayTeamId: true },
  });
  if (!game || game.status !== "final") return "pending";

  // Totals are graded once per game from the Over's perspective and stored
  // against both teams, so either team's row answers an over/under ask; the
  // home row is picked arbitrarily for that market.
  const teamId =
    play.selection.kind === "total"
      ? game.homeTeamId
      : play.selection.side === "home"
        ? game.homeTeamId
        : game.awayTeamId;
  if (!teamId) return "void";

  const outcome = await prisma.gameOutcome.findUnique({
    where: {
      gameId_teamId_marketType: {
        gameId: play.eventRef,
        teamId,
        marketType: play.selection.market as MarketType,
      },
    },
  });
  if (!outcome) return "pending"; // not graded yet — leave it for a later pass

  // A totals play stored from the Over's perspective must be flipped for Unders.
  if (play.selection.kind === "total" && play.selection.side === "under") {
    if (outcome.result === "hit") return "miss";
    if (outcome.result === "miss") return "hit";
    return "push";
  }
  return outcome.result as PlayGrade; // hit | miss | push
}

export const nflAdapter = {
  key: "nfl",
  meta: sportMetaByKey.nfl,
  markets: NFL_MARKETS,
  ingest,
  listPlays,
  grade,
} satisfies SportAdapter;
